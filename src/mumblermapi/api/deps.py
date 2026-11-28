"""Dependencies the routes share: who is calling, and the store"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request

from ..store import Store


def _cn(request: Request) -> str:
    return str(request.state.mtlsdn.get("CN", ""))


def from_rmapi(request: Request) -> None:
    """Only rmapi may send user lifecycle events"""
    if _cn(request) != request.app.state.settings.rmapi_identity:
        raise HTTPException(status_code=403)


def from_agent(request: Request) -> None:
    """Only the murmur pod's agent may read the desired state"""
    if _cn(request) != request.app.state.settings.agent_identity:
        raise HTTPException(status_code=403)


def admin_callsign(request: Request) -> str:
    """The caller must be a Deploy App admin"""
    callsign = _cn(request)
    user = request.app.state.store.user(callsign)
    if user is None or not user.admin or user.revoked:
        raise HTTPException(status_code=403)
    return callsign


def get_store(request: Request) -> Store:
    """The app's store"""
    store: Store = request.app.state.store
    return store


StoreDep = Annotated[Store, Depends(get_store)]
AdminDep = Annotated[str, Depends(admin_callsign)]
