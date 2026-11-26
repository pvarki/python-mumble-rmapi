"""User lifecycle events from rmapi"""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import RMAPI, as_, user


def test_user_events_only_from_rmapi(client: TestClient) -> None:
    """Anyone but rmapi is refused, and an unauthenticated caller too"""
    assert client.post("/api/v1/users/promoted", json=user("VOICE3"), headers=as_("VOICE3")).status_code == 403
    assert client.post("/api/v1/users/created", json=user("X")).status_code == 403


def test_demoted_and_revoked_admins_lose_access(client: TestClient) -> None:
    """Admin rights follow rmapi"""
    client.post("/api/v1/users/demoted", json=user("VOICE1"), headers=as_(RMAPI))
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE1")).status_code == 403
    client.post("/api/v1/users/promoted", json=user("VOICE1"), headers=as_(RMAPI))
    client.put("/api/v1/users/updated", json=user("VOICE1"), headers=as_(RMAPI))
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE1")).status_code == 200
    client.post("/api/v1/users/revoked", json=user("VOICE1"), headers=as_(RMAPI))
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE1")).status_code == 403
