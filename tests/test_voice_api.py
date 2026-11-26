"""Voice tickets from mumblermapi"""

from __future__ import annotations

import base64
import time
from pathlib import Path
from urllib.parse import quote

import pytest
from cryptography.hazmat.primitives.serialization import Encoding
from fastapi.testclient import TestClient

from mumblermapi.app import create_app
from mumblermapi.config import Settings
from mumblermapi.store import DatabaseSettings
from mumblermapi.tickets import verify

from .conftest import AGENT, RMAPI, TRAEFIK, Issued, Pki, as_, issue, user


def forwarded(*certs: Issued) -> dict[str, str]:
    """Traefik's X-Forwarded-Tls-Client-Cert: PEM bodies, leaf first, comma-separated, URL-escaped"""
    value = ",".join(base64.b64encode(c.der).decode() for c in certs)
    return {"X-Forwarded-Tls-Client-Cert": quote(value, safe="")}


def edge(*certs: Issued) -> dict[str, str]:
    """A browser's JSON request through Traefik"""
    return {"l5d-client-id": TRAEFIK, "Content-Type": "application/json"} | forwarded(*certs)


@pytest.fixture(name="client")
def client_fixture(pki: Pki, database: DatabaseSettings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """mumblermapi trusting the fixture PKI, which knows ALPHA 1 and BRAVO 2"""
    monkeypatch.setenv("MTLS_TRUST_L5D", "1")
    monkeypatch.setenv("MTLS_REQUIRE_L5D", "1")
    monkeypatch.setenv("MTLS_TRUSTED_INGRESS_IDENTITIES", TRAEFIK)
    bundle = tmp_path / "ca.pem"
    bundle.write_bytes(pki.root.cert.public_bytes(Encoding.PEM) + pki.ca.cert.public_bytes(Encoding.PEM))
    settings = Settings(
        database=database,
        templates_dir=tmp_path,
        ui_dir=tmp_path / "none",
        rmapi_identity=RMAPI,
        agent_identity=AGENT,
        ca_bundle=bundle,
    )
    client = TestClient(create_app(settings))
    for callsign in ("ALPHA 1", "BRAVO 2"):
        client.post("/api/v1/users/created", json=user(callsign), headers=as_(RMAPI))
    return client


LAPTOP = {"browser": "laptop-browser-01"}
PHONE = {"browser": "phone-browser-0002"}


def _keys(client: TestClient) -> frozenset[str]:
    return frozenset(client.get("/api/v1/agent/state", headers=as_(AGENT)).json()["ticket_keys"])


def test_ticket_binds_the_slot_to_the_verified_leaf(client: TestClient, pki: Pki) -> None:
    """The agent's published key verifies the ticket, which carries the caller's own leaf"""
    response = client.post("/api/v1/voice/token", json=LAPTOP, headers=edge(pki.alpha, pki.ca))
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "ALPHA_1---web-1"
    leaf = verify(body["ticket"], _keys(client), "ALPHA_1---web-1", time.time())
    assert leaf == pki.alpha.der


def _username(client: TestClient, cert: Issued, browser: dict[str, str]) -> str:
    response = client.post("/api/v1/voice/token", json=browser, headers=edge(cert))
    assert response.status_code == 200
    return str(response.json()["username"])


def test_each_browser_keeps_its_own_slot(client: TestClient, pki: Pki) -> None:
    """Two browsers of one callsign never share a slot, and a browser that comes back keeps its own"""
    assert _username(client, pki.alpha, LAPTOP) == "ALPHA_1---web-1"
    assert _username(client, pki.alpha, PHONE) == "ALPHA_1---web-2"
    assert _username(client, pki.alpha, LAPTOP) == "ALPHA_1---web-1"


def test_browser_id_counts_only_within_the_callsign(client: TestClient, pki: Pki) -> None:
    """The callsign comes from the certificate, so another person's browser id moves nobody else"""
    assert _username(client, pki.alpha, LAPTOP) == "ALPHA_1---web-1"
    assert _username(client, pki.alpha, PHONE) == "ALPHA_1---web-2"
    assert _username(client, issue("BRAVO 2", pki.ca), PHONE) == "BRAVO_2---web-1"
    assert _username(client, pki.alpha, LAPTOP) == "ALPHA_1---web-1"


@pytest.mark.parametrize(
    "headers",
    [
        {"l5d-client-id": RMAPI, "Content-Type": "application/json"},  # not through the edge
        {"Content-Type": "application/json"},  # not meshed at all
        {"l5d-client-id": TRAEFIK, "Content-Type": "application/json"},  # no certificate
        {"l5d-client-id": TRAEFIK, "Content-Type": "application/json", "X-Forwarded-Tls-Client-Cert": "%%%"},
    ],
)
def test_refuses_without_the_edge_and_a_certificate(client: TestClient, headers: dict[str, str]) -> None:
    """Only Traefik's forwarded certificate counts"""
    assert client.post("/api/v1/voice/token", json=LAPTOP, headers=headers).status_code == 403


def test_refuses_a_certificate_from_another_ca(client: TestClient) -> None:
    """A self-made CA's certificate for a known callsign is refused"""
    rogue = issue("Rogue CA", ca=True)
    response = client.post("/api/v1/voice/token", json=LAPTOP, headers=edge(issue("ALPHA 1", rogue)))
    assert response.status_code == 403


def test_refuses_unknown_revoked_and_disabled(client: TestClient, pki: Pki) -> None:
    """Tickets fail closed: the callsign must be known (404 tells the UI to say so), unrevoked and have voice on"""
    stranger = issue("CHARLIE 3", pki.ca)
    assert client.post("/api/v1/voice/token", json=LAPTOP, headers=edge(stranger)).status_code == 404
    bravo = issue("BRAVO 2", pki.ca)
    assert client.post("/api/v1/voice/token", json=LAPTOP, headers=edge(bravo)).status_code == 200
    client.post("/api/v1/users/promoted", json=user("ALPHA 1"), headers=as_(RMAPI))
    voice_off = client.put("/api/v1/admin/users/BRAVO 2/voice", json={"enabled": False}, headers=as_("ALPHA 1"))
    assert voice_off.status_code == 200
    assert client.post("/api/v1/voice/token", json=LAPTOP, headers=edge(bravo)).status_code == 403
    client.post("/api/v1/users/revoked", json=user("ALPHA 1"), headers=as_(RMAPI))
    assert client.post("/api/v1/voice/token", json=LAPTOP, headers=edge(pki.alpha)).status_code == 403


@pytest.mark.parametrize("content_type", ["text/plain", None])
def test_refuses_what_a_cross_site_page_can_send(client: TestClient, pki: Pki, content_type: str | None) -> None:
    """A form, a beacon or a no-cors fetch cannot send application/json, and FastAPI parses JSON bodies only"""
    headers = {k: v for k, v in edge(pki.alpha).items() if k != "Content-Type"}
    if content_type:
        headers["Content-Type"] = content_type
    response = client.post("/api/v1/voice/token", content=b'{"browser": "laptop-browser-01"}', headers=headers)
    assert response.status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"browser": "a" * 15},
        {"browser": "a" * 65},
        {"browser": "laptop_browser_01"},
        {"browser": "laptop-browser-01\n"},
        {"browser": 1234567890123456},
        {},
        {"slot": 3},  # the old request, when each browser picked its own slot
        LAPTOP | {"username": "BRAVO_2---web-1"},
    ],
)
def test_refuses_bad_browser_ids_and_other_fields(client: TestClient, pki: Pki, body: dict[str, object]) -> None:
    """A browser id is 16 to 64 letters, digits and dashes, and the caller cannot name a slot or anyone"""
    assert client.post("/api/v1/voice/token", json=body, headers=edge(pki.alpha)).status_code == 422


