"""murmur-agent's rounds: the certificate sweep, the plan and presence, and what a failure in one holds up"""

from __future__ import annotations

import logging
from typing import Any

import pytest

from mumblermapi.agent import rounds
from mumblermapi.agent.policy import Policy
from mumblermapi.agent.presence import PresenceReporter
from mumblermapi.agent.userids import UserIds

from .agent_helpers import POLICY, FakeAuth, chain, murmur, wrong_secret
from .fake_murmur import ICE, MUMBLE, FakeServer, MemoryLimitException


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
    rounds._sweep(MUMBLE, server, FakeAuth())  # type: ignore[arg-type]
    assert server.log == ["kick 1"]


def make_rounds(ids: UserIds, reports: list[object] | None = None) -> rounds.Rounds:
    """The agent's rounds, with presence reports collected in reports, or none made"""

    def post(url: str, body: object, timeout: float) -> int:
        assert reports is not None
        reports.append(body)
        return 200

    reporter = None if reports is None else PresenceReporter("http://m/presence", post=post)
    return rounds.Rounds(ICE, MUMBLE, FakeAuth(), ids, reporter, sweep_seconds=60)  # type: ignore[arg-type]


def test_a_round_sweeps_first(ids: UserIds) -> None:
    """A revoked certificate is disconnected even while enforcing the policy keeps failing; presence then stays
    unreported, so health shows the failure"""
    server = murmur()
    server.addChannel = wrong_secret  # type: ignore[method-assign]
    reports: list[object] = []
    loop = make_rounds(ids, reports)
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
    loop = make_rounds(ids, reports)
    loop.round(server, POLICY, units=True)
    assert server.id_of("/Units/10") and len(reports) == 1 and loop.next_sweep == 0


def test_a_round_names_oversized_answers(ids: UserIds, caplog: pytest.LogCaptureFixture) -> None:
    """An answer over Ice's limit is no outage: the log says what it is"""

    def oversized(*args: object) -> Any:
        raise MemoryLimitException()

    server = murmur()
    server.getUsers = oversized  # type: ignore[method-assign]
    with caplog.at_level(logging.WARNING, logger=rounds.__name__):
        make_rounds(ids).round(server, POLICY, units=True)
    assert [(r.levelname, r.getMessage().split(" is over")[0]) for r in caplog.records] == [
        ("ERROR", "Murmur's answer for the certificate sweep"),
        ("ERROR", "Murmur's answer for the plan"),
    ]


def test_an_unexpected_error_ends_no_round(
    ids: UserIds, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The agent stays up, with Murmur's authenticator; a failed sweep holds up nothing, a failed plan stops
    presence"""

    def broken(*args: object) -> Any:
        raise KeyError("a bug")

    monkeypatch.setattr(rounds, "_sweep", broken)
    reports: list[object] = []
    loop = make_rounds(ids, reports)
    with caplog.at_level(logging.ERROR, logger=rounds.__name__):
        loop.round(murmur(), POLICY, units=True)
        monkeypatch.setattr(rounds, "_enforce", broken)
        loop.round(murmur(), POLICY, units=True)
    assert len(reports) == 1 and loop.next_sweep == 0
    assert [(r.getMessage(), bool(r.exc_info)) for r in caplog.records] == [
        ("Unexpected error in the certificate sweep", True),
        ("Unexpected error in the certificate sweep", True),
        ("Unexpected error in the plan", True),
    ]


def test_a_round_warns_about_refused_nets(ids: UserIds, caplog: pytest.LogCaptureFixture) -> None:
    """Once, not every round"""
    server = murmur()
    policy = Policy(version=2, units=(chain(server.nesting_limit + 1, "00"),))
    loop = make_rounds(ids)
    with caplog.at_level(logging.WARNING, logger=rounds.__name__):
        loop.round(server, policy, units=True)
        loop.round(server, policy, units=True)
    warned = [r for r in caplog.records if r.getMessage().startswith("Murmur refused")]
    assert len(warned) == 1 and loop.left_out == ["/Units" + "/00" * server.nesting_limit]


def test_refused_nets_are_warned_about_when_they_change(caplog: pytest.LogCaptureFixture) -> None:
    """Not every round"""
    with caplog.at_level(logging.WARNING, logger=rounds.__name__):
        before = rounds._warn_left_out(["/Units/a"], [])
        before = rounds._warn_left_out(["/Units/a"], before)
        before = rounds._warn_left_out(["/Units/a", "/Units/b"], before)
        rounds._warn_left_out([], before)
    assert [r.getMessage().rsplit(": ", 1)[1] for r in caplog.records] == ["/Units/a", "/Units/a, /Units/b"]
