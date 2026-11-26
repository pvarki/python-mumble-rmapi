"""The app as a whole: settings, entrypoint, lifespan and who the mesh says is calling"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mumblermapi.app import create_app
from mumblermapi.config import Settings
from mumblermapi.store import DatabaseSettings
from mumblermapi.tak import TakSettings

from .conftest import AGENT


def test_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every setting comes from MUMBLERMAPI_* variables; TAK is off unless configured"""
    for name, value in {
        "MUMBLERMAPI_DATABASE_HOST": "db.example.fi",
        "MUMBLERMAPI_DATABASE_PORT": "6543",
        "MUMBLERMAPI_DATABASE_NAME": "voice",
        "MUMBLERMAPI_DATABASE_USER": "voiceapi",
        "MUMBLERMAPI_DATABASE_PASSWORD": "secret",  # pragma: allowlist secret
        "MUMBLERMAPI_TEMPLATES_DIR": "/t",
        "MUMBLERMAPI_UI_DIR": "/u",
        "MUMBLERMAPI_RMAPI_IDENTITY": "rm",
        "MUMBLERMAPI_AGENT_IDENTITY": "ag",
    }.items():
        monkeypatch.setenv(name, value)
    settings = Settings.from_env()
    assert settings == Settings(
        database=DatabaseSettings(
            host="db.example.fi",
            port=6543,
            name="voice",
            user="voiceapi",
            password="secret",  # pragma: allowlist secret
        ),
        templates_dir=Path("/t"),
        ui_dir=Path("/u"),
        rmapi_identity="rm",
        agent_identity="ag",
    )
    assert settings.tak is None


def test_console_entrypoint() -> None:
    """The container entrypoint is importable"""
    from mumblermapi import console

    assert callable(console.main)


def test_lifespan_runs_the_mission_watcher(database: DatabaseSettings, tmp_path: Path) -> None:
    """With TAK configured, the watcher runs for the app's life and stops with it"""
    tak_settings = TakSettings(
        tak_url="https://127.0.0.1:9", tak_server_name="tak.example.fi", cn="mumble.example.fi",
        rmapi_url="http://127.0.0.1:9/", data_dir=tmp_path / "tak", poll_seconds=60,
    )  # fmt: skip
    # Empty health URLs: the health check, which also runs for the app's life, asks nothing outside the test
    settings = Settings(
        database=database,
        ui_dir=tmp_path / "no-ui",
        tak=tak_settings,
        proxy_ready_url="",
        gateway_ready_url="",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.get("/api/v1/healthcheck").status_code == 200
        assert client.get("/ui/mumble/remoteEntry.js").status_code == 404


def test_mesh_identity(client: TestClient) -> None:
    """Without a Linkerd identity nobody is anyone, not even with a forged DN header"""
    assert client.get("/api/v1/admin/channels", headers={"X-ClientCert-DN": "CN=VOICE1"}).status_code == 403
    forged_via_other_service = {"l5d-client-id": AGENT, "X-ClientCert-DN": "CN=VOICE1"}
    assert client.get("/api/v1/admin/channels", headers=forged_via_other_service).status_code == 403
