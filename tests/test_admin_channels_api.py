"""Admins manage the nets: the Units/ tree, its members, plans in and out, and the mission nets"""

from __future__ import annotations

import yaml
from fastapi.testclient import TestClient

from mumblermapi.api.admin_channels import MAX_PLAN_BYTES
from mumblermapi.channels import MAX_DEPTH

from .conftest import RMAPI, as_, user


def test_admin_channel_management(client: TestClient) -> None:
    """Admins manage channels and members; others may not"""
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE3")).status_code == 403
    tree = client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()
    squad = tree[0]["children"][0]["id"]
    assert client.put(f"/api/v1/admin/channels/{squad}/members/VOICE3", headers=as_("VOICE1")).status_code == 200
    assert client.put(f"/api/v1/admin/channels/{squad}/members/GHOST", headers=as_("VOICE1")).status_code == 404
    assert client.put("/api/v1/admin/channels/999/members/VOICE3", headers=as_("VOICE1")).status_code == 404
    assert client.put(f"/api/v1/admin/channels/{squad}/members/A%00B", headers=as_("VOICE1")).status_code == 422
    tree = client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()
    assert tree[0]["children"][0]["members"] == ["VOICE3"]
    assert client.delete(f"/api/v1/admin/channels/{squad}/members/VOICE3", headers=as_("VOICE1")).status_code == 200
    assert client.delete("/api/v1/admin/channels/999/members/VOICE3", headers=as_("VOICE1")).status_code == 404
    assert client.delete(f"/api/v1/admin/channels/{squad}/members/A%00B", headers=as_("VOICE1")).status_code == 422

    new = client.post(
        "/api/v1/admin/channels", json={"name": "07 TJ", "description": "Tulenjohto"}, headers=as_("VOICE1")
    )
    assert new.status_code == 200
    assert client.post("/api/v1/admin/channels", json={"name": "07 TJ"}, headers=as_("VOICE1")).status_code == 400
    assert client.post("/api/v1/admin/channels", json={"name": "a/b"}, headers=as_("VOICE1")).status_code == 400
    too_long = {"name": "08", "description": "x" * 1001}
    assert client.post("/api/v1/admin/channels", json=too_long, headers=as_("VOICE1")).status_code == 422
    with_nul = {"name": "08", "description": "a\x00b"}
    assert client.post("/api/v1/admin/channels", json=with_nul, headers=as_("VOICE1")).status_code == 422
    cross_site_form = as_("VOICE1") | {"Content-Type": "text/plain"}
    assert client.post("/api/v1/admin/channels", content='{"name": "X"}', headers=cross_site_form).status_code == 422
    assert client.delete(f"/api/v1/admin/channels/{new.json()['id']}", headers=as_("VOICE1")).status_code == 200
    assert client.delete("/api/v1/admin/channels/999", headers=as_("VOICE1")).status_code == 404


def test_plan_export_and_import(client: TestClient) -> None:
    """Channel plans go out and come in as the 2022 YAML schema"""
    exported = client.get("/api/v1/admin/channels/export", headers=as_("VOICE1")).text
    assert "name: '10'" in exported and "name: '101'" in exported
    yaml_from = as_("VOICE1") | {"Content-Type": "application/yaml"}
    added = client.post(
        "/api/v1/admin/channels/import", content="channels:\n  - name: 20\n  - name: 10\n", headers=yaml_from
    )
    assert added.json() == {"created": 1}
    bad = client.post("/api/v1/admin/channels/import", content="nets: []", headers=yaml_from)
    assert bad.status_code == 400
    with_nul = 'channels:\n  - name: 30\n  - name: 31\n    description: "a\\0b"\n'
    assert client.post("/api/v1/admin/channels/import", content=with_nul, headers=yaml_from).status_code == 400
    assert [c["name"] for c in client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()] == ["10", "20"]
    merged = client.post(
        "/api/v1/admin/channels/import", content="a: &a {name: 40}\nchannels: [{<<: *a}]", headers=yaml_from
    )
    assert merged.status_code == 400 and "merge keys" in merged.json()["detail"]
    cross_site_form = as_("VOICE1") | {"Content-Type": "text/plain"}
    forged = client.post("/api/v1/admin/channels/import", content="channels:\n  - name: 30\n", headers=cross_site_form)
    assert forged.status_code == 415
    huge = client.post("/api/v1/admin/channels/import", content=b"#" * (MAX_PLAN_BYTES + 1), headers=yaml_from)
    assert huge.status_code == 413


