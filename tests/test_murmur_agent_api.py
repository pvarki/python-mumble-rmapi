"""What murmur-agent reads and reports"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from mumblermapi.api import murmur_agent

from .conftest import AGENT, RMAPI, as_, user


def test_agent_state_and_versions(client: TestClient) -> None:
    """The agent gets the applied tree, then 304 until something changes"""
    assert client.get("/api/v1/agent/state", headers=as_("VOICE1")).status_code == 403
    first = client.get("/api/v1/agent/state", headers=as_(AGENT))
    state = first.json()
    assert state["refused"] == []
    assert [c["name"] for c in state["units"]] == ["10"]
    assert state["units"][0]["children"][0]["name"] == "101"
    etag = first.headers["ETag"]
    assert client.get("/api/v1/agent/state", headers=as_(AGENT) | {"If-None-Match": etag}).status_code == 304
    client.post("/api/v1/users/revoked", json=user("VOICE3"), headers=as_(RMAPI))
    changed = client.get("/api/v1/agent/state", headers=as_(AGENT) | {"If-None-Match": etag})
    assert changed.status_code == 200
    assert changed.json()["refused"] == ["VOICE3"]
    assert changed.json()["missions"] == []


def test_presence(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The agent reports who is where; admins see it per user; without fresh reports nobody knows"""
    users = client.get("/api/v1/admin/users", headers=as_("VOICE1")).json()
    assert {u["callsign"]: u["online"] for u in users} == {"VOICE1": None, "VOICE3": None}
    report = {"sessions": [{"callsign": "VOICE1", "channel": "/Units/10"}, {"callsign": "VOICE1", "channel": "/"}]}
    assert client.post("/api/v1/agent/presence", json=report, headers=as_("VOICE1")).status_code == 403
    assert client.post("/api/v1/agent/presence", json=report, headers=as_(AGENT)).status_code == 200
    users = client.get("/api/v1/admin/users", headers=as_("VOICE1")).json()
    assert {u["callsign"]: u["online"] for u in users} == {"VOICE1": ["/Units/10", "/"], "VOICE3": []}
    monkeypatch.setattr(murmur_agent, "PRESENCE_TTL", -1.0)
    assert all(u["online"] is None for u in client.get("/api/v1/admin/users", headers=as_("VOICE1")).json())
