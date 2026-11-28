"""Shared fixtures: a throwaway PKI shaped like the platform's, a Postgres, the API as the cluster runs it, and
user ids"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from fastapi.testclient import TestClient
from pytest_docker.plugin import Services
from sqlmodel import SQLModel

from mumblermapi.agent.userids import UserIds
from mumblermapi.app import create_app
from mumblermapi.config import Settings
from mumblermapi.store import DatabaseSettings, Store, engine

# Today, so certificates the code checks against the real clock are valid when the tests run
NOW = datetime.now(UTC).replace(microsecond=0)


@dataclass(frozen=True)
class Issued:
    """A certificate and its key"""

    cert: x509.Certificate
    key: ec.EllipticCurvePrivateKey

    @property
    def der(self) -> bytes:
        """DER, as Murmur hands it over"""
        return self.cert.public_bytes(Encoding.DER)


def _name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def issue(
    cn: str,
    issuer: Issued | None = None,
    *,
    ca: bool = False,
    eku: list[x509.ObjectIdentifier] | None = None,
    not_before: datetime = NOW - timedelta(days=1),
    not_after: datetime = NOW + timedelta(days=30),
) -> Issued:
    """Issue a certificate; self-signed when no issuer is given"""
    key = ec.generate_private_key(ec.SECP256R1())
    signer_key = issuer.key if issuer else key
    issuer_name = issuer.cert.subject if issuer else _name(cn)
    builder = (
        x509.CertificateBuilder()
        .subject_name(_name(cn))
        .issuer_name(issuer_name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(not_before)
        .not_valid_after(not_after)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(signer_key.public_key()),
            critical=False,
        )
    )
    if ca:
        builder = builder.add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        builder = builder.add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
    else:
        builder = builder.add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        builder = builder.add_extension(
            x509.ExtendedKeyUsage(eku if eku is not None else [ExtendedKeyUsageOID.CLIENT_AUTH]), critical=False
        )
    return Issued(cert=builder.sign(signer_key, hashes.SHA256()), key=key)


@dataclass(frozen=True)
class Pki:
    """The fixture PKI"""

    root: Issued
    ca: Issued
    alpha: Issued  # CN "ALPHA 1", a valid client


@pytest.fixture(scope="session", name="pki")
def pki_fixture() -> Pki:
    """Root -> CA -> client"""
    root = issue("Test External Root", ca=True)
    ca = issue("Test External CA", root, ca=True)
    return Pki(root=root, ca=ca, alpha=issue("ALPHA 1", ca))


@pytest.fixture(scope="session", name="postgres")
def postgres_fixture(docker_ip: str, docker_services: Services) -> DatabaseSettings:
    """The Postgres from docker-compose.yml, up and ready"""
    port = docker_services.port_for("postgres", 5432)
    return DatabaseSettings(host=docker_ip, port=port, password="mumbletestpwd")  # pragma: allowlist secret


@pytest.fixture(name="database")
def database_fixture(postgres: DatabaseSettings) -> DatabaseSettings:
    """The test Postgres with no tables, so each test starts from an empty store"""
    SQLModel.metadata.drop_all(engine(postgres.url))
    return postgres


@pytest.fixture(name="store")
def store_fixture(database: DatabaseSettings) -> Store:
    """A fresh store"""
    return Store(engine(database.url))


@pytest.fixture(name="ids")
def ids_fixture(tmp_path: Path) -> UserIds:
    """User ids for the users of agent_helpers.murmur(), as the authenticator would have handed them out"""
    ids = UserIds(tmp_path / "ids.json")
    for name in ("VOICE1---a", "VOICE3---b", "BAD---c", "OTHER---d"):
        ids.get_or_assign(name)
    return ids


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
def client_fixture(database: DatabaseSettings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
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
        database=database, templates_dir=templates, ui_dir=ui, rmapi_identity=RMAPI, agent_identity=AGENT
    )
    client = TestClient(create_app(settings))
    for callsign in ("VOICE1", "VOICE3"):
        assert client.post("/api/v1/users/created", json=user(callsign), headers=as_(RMAPI)).json()["success"]
    client.post("/api/v1/users/promoted", json=user("VOICE1"), headers=as_(RMAPI))
    applied = client.post("/api/v1/admin/templates/apply", json={"template": "company"}, headers=as_("VOICE1"))
    assert applied.json() == {"created": 2}
    return client
