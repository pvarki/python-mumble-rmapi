"""What murmur-agent enforces, as mumblermapi publishes it"""

from __future__ import annotations

import json
import logging
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field

from .channels import ACCESS, GUARD, ChannelSpec

LOGGER = logging.getLogger(__name__)
MAX_STATE_BYTES = 4 * 1024 * 1024


@dataclass(frozen=True)
class Unit:
    """A Units/ channel. access is one of channels.ACCESS; "" (from an older mumblermapi) means the members
    decide: any member makes it invite-only, otherwise it is open at the top level and inherits below."""

    id: int
    name: str
    description: str = ""
    members: frozenset[str] = frozenset()
    children: tuple[Unit, ...] = ()
    access: str = ""


@dataclass(frozen=True)
class Policy:
    """Refused callsigns, the Units/ tree, and TAK missions with their subscribers as members"""

    version: int = 0
    refused: frozenset[str] = frozenset()
    units: tuple[Unit, ...] = ()
    missions: tuple[Unit, ...] = ()

    def refuses(self, callsign: str) -> bool:
        """Revoked in rmapi, or voice turned off by an admin"""
        return callsign in self.refused

    def specs(self) -> tuple[ChannelSpec, ...]:
        """The tree as channel specs, for the reconciler"""

        def spec(unit: Unit) -> ChannelSpec:
            return ChannelSpec(unit.name, unit.description, tuple(spec(c) for c in unit.children))

        return tuple(spec(u) for u in self.units)

    def mission_specs(self) -> tuple[ChannelSpec, ...]:
        """The Missions/ nets, for the reconciler: TAK's missions and Guard, which no mission rule gates"""
        return (*(ChannelSpec(m.name) for m in self.missions), ChannelSpec(GUARD, "Emergency net, open to everyone"))


def _unit(data: object) -> Unit:
    if not isinstance(data, dict):
        raise TypeError("unit is not an object")
    children = data.get("children") or []
    members = data.get("members") or []
    if not isinstance(children, list) or not isinstance(members, list):
        raise TypeError("malformed unit")
    access = str(data.get("access", ""))
    if access not in ("", *ACCESS):
        raise TypeError(f"unknown access {access!r}")
    return Unit(
        id=int(str(data["id"])),
        name=str(data["name"]),
        description=str(data.get("description", "")),
        access=access,
        members=frozenset(str(m) for m in members),
        children=tuple(_unit(c) for c in children),
    )


def parse_state(data: object) -> Policy:
    """mumblermapi's /api/v1/agent/state document"""
    if not isinstance(data, dict):
        raise TypeError("state is not an object")
    refused, units, missions = data.get("refused", []), data.get("units", []), data.get("missions", [])
    if not isinstance(refused, list) or not isinstance(units, list) or not isinstance(missions, list):
        raise TypeError("malformed state")
    return Policy(
        version=int(data["version"]),
        refused=frozenset(str(r) for r in refused),
        units=tuple(_unit(u) for u in units),
        missions=tuple(_unit({"id": 0} | m) for m in missions if isinstance(m, dict) and m.get("name") != GUARD),
    )


def from_plan(plan: tuple[ChannelSpec, ...]) -> Policy:
    """A policy from a channel plan alone, for running without mumblermapi"""

    def unit(spec: ChannelSpec) -> Unit:
        return Unit(
            id=0,
            name=spec.name,
            description=spec.description,
            access=spec.access,
            children=tuple(unit(c) for c in spec.children),
        )

    return Policy(units=tuple(unit(s) for s in plan))


Get = Callable[[str, dict[str, str], float], tuple[int, bytes]]


def http_get(url: str, headers: dict[str, str], timeout: float) -> tuple[int, bytes]:
    """GET returning (status, body); 304 is a status, not an error"""
    if not url.startswith(("http://", "https://")):
        raise ValueError(f"refusing state URL {url!r}")
    request = urllib.request.Request(url, headers=headers)
    try:
        # The scheme is checked above, so urlopen cannot be steered to file:// or similar.
        with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310
            body: bytes = response.read(MAX_STATE_BYTES)
            return response.status, body
    except urllib.error.HTTPError as exc:
        return exc.code, b""


@dataclass
class PolicySource:
    """Polls mumblermapi and keeps the last good policy; failures keep it unchanged"""

    url: str
    policy: Policy
    get: Get = http_get
    timeout: float = 5.0
    ready: bool = field(default=False, init=False)  # a policy has been fetched since start
    _etag: str = field(default="", init=False)

    def refresh(self) -> bool:
        """Fetch a newer policy if there is one; True when it changed"""
        headers = {"If-None-Match": self._etag} if self._etag else {}
        try:
            status, body = self.get(self.url, headers, self.timeout)
            if status == 304:
                return False
            if status != 200:
                raise ValueError(f"HTTP {status}")
            policy = parse_state(json.loads(body))
        except (OSError, ValueError, TypeError, KeyError) as exc:
            LOGGER.warning("Keeping policy version %d, mumblermapi unavailable: %s", self.policy.version, exc)
            return False
        self._etag = str(policy.version)
        self.ready = True
        changed = policy != self.policy
        self.policy = policy
        return changed
