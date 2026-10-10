"""Usernames, certificate verification and name binding"""

from pathlib import Path

import pytest
from cryptography.hazmat.primitives.serialization import Encoding
from cryptography.x509.oid import ExtendedKeyUsageOID

from mumblermapi.identity import CertVerifier, IdentityError, Username, bind, normalize_callsign, parse_username

from .conftest import NOW, Pki, issue


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ALPHA_1---3f2a9c", Username("ALPHA_1", "3f2a9c")),
        ("ALPHA_1---VS2-x_y", Username("ALPHA_1", "VS2-x_y")),
        ("ALPHA_1", Username("ALPHA_1", "")),
    ],
)
def test_parse_username(raw: str, expected: Username) -> None:
    """Vx/XVoice usernames and bare callsigns parse"""
    assert parse_username(raw) == expected


@pytest.mark.parametrize("raw", ["", "---slot", " ALPHA", "ALPHA---", "ALPHA---bad slot", "ALPHA---" + "x" * 65])
def test_parse_username_rejects(raw: str) -> None:
    """Anything else is refused"""
    with pytest.raises(IdentityError):
        parse_username(raw)


def test_normalize_callsign() -> None:
    """Spaces become underscores, as clients send them"""
    assert normalize_callsign(" ALPHA 1 ") == "ALPHA_1"


def _verifier(pki: Pki) -> CertVerifier:
    return CertVerifier([pki.root.cert, pki.ca.cert])


def test_verify_leaf_only(pki: Pki) -> None:
    """A client that sends only its leaf verifies against the bundle"""
    identity = _verifier(pki).verify([pki.alpha.der], NOW)
    assert identity.callsign == "ALPHA 1"
    assert identity.issuer == pki.ca.cert


def test_verify_full_chain(pki: Pki) -> None:
    """A client that sends its whole chain verifies too"""
    identity = _verifier(pki).verify([pki.alpha.der, pki.ca.der, pki.root.der], NOW)
    assert identity.leaf == pki.alpha.cert


def test_verify_from_pem_bundle(pki: Pki, tmp_path: Path) -> None:
    """The trust-manager bundle loads as a PEM file"""
    bundle = tmp_path / "ca-cert.pem"
    bundle.write_bytes(pki.root.cert.public_bytes(Encoding.PEM) + pki.ca.cert.public_bytes(Encoding.PEM))
    assert CertVerifier.from_pem_file(bundle).verify([pki.alpha.der], NOW).callsign == "ALPHA 1"


def test_verify_rejects_foreign_ca(pki: Pki) -> None:
    """A certificate from another CA is refused, even with its own chain attached"""
    other_root = issue("Other Root", ca=True)
    stranger = issue("ALPHA 1", other_root)
    with pytest.raises(IdentityError, match="untrusted"):
        _verifier(pki).verify([stranger.der, other_root.der], NOW)


def test_verify_rejects_expired(pki: Pki) -> None:
    """Expired certificates are refused"""
    expired = issue("ALPHA 1", pki.ca, not_before=NOW.replace(year=2025), not_after=NOW.replace(year=2026, month=1))
    with pytest.raises(IdentityError, match="untrusted"):
        _verifier(pki).verify([expired.der], NOW)


def test_verify_rejects_server_only_eku(pki: Pki) -> None:
    """A certificate that is not for client auth is refused"""
    server = issue("ALPHA 1", pki.ca, eku=[ExtendedKeyUsageOID.SERVER_AUTH])
    with pytest.raises(IdentityError, match="untrusted"):
        _verifier(pki).verify([server.der], NOW)


def test_verify_rejects_missing_and_garbage(pki: Pki) -> None:
    """No certificate, or bytes that are not one, are refused"""
    with pytest.raises(IdentityError, match="no client certificate"):
        _verifier(pki).verify([], NOW)
    with pytest.raises(IdentityError, match="unparseable"):
        _verifier(pki).verify([b"not a certificate"], NOW)


def test_verifier_needs_trust() -> None:
    """An empty bundle is a configuration error, not trust-everything"""
    with pytest.raises(ValueError):
        CertVerifier([])


def test_verify_rejects_blank_cn(pki: Pki) -> None:
    """A certificate must name exactly one callsign"""
    blank = issue(" ", pki.ca)
    with pytest.raises(IdentityError, match="CN"):
        _verifier(pki).verify([blank.der], NOW)


def test_bind(pki: Pki) -> None:
    """The username's callsign must be the certificate's"""
    identity = _verifier(pki).verify([pki.alpha.der], NOW)
    bind(Username("ALPHA_1", "slot"), identity)
    with pytest.raises(IdentityError, match="does not match"):
        bind(Username("BRAVO_2", "slot"), identity)
