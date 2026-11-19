"""murmur-agent's Ice glue, against an in-memory Murmur"""

from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from mumblermapi import agent
from mumblermapi.authenticator import TRY_LATER, UNKNOWN, Refusal
from mumblermapi.channels import MAX_DEPTH
from mumblermapi.enforce import OPEN, acl_of, members_only
from mumblermapi.policy import Policy, Unit
from mumblermapi.presence import PresenceReporter
from mumblermapi.userids import UserIds

from .fake_murmur import ICE, MUMBLE, FakeServer, InvalidSecretException, NestingLimitException

POLICY = Policy(
    version=2,
    refused=frozenset({"BAD"}),
    units=(Unit(1, "10", members=frozenset({"VOICE1"}), children=(Unit(2, "101"),)),),
    missions=(Unit(0, "RECON", members=frozenset({"VOICE3"})),),
)


@pytest.fixture(name="ids")
def ids_fixture(tmp_path: Path) -> UserIds:
    """User ids as the authenticator would have handed them out"""
    ids = UserIds(tmp_path / "ids.json")
    for name in ("VOICE1---a", "VOICE3---b", "BAD---c", "OTHER---d"):
        ids.get_or_assign(name)
    return ids


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


def test_enforce_pass(ids: UserIds) -> None:
    """Refused users go first; the tree, ACLs and sessions then follow the policy; a second pass changes nothing"""
    server = murmur()
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)

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
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    assert server.log == ["move 4 0", f"unlisten 4 {platoon}"]

    server.log.clear()
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
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
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    assert server.users[4].channel == 0


def test_temporary_twin_of_a_net(ids: UserIds) -> None:
    """A temporary channel made in a net's place before the net exists is replaced by the real, restricted net"""
    server = murmur()
    server.channel(5, 1, "10", temporary=True)
    server.users[4].channel = 5
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    platoon = server.id_of("/Units/10")
    assert not server.channels[platoon].temporary
    assert server.channels[server.id_of("/Units/10/101")].parent == platoon
    assert acl_of(*server.getACL(platoon)) == members_only([1])
    assert server.users[4].channel == 1


def test_temporary_channel_in_a_restricted_net(ids: UserIds) -> None:
    """Its creator's rights are dropped; one that empties during the pass is skipped"""
    server = murmur()
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    platoon = server.id_of("/Units/10")
    server.channel(50, platoon, "huddle", temporary=True)
    server.channel(51, platoon, "gone", temporary=True)
    server.acls[50] = ([MUMBLE.ACL(True, False, False, 4, "", 1, 0)], [], True)
    read = server.getChannels
    server.getChannels = lambda: read() | {52: SimpleNamespace(**vars(read()[51]) | {"id": 52})}  # type: ignore[method-assign]
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    assert server.acls[50] == ([], [], True)


def test_restricted_nets_are_unlinked(ids: UserIds) -> None:
    """A link would carry a restricted net's audio to anyone in the other channel"""
    server = murmur()
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    platoon, open_net = server.id_of("/Units/10"), server.id_of("/Teams/Red")
    state = server.getChannelState(open_net)
    state.links = [platoon]
    server.setChannelState(state)
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    assert server.channels[platoon].links == [] and server.channels[open_net].links == []


def test_guard_is_open(ids: UserIds) -> None:
    """Anyone may stay in Guard, and a stand-in named Guard elsewhere sends everyone to it"""
    server = murmur()
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    guard = server.id_of("/Missions/Guard")
    server.users[4].channel = guard
    server.channel(60, 0, "Guard", temporary=True)
    server.users[1].channel = 60
    server.log.clear()
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    assert server.users[4].channel == guard and server.users[1].channel == guard


def test_enforce_before_policy(ids: UserIds) -> None:
    """Without mumblermapi's state yet, refused users are still kicked but Units/ and Missions/ stay as they are"""
    server = murmur()
    agent._enforce(MUMBLE, server, POLICY, ids, units=False)
    assert server.log == ["kick 3"]
    assert server.id_of("/Units/20") == 2 and server.id_of("/Missions")
    assert server.acls == {}


