"""Murmur's authentication decisions, independent of Ice"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from .identity import CertVerifier, Identity, IdentityError, Username, bind, parse_username
from .ocsp import OcspUnavailable
from .policy import Policy
from .tickets import AUDIT, is_web_slot, verify
from .userids import UserIds

LOGGER = logging.getLogger(__name__)

# Murmur's ServerAuthenticator return codes. The agent never answers UNKNOWN from authenticate(): Murmur then
# demands the server password, which nobody is given, so nothing the agent did not vouch for gets in.
REJECT = -1
UNKNOWN = -2
TRY_LATER = -3


class RevocationCheck(Protocol):
    """Answers whether a verified certificate is revoked"""

    def is_revoked(self, identity: Identity, now: datetime) -> bool:
        """True when revoked; raises OcspUnavailable when it cannot tell"""


def _utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Refusal:
    """Why a connection is refused; transient refusals may succeed on retry"""

    reason: str
    transient: bool = False


class Authenticator:
    """Accepts a connection only on a valid, unrevoked platform certificate whose CN is the username's callsign,
    and only while mumblermapi does not refuse that callsign.

    Browsers come in through the voice gateway, whose own certificate (from a CA that signs nothing else) fills
    web slots only. Its password is a ticket from mumblermapi carrying the user's certificate, and that
    certificate then gets every check a phone's does.
    """

    def __init__(
        self,
        verifier: CertVerifier,
        revocation: RevocationCheck,
        ids: UserIds,
        clock: Callable[[], datetime] = _utcnow,
        policy: Callable[[], Policy] = Policy,
        gateway: CertVerifier | None = None,
    ) -> None:
        self._verifier = verifier
        self._revocation = revocation
        self._ids = ids
        self._clock = clock
        self._policy = policy
        self._gateway = gateway
        # The certificate each web session's ticket carried, for the sweep. In memory only: after a restart the
        # sweep finds none and disconnects browsers, which reconnect with fresh tickets.
        self._web_leaves: dict[str, bytes] = {}

    def _from_gateway(self, certificates: list[bytes], now: datetime) -> bool:
        if self._gateway is None:
            return False
        try:
            self._gateway.verify(certificates, now)
        except IdentityError:
            return False
        return True

    def _chain(self, name: str, username: Username, certificates: list[bytes], ticket: str | None) -> list[bytes]:
        """The chain to check: the connection's own, or for a browser the certificate its ticket carried.
        ticket None is the sweep, which uses the certificate stored at login."""
        now = self._clock()
        gateway = self._from_gateway(certificates, now)
        if not is_web_slot(username.slot):
            if gateway:
                raise IdentityError("the voice gateway logs in web slots only")
            return certificates
        if not gateway:
            raise IdentityError("web slots are only for the voice gateway")
        if ticket is None:
            leaf = self._web_leaves.get(name)
            if leaf is None:
                raise IdentityError("no ticket on record for this browser session")
            return [leaf]
        return [verify(ticket, self._policy().ticket_keys, name, now.timestamp())]

    def refusal(self, name: str, certificates: list[bytes], ticket: str | None = None) -> Refusal | None:
        """Why this connection must not be in, or None when it may. ticket is the login password; the sweep
        leaves it out."""
        now = self._clock()
        try:
            username = parse_username(name)
            chain = self._chain(name, username, certificates, ticket)
            identity = self._verifier.verify(chain, now)
            bind(username, identity)
            if self._policy().refuses(identity.callsign):
                return Refusal("revoked or voice disabled in Deploy App")
            if self._revocation.is_revoked(identity, now):
                return Refusal("certificate revoked")
        except IdentityError as exc:
            return Refusal(str(exc))
        except OcspUnavailable as exc:
            return Refusal(str(exc), transient=True)
        if ticket is not None and is_web_slot(username.slot):
            self._web_leaves[name] = chain[0]
        return None

    def authenticate(self, name: str, certificates: list[bytes], ticket: str = "") -> int:
        """Murmur's authenticate(): a user id, REJECT, or TRY_LATER while revocation cannot be checked. ticket is
        the login's password, which matters only from the voice gateway."""
        refusal = self.refusal(name, certificates, ticket)
        if refusal is not None:
            LOGGER.log(AUDIT, "Refused %r: %s", name, refusal.reason)
            return TRY_LATER if refusal.transient else REJECT
        user_id = self._ids.get_or_assign(name)
        LOGGER.info("Accepted %r as user %d", name, user_id)
        return user_id

    def name_to_id(self, name: str) -> int:
        """Murmur's nameToId(): our id, or UNKNOWN"""
        user_id = self._ids.id_for(name)
        return UNKNOWN if user_id is None else user_id

    def id_to_name(self, user_id: int) -> str:
        """Murmur's idToName(): our name, or "" when the id is not ours"""
        return self._ids.name_for(user_id) or ""
