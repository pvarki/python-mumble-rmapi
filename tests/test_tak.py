"""Reading TAK missions and their subscribers"""

from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding

from mumblermapi import tak
from mumblermapi.store import Store
from mumblermapi.tak import TakSettings, mission_names, needs_enrolment, subscribers

from .conftest import NOW, Pki, issue

MISSIONS = {"data": [{"name": "RECON"}, {"name": "OP/ODIN"}, {"name": "LOCKED"}, {"name": "NOBODY"}]}
SUBSCRIBERS = {
    "RECON": {"data": [{"username": "VOICE1", "clientUid": "a"}, {"username": "VOICE3"}, {"clientUid": "x"}]},
    # Missions takrmapi made, subscribed only by TAK's own service identity
    "NOBODY": {"data": [{"username": "tak.example.fi"}]},
}


def test_settings_from_env() -> None:
    """Missions are off unless TAK is configured"""
    assert TakSettings.from_env({}) is None
    settings = TakSettings.from_env(
        {
            "MUMBLERMAPI_TAK_URL": "https://tak-server:8443/",
            "MUMBLERMAPI_TAK_SERVER_NAME": "tak.example.fi",
            "MUMBLERMAPI_TAK_CN": "mumble.example.fi",
            "MUMBLERMAPI_TAK_POLL_SECONDS": "5",
        }
    )
    assert settings is not None
    assert settings.tak_url == "https://tak-server:8443"
    assert settings.poll_seconds == 5.0
    assert settings.cert.name == "tak.pem" and settings.key.name == "tak.key"


def test_parsing() -> None:
    """Names Murmur would refuse get no net; subscriptions without a username are skipped"""
    assert mission_names(MISSIONS) == ["RECON", "LOCKED", "NOBODY"]
    assert mission_names({"data": [{"name": "RECON\n"}]}) == []  # "$" alone would let the newline through
    assert subscribers(SUBSCRIBERS["RECON"]) == {"VOICE1", "VOICE3"}


def test_needs_enrolment(tmp_path: Path, pki: Pki) -> None:
    """Enrol when there is no certificate or it expires within a week"""
    cert = tmp_path / "tak.pem"
    assert needs_enrolment(cert, NOW)
    cert.write_bytes(
        issue("mumble.example.fi", pki.ca, not_after=NOW + timedelta(days=30)).cert.public_bytes(Encoding.PEM)
    )
    assert not needs_enrolment(cert, NOW)
    assert needs_enrolment(cert, NOW + timedelta(days=25))


