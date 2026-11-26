"""What rmapi asks on a user's behalf"""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import RMAPI, as_, user


def test_client_data(client: TestClient) -> None:
    """rmapi asks for a user's view on their behalf: nets, admin flag and whether voice works"""
    squad = client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()[0]["children"][0]["id"]
    client.put(f"/api/v1/admin/channels/{squad}/members/VOICE3", headers=as_("VOICE1"))
    assert client.post("/api/v2/clients/data", json=user("VOICE3"), headers=as_("VOICE3")).status_code == 403
    data = client.post("/api/v2/clients/data", json=user("VOICE3"), headers=as_(RMAPI)).json()["data"]
    assert data == {"admin": False, "voice": True, "nets": ["/Units/10/101"]}
    client.patch(f"/api/v1/admin/channels/{squad}", json={"access": "inherit"}, headers=as_("VOICE1"))
    data = client.post("/api/v2/clients/data", json=user("VOICE3"), headers=as_(RMAPI)).json()["data"]
    assert data["nets"] == []  # a kept membership lets nobody in
    client.patch(f"/api/v1/admin/channels/{squad}", json={"access": "invite"}, headers=as_("VOICE1"))
    assert client.post("/api/v2/clients/data", json=user("VOICE1"), headers=as_(RMAPI)).json()["data"]["admin"]
    client.put("/api/v1/admin/users/VOICE3/voice", json={"enabled": False}, headers=as_("VOICE1"))
    assert not client.post("/api/v2/clients/data", json=user("VOICE3"), headers=as_(RMAPI)).json()["data"]["voice"]
    stranger = client.post("/api/v2/clients/data", json=user("NEW"), headers=as_(RMAPI)).json()["data"]
    assert stranger == {"admin": False, "voice": True, "nets": []}
