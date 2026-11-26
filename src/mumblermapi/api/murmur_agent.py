"""What murmur-agent reads and reports: the state to enforce, and who is connected where"""

from __future__ import annotations

import json
import time
from dataclasses import asdict

from fastapi import APIRouter, Depends, Request, Response
from libpvarki.middleware import MTLSHeader

from ..tickets import public_key
from .deps import StoreDep, from_agent
from .models import PresenceReport

# murmur-agent reports presence at least every 30 s; older than this and nobody can say who is online
PRESENCE_TTL = 90.0

router = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True)), Depends(from_agent)])


@router.get("/state")
def agent_state(request: Request, store: StoreDep) -> Response:
    """Everything murmur-agent enforces; 304 while nothing has changed. The ticket key changes on every start
    while the store's version does not, so the ETag carries both."""
    version = store.version()
    ticket_key = public_key(request.app.state.ticket_key)
    etag = f"{version}-{ticket_key[:16]}"
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    all_users = store.users()
    body = {
        "version": version,
        "etag": etag,
        "ticket_keys": [ticket_key],
        "refused": sorted(u.callsign for u in all_users if u.revoked or u.voice_disabled),
        "units": [asdict(c) for c in store.tree()],
        "missions": [{"name": name, "members": sorted(members)} for name, members in sorted(store.missions().items())],
    }
    return Response(json.dumps(body), media_type="application/json", headers={"ETag": etag})


@router.post("/presence")
def agent_presence(report: PresenceReport, request: Request) -> None:
    """Who is connected where, for the admin UI; kept in memory only"""
    online: dict[str, list[str]] = {}
    for entry in report.sessions:
        online.setdefault(entry.callsign, []).append(entry.channel)
    request.app.state.presence = (time.monotonic(), online)


def presence_of(request: Request) -> dict[str, list[str]] | None:
    """Callsign (in Mumble's form) to nets, or None when murmur-agent has not reported lately"""
    received, online = request.app.state.presence
    if time.monotonic() - received > PRESENCE_TTL:
        return None
    return dict(online)
