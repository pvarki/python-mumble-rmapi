"""What admins see and set per person"""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import AGENT, as_


def test_voice_off_for_one_callsign(client: TestClient) -> None:
    """Disabling voice refuses the callsign without revoking it"""
    users = client.get("/api/v1/admin/users", headers=as_("VOICE1")).json()
    assert [u["callsign"] for u in users] == ["VOICE1", "VOICE3"]
    assert all(u["uuid"] is None for u in users)
    assert (
        client.put("/api/v1/admin/users/VOICE3/voice", json={"enabled": False}, headers=as_("VOICE1")).status_code
        == 200
    )
    assert (
        client.put("/api/v1/admin/users/GHOST/voice", json={"enabled": False}, headers=as_("VOICE1")).status_code == 404
    )
    assert (
        client.put("/api/v1/admin/users/A%00B/voice", json={"enabled": False}, headers=as_("VOICE1")).status_code == 422
    )
    assert client.get("/api/v1/agent/state", headers=as_(AGENT)).json()["refused"] == ["VOICE3"]
    client.put("/api/v1/admin/users/VOICE3/voice", json={"enabled": True}, headers=as_("VOICE1"))
    assert client.get("/api/v1/agent/state", headers=as_(AGENT)).json()["refused"] == []
