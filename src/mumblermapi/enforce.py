"""Who may use which Units/ net, as Murmur ACLs, and the connected sessions that break the rules"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from .channels import ExistingChannel
from .identity import IdentityError, normalize_callsign, parse_username
from .policy import Policy, Unit

# Murmur ACL bits a restricted net keeps for its members. Traverse stays, so everyone still sees the tree.
ENTER, SPEAK, WHISPER, TEXT_MESSAGE, MAKE_TEMP_CHANNEL, LISTEN = 0x04, 0x08, 0x100, 0x200, 0x400, 0x800
MEMBERS_ONLY = ENTER | SPEAK | WHISPER | TEXT_MESSAGE | MAKE_TEMP_CHANNEL | LISTEN
MEMBERS_GROUP = "members"

# A channel's own ACL, as getACL() reports it once inherited entries are dropped:
# (inherit, ((applyHere, applySubs, userid, group, allow, deny), ...), ((name, inherit, inheritable, add, remove), ...))
AclRule = tuple[bool, bool, int, str, int, int]
AclGroup = tuple[str, bool, bool, tuple[int, ...], tuple[int, ...]]
Acl = tuple[bool, tuple[AclRule, ...], tuple[AclGroup, ...]]
OPEN: Acl = (True, (), ())
# An open net under an invite-only one: re-allow, for everyone, what the nets above deny
OPEN_OVERRIDE: Acl = (True, ((True, True, -1, "all", MEMBERS_ONLY, 0),), ())


def members_only(user_ids: Iterable[int]) -> Acl:
    """Everyone is denied, then the channel's own members group is allowed; sub-channels inherit both.

    The group is defined on the channel with inherit off, so in a restricted sub-net the name resolves to that
    sub-net's own group, which already holds the parent's members.
    """
    return (
        True,
        ((True, True, -1, "all", 0, MEMBERS_ONLY), (True, True, -1, MEMBERS_GROUP, MEMBERS_ONLY, 0)),
        ((MEMBERS_GROUP, False, True, tuple(sorted(user_ids)), ()),),
    )


def acl_of(acls: Iterable[Any], groups: Iterable[Any], inherit: bool) -> Acl:
    """A channel's own ACL from Murmur's getACL() answer, comparable with members_only() and OPEN"""
    return (
        inherit,
        tuple((a.applyHere, a.applySubs, a.userid, a.group, a.allow, a.deny) for a in acls if not a.inherited),
        tuple(
            sorted(
                (g.name, g.inherit, g.inheritable, tuple(sorted(g.add)), tuple(sorted(g.remove)))
                for g in groups
                if not g.inherited
            )
        ),
    )


def callsign_of(name: str) -> str | None:
    """The callsign in a Mumble username, in username form"""
    try:
        return parse_username(name).callsign
    except IdentityError:
        return None


@dataclass(frozen=True)
class Access:
    """The policy mapped onto Murmur's channel ids"""

    acls: dict[int, Acl]  # every permanent channel under Units/, and temporary ones in restricted nets
    admitted: dict[int, frozenset[str]]  # every channel inside a restricted net: callsigns (username form) let in


def effective_access(unit: Unit, top: bool) -> str:
    """open, invite or inherit, resolving an older mumblermapi's implicit access and a top-level inherit"""
    access = unit.access or ("invite" if unit.members else "inherit")
    return "open" if top and access == "inherit" else access


