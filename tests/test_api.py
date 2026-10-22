"""The mumblermapi integration API"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mumblermapi import api
from mumblermapi.api import Settings, create_app
from mumblermapi.tak import TakSettings

RMAPI = "rmapi.opendefence-system.serviceaccount.identity.linkerd.cluster.local"
AGENT = "murmur.app-mumble.serviceaccount.identity.linkerd.cluster.local"
TRAEFIK = "traefik.traefik-system.serviceaccount.identity.linkerd.cluster.local"
PLAN = "channels:\n  - name: 10\n    description: Alfa\n    channels:\n      - name: 101\n"


def as_(identity: str) -> dict[str, str]:
    """How a caller arrives in the mesh: services by Linkerd identity, people through Traefik with their cert DN"""
    if "." in identity:
        return {"l5d-client-id": identity}
    return {"l5d-client-id": TRAEFIK, "X-ClientCert-DN": f"CN={identity}"}


def user(callsign: str) -> dict[str, str]:
    """A UserCRUDRequest body"""
    return {"uuid": f"uuid-{callsign}", "callsign": callsign, "x509cert": ""}


@pytest.fixture(name="client")
def client_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """An app configured as in the cluster, with the company template applied by an admin"""
    monkeypatch.setenv("MTLS_TRUST_L5D", "1")
    monkeypatch.setenv("MTLS_REQUIRE_L5D", "1")
    monkeypatch.setenv("MTLS_TRUSTED_INGRESS_IDENTITIES", TRAEFIK)
    templates = tmp_path / "templates"
    templates.mkdir()
    (templates / "company.yaml").write_text(f"name: Komppania\ndescription: Vakiosuunnitelma\n{PLAN}")
    (templates / "broken.yaml").write_text("nets: []\n")
    (templates / "Company_2022.yaml").write_text(PLAN)  # an id the apply endpoint would refuse
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "remoteEntry.js").write_text("export {}")
    settings = Settings(
        database=tmp_path / "db.sqlite", templates_dir=templates, ui_dir=ui, rmapi_identity=RMAPI, agent_identity=AGENT
    )
    client = TestClient(create_app(settings))
    for callsign in ("VOICE1", "VOICE3"):
        assert client.post("/api/v1/users/created", json=user(callsign), headers=as_(RMAPI)).json()["success"]
    client.post("/api/v1/users/promoted", json=user("VOICE1"), headers=as_(RMAPI))
    applied = client.post("/api/v1/admin/templates/apply", json={"template": "company"}, headers=as_("VOICE1"))
    assert applied.json() == {"created": 2}
    return client


def test_user_events_only_from_rmapi(client: TestClient) -> None:
    """Anyone but rmapi is refused, and an unauthenticated caller too"""
    assert client.post("/api/v1/users/promoted", json=user("VOICE3"), headers=as_("VOICE3")).status_code == 403
    assert client.post("/api/v1/users/created", json=user("X")).status_code == 403


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


def test_admin_channel_management(client: TestClient) -> None:
    """Admins manage channels and members; others may not"""
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE3")).status_code == 403
    tree = client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()
    squad = tree[0]["children"][0]["id"]
    assert client.put(f"/api/v1/admin/channels/{squad}/members/VOICE3", headers=as_("VOICE1")).status_code == 200
    assert client.put(f"/api/v1/admin/channels/{squad}/members/GHOST", headers=as_("VOICE1")).status_code == 404
    assert client.put("/api/v1/admin/channels/999/members/VOICE3", headers=as_("VOICE1")).status_code == 404
    tree = client.get("/api/v1/admin/channels", headers=as_("VOICE1")).json()
    assert tree[0]["children"][0]["members"] == ["VOICE3"]
    assert client.delete(f"/api/v1/admin/channels/{squad}/members/VOICE3", headers=as_("VOICE1")).status_code == 200
    assert client.delete("/api/v1/admin/channels/999/members/VOICE3", headers=as_("VOICE1")).status_code == 404

    new = client.post(
        "/api/v1/admin/channels", json={"name": "07 TJ", "description": "Tulenjohto"}, headers=as_("VOICE1")
    )
    assert new.status_code == 200
    assert client.post("/api/v1/admin/channels", json={"name": "07 TJ"}, headers=as_("VOICE1")).status_code == 400
    assert client.post("/api/v1/admin/channels", json={"name": "a/b"}, headers=as_("VOICE1")).status_code == 400
    too_long = {"name": "08", "description": "x" * 1001}
    assert client.post("/api/v1/admin/channels", json=too_long, headers=as_("VOICE1")).status_code == 422
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
    merged = client.post(
        "/api/v1/admin/channels/import", content="a: &a {name: 40}\nchannels: [{<<: *a}]", headers=yaml_from
    )
    assert merged.status_code == 400 and "merge keys" in merged.json()["detail"]
    cross_site_form = as_("VOICE1") | {"Content-Type": "text/plain"}
    forged = client.post("/api/v1/admin/channels/import", content="channels:\n  - name: 30\n", headers=cross_site_form)
    assert forged.status_code == 415
    huge = client.post("/api/v1/admin/channels/import", content=b"#" * (api.MAX_PLAN_BYTES + 1), headers=yaml_from)
    assert huge.status_code == 413


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
    assert client.get("/api/v1/agent/state", headers=as_(AGENT)).json()["refused"] == ["VOICE3"]
    client.put("/api/v1/admin/users/VOICE3/voice", json={"enabled": True}, headers=as_("VOICE1"))
    assert client.get("/api/v1/agent/state", headers=as_(AGENT)).json()["refused"] == []


def test_demoted_and_revoked_admins_lose_access(client: TestClient) -> None:
    """Admin rights follow rmapi"""
    client.post("/api/v1/users/demoted", json=user("VOICE1"), headers=as_(RMAPI))
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE1")).status_code == 403
    client.post("/api/v1/users/promoted", json=user("VOICE1"), headers=as_(RMAPI))
    client.put("/api/v1/users/updated", json=user("VOICE1"), headers=as_(RMAPI))
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE1")).status_code == 200
    client.post("/api/v1/users/revoked", json=user("VOICE1"), headers=as_(RMAPI))
    assert client.get("/api/v1/admin/channels", headers=as_("VOICE1")).status_code == 403


def test_public_endpoints(client: TestClient) -> None:
    """Health and descriptions need no identity"""
    assert client.get("/api/v1/healthcheck").json()["healthy"] is True
    assert client.get("/api/v1/description/fi").json()["shortname"] == "mumble"
    assert client.get("/api/v1/description/de").status_code == 404


def test_v2_descriptions(client: TestClient) -> None:
    """rmui gets the tile, the admin entry and the remote's address; unknown languages fall back to English"""
    tile = client.get("/api/v2/description/fi").json()
    assert tile["title"] == "Puhe"
    assert tile["component"] == {"type": "component", "ref": "/ui/mumble/remoteEntry.js"}
    assert tile["icon"] == "ui/mumble/icon.svg"
    assert client.get("/api/v2/description/de").json()["language"] == "en"
    assert "members" in client.get("/api/v2/admin/description/en").json()["description"]
    remote = client.get("/ui/mumble/remoteEntry.js")
    assert remote.status_code == 200 and "javascript" in remote.headers["content-type"]
    assert remote.headers["cache-control"] == "no-cache"  # a new release shows on the next load
    assert client.get("/ui/mumble/%2e%2e/db.sqlite").status_code == 404


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