def test_nets_nest_only_as_deep_as_murmur_takes(client: TestClient) -> None:
    """A net deeper than MAX_DEPTH is refused with the reason, whether made on its own or imported"""
    parent = 0
    for _ in range(MAX_DEPTH):
        made = client.post("/api/v1/admin/channels", json={"name": "x", "parent": parent}, headers=as_("VOICE1"))
        parent = made.json()["id"]
    deeper = client.post("/api/v1/admin/channels", json={"name": "y", "parent": parent}, headers=as_("VOICE1"))
    assert (deeper.status_code, deeper.json()["detail"]) == (400, f"nets nest at most {MAX_DEPTH} deep")
    net: dict[str, object] = {"name": "y"}
    for _ in range(MAX_DEPTH):
        net = {"name": "y", "channels": [net]}
    imported = client.post(
        "/api/v1/admin/channels/import",
        content=yaml.safe_dump({"channels": [net]}),
        headers=as_("VOICE1") | {"Content-Type": "application/yaml"},
    )
    assert imported.status_code == 400 and f"at most {MAX_DEPTH} deep" in imported.json()["detail"]


def test_missions(client: TestClient) -> None:
    """Admins see mission nets with subscribers; subscribers see theirs among their nets"""
    store = client.app.state.store  # type: ignore[attr-defined]
    store.set_missions({"RECON": frozenset({"VOICE3"}), "Guard": frozenset({"VOICE1"})})
    assert client.get("/api/v1/admin/missions", headers=as_("VOICE3")).status_code == 403
    assert client.get("/api/v1/admin/missions", headers=as_("VOICE1")).json() == [
        {"name": "Guard", "members": [], "open": True},
        {"name": "RECON", "members": ["VOICE3"], "open": False},
    ]
    data = client.post("/api/v2/clients/data", json=user("VOICE3"), headers=as_(RMAPI)).json()["data"]
    assert data["nets"] == ["/Missions/RECON"]


def test_edit_channel(client: TestClient) -> None:
    """Admins rename nets and change descriptions; clashes, bad names and unknown nets are refused"""
    tree = client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()
    platoon = tree[0]["id"]
    url = f"/api/v1/admin/channels/{platoon}"
    assert client.patch(url, json={"description": "Alfa-joukkue"}, headers=as_("VOICE3")).status_code == 403
    assert client.patch(url, json={"description": "Alfa-joukkue"}, headers=as_("VOICE1")).status_code == 200
    assert client.patch(url, json={"name": "11"}, headers=as_("VOICE1")).status_code == 200
    renamed = client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()[0]
    assert (renamed["name"], renamed["description"]) == ("11", "Alfa-joukkue")
    client.post("/api/v1/admin/channels", json={"name": "20"}, headers=as_("VOICE1"))
    assert client.patch(url, json={"name": "20"}, headers=as_("VOICE1")).status_code == 400
    assert client.patch(url, json={"name": "a/b"}, headers=as_("VOICE1")).status_code == 400
    assert client.patch(url, json={"description": "a\x00b"}, headers=as_("VOICE1")).status_code == 422
    assert client.patch("/api/v1/admin/channels/999", json={"name": "x"}, headers=as_("VOICE1")).status_code == 404


def test_channel_access(client: TestClient) -> None:
    """Admins make nets open or invite-only; the plan export keeps it"""
    created = client.post(
        "/api/v1/admin/channels", json={"name": "07 TJ", "access": "invite"}, headers=as_("VOICE1")
    ).json()
    url = f"/api/v1/admin/channels/{created['id']}"
    tree = {c["name"]: c for c in client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()}
    assert (tree["10"]["access"], tree["07 TJ"]["access"]) == ("open", "invite")
    assert tree["10"]["children"][0]["access"] == "inherit"
    assert client.patch(url, json={"access": "secret"}, headers=as_("VOICE1")).status_code == 422
    assert client.patch(url, json={"access": "open"}, headers=as_("VOICE1")).status_code == 200
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()[0]["access"] == "open"
    exported = client.get("/api/v1/admin/channels/export", headers=as_("VOICE1")).text
    assert "access: open" in exported and "access: inherit" in exported
    # The export restores the plan as it was, members included
    client.put(url + "/members/VOICE3", headers=as_("VOICE1"))
    exported = client.get("/api/v1/admin/channels/export", headers=as_("VOICE1")).text
    assert client.delete("/api/v1/admin/channels", headers=as_("VOICE1")).status_code == 200
    yaml_from = as_("VOICE1") | {"Content-Type": "application/yaml"}
    client.post("/api/v1/admin/channels/import", content=exported, headers=yaml_from)
    restored = {c["name"]: c for c in client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()}
    assert (restored["07 TJ"]["access"], restored["07 TJ"]["members"]) == ("invite", ["VOICE3"])


def test_clear_plan(client: TestClient) -> None:
    """Admins remove the whole plan at once"""
    assert client.delete("/api/v1/admin/channels", headers=as_("VOICE3")).status_code == 403
    assert client.delete("/api/v1/admin/channels", headers=as_("VOICE1")).json() == {"removed": 2}
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json() == []
