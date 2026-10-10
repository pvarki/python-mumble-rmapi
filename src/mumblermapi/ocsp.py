"""Revocation checks against rmapi's OCSP responder"""

from __future__ import annotations

import logging
import threading
import time
import urllib.request
from collections.abc import Callable
from datetime import datetime, timedelta

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.serialization import Encoding
from cryptography.x509 import ocsp
from cryptography.x509.oid import AuthorityInformationAccessOID, ExtendedKeyUsageOID

from .identity import Identity

LOGGER = logging.getLogger(__name__)
MAX_RESPONSE_BYTES = 64 * 1024
CLOCK_SKEW = timedelta(minutes=5)

Fetch = Callable[[str, bytes, float], bytes]


class OcspUnavailable(Exception):
    """No trustworthy answer from the responder"""


def http_post(url: str, body: bytes, timeout: float) -> bytes:
    """POST an OCSP request; raises OcspUnavailable"""
    if not url.startswith(("http://", "https://")):
        raise OcspUnavailable(f"refusing OCSP URL {url!r}")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/ocsp-request", "Accept": "application/ocsp-response"},
        method="POST",
    )
    try:
        # The scheme is checked above, so urlopen cannot be steered to file:// or similar.
        with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310
            if response.status != 200:
                raise OcspUnavailable(f"OCSP responder answered HTTP {response.status}")
            data: bytes = response.read(MAX_RESPONSE_BYTES)
            return data
    except OSError as exc:
        raise OcspUnavailable(f"OCSP responder unreachable: {exc}") from exc


def responder_url(cert: x509.Certificate) -> str | None:
    """The OCSP URL from the certificate's authority information access, if any"""
    try:
        aia = cert.extensions.get_extension_for_class(x509.AuthorityInformationAccess).value
    except x509.ExtensionNotFound:
        return None
    for desc in aia:
        if desc.access_method == AuthorityInformationAccessOID.OCSP and isinstance(
            desc.access_location, x509.UniformResourceIdentifier
        ):
            return desc.access_location.value
    return None


def _verify_signature(key: object, signature: bytes, data: bytes, algorithm: hashes.HashAlgorithm | None) -> None:
    if algorithm is None:
        raise OcspUnavailable("OCSP response has no signature hash algorithm")
    try:
        if isinstance(key, ec.EllipticCurvePublicKey):
            key.verify(signature, data, ec.ECDSA(algorithm))
        elif isinstance(key, rsa.RSAPublicKey):
            key.verify(signature, data, padding.PKCS1v15(), algorithm)
        else:
            raise OcspUnavailable("unsupported OCSP responder key type")
    except InvalidSignature as exc:
        raise OcspUnavailable("OCSP response signature does not verify") from exc


def _responder(response: ocsp.OCSPResponse, issuer: x509.Certificate) -> x509.Certificate:
    """The issuer signs its own responses; a delegated responder must be issued by it for OCSP signing"""
    if not response.certificates:
        return issuer
    delegate = response.certificates[0]
    try:
        delegate.verify_directly_issued_by(issuer)
    except (ValueError, TypeError, InvalidSignature) as exc:
        raise OcspUnavailable("OCSP responder is not issued by the certificate's CA") from exc
    try:
        eku = delegate.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
    except x509.ExtensionNotFound as exc:
        raise OcspUnavailable("delegated OCSP responder has no EKU") from exc
    if ExtendedKeyUsageOID.OCSP_SIGNING not in eku:
        raise OcspUnavailable("delegated OCSP responder is not for OCSP signing")
    return delegate


class OcspChecker:
    """Asks the responder whether a certificate is revoked, caching answers.

    Revocations are issued only in rmapi. While the responder is unreachable nobody can revoke anything, so a
    certificate that was answered "good" before stays good; one never seen before is refused.
    """

    def __init__(
        self,
        *,
        url_override: str | None = None,
        cache_seconds: float = 300.0,
        timeout: float = 3.0,
        fetch: Fetch = http_post,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._url_override = url_override
        self._cache_seconds = cache_seconds
        self._timeout = timeout
        self._fetch = fetch
        self._clock = clock
        self._good: dict[int, float] = {}
        self._revoked: set[int] = set()
        self._lock = threading.Lock()

    def is_revoked(self, identity: Identity, now: datetime) -> bool:
        """True when revoked or unknown to the responder; raises OcspUnavailable for unknown certificates"""
        serial = identity.leaf.serial_number
        with self._lock:
            if serial in self._revoked:
                return True
            seen = self._good.get(serial)
        if seen is not None and self._clock() - seen < self._cache_seconds:
            return False
        try:
            status = self._query(identity, now)
        except OcspUnavailable as exc:
            if seen is None:
                raise
            LOGGER.warning("OCSP unavailable, keeping known-good %s: %s", identity.callsign, exc)
            return False
        with self._lock:
            if status == ocsp.OCSPCertStatus.GOOD:
                self._good[serial] = self._clock()
                return False
            if status == ocsp.OCSPCertStatus.REVOKED:
                self._revoked.add(serial)
                self._good.pop(serial, None)
        return True

    def _query(self, identity: Identity, now: datetime) -> ocsp.OCSPCertStatus:
        url = self._url_override or responder_url(identity.leaf)
        if not url:
            raise OcspUnavailable("certificate names no OCSP responder")
        request = ocsp.OCSPRequestBuilder().add_certificate(identity.leaf, identity.issuer, hashes.SHA256()).build()
        body = self._fetch(url, request.public_bytes(Encoding.DER), self._timeout)
        try:
            response = ocsp.load_der_ocsp_response(body)
        except ValueError as exc:
            raise OcspUnavailable("unparseable OCSP response") from exc
        if response.response_status != ocsp.OCSPResponseStatus.SUCCESSFUL:
            raise OcspUnavailable(f"OCSP responder refused: {response.response_status.name}")
        responder = _responder(response, identity.issuer)
        _verify_signature(
            responder.public_key(),
            response.signature,
            response.tbs_response_bytes,
            response.signature_hash_algorithm,
        )
        for single in response.responses:
            if single.serial_number != identity.leaf.serial_number:
                continue
            if single.this_update_utc > now + CLOCK_SKEW:
                raise OcspUnavailable("OCSP response is from the future")
            if single.next_update_utc is not None and single.next_update_utc < now - CLOCK_SKEW:
                raise OcspUnavailable("OCSP response is stale")
            return single.certificate_status
        raise OcspUnavailable("OCSP response does not cover the certificate")