def test_mesh_identity(client: TestClient) -> None:
    """Without a Linkerd identity nobody is anyone, not even with a forged DN header"""
    assert client.get("/api/v1/admin/channels", headers={"X-ClientCert-DN": "CN=VOICE1"}).status_code == 403
    forged_via_other_service = {"l5d-client-id": AGENT, "X-ClientCert-DN": "CN=VOICE1"}
    assert client.get("/api/v1/admin/channels", headers=forged_via_other_service).status_code == 403


def test_console_entrypoint() -> None:
    """The container entrypoint is importable"""
    from mumblermapi import console

    assert callable(console.main)


def test_presence(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The agent reports who is where; admins see it per user; without fresh reports nobody knows"""
    users = client.get("/api/v1/admin/users", headers=as_("VOICE1")).json()
    assert {u["callsign"]: u["online"] for u in users} == {"VOICE1": None, "VOICE3": None}
    report = {"sessions": [{"callsign": "VOICE1", "channel": "/Units/10"}, {"callsign": "VOICE1", "channel": "/"}]}
    assert client.post("/api/v1/agent/presence", json=report, headers=as_("VOICE1")).status_code == 403
    assert client.post("/api/v1/agent/presence", json=report, headers=as_(AGENT)).status_code == 200
    users = client.get("/api/v1/admin/users", headers=as_("VOICE1")).json()
    assert {u["callsign"]: u["online"] for u in users} == {"VOICE1": ["/Units/10", "/"], "VOICE3": []}
    monkeypatch.setattr(api, "PRESENCE_TTL", -1.0)
    assert all(u["online"] is None for u in client.get("/api/v1/admin/users", headers=as_("VOICE1")).json())


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


def test_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every setting comes from MUMBLERMAPI_* variables; TAK is off unless configured"""
    for name, value in {
        "MUMBLERMAPI_DATABASE": "/d/db.sqlite",
        "MUMBLERMAPI_TEMPLATES_DIR": "/t",
        "MUMBLERMAPI_UI_DIR": "/u",
        "MUMBLERMAPI_RMAPI_IDENTITY": "rm",
        "MUMBLERMAPI_AGENT_IDENTITY": "ag",
    }.items():
        monkeypatch.setenv(name, value)
    settings = Settings.from_env()
    assert settings == Settings(
        database=Path("/d/db.sqlite"),
        templates_dir=Path("/t"),
        ui_dir=Path("/u"),
        rmapi_identity="rm",
        agent_identity="ag",
    )
    assert settings.tak is None


def test_lifespan_runs_the_mission_watcher(tmp_path: Path) -> None:
    """With TAK configured, the watcher runs for the app's life and stops with it"""
    tak_settings = TakSettings(
        tak_url="https://127.0.0.1:9", tak_server_name="tak.example.fi", cn="mumble.example.fi",
        rmapi_url="http://127.0.0.1:9/", data_dir=tmp_path / "tak", poll_seconds=60,
    )  # fmt: skip
    # Empty health URLs: the health check, which also runs for the app's life, asks nothing outside the test
    settings = Settings(
        database=tmp_path / "db.sqlite",
        ui_dir=tmp_path / "no-ui",
        tak=tak_settings,
        proxy_ready_url="",
        gateway_ready_url="",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.get("/api/v1/healthcheck").status_code == 200
        assert client.get("/ui/mumble/remoteEntry.js").status_code == 404


def test_templates(client: TestClient) -> None:
    """Admins list templates (broken files and unusable names skipped) and apply one; applying again adds
    nothing"""
    assert client.get("/api/v1/admin/templates", headers=as_("VOICE3")).status_code == 403
    assert client.get("/api/v1/admin/templates", headers=as_("VOICE1")).json() == [
        {"id": "company", "name": "Komppania", "description": "Vakiosuunnitelma", "nets": 2}
    ]
    apply = "/api/v1/admin/templates/apply"
    assert client.post(apply, json={"template": "company"}, headers=as_("VOICE1")).json() == {"created": 0}
    assert client.post(apply, json={"template": "nope"}, headers=as_("VOICE1")).status_code == 404
    assert client.post(apply, json={"template": "../etc"}, headers=as_("VOICE1")).status_code == 422
    cross_site_form = as_("VOICE1") | {"Content-Type": "text/plain"}
    assert client.post(apply, content='{"template": "company"}', headers=cross_site_form).status_code == 422


def test_templates_dir_missing(tmp_path: Path) -> None:
    """Without a templates directory there is simply nothing to offer"""
    settings = Settings(database=tmp_path / "db.sqlite", templates_dir=tmp_path / "none")
    assert api.templates(settings) == {}


def test_shipped_templates_are_offered() -> None:
    """Each template the image ships loads: templates() skips a file it cannot read with only a warning"""
    shipped = Path(__file__).parents[1] / "templates"
    offered = api.templates(Settings(templates_dir=shipped))
    assert "komppania" in offered
    assert sorted(offered) == sorted(path.stem for path in shipped.glob("*.yaml"))


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
