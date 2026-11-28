"""murmur-agent's enforcement pass and presence, against an in-memory Murmur"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from mumblermapi.agent import rounds
from mumblermapi.agent.enforce import OPEN, acl_of, members_only
from mumblermapi.agent.policy import Policy, Unit
from mumblermapi.agent.userids import UserIds
from mumblermapi.channels import MAX_DEPTH

from .agent_helpers import POLICY, chain, murmur, wrong_secret
from .fake_murmur import ICE, MUMBLE, InvalidSecretException, MemoryLimitException, NestingLimitException


def test_enforce_pass(ids: UserIds) -> None:
    """Refused users go first; the tree, ACLs and sessions then follow the policy; a second pass changes nothing"""
    server = murmur()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)

    assert server.log[0] == "kick 3"
    platoon, mission = server.id_of("/Units/10"), server.id_of("/Missions/RECON")
    assert server.id_of("/Units/10/101") and server.id_of("/Teams/Red") and server.id_of("/Roles/Medic")
    assert "remove 2" in server.log
    assert acl_of(*server.getACL(platoon)) == members_only([1])
    assert acl_of(*server.getACL(mission)) == members_only([2])
    # Guard is a mission net open to everyone: no rules of its own, and nobody is moved out of it
    guard = server.id_of("/Missions/Guard")
    assert acl_of(*server.getACL(guard)) == OPEN
    # The subscriber goes from the stand-in to the real net, the outsider to the root
    assert server.users[2].channel == mission and server.users[4].channel == 0

    server.users[4].channel = platoon  # entered before the net was restricted
    server.listeners[platoon] = [4, 1]
    server.log.clear()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.log == ["move 4 0", f"unlisten 4 {platoon}"]

    server.log.clear()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.log == []


def test_entered_before_the_rules(ids: UserIds) -> None:
    """Someone who enters a net between its creation and its ACL is moved out in the same pass"""
    server = murmur()
    server.users[4].channel = 0
    create = server.addChannel

    def add_and_enter(name: str, parent: int) -> int:
        channel_id = create(name, parent)
        if name == "10":
            server.users[4].channel = channel_id
        return channel_id

    server.addChannel = add_and_enter  # type: ignore[method-assign]
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.users[4].channel == 0


def test_temporary_twin_of_a_net(ids: UserIds) -> None:
    """A temporary channel made in a net's place before the net exists is replaced by the real, restricted net"""
    server = murmur()
    server.channel(5, 1, "10", temporary=True)
    server.users[4].channel = 5
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    platoon = server.id_of("/Units/10")
    assert not server.channels[platoon].temporary
    assert server.channels[server.id_of("/Units/10/101")].parent == platoon
    assert acl_of(*server.getACL(platoon)) == members_only([1])
    assert server.users[4].channel == 1


def test_temporary_channel_in_a_restricted_net(ids: UserIds) -> None:
    """Its creator's rights are dropped; one that empties during the pass is skipped"""
    server = murmur()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    platoon = server.id_of("/Units/10")
    server.channel(50, platoon, "huddle", temporary=True)
    server.channel(51, platoon, "gone", temporary=True)
    server.acls[50] = ([MUMBLE.ACL(True, False, False, 4, "", 1, 0)], [], True)
    read = server.getChannels
    server.getChannels = lambda: read() | {52: SimpleNamespace(**vars(read()[51]) | {"id": 52})}  # type: ignore[method-assign]
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.acls[50] == ([], [], True)


def test_restricted_nets_are_unlinked(ids: UserIds) -> None:
    """A link would carry a restricted net's audio to anyone in the other channel"""
    server = murmur()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    platoon, open_net = server.id_of("/Units/10"), server.id_of("/Teams/Red")
    state = server.getChannelState(open_net)
    state.links = [platoon]
    server.setChannelState(state)
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.channels[platoon].links == [] and server.channels[open_net].links == []


def test_guard_is_open(ids: UserIds) -> None:
    """Anyone may stay in Guard, and a stand-in named Guard elsewhere sends everyone to it"""
    server = murmur()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    guard = server.id_of("/Missions/Guard")
    server.users[4].channel = guard
    server.channel(60, 0, "Guard", temporary=True)
    server.users[1].channel = 60
    server.log.clear()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.users[4].channel == guard and server.users[1].channel == guard


def test_enforce_before_policy(ids: UserIds) -> None:
    """Without mumblermapi's state yet, refused users are still kicked but Units/ and Missions/ stay as they are"""
    server = murmur()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=False)
    assert server.log == ["kick 3"]
    assert server.id_of("/Units/20") == 2 and server.id_of("/Missions")
    assert server.acls == {}