def plan(units: tuple[Unit, ...], channels: list[ExistingChannel], root: int, names: Mapping[str, int]) -> Access:
    """What Murmur should enforce. names maps every username the authenticator has seen to its user id.

    - invite: the net admits its members and everyone the invite-only nets above it admit, so platoon members
      can use their squads' nets, even across an open net in between.
    - open: everyone, even under an invite-only net; its own ACL then re-allows what the nets above deny.
    - inherit: the same as the nearest net above with access of its own.
    """
    index = {(c.parent, c.name): c.id for c in channels if not c.temporary}
    rules: dict[int, frozenset[str] | None] = {}  # who each net admits; None is everyone
    own: dict[int, Acl] = {}  # nets that need an ACL of their own, as callsign sets until ids are known
    members_of: dict[int, frozenset[str]] = {}

    def walk(
        units: tuple[Unit, ...],
        parent: int,
        rule: frozenset[str] | None,
        leaders: frozenset[str],
        restricted_above: bool,
    ) -> None:
        for unit in units:
            channel_id = index.get((parent, unit.name))
            if channel_id is None:
                continue  # not created yet
            access = effective_access(unit, top=parent == root)
            if access == "invite":
                admitted = frozenset(normalize_callsign(m) for m in unit.members) | leaders
                rules[channel_id] = admitted
                members_of[channel_id] = admitted
                walk(unit.children, channel_id, admitted, admitted, True)
            elif access == "open":
                rules[channel_id] = None
                if restricted_above:
                    own[channel_id] = OPEN_OVERRIDE
                walk(unit.children, channel_id, None, leaders, restricted_above)
            else:
                rules[channel_id] = rule
                walk(unit.children, channel_id, rule, leaders, restricted_above)

    walk(units, root, None, frozenset(), False)

    children: dict[int, list[ExistingChannel]] = {}
    for channel in channels:
        children.setdefault(channel.parent, []).append(channel)
    acls: dict[int, Acl] = {}
    admitted: dict[int, frozenset[str]] = {}

    def spread(parent: int, inherited: frozenset[str] | None) -> None:
        for channel in children.get(parent, []):
            here = rules.get(channel.id, inherited)  # a stored None is an explicitly open net
            if here is not None:
                admitted[channel.id] = here
            if channel.temporary:
                # Murmur makes the creator of a temporary channel its admin, and Write gives back Enter, Listen
                # and LinkChannel. In a restricted net that must go: the net's own rules then apply.
                if here is not None:
                    acls[channel.id] = OPEN
            elif channel.id in members_of:
                allowed = members_of[channel.id]
                acls[channel.id] = members_only(
                    user_id for name, user_id in names.items() if callsign_of(name) in allowed
                )
            else:
                acls[channel.id] = own.get(channel.id, OPEN)
            spread(channel.id, here)

    spread(root, None)
    return Access(acls=acls, admitted=admitted)


def combine(*parts: Access) -> Access:
    """Several branches' rules as one; their channels never overlap"""
    return Access(
        acls={k: v for part in parts for k, v in part.acls.items()},
        admitted={k: v for part in parts for k, v in part.admitted.items()},
    )


@dataclass(frozen=True)
class Session:
    """A connected user"""

    session: int
    name: str
    channel: int


def refused(policy: Policy, sessions: Iterable[Session]) -> tuple[int, ...]:
    """Sessions of callsigns mumblermapi refuses: revoked, or voice turned off"""
    names = {normalize_callsign(c) for c in policy.refused}
    return tuple(s.session for s in sessions if callsign_of(s.name) in names)


def shadows(channels: list[ExistingChannel], missions_root: int) -> dict[int, int]:
    """Temporary channels outside Missions/ named like a mission net, mapped to that net.

    A client that finds nets by name alone may create a temporary channel named after a mission net it cannot
    find, as XVoice, which ODVoice is built from, did. Such a channel would be an ungated copy of the mission's
    net.
    """
    parents = {c.id: c.parent for c in channels}
    nets = {c.name: c.id for c in channels if c.parent == missions_root}

    def under_missions(channel_id: int) -> bool:
        while channel_id in parents:
            if channel_id == missions_root:
                return True
            channel_id = parents[channel_id]
        return False

    return {c.id: nets[c.name] for c in channels if c.temporary and c.name in nets and not under_missions(c.parent)}


@dataclass(frozen=True)
class Actions:
    """What to do about sessions that break the policy"""

    move: tuple[tuple[int, int], ...] = ()  # (session, channel): out of nets that do not admit them
    unlisten: tuple[tuple[int, int], ...] = ()  # (session, channel) listening to a net that does not admit them


def violations(
    access: Access,
    sessions: list[Session],
    listeners: Mapping[int, Iterable[int]],
    shadowed: Mapping[int, int] | None = None,
) -> Actions:
    """Sessions to move or stop listening. listeners maps restricted channels to listening sessions; shadowed
    maps mission-named temporary channels to the real mission nets.

    Murmur checks ACLs only when someone enters or starts listening, and routes audio to listeners without
    checking again, so whoever lost access since has to be removed here. Sessions in a shadowing channel go to
    the real net when it admits them, which such a client takes as the net it wanted, and to the root otherwise.
    """
    shadowed = shadowed or {}
    callsigns = {s.session: callsign_of(s.name) for s in sessions}

    def admits(channel: int, callsign: str | None) -> bool:
        return channel not in access.admitted or callsign in access.admitted[channel]

    move: list[tuple[int, int]] = []
    for s in sessions:
        if s.channel in shadowed:
            net = shadowed[s.channel]
            move.append((s.session, net if admits(net, callsigns[s.session]) else 0))
        elif not admits(s.channel, callsigns[s.session]):
            move.append((s.session, 0))
    unlisten = tuple(
        (session, channel)
        for channel, listening in listeners.items()
        if channel in access.admitted
        for session in listening
        if callsigns.get(session) not in access.admitted[channel]
    )
    return Actions(move=tuple(move), unlisten=unlisten)