def test_no_bundle_no_tickets(database: DatabaseSettings, tmp_path: Path, pki: Pki) -> None:
    """Without the CA bundle nothing can be checked, so nothing is minted"""
    settings = Settings(database=database, ca_bundle=tmp_path / "missing.pem", ui_dir=tmp_path / "x")
    client = TestClient(create_app(settings))
    assert client.post("/api/v1/voice/token", json=LAPTOP, headers=edge(pki.alpha)).status_code == 503


def test_restart_changes_the_etag(client: TestClient, tmp_path: Path, pki: Pki) -> None:
    """A new ticket key reaches an agent that holds the old store version's ETag"""
    first = client.get("/api/v1/agent/state", headers=as_(AGENT))
    etag = first.headers["ETag"]
    assert first.json()["etag"] == etag and len(first.json()["ticket_keys"]) == 1
    assert client.get("/api/v1/agent/state", headers=as_(AGENT) | {"If-None-Match": etag}).status_code == 304
    restarted = TestClient(create_app(client.app.state.settings))  # type: ignore[attr-defined]
    again = restarted.get("/api/v1/agent/state", headers=as_(AGENT) | {"If-None-Match": etag})
    assert again.status_code == 200
    assert again.json()["version"] == first.json()["version"]
    assert again.json()["ticket_keys"] != first.json()["ticket_keys"]