def test_a_refused_net_stalls_no_other(ids: UserIds) -> None:
    """A net past Murmur's nesting limit is left out with what is under it; every other net is enforced"""
    server = murmur()
    stale = server.id_of("/Units/20")
    server.users[4].channel = stale  # an outsider, inside the open net about to become invite-only
    server.listeners[stale] = [4, 1]
    policy = Policy(
        version=2,
        units=(
            chain(server.nesting_limit + 1, "00"),  # first in walk order
            Unit(1, "10", access="invite", members=frozenset({"VOICE1"})),
            Unit(2, "20", access="invite", members=frozenset({"VOICE1"})),
        ),
    )
    refused = "/Units" + "/00" * server.nesting_limit
    assert rounds._enforce(ICE, MUMBLE, server, policy, ids, units=True) == [refused]

    assert server.id_of("/Units" + "/00" * (server.nesting_limit - 1))
    assert acl_of(*server.getACL(server.id_of("/Units/10"))) == members_only([1])
    assert acl_of(*server.getACL(stale)) == members_only([1])
    assert server.id_of("/Missions/Guard") and server.id_of("/Teams/Red") and server.id_of("/Roles/Medic")
    assert server.users[4].channel == 0 and server.listeners[stale] == [1]

    server.log.clear()
    assert rounds._enforce(ICE, MUMBLE, server, policy, ids, units=True) == [refused]
    assert server.log == []


def test_other_murmur_errors_end_the_pass(ids: UserIds) -> None:
    """Only the nesting limit is a refusal: any other error from Murmur still ends the pass"""
    server = murmur()
    server.addChannel = wrong_secret  # type: ignore[method-assign]
    with pytest.raises(InvalidSecretException):
        rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)


def test_the_deepest_net_has_room_for_temporary_channels(ids: UserIds) -> None:
    """Nets as deep as mumblermapi takes them fit in Murmur, with a level left for members' temporary channels"""
    server = murmur()
    policy = Policy(version=2, units=(chain(MAX_DEPTH, "x"),))
    assert rounds._enforce(ICE, MUMBLE, server, policy, ids, units=True) == []
    temporary = server.addChannel("huddle", server.id_of("/Units" + "/x" * MAX_DEPTH))
    with pytest.raises(NestingLimitException):
        server.addChannel("deeper", temporary)


def test_presence(ids: UserIds) -> None:
    """Who is where, by path"""
    server = murmur()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert rounds._presence(MUMBLE, server) == [
        {"callsign": "OTHER", "channel": "/"},
        {"callsign": "VOICE1", "channel": "/"},
        {"callsign": "VOICE3", "channel": "/Missions/RECON"},
    ]


def test_nets_that_emptied_meanwhile(ids: UserIds) -> None:
    """A temporary channel gone before its listeners are read does not stop the rest of the pass"""
    server = murmur()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    platoon = server.id_of("/Units/10")
    server.users[4].channel = platoon
    server.channel(99, platoon, "huddle", temporary=True)
    server.log.clear()
    real = server.getListeningUsers

    def emptied(channel_id: int) -> list[int]:
        server.channels.pop(99, None)  # emptied, so Murmur removed it, after we listed it
        return real(channel_id)

    server.getListeningUsers = emptied  # type: ignore[method-assign]
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.log == ["move 4 0"]


def test_rules_too_large_to_read_are_replaced(ids: UserIds) -> None:
    """A member's own rules in their temporary channel, past Ice's limit, are overwritten; the pass goes on"""
    server = murmur()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    platoon = server.id_of("/Units/10")
    server.channel(99, platoon, "huddle", temporary=True)
    server.acls[99] = ([], [MUMBLE.Group("x" * 100, False, True, True, [], [], [])], True)
    server.users[4].channel = platoon  # an outsider, to be moved out after the rules are written
    real = server.getACL

    def limited(channel_id: int) -> tuple[list[Any], list[Any], bool]:
        acls = real(channel_id)
        if any(len(group.name) > 50 for group in acls[1]):
            raise MemoryLimitException()
        return acls

    server.getACL = limited  # type: ignore[method-assign]
    server.log.clear()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert "acl 99" in server.log and server.users[4].channel == 0

    server.log.clear()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.log == []


def test_listener_calls_end_the_pass_on_other_errors(ids: UserIds) -> None:
    """Only "gone" is taken as gone"""

    def oversized(channel_id: int) -> list[int]:
        raise MemoryLimitException()

    server = murmur()
    server.getListeningUsers = oversized  # type: ignore[method-assign]
    with pytest.raises(MemoryLimitException):
        rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)


def test_listeners_that_left_meanwhile(ids: UserIds) -> None:
    """A listener gone before they are stopped does not keep the others listening"""
    server = murmur()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    platoon = server.id_of("/Units/10")
    server.listeners[platoon] = [4, 2, 1]  # OTHER and VOICE3 are no members
    real = server.stopListening
    gone: list[int] = []

    def leaving(session: int, channel_id: int) -> None:
        if not gone:
            gone.append(session)
            del server.users[session]
        real(session, channel_id)

    server.stopListening = leaving  # type: ignore[method-assign]
    server.log.clear()
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.log == [f"unlisten {({2, 4} - set(gone)).pop()} {platoon}"]


def test_sessions_that_left_meanwhile(ids: UserIds) -> None:
    """A user gone before their kick or move does not stop the rest of the pass"""
    server = murmur()
    real_kick = server.kickUser

    def gone_first(session: int, reason: str) -> None:
        del server.users[session]
        real_kick(session, reason)

    server.kickUser = gone_first  # type: ignore[method-assign]
    rounds._enforce(ICE, MUMBLE, server, POLICY, ids, units=True)
    assert server.id_of("/Missions/RECON") and server.users[2].channel == server.id_of("/Missions/RECON")
