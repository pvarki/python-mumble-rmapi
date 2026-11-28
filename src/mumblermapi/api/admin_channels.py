"""Admin routes for the nets: the Units/ tree and its members, plans in and out, and the mission nets"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse
from libpvarki.middleware import MTLSHeader

from ..channels import GUARD, ChannelPlanError, ChannelSpec, load_yaml, parse_plan
from ..store import Channel, NoSuchChannel, StoreError
from .deps import AdminDep, StoreDep
from .models import Callsign, ChannelEdit, NewChannel

LOGGER = logging.getLogger(__name__)
MAX_PLAN_BYTES = 1 << 20  # an imported channel plan; a full plan of 1000 nets with members is about half of this

router = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True))])


@router.get("/channels")
def list_channels(_: AdminDep, store: StoreDep) -> list[dict[str, Any]]:
    """The Units/ tree with members"""
    return [asdict(c) for c in store.tree()]


@router.post("/channels")
def create_channel(channel: NewChannel, who: AdminDep, store: StoreDep) -> dict[str, int]:
    """Create a Units/ channel"""
    try:
        parse_plan({"channels": [{"name": channel.name, "description": channel.description}]})
        channel_id = store.add_channel(channel.name, channel.description, channel.parent, channel.access)
    except (StoreError, ChannelPlanError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    LOGGER.info("%s created channel %r", who, channel.name)
    return {"id": channel_id}


@router.delete("/channels/{channel_id}")
def delete_channel(channel_id: int, who: AdminDep, store: StoreDep) -> None:
    """Remove a channel and everything under it"""
    try:
        store.remove_channel(channel_id)
    except StoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    LOGGER.info("%s removed channel %d", who, channel_id)


@router.patch("/channels/{channel_id}")
def edit_channel(channel_id: int, edit: ChannelEdit, who: AdminDep, store: StoreDep) -> None:
    """Rename a channel, change its description, or change who may use it"""
    try:
        if edit.name is not None:
            parse_plan({"channels": [{"name": edit.name}]})
        store.update_channel(channel_id, edit.name, edit.description, edit.access)
    except NoSuchChannel as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ChannelPlanError, StoreError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    LOGGER.info("%s edited channel %d", who, channel_id)


@router.delete("/channels")
def clear_channels(who: AdminDep, store: StoreDep) -> dict[str, int]:
    """Remove the whole channel plan; the voice server moves everyone out of the removed nets"""
    removed = store.clear()
    LOGGER.info("%s removed the channel plan, %d channels", who, removed)
    return {"removed": removed}


@router.put("/channels/{channel_id}/members/{callsign}")
def add_member(channel_id: int, callsign: Callsign, _: AdminDep, store: StoreDep) -> None:
    """Make a callsign a member of a channel"""
    if store.user(callsign) is None:
        raise HTTPException(status_code=404, detail=f"unknown callsign {callsign}")
    try:
        store.set_member(channel_id, callsign, True)
    except StoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/channels/{channel_id}/members/{callsign}")
def remove_member(channel_id: int, callsign: Callsign, _: AdminDep, store: StoreDep) -> None:
    """Take a callsign off a channel"""
    try:
        store.set_member(channel_id, callsign, False)
    except StoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _plan_of(channels: list[Channel]) -> list[dict[str, Any]]:
    return [
        {"name": c.name, "description": c.description, "access": c.access}
        | ({"members": sorted(c.members)} if c.members else {})
        | ({"channels": _plan_of(c.children)} if c.children else {})
        for c in channels
    ]


@router.get("/channels/export", response_class=PlainTextResponse)
def export_channels(_: AdminDep, store: StoreDep) -> str:
    """The tree in the 2022 channel plan schema"""
    return str(yaml.safe_dump({"channels": _plan_of(store.tree())}, allow_unicode=True, sort_keys=False))


@router.post("/channels/import")
async def import_channels(request: Request, who: AdminDep, store: StoreDep) -> dict[str, int]:
    """Add a channel plan (YAML, 2022 schema); existing channels are kept"""
    # The browser sends the client certificate to any site's request, so refuse the content types a cross-site
    # form can POST without a CORS preflight.
    if request.headers.get("content-type", "").split(";")[0].strip() not in ("application/yaml", "application/x-yaml"):
        raise HTTPException(status_code=415, detail="send the plan as application/yaml")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_PLAN_BYTES:
            raise HTTPException(status_code=413, detail=f"a channel plan may be at most {MAX_PLAN_BYTES} bytes")
    # Parsed and stored in the thread pool, as the other admin routes are, so a large plan stalls no other request
    try:
        plan: tuple[ChannelSpec, ...] = await run_in_threadpool(lambda: parse_plan(load_yaml(bytes(body))))
    except (ChannelPlanError, yaml.YAMLError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    created = await run_in_threadpool(store.import_plan, plan)
    LOGGER.info("%s imported a channel plan, %d new channels", who, created)
    return {"created": created}


@router.get("/missions")
def list_missions(_: AdminDep, store: StoreDep) -> list[dict[str, Any]]:
    """Guard, open to everyone, then the mission nets and their subscribers as last read from TAK; those are
    managed in TAK, not here"""
    return [{"name": GUARD, "members": [], "open": True}] + [
        {"name": name, "members": sorted(members), "open": False} for name, members in sorted(store.missions().items())
    ]