def chain(depth: int, name: str) -> Unit:
    """A net depth deep, under nets of the same name"""
    unit = Unit(100 + depth, name)
    for level in range(depth - 1, 0, -1):
        unit = Unit(100 + level, name, children=(unit,))
    return unit


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
    assert agent._enforce(MUMBLE, server, policy, ids, units=True) == [refused]

    assert server.id_of("/Units" + "/00" * (server.nesting_limit - 1))
    assert acl_of(*server.getACL(server.id_of("/Units/10"))) == members_only([1])
    assert acl_of(*server.getACL(stale)) == members_only([1])
    assert server.id_of("/Missions/Guard") and server.id_of("/Teams/Red") and server.id_of("/Roles/Medic")
    assert server.users[4].channel == 0 and server.listeners[stale] == [1]

    server.log.clear()
    assert agent._enforce(MUMBLE, server, policy, ids, units=True) == [refused]
    assert server.log == []


def wrong_secret(*args: object, **kwargs: object) -> Any:
    """What every Murmur call raises once the Ice secret no longer matches"""
    raise InvalidSecretException()


def test_other_murmur_errors_end_the_pass(ids: UserIds) -> None:
    """Only the nesting limit is a refusal: any other error from Murmur still ends the pass"""
    server = murmur()
    server.addChannel = wrong_secret  # type: ignore[method-assign]
    with pytest.raises(InvalidSecretException):
        agent._enforce(MUMBLE, server, POLICY, ids, units=True)


def test_the_deepest_net_has_room_for_temporary_channels(ids: UserIds) -> None:
    """Nets as deep as mumblermapi takes them fit in Murmur, with a level left for members' temporary channels"""
    server = murmur()
    assert agent._enforce(MUMBLE, server, Policy(version=2, units=(chain(MAX_DEPTH, "x"),)), ids, units=True) == []
    temporary = server.addChannel("huddle", server.id_of("/Units" + "/x" * MAX_DEPTH))
    with pytest.raises(NestingLimitException):
        server.addChannel("deeper", temporary)


def test_refused_nets_are_warned_about_when_they_change(caplog: pytest.LogCaptureFixture) -> None:
    """Not every round"""
    with caplog.at_level(logging.WARNING, logger=agent.__name__):
        before = agent._warn_left_out(["/Units/a"], [])
        before = agent._warn_left_out(["/Units/a"], before)
        before = agent._warn_left_out(["/Units/a", "/Units/b"], before)
        agent._warn_left_out([], before)
    assert [r.getMessage().rsplit(": ", 1)[1] for r in caplog.records] == ["/Units/a", "/Units/a, /Units/b"]


def test_presence(ids: UserIds) -> None:
    """Who is where, by path"""
    server = murmur()
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    assert agent._presence(MUMBLE, server) == [
        {"callsign": "OTHER", "channel": "/"},
        {"callsign": "VOICE1", "channel": "/"},
        {"callsign": "VOICE3", "channel": "/Missions/RECON"},
    ]


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


def test_sweep() -> None:
    """Only lasting refusals disconnect; sessions that left meanwhile are skipped"""
    server = FakeServer()
    server.connect(1, "BAD---x")
    server.connect(2, "LATER---y")
    server.connect(3, "GOOD---z")
    vanishing = server.getCertificateList

    def certificates(session: int) -> list[bytes]:
        if session == 3:
            del server.users[3]
        return vanishing(session)

    server.getCertificateList = certificates  # type: ignore[method-assign]
    agent._sweep(MUMBLE, server, FakeAuth())  # type: ignore[arg-type]
    assert server.log == ["kick 1"]


def rounds(ids: UserIds, reports: list[object] | None = None) -> agent.Rounds:
    """The agent's rounds, with presence reports collected in reports, or none made"""

    def post(url: str, body: object, timeout: float) -> int:
        assert reports is not None
        reports.append(body)
        return 200

    reporter = None if reports is None else PresenceReporter("http://m/presence", post=post)
    return agent.Rounds(ICE, MUMBLE, FakeAuth(), ids, reporter, sweep_seconds=60)  # type: ignore[arg-type]


def test_a_round_sweeps_first(ids: UserIds) -> None:
    """A revoked certificate is disconnected even while enforcing the policy keeps failing; presence then stays
    unreported, so health shows the failure"""
    server = murmur()
    server.addChannel = wrong_secret  # type: ignore[method-assign]
    reports: list[object] = []
    loop = rounds(ids, reports)
    policy = Policy(version=2, refused=frozenset({"OTHER"}))
    loop.round(server, policy, units=True)
    # BAD's certificate is revoked; OTHER is refused by mumblermapi, which enforcement sees to before it fails
    assert server.log == ["kick 3", "kick 4"] and reports == [] and loop.next_sweep > 0

    del server.addChannel
    loop.round(server, policy, units=True)
    assert server.id_of("/Missions/Guard") and len(reports) == 1


