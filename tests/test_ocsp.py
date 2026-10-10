"""OCSP revocation checks"""

from __future__ import annotations

import io
import urllib.request
from datetime import timedelta
from typing import Any

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.serialization import Encoding
from cryptography.x509 import ocsp
from cryptography.x509.oid import AuthorityInformationAccessOID, ExtendedKeyUsageOID

from mumblermapi.identity import Identity
from mumblermapi.ocsp import OcspChecker, OcspUnavailable, http_post, responder_url

from .conftest import NOW, Issued, Pki, issue

URL = "http://rmapi.test/api/v1/ocsp"


def _identity(pki: Pki, leaf: Issued | None = None) -> Identity:
    leaf = leaf or pki.alpha
    return Identity(callsign="ALPHA 1", leaf=leaf.cert, issuer=pki.ca.cert)


def _response(
    pki: Pki,
    status: ocsp.OCSPCertStatus = ocsp.OCSPCertStatus.GOOD,
    *,
    leaf: Issued | None = None,
    signer: Issued | None = None,
    certificates: list[x509.Certificate] | None = None,
    this_update: timedelta = timedelta(minutes=-1),
    next_update: timedelta | None = timedelta(hours=1),
) -> bytes:
    leaf = leaf or pki.alpha
    signer = signer or pki.ca
    builder = ocsp.OCSPResponseBuilder().add_response(
        cert=leaf.cert,
        issuer=pki.ca.cert,
        algorithm=hashes.SHA256(),
        cert_status=status,
        this_update=NOW + this_update,
        next_update=NOW + next_update if next_update is not None else None,
        revocation_time=NOW - timedelta(hours=1) if status == ocsp.OCSPCertStatus.REVOKED else None,
        revocation_reason=None,
    )
    builder = builder.responder_id(ocsp.OCSPResponderEncoding.HASH, signer.cert)
    if certificates:
        builder = builder.certificates(certificates)
    return builder.sign(signer.key, hashes.SHA256()).public_bytes(Encoding.DER)


class FakeFetch:
    """Stands in for the responder"""

    def __init__(self, *answers: bytes | Exception) -> None:
        self.answers = list(answers)
        self.requests: list[tuple[str, bytes]] = []

    def __call__(self, url: str, body: bytes, timeout: float) -> bytes:
        self.requests.append((url, body))
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


class FakeClock:
    """Monotonic time we control"""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _checker(fetch: FakeFetch, clock: FakeClock | None = None) -> OcspChecker:
    return OcspChecker(url_override=URL, cache_seconds=300, fetch=fetch, clock=clock or FakeClock())


def test_good_is_cached(pki: Pki) -> None:
    """A good answer is reused until the cache expires"""
    fetch = FakeFetch(_response(pki), _response(pki))
    clock = FakeClock()
    checker = _checker(fetch, clock)
    assert checker.is_revoked(_identity(pki), NOW) is False
    assert checker.is_revoked(_identity(pki), NOW) is False
    assert len(fetch.requests) == 1
    clock.now += 301
    assert checker.is_revoked(_identity(pki), NOW) is False
    assert len(fetch.requests) == 2


def test_request_names_the_certificate(pki: Pki) -> None:
    """The request asks about the client's serial, at the configured URL"""
    fetch = FakeFetch(_response(pki))
    _checker(fetch).is_revoked(_identity(pki), NOW)
    url, body = fetch.requests[0]
    assert url == URL
    assert ocsp.load_der_ocsp_request(body).serial_number == pki.alpha.cert.serial_number


def test_revoked_is_permanent(pki: Pki) -> None:
    """Once revoked, always revoked: the responder is not asked again"""
    fetch = FakeFetch(_response(pki, ocsp.OCSPCertStatus.REVOKED))
    clock = FakeClock()
    checker = _checker(fetch, clock)
    assert checker.is_revoked(_identity(pki), NOW) is True
    clock.now += 10_000
    assert checker.is_revoked(_identity(pki), NOW) is True
    assert len(fetch.requests) == 1


