"""Units/ access rules and the sessions that break them"""

from __future__ import annotations

from types import SimpleNamespace

from mumblermapi.channels import ExistingChannel
from mumblermapi.enforce import (
    OPEN,
    OPEN_OVERRIDE,
    Access,
    Actions,
    Session,
    acl_of,
    callsign_of,
    combine,
    effective_access,
    members_only,
    plan,
    refused,
    shadows,
    violations,
)
from mumblermapi.policy import Policy, Unit

from .murmur_acl import created_by, may_enter

CHANNELS = [
    ExistingChannel(0, -1, "Root"),
    ExistingChannel(1, 0, "Units"),
    ExistingChannel(2, 1, "10"),
    ExistingChannel(3, 2, "101"),
    ExistingChannel(4, 2, "102"),
    ExistingChannel(5, 1, "07 TJ"),
    ExistingChannel(6, 2, "huddle", temporary=True),
    ExistingChannel(7, 0, "Teams"),
]
POLICY = Policy(
    version=3,
    refused=frozenset({"CHARLIE 3"}),
    units=(
        Unit(
            1,
            "10",
            members=frozenset({"LEADER"}),
            children=(Unit(2, "101", members=frozenset({"ALPHA 1"})), Unit(3, "102")),
        ),
        Unit(4, "07 TJ"),
        Unit(5, "not yet created", members=frozenset({"LEADER"})),
    ),
)
NAMES = {"LEADER---vs1": 1, "LEADER---vs2": 2, "ALPHA_1---vs1": 3, "BRAVO_2---vs1": 4, "bad name ": 5}


def test_plan() -> None:
    """Members get their nets and their sub-nets; open nets get no rules; a temporary channel in a restricted net
    loses what Murmur gave its creator"""
    access = plan(POLICY.units, CHANNELS, root=1, names=NAMES)
    assert access.acls == {2: members_only([1, 2]), 3: members_only([1, 2, 3]), 4: OPEN, 5: OPEN, 6: OPEN}
    assert access.admitted == {
        2: {"LEADER"},
        3: {"LEADER", "ALPHA_1"},
        4: {"LEADER"},
        6: {"LEADER"},
    }


def test_acl_of_matches_what_was_set() -> None:
    """Murmur's answer for a channel set to members_only() compares equal; inherited entries do not count"""
    inherit, rules, groups = members_only([2, 1])
    acls = [
        SimpleNamespace(applyHere=r[0], applySubs=r[1], inherited=False, userid=r[2], group=r[3], allow=r[4], deny=r[5])
        for r in rules
    ]
    acls.insert(
        0, SimpleNamespace(applyHere=True, applySubs=True, inherited=True, userid=-1, group="auth", allow=0x400, deny=0)
    )
    mgroups = [
        SimpleNamespace(name=g[0], inherited=False, inherit=g[1], inheritable=g[2], add=[2, 1], remove=[])
        for g in groups
    ]
    mgroups.append(SimpleNamespace(name="admin", inherited=True, inherit=True, inheritable=True, add=[], remove=[]))
    assert acl_of(acls, mgroups, inherit) == members_only([1, 2])
    assert acl_of([], [], True) == OPEN
    assert acl_of(acls, mgroups, inherit) != members_only([1])


def test_refused() -> None:
    """Revoked or voice-disabled callsigns, in username form, whatever net they are in"""
    sessions = [Session(13, "BRAVO_2---vs2", 5), Session(14, "CHARLIE_3---vs1", 3), Session(15, "bad name ", 0)]
    assert refused(POLICY, sessions) == (14,)


def test_violations() -> None:
    """Sessions leave nets and stop listening to nets that do not admit them"""
    access = plan(POLICY.units, CHANNELS, root=1, names=NAMES)
    sessions = [
        Session(10, "LEADER---vs1", 3),
        Session(11, "ALPHA_1---vs1", 2),
        Session(12, "BRAVO_2---vs1", 6),
        Session(13, "BRAVO_2---vs2", 5),
    ]
    actions = violations(access, sessions, {3: [11, 12, 99], 5: [12]})
    assert actions == Actions(move=((11, 0), (12, 0)), unlisten=((12, 3), (99, 3)))


def test_mission_shadows() -> None:
    """A temporary channel named like a mission net sends subscribers to the net and others to the root"""
    channels = [
        *CHANNELS,
        ExistingChannel(8, 0, "Missions"),
        ExistingChannel(9, 8, "RECON"),
        ExistingChannel(10, 0, "RECON", temporary=True),  # a client's stand-in
        ExistingChannel(11, 9, "RECON", temporary=True),  # inside the gated net: fine
        ExistingChannel(12, 0, "OTHER", temporary=True),
    ]
    shadowed = shadows(channels, missions_root=8)
    assert shadowed == {10: 9}
    access = plan((Unit(0, "RECON", members=frozenset({"ALPHA 1"})),), channels, root=8, names=NAMES)
    sessions = [Session(1, "ALPHA_1---vs1", 10), Session(2, "BRAVO_2---vs1", 10), Session(3, "BRAVO_2---vs2", 12)]
    assert violations(access, sessions, {}, shadowed).move == ((1, 9), (2, 0))


