"""What rmapi asks on a user's behalf: the data the UI remote shows them"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from libpvarki.middleware import MTLSHeader
from libpvarki.schemas.product import UserCRUDRequest

from ..store import Channel
from .deps import StoreDep, from_rmapi

router = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True)), Depends(from_rmapi)])


@router.post("/data")
def client_data(user: UserCRUDRequest, store: StoreDep) -> dict[str, dict[str, Any]]:
    """What the UI remote shows this user"""
    record = store.user(user.callsign)
    nets: list[str] = []

    def walk(channels: list[Channel], path: str) -> None:
        for channel in channels:
            here = f"{path}/{channel.name}"
            # Kept members of a net that is not members-only are not let in by it
            if channel.access == "invite" and user.callsign in channel.members:
                nets.append(here)
            walk(channel.children, here)

    walk(store.tree(), "/Units")
    nets += [f"/Missions/{name}" for name, members in sorted(store.missions().items()) if user.callsign in members]
    return {
        "data": {
            "admin": bool(record and record.admin and not record.revoked),
            # Callsigns mumblermapi has not heard of yet are not refused either
            "voice": not (record and (record.revoked or record.voice_disabled)),
            "nets": nets,
        }
    }
