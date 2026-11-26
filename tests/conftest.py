"""Shared fixtures: a throwaway PKI shaped like the platform's, and user ids"""

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

from mumblermapi.agent.userids import UserIds

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


@pytest.fixture(name="ids")
def ids_fixture(tmp_path: Path) -> UserIds:
    """User ids for the users of agent_helpers.murmur(), as the authenticator would have handed them out"""
    ids = UserIds(tmp_path / "ids.json")
    for name in ("VOICE1---a", "VOICE3---b", "BAD---c", "OTHER---d"):
        ids.get_or_assign(name)
    return ids