def fake_services(pki: Pki, calls: list[str], interop_ok: bool = True) -> web.Application:
    """rmapi's product endpoints and TAK's mission API in one app"""

    async def sign(request: web.Request) -> web.Response:
        csr = x509.load_pem_x509_csr(str((await request.json())["csr"]).encode())
        calls.append("sign:" + csr.subject.rfc4514_string())
        pem = issue("mumble.example.fi", pki.ca).cert.public_bytes(Encoding.PEM).decode()
        return web.json_response({"certificate": pem.replace("\n", "\\n"), "ca": ""})

    async def interop(request: web.Request) -> web.Response:
        body = await request.json()
        calls.append("interop:" + body["certcn"])
        return web.json_response({"success": interop_ok, "error": None if interop_ok else "nope"})

    async def missions(_: web.Request) -> web.Response:
        return web.Response(text=json.dumps(MISSIONS), content_type="application/json")

    async def roles(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        if name not in SUBSCRIBERS:
            raise web.HTTPForbidden()
        return web.json_response(SUBSCRIBERS[name])

    app = web.Application()
    app.router.add_post("/api/v1/product/sign_csr/mtls", sign)
    app.router.add_post("/api/v1/product/interop/tak", interop)
    app.router.add_get("/Marti/api/missions", missions)
    app.router.add_get("/Marti/api/missions/{name}/subscriptions/roles", roles)
    return app


async def _cycle(
    pki: Pki, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, interop_ok: bool = True
) -> tuple[Store, TakSettings, list[str]]:
    calls: list[str] = []
    server = TestServer(fake_services(pki, calls, interop_ok))
    await server.start_server()
    try:
        base = str(server.make_url("/"))
        settings = TakSettings(
            tak_url=base.rstrip("/"), tak_server_name="tak.example.fi", cn="mumble.example.fi",
            rmapi_url=base, data_dir=tmp_path / "tak", poll_seconds=0.01,
        )  # fmt: skip
        store = Store(tmp_path / "db.sqlite")
        stop = asyncio.Event()
        monkeypatch.setattr(tak, "tls_context", lambda _: False)
        original = store.set_missions

        def set_and_stop(missions: dict[str, frozenset[str]]) -> bool:
            stop.set()
            return original(missions)

        monkeypatch.setattr(store, "set_missions", set_and_stop)
        task = asyncio.create_task(tak.watch(store, settings, stop))
        await asyncio.wait_for(_until(lambda: stop.is_set() or len(calls) >= 4), 5)
        stop.set()
        await task
        return store, settings, calls
    finally:
        await server.close()


async def _until(condition: Any) -> None:
    while not condition():
        await asyncio.sleep(0.01)


def test_enrols_then_reads_missions(pki: Pki, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A certificate from rmapi, TAK rights via interop, then missions with subscribers into the store"""
    store, settings, calls = asyncio.run(_cycle(pki, tmp_path, monkeypatch))
    assert calls[:2] == ["sign:CN=mumble.example.fi", "interop:mumble.example.fi"]
    assert store.missions() == {"RECON": frozenset({"VOICE1", "VOICE3"})}
    assert settings.cert.exists() and settings.key.exists()
    assert settings.key.stat().st_mode & 0o077 == 0


def test_refused_interop_keeps_old_identity(pki: Pki, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """If takrmapi refuses, the identity in use stays as it was (none here) and no missions are read"""
    store, settings, calls = asyncio.run(_cycle(pki, tmp_path, monkeypatch, interop_ok=False))
    assert "interop:mumble.example.fi" in calls
    assert not settings.cert.exists() and not settings.key.exists()
    assert store.missions() == {}


def test_refused_interop_is_retried_with_the_same_certificate(
    pki: Pki, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """rmapi signs once; later polls retry only the interop, and the accepted retry installs that certificate"""
    _, settings, calls = asyncio.run(_cycle(pki, tmp_path, monkeypatch, interop_ok=False))
    assert calls.count("sign:CN=mumble.example.fi") == 1 and calls.count("interop:mumble.example.fi") >= 2
    pending = (settings.data_dir / "tak.pem.new").read_bytes()
    store, settings, calls = asyncio.run(_cycle(pki, tmp_path, monkeypatch))
    assert calls[0] == "interop:mumble.example.fi" and "sign:CN=mumble.example.fi" not in calls
    assert settings.cert.read_bytes() == pending and settings.key.exists()
    assert store.missions() == {"RECON": frozenset({"VOICE1", "VOICE3"})}


def test_tls_context_presents_our_certificate(pki: Pki, tmp_path: Path) -> None:
    """TAK is verified against the platform bundle only"""
    from cryptography.hazmat.primitives.serialization import NoEncryption, PrivateFormat

    issued = issue("mumble.example.fi", pki.ca)
    (tmp_path / "tak.pem").write_bytes(issued.cert.public_bytes(Encoding.PEM))
    (tmp_path / "tak.key").write_bytes(issued.key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))
    (tmp_path / "ca.pem").write_bytes(pki.ca.cert.public_bytes(Encoding.PEM))
    settings = TakSettings(
        tak_url="https://x", tak_server_name="tak.example.fi", cn="mumble.example.fi",
        ca_bundle=tmp_path / "ca.pem", data_dir=tmp_path,
    )  # fmt: skip
    context = tak.tls_context(settings)
    assert context.check_hostname and len(context.get_ca_certs()) == 1