def test_unknown_is_refused(pki: Pki) -> None:
    """A certificate the responder does not know is treated as revoked"""
    assert _checker(FakeFetch(_response(pki, ocsp.OCSPCertStatus.UNKNOWN))).is_revoked(_identity(pki), NOW) is True


def test_unreachable_refuses_unknown_certificates(pki: Pki) -> None:
    """With no previous answer, an unreachable responder means no entry"""
    with pytest.raises(OcspUnavailable):
        _checker(FakeFetch(OcspUnavailable("down"))).is_revoked(_identity(pki), NOW)


def test_unreachable_keeps_known_good(pki: Pki) -> None:
    """A certificate answered good before stays good while the responder is down"""
    fetch = FakeFetch(_response(pki), OcspUnavailable("down"))
    clock = FakeClock()
    checker = _checker(fetch, clock)
    assert checker.is_revoked(_identity(pki), NOW) is False
    clock.now += 301
    assert checker.is_revoked(_identity(pki), NOW) is False
    assert len(fetch.requests) == 2


def test_delegated_responder(pki: Pki) -> None:
    """A responder certificate issued by the CA for OCSP signing is accepted"""
    delegate = issue("OCSP", pki.ca, eku=[ExtendedKeyUsageOID.OCSP_SIGNING])
    body = _response(pki, signer=delegate, certificates=[delegate.cert])
    assert _checker(FakeFetch(body)).is_revoked(_identity(pki), NOW) is False


@pytest.mark.parametrize("case", ["no_ocsp_eku", "foreign_issuer", "no_eku"])
def test_delegated_responder_rejected(pki: Pki, case: str) -> None:
    """Delegates that are not the CA's OCSP signers are refused"""
    if case == "no_ocsp_eku":
        delegate = issue("OCSP", pki.ca, eku=[ExtendedKeyUsageOID.CLIENT_AUTH])
    elif case == "foreign_issuer":
        delegate = issue("OCSP", issue("Other", ca=True), eku=[ExtendedKeyUsageOID.OCSP_SIGNING])
    else:
        delegate = issue("OCSP", pki.root, ca=True)
    body = _response(pki, signer=delegate, certificates=[delegate.cert])
    with pytest.raises(OcspUnavailable):
        _checker(FakeFetch(body)).is_revoked(_identity(pki), NOW)


def test_forged_signature(pki: Pki) -> None:
    """A response signed by anyone but the CA is refused"""
    forger = issue("Forger", ca=True)
    with pytest.raises(OcspUnavailable, match="signature"):
        _checker(FakeFetch(_response(pki, signer=forger))).is_revoked(_identity(pki), NOW)