def test_mission_nets_admit_subscribers() -> None:
    """A mission net admits its subscribers' every slot; the branches combine without touching each other"""
    channels = [*CHANNELS, ExistingChannel(8, 0, "Missions"), ExistingChannel(9, 8, "RECON")]
    missions = (Unit(0, "RECON", members=frozenset({"ALPHA 1", "BRAVO 2"})),)
    access = combine(
        plan(POLICY.units, channels, root=1, names=NAMES),
        plan(missions, channels, root=8, names=NAMES),
    )
    assert access.acls[9] == members_only([3, 4])
    assert access.admitted[9] == {"ALPHA_1", "BRAVO_2"}
    assert access.acls[2] == members_only([1, 2])


def test_nothing_to_do_without_rules() -> None:
    """A policy from a plan file restricts nobody"""
    assert violations(Access(acls={}, admitted={}), [Session(1, "X---vs1", 2)], {}) == Actions()


# Every access combination: 10 invite {LEADER} with 101 open (holding 1011 invite {BRAVO 2} and 1012 inherit),
# 102 inherit, 103 invite {ALPHA 1} and 104 invite with nobody; 20 open with 201 invite {ALPHA 1}; 30 inherit.
MIXED_CHANNELS = [
    ExistingChannel(0, -1, "Root"),
    ExistingChannel(1, 0, "Units"),
    ExistingChannel(2, 1, "10"),
    ExistingChannel(3, 2, "101"),
    ExistingChannel(4, 3, "1011"),
    ExistingChannel(5, 3, "1012"),
    ExistingChannel(6, 2, "102"),
    ExistingChannel(7, 2, "103"),
    ExistingChannel(8, 2, "104"),
    ExistingChannel(9, 1, "20"),
    ExistingChannel(10, 9, "201"),
    ExistingChannel(11, 1, "30"),
    ExistingChannel(12, 6, "huddle", temporary=True),
    ExistingChannel(13, 9, "chat", temporary=True),  # in an open net: Murmur's creator rights stay
]
MIXED = (
    Unit(
        1,
        "10",
        access="invite",
        members=frozenset({"LEADER"}),
        children=(
            Unit(
                2,
                "101",
                access="open",
                children=(
                    Unit(3, "1011", access="invite", members=frozenset({"BRAVO 2"})),
                    Unit(4, "1012", access="inherit"),
                ),
            ),
            Unit(5, "102", access="inherit"),
            Unit(6, "103", access="invite", members=frozenset({"ALPHA 1"})),
            Unit(7, "104", access="invite"),
        ),
    ),
    Unit(8, "20", access="open", children=(Unit(9, "201", access="invite", members=frozenset({"ALPHA 1"})),)),
    Unit(10, "30", access="inherit"),
)


def test_explicit_access() -> None:
    """Invite-only nets admit their members and those above; open re-opens; inherit follows the nearest rule"""
    access = plan(MIXED, MIXED_CHANNELS, root=1, names=NAMES)
    assert access.admitted == {
        2: {"LEADER"},
        4: {"LEADER", "BRAVO_2"},  # invite-only under an open net under 10 still admits 10's members
        6: {"LEADER"},
        7: {"LEADER", "ALPHA_1"},
        8: {"LEADER"},  # invite-only with nobody of its own: only those above
        10: {"ALPHA_1"},
        12: {"LEADER"},  # a temporary channel follows the net it is in
    }
    assert access.acls[3] == OPEN_OVERRIDE  # 101 is open although 10 is not
    assert access.acls[5] == OPEN and access.acls[6] == OPEN  # inherit: no rules of its own
    assert access.acls[9] == OPEN and access.acls[11] == OPEN  # open at the top needs no override
    assert access.acls[12] == OPEN and 13 not in access.acls


def _murmur_agrees(units: tuple[Unit, ...], channels: list[ExistingChannel]) -> None:
    access = plan(units, channels, root=1, names=NAMES)
    parents = {c.id: c.parent for c in channels if c.parent >= 0}
    # BRAVO 2 made every temporary channel; the agent's ACLs replace what Murmur gave them for it
    acls = {c.id: created_by(NAMES["BRAVO_2---vs1"]) for c in channels if c.temporary} | access.acls
    for channel in channels:
        if channel.id in (0, 1):
            continue
        for name, user_id in NAMES.items():
            callsign = callsign_of(name)
            expected = channel.id not in access.admitted or callsign in access.admitted[channel.id]
            assert may_enter(user_id, channel.id, parents, acls) == expected, (channel.name, name)


def test_murmur_enforces_explicit_access() -> None:
    """Murmur's own permission rules, applied to the ACLs written, admit exactly whom the policy admits"""
    _murmur_agrees(MIXED, MIXED_CHANNELS)


def test_murmur_enforces_legacy_access() -> None:
    """The same holds for state from an older mumblermapi, where members alone decide"""
    _murmur_agrees(POLICY.units, CHANNELS)


def test_effective_access() -> None:
    """Older state: members make a net invite-only; otherwise open at the top and inherit below"""
    assert effective_access(Unit(1, "a", members=frozenset({"X"})), top=False) == "invite"
    assert effective_access(Unit(1, "a"), top=True) == "open"
    assert effective_access(Unit(1, "a"), top=False) == "inherit"
    assert effective_access(Unit(1, "a", access="inherit"), top=True) == "open"
    assert effective_access(Unit(1, "a", access="open", members=frozenset({"X"})), top=False) == "open"
