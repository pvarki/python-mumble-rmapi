"""Voice tickets: how a browser gets into Murmur through the voice gateway (VOICE-PLAN §4.10).

mumblermapi signs a ticket binding a web slot username to the client certificate Traefik verified. The gateway
logs in with its own certificate and the ticket as the password, and murmur-agent then checks the user's own
certificate from the ticket exactly as it checks a phone's. Only mumblermapi holds the signing key.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from .identity import SLOT_SEPARATOR, IdentityError

TTL_SECONDS = 60
SKEW_SECONDS = 5
# Phones never get these slots, and the gateway gets no others. Murmur compares names case-insensitively.
WEB_SLOT_PREFIX = "web-"
WEB_SLOT = re.compile(r"^web-[1-9]$")
MAX_TICKET_BYTES = 8192
# libpvarki's AUDIT level, for refused security decisions
AUDIT = logging.CRITICAL + 5


def is_web_slot(slot: str) -> bool:
    """Whether a username slot is one reserved for browsers"""
    return slot.lower().startswith(WEB_SLOT_PREFIX)


def web_username(callsign: str, slot: int) -> str:
    """The username a browser session logs in with"""
    name = f"{callsign}{SLOT_SEPARATOR}{WEB_SLOT_PREFIX}{slot}"
    if not WEB_SLOT.match(name.rpartition(SLOT_SEPARATOR)[2]):
        raise ValueError(f"no web slot {slot}")
    return name


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    try:
        return base64.b64decode(text + "=" * (-len(text) % 4), altchars=b"-_", validate=True)
    except (binascii.Error, ValueError) as exc:
        raise IdentityError("malformed ticket") from exc


def public_key(key: Ed25519PrivateKey) -> str:
    """The raw public key as murmur-agent receives it"""
    return _b64(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))


def mint(key: Ed25519PrivateKey, username: str, leaf_der: bytes, now: float) -> str:
    """A ticket letting the gateway log in as username for the next TTL_SECONDS, bound to that leaf"""
    payload = json.dumps({"u": username, "c": _b64(leaf_der), "e": int(now) + TTL_SECONDS}, separators=(",", ":"))
    data = payload.encode()
    return f"{_b64(data)}.{_b64(key.sign(data))}"


def verify(ticket: str, keys: frozenset[str], username: str, now: float) -> bytes:
    """The DER leaf a valid, current ticket binds to exactly this username; raises IdentityError"""
    if not ticket or len(ticket) > MAX_TICKET_BYTES:
        raise IdentityError("no ticket")
    head, _, signature = ticket.partition(".")
    data, sig = _unb64(head), _unb64(signature)
    if not any(_signed_by(key, data, sig) for key in keys):
        raise IdentityError("ticket not signed by mumblermapi")
    try:
        claims = json.loads(data)
        named, leaf, expires = str(claims["u"]), _unb64(str(claims["c"])), int(claims["e"])
    except (ValueError, TypeError, KeyError) as exc:
        raise IdentityError("malformed ticket") from exc
    if named != username:
        raise IdentityError(f"ticket is for {named!r}, not {username!r}")
    if now > expires + SKEW_SECONDS or expires > now + TTL_SECONDS + SKEW_SECONDS:
        raise IdentityError("ticket expired")
    return leaf


def _signed_by(key: str, data: bytes, signature: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(_unb64(key)).verify(signature, data)
    except (InvalidSignature, ValueError, IdentityError):
        return False
    return True