def test_rsa_responder(pki: Pki) -> None:
    """An RSA-keyed CA's signature verifies too"""
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(x509.oid.NameOID.COMMON_NAME, "RSA CA")])
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(NOW - timedelta(days=1))
        .not_valid_after(NOW + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    rsa_ca = Issued(cert=ca_cert, key=key)  # type: ignore[arg-type]
    leaf = issue("ALPHA 1", rsa_ca)
    body = (
        ocsp.OCSPResponseBuilder()
        .add_response(
            cert=leaf.cert,
            issuer=ca_cert,
            algorithm=hashes.SHA256(),
            cert_status=ocsp.OCSPCertStatus.GOOD,
            this_update=NOW,
            next_update=None,
            revocation_time=None,
            revocation_reason=None,
        )
        .responder_id(ocsp.OCSPResponderEncoding.NAME, ca_cert)
        .sign(key, hashes.SHA256())
        .public_bytes(Encoding.DER)
    )
    identity = Identity(callsign="ALPHA 1", leaf=leaf.cert, issuer=ca_cert)
    assert _checker(FakeFetch(body)).is_revoked(identity, NOW) is False


def test_other_certificate(pki: Pki) -> None:
    """A response about another serial does not answer for this one"""
    other = issue("BRAVO 2", pki.ca)
    with pytest.raises(OcspUnavailable, match="does not cover"):
        _checker(FakeFetch(_response(pki, leaf=other))).is_revoked(_identity(pki), NOW)


@pytest.mark.parametrize(
    ("this_update", "next_update", "match"),
    [
        (timedelta(hours=1), timedelta(hours=2), "future"),
        (timedelta(hours=-3), timedelta(hours=-2), "stale"),
    ],
)
def test_response_freshness(pki: Pki, this_update: timedelta, next_update: timedelta, match: str) -> None:
    """Responses from the future or past their next update are refused"""
    body = _response(pki, this_update=this_update, next_update=next_update)
    with pytest.raises(OcspUnavailable, match=match):
        _checker(FakeFetch(body)).is_revoked(_identity(pki), NOW)


def test_unsuccessful_and_garbage(pki: Pki) -> None:
    """Error responses and junk are not answers"""
    refused = ocsp.OCSPResponseBuilder.build_unsuccessful(ocsp.OCSPResponseStatus.UNAUTHORIZED)
    with pytest.raises(OcspUnavailable, match="refused"):
        _checker(FakeFetch(refused.public_bytes(Encoding.DER))).is_revoked(_identity(pki), NOW)
    with pytest.raises(OcspUnavailable, match="unparseable"):
        _checker(FakeFetch(b"junk")).is_revoked(_identity(pki), NOW)


def test_url_from_certificate(pki: Pki) -> None:
    """Without an override the URL comes from the certificate's AIA"""
    assert responder_url(pki.alpha.cert) is None
    aia = x509.AuthorityInformationAccess(
        [
            x509.AccessDescription(AuthorityInformationAccessOID.CA_ISSUERS, x509.UniformResourceIdentifier("x")),
            x509.AccessDescription(AuthorityInformationAccessOID.OCSP, x509.UniformResourceIdentifier(URL)),
        ]
    )
    leaf = issue("ALPHA 1", pki.ca)
    cert = (
        x509.CertificateBuilder()
        .subject_name(leaf.cert.subject)
        .issuer_name(pki.ca.cert.subject)
        .public_key(leaf.key.public_key())
        .serial_number(leaf.cert.serial_number)
        .not_valid_before(leaf.cert.not_valid_before_utc)
        .not_valid_after(leaf.cert.not_valid_after_utc)
        .add_extension(aia, critical=False)
        .sign(pki.ca.key, hashes.SHA256())
    )
    assert responder_url(cert) == URL
    fetch = FakeFetch(_response(pki, leaf=Issued(cert=cert, key=leaf.key)))
    checker = OcspChecker(fetch=fetch, clock=FakeClock())
    assert checker.is_revoked(Identity(callsign="ALPHA 1", leaf=cert, issuer=pki.ca.cert), NOW) is False
    assert fetch.requests[0][0] == URL
    with pytest.raises(OcspUnavailable, match="no OCSP responder"):
        OcspChecker(fetch=fetch).is_revoked(_identity(pki), NOW)


class _FakeHttpResponse(io.BytesIO):
    def __init__(self, status: int, body: bytes) -> None:
        super().__init__(body)
        self.status = status


def test_http_post(monkeypatch: pytest.MonkeyPatch) -> None:
    """The transport posts DER and maps every failure to OcspUnavailable"""
    seen: dict[str, Any] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> _FakeHttpResponse:
        seen["request"], seen["timeout"] = request, timeout
        return _FakeHttpResponse(200, b"answer")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    assert http_post(URL, b"question", 2.0) == b"answer"
    assert seen["request"].get_header("Content-type") == "application/ocsp-request"
    assert seen["request"].data == b"question"
    assert seen["timeout"] == 2.0

    monkeypatch.setattr(urllib.request, "urlopen", lambda request, timeout: _FakeHttpResponse(500, b""))
    with pytest.raises(OcspUnavailable, match="HTTP 500"):
        http_post(URL, b"q", 1.0)

    def refuse(request: urllib.request.Request, timeout: float) -> _FakeHttpResponse:
        raise ConnectionRefusedError("nope")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    with pytest.raises(OcspUnavailable, match="unreachable"):
        http_post(URL, b"q", 1.0)

    with pytest.raises(OcspUnavailable, match="refusing"):
        http_post("file:///etc/passwd", b"q", 1.0)
