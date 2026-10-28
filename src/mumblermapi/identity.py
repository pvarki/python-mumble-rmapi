"""Who is connecting: Mumble usernames and TAK client certificates"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.x509.verification import Criticality, ExtensionPolicy, PolicyBuilder, Store, VerificationError

# ODVoice (built from XVoice) and Vx connect as "<callsign>---<slot>", with spaces in the callsign replaced by "_".
SLOT_SEPARATOR = "---"
_SLOT_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class IdentityError(Exception):
    """The connection does not prove who it claims to be"""


@dataclass(frozen=True)
class Username:
    """A Mumble username split into its callsign and per-device slot"""

    callsign: str  # as sent, with "_" for spaces
    slot: str  # "" when the client sent a bare callsign


def parse_username(username: str) -> Username:
    """Split "<callsign>---<slot>"; reject anything that is not plainly that shape"""
    callsign, sep, slot = username.partition(SLOT_SEPARATOR)
    if not callsign or callsign != callsign.strip():
        raise IdentityError(f"malformed username {username!r}")
    if sep and not _SLOT_RE.match(slot):
        raise IdentityError(f"malformed slot in username {username!r}")
    return Username(callsign=callsign, slot=slot)


def normalize_callsign(callsign: str) -> str:
    """The form clients put in the username: spaces become underscores"""
    return callsign.strip().replace(" ", "_")


@dataclass(frozen=True)
class Identity:
    """A verified client certificate"""

    callsign: str  # the certificate CN
    leaf: x509.Certificate
    issuer: x509.Certificate


class CertVerifier:
    """Verifies client certificate chains against the platform CA bundle, and nothing else"""

    def __init__(self, trusted: list[x509.Certificate]) -> None:
        if not trusted:
            raise ValueError("no trusted certificates")
        # The bundle holds the external root and the external CA. Both are anchors, so a client that sends
        # only its leaf still verifies, and no public CA is ever trusted.
        self._trusted = trusted
        self._store = Store(trusted)

    @classmethod
    def from_pem_file(cls, path: Path) -> CertVerifier:
        """Load the trust-manager bundle"""
        return cls(x509.load_pem_x509_certificates(path.read_bytes()))

    def verify(self, chain_der: list[bytes], now: datetime) -> Identity:
        """Verify the chain Murmur received; raises IdentityError"""
        if not chain_der:
            raise IdentityError("no client certificate")
        try:
            certs = [x509.load_der_x509_certificate(der) for der in chain_der]
        except ValueError as exc:
            raise IdentityError("unparseable client certificate") from exc
        leaf, intermediates = certs[0], certs[1:] + self._trusted
        # Platform client certificates identify by CN=<callsign> alone, so the SAN that webpki requires of every
        # leaf is optional here. All other webpki checks stay, including the clientAuth EKU.
        ee_policy = ExtensionPolicy.webpki_defaults_ee().may_be_present(
            x509.SubjectAlternativeName, Criticality.AGNOSTIC, None
        )
        verifier = (
            PolicyBuilder()
            .store(self._store)
            .time(now)
            .extension_policies(ca_policy=ExtensionPolicy.webpki_defaults_ca(), ee_policy=ee_policy)
            .build_client_verifier()
        )
        try:
            verified = verifier.verify(leaf, intermediates)
        except VerificationError as exc:
            raise IdentityError(f"untrusted client certificate: {exc}") from exc
        names = leaf.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
        if len(names) != 1 or not isinstance(names[0].value, str) or not names[0].value.strip():
            raise IdentityError("client certificate has no single CN")
        return Identity(callsign=names[0].value, leaf=leaf, issuer=verified.chain[1])


def bind(username: Username, identity: Identity) -> None:
    """The callsign in the username must be the certificate's; raises IdentityError"""
    if username.callsign != normalize_callsign(identity.callsign):
        raise IdentityError(f"username {username.callsign!r} does not match certificate CN {identity.callsign!r}")