def test_a_failed_sweep_holds_up_nothing(ids: UserIds) -> None:
    """The policy is still enforced and presence reported, and the sweep is tried again next round"""
    server = murmur()
    server.getCertificateList = wrong_secret  # type: ignore[method-assign]
    reports: list[object] = []
    loop = rounds(ids, reports)
    loop.round(server, POLICY, units=True)
    assert server.id_of("/Units/10") and len(reports) == 1 and loop.next_sweep == 0


def test_a_round_warns_about_refused_nets(ids: UserIds, caplog: pytest.LogCaptureFixture) -> None:
    """Once, not every round"""
    server = murmur()
    policy = Policy(version=2, units=(chain(server.nesting_limit + 1, "00"),))
    loop = rounds(ids)
    with caplog.at_level(logging.WARNING, logger=agent.__name__):
        loop.round(server, policy, units=True)
        loop.round(server, policy, units=True)
    warned = [r for r in caplog.records if r.getMessage().startswith("Murmur refused")]
    assert len(warned) == 1 and loop.left_out == ["/Units" + "/00" * server.nesting_limit]


def test_servant() -> None:
    """Murmur's ServerAuthenticator calls reach the authenticator"""
    servant = agent._servant(MUMBLE, FakeAuth())  # type: ignore[arg-type]
    assert servant.authenticate("VOICE1---a", "", [b"cert"], "hash", True) == (7, "", [])
    assert servant.authenticate("VOICE1---web-1", "signed", [b"gateway"], "hash", False) == (8, "", [])
    assert servant.getInfo(7) == (True, {MUMBLE.UserInfo.UserName: "VOICE1---a"})
    assert servant.getInfo(8) == (False, {})
    assert servant.nameToId("VOICE1---a") == 7 and servant.idToName(7) == "VOICE1---a"
    assert servant.idToTexture(7) == b""


class BrokenAuth:
    """Every check fails, as with a full disk, a responder answering garbage, or a bug"""

    def __init__(self, error: Exception) -> None:
        self.error = error

    def __getattr__(self, name: str) -> Any:
        def broken(*args: object) -> Any:
            raise self.error

        return broken


@pytest.mark.parametrize("error", [OSError("no space left on device"), ValueError("garbage"), KeyError("a bug")])
def test_servant_answers_when_a_check_fails(caplog: pytest.LogCaptureFixture, error: Exception) -> None:
    """A failing check is a "try later" or "unknown" answer, never an error, which would make Murmur drop the
    authenticator and refuse every login"""
    servant = agent._servant(MUMBLE, BrokenAuth(error))  # type: ignore[arg-type]
    with caplog.at_level(logging.ERROR, logger=agent.__name__):
        assert servant.authenticate("VOICE1---a", "", [b"cert"], "hash", True) == (TRY_LATER, "", [])
        assert servant.getInfo(7) == (False, {})
        assert servant.nameToId("VOICE1---a") == UNKNOWN and servant.idToName(7) == ""
    assert len(caplog.records) == 4 and all(r.exc_info for r in caplog.records)


def test_channel_description() -> None:
    """New channels get their description"""
    server = FakeServer()
    channel_id = agent.IceChannels(server, MUMBLE).add_channel("10", 0, "Alfa")
    assert server.channels[channel_id].description == "Alfa"


def test_server_lookup() -> None:
    """A configured server id, or the one running server"""
    one = SimpleNamespace(name="one")
    meta: Any = SimpleNamespace(getServer=lambda i: one if i == 1 else None, getBootedServers=lambda: [one])
    assert agent._server(meta, 1) is one and agent._server(meta, None) is one
    with pytest.raises(RuntimeError):
        agent._server(meta, 2)
    meta.getBootedServers = list
    with pytest.raises(RuntimeError):
        agent._server(meta, None)


def test_sessions_that_left_meanwhile(ids: UserIds) -> None:
    """A user gone before their kick or move does not stop the rest of the pass"""
    server = murmur()
    real_kick = server.kickUser

    def gone_first(session: int, reason: str) -> None:
        del server.users[session]
        real_kick(session, reason)

    server.kickUser = gone_first  # type: ignore[method-assign]
    agent._enforce(MUMBLE, server, POLICY, ids, units=True)
    assert server.id_of("/Missions/RECON") and server.users[2].channel == server.id_of("/Missions/RECON")
