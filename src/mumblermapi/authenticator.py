"""Murmur's authentication decisions, independent of Ice"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from .identity import CertVerifier, Identity, IdentityError, bind, parse_username
from .ocsp import OcspUnavailable
from .policy import Policy
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
    and only while mumblermapi does not refuse that callsign"""

    def __init__(
        self,
        verifier: CertVerifier,
        revocation: RevocationCheck,
        ids: UserIds,
        clock: Callable[[], datetime] = _utcnow,
        policy: Callable[[], Policy] = Policy,
    ) -> None:
        self._verifier = verifier
        self._revocation = revocation
        self._ids = ids
        self._clock = clock
        self._policy = policy

    def refusal(self, name: str, certificates: list[bytes]) -> Refusal | None:
        """Why this connection must not be in, or None when it may"""
        now = self._clock()
        try:
            username = parse_username(name)
            identity = self._verifier.verify(certificates, now)
            bind(username, identity)
            if self._policy().refuses(identity.callsign):
                return Refusal("revoked or voice disabled in Deploy App")
            if self._revocation.is_revoked(identity, now):
                return Refusal("certificate revoked")
        except IdentityError as exc:
            return Refusal(str(exc))
        except OcspUnavailable as exc:
            return Refusal(str(exc), transient=True)
        return None

    def authenticate(self, name: str, certificates: list[bytes]) -> int:
        """Murmur's authenticate(): a user id, REJECT, or TRY_LATER while revocation cannot be checked"""
        refusal = self.refusal(name, certificates)
        if refusal is not None:
            LOGGER.warning("Refused %r: %s", name, refusal.reason)
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
