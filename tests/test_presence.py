"""Presence reporting from murmur-agent"""

from __future__ import annotations

import io
import urllib.error
import urllib.request

import pytest

from mumblermapi.channels import ExistingChannel
from mumblermapi.enforce import Session
from mumblermapi.presence import PresenceReporter, channel_paths, http_post_json, presence

CHANNELS = [
    ExistingChannel(0, -1, "Root"),
    ExistingChannel(1, 0, "Units"),
    ExistingChannel(2, 1, "10"),
    ExistingChannel(3, 2, "101"),
]


def test_channel_paths() -> None:
    """Paths from the root; the root itself is "/" """
    assert channel_paths(CHANNELS) == {0: "/", 1: "/Units", 2: "/Units/10", 3: "/Units/10/101"}


def test_presence() -> None:
    """Callsigns in username form with their net, sorted; unparseable names and unknown channels handled"""
    sessions = [
        Session(2, "VOICE3---b", 3),
        Session(1, "VOICE1---a", 0),
        Session(3, "bad name ", 2),
        Session(4, "X", 99),
    ]
    assert presence(sessions, channel_paths(CHANNELS)) == [
        {"callsign": "VOICE1", "channel": "/"},
        {"callsign": "VOICE3", "channel": "/Units/10/101"},
        {"callsign": "X", "channel": "/"},
    ]


class FakePost:
    """Records posts and answers with canned statuses"""

    def __init__(self, *answers: int | Exception) -> None:
        self.answers = list(answers)
        self.bodies: list[object] = []

    def __call__(self, url: str, body: object, timeout: float) -> int:
        self.bodies.append(body)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def test_reports_changes_and_heartbeats() -> None:
    """Unchanged presence is resent only after the heartbeat; failures are retried at once"""
    post = FakePost(200, OSError("down"), 500, 200, 200)
    reporter = PresenceReporter(url="http://m/api/v1/agent/presence", post=post, heartbeat=30)
    one = [{"callsign": "VOICE1", "channel": "/"}]
    two = [*one, {"callsign": "VOICE3", "channel": "/"}]
    reporter.report(one, now=0)
    reporter.report(one, now=10)  # unchanged, not due
    reporter.report(two, now=11)  # changed: fails
    reporter.report(two, now=12)  # retried: refused
    reporter.report(two, now=13)  # retried: sent
    reporter.report(two, now=50)  # heartbeat
    assert post.bodies == [{"sessions": one}] + [{"sessions": two}] * 4


class _Resp(io.BytesIO):
    status = 200


def test_http_post_json(monkeypatch: pytest.MonkeyPatch) -> None:
    """Status out, HTTP errors as statuses, odd schemes refused"""
    seen: list[urllib.request.Request] = []

    def ok(request: urllib.request.Request, timeout: float) -> _Resp:
        seen.append(request)
        return _Resp(b"")

    monkeypatch.setattr(urllib.request, "urlopen", ok)
    assert http_post_json("http://m/p", {"a": 1}, 1.0) == 200
    assert seen[0].data == b'{"a": 1}' and seen[0].get_method() == "POST"

    def refused(request: urllib.request.Request, timeout: float) -> _Resp:
        raise urllib.error.HTTPError("http://m/p", 403, "Forbidden", {}, None)  # type: ignore[arg-type]

    monkeypatch.setattr(urllib.request, "urlopen", refused)
    assert http_post_json("http://m/p", {}, 1.0) == 403
    with pytest.raises(ValueError):
        http_post_json("file:///etc/passwd", {}, 1.0)
