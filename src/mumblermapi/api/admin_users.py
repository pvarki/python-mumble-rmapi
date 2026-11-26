"""Admin routes for the people: who is known and online, and whose voice is off"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from libpvarki.middleware import MTLSHeader

from ..identity import normalize_callsign
from .deps import AdminDep, StoreDep
from .models import VoiceSetting
from .murmur_agent import presence_of

LOGGER = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True))])


@router.get("/users")
def list_users(request: Request, _: AdminDep, store: StoreDep) -> list[dict[str, Any]]:
    """Every known callsign, for the member picker, with the nets each is connected to (None: unknown)"""
    online = presence_of(request)
    return [
        asdict(u) | {"uuid": None, "online": None if online is None else online.get(normalize_callsign(u.callsign), [])}
        for u in store.users()
    ]


@router.put("/users/{callsign}/voice")
def set_voice(callsign: str, setting: VoiceSetting, who: AdminDep, store: StoreDep) -> None:
    """Turn voice off or on for one callsign, without touching their Deploy App identity"""
    if store.user(callsign) is None:
        raise HTTPException(status_code=404, detail=f"unknown callsign {callsign}")
    store.set_user_flag(callsign, "voice_disabled", not setting.enabled)
    LOGGER.info("%s set voice %s for %s", who, "on" if setting.enabled else "off", callsign)
