"""What the murmur-agent test files use: a Murmur with users in it, a policy for it and a fake authenticator"""

from __future__ import annotations

from typing import Any

from mumblermapi.agent.authenticator import Refusal
from mumblermapi.agent.policy import Policy, Unit

from .fake_murmur import FakeServer, InvalidSecretException

POLICY = Policy(
    version=2,
    refused=frozenset({"BAD"}),
    units=(Unit(1, "10", members=frozenset({"VOICE1"}), children=(Unit(2, "101"),)),),
    missions=(Unit(0, "RECON", members=frozenset({"VOICE3"})),),
)


def murmur() -> FakeServer:
    """A server with a stale unit net, a client's stand-in for the RECON mission net, and four users"""
    server = FakeServer()
    server.channel(1, 0, "Units")
    server.channel(2, 1, "20")
    server.channel(3, 0, "RECON", temporary=True)
    server.connect(1, "VOICE1---a", 0, userid=1)
    server.connect(2, "VOICE3---b", 3, userid=2)
    server.connect(3, "BAD---c", 0, userid=3)
    server.connect(4, "OTHER---d", 3, userid=4)
    return server


def chain(depth: int, name: str) -> Unit:
    """A net depth deep, under nets of the same name"""
    unit = Unit(100 + depth, name)
    for level in range(depth - 1, 0, -1):
        unit = Unit(100 + level, name, children=(unit,))
    return unit


def wrong_secret(*args: object, **kwargs: object) -> Any:
    """What every Murmur call raises once the Ice secret no longer matches"""
    raise InvalidSecretException()


class FakeAuth:
    """Refuses BAD for good and LATER for now"""

    def refusal(self, name: str, certificates: list[bytes]) -> Refusal | None:
        if name.startswith("BAD"):
            return Refusal("revoked")
        if name.startswith("LATER"):
            return Refusal("OCSP down", transient=True)
        return None

    def authenticate(self, name: str, certificates: list[bytes], ticket: str = "") -> int:
        if ticket == "signed":
            return 8
        return 7 if certificates == [b"cert"] else -1

    def id_to_name(self, user_id: int) -> str:
        return "VOICE1---a" if user_id == 7 else ""

    def name_to_id(self, name: str) -> int:
        return 7 if name == "VOICE1---a" else -2
