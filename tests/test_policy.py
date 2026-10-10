"""The policy murmur-agent enforces"""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.request

import pytest

from mumblermapi.channels import GUARD, ChannelSpec
from mumblermapi.policy import Policy, PolicySource, Unit, from_plan, http_get, parse_state

STATE = {
    "version": 7,
    "refused": ["BRAVO 2"],
    "units": [
        {
            "id": 1,
            "name": "10",
            "description": "Alfa",
            "members": ["LEADER"],
            "children": [
                {"id": 2, "name": "101", "description": "", "members": ["ALPHA 1"], "children": []},
                {"id": 3, "name": "102", "description": "", "members": [], "children": []},
            ],
        },
        {"id": 4, "name": "07 TJ", "description": "", "members": [], "children": []},
    ],
    "missions": [{"name": "RECON", "members": ["VOICE1", "VOICE3"]}],
}


def test_parse_state() -> None:
    """mumblermapi's document becomes a policy"""
    policy = parse_state(STATE)
    assert policy.version == 7
    assert policy.refuses("BRAVO 2") and not policy.refuses("ALPHA 1")
    assert policy.specs() == (
        ChannelSpec("10", "Alfa", (ChannelSpec("101"), ChannelSpec("102"))),
        ChannelSpec("07 TJ"),
    )
    assert [s.name for s in policy.mission_specs()] == ["RECON", GUARD]
    # A TAK mission named like Guard cannot gate it
    assert parse_state({"version": 1, "missions": [{"name": GUARD, "members": ["X"]}]}).missions == ()
    assert policy.missions[0].members == {"VOICE1", "VOICE3"}
    assert parse_state({"version": 1}).missions == ()
    assert policy.units[0].access == ""
    assert (
        parse_state({"version": 1, "units": [{"id": 1, "name": "a", "access": "invite"}]}).units[0].access == "invite"
    )


@pytest.mark.parametrize(
    "bad",
    [
        [],
        {"refused": []},
        {"version": 1, "refused": "x"},
        {"version": 1, "units": [{"id": 1, "name": "a", "children": 5}]},
        {"version": 1, "units": ["a"]},
        {"version": 1, "units": [{"id": 1, "name": "a", "access": "secret"}]},
    ],
)
def test_parse_state_rejects(bad: object) -> None:
    """Malformed documents are refused"""
    with pytest.raises((TypeError, KeyError)):
        parse_state(bad)


def test_from_plan() -> None:
    """Without mumblermapi, the plan file gives channels with no members, keeping the plan's access"""
    policy = from_plan((ChannelSpec("10", children=(ChannelSpec("101"),)),))
    assert from_plan((ChannelSpec("10", access="invite"),)).units[0].access == "invite"
    assert policy.specs() == (ChannelSpec("10", children=(ChannelSpec("101"),)),)
    assert not policy.refused


class FakeGet:
    """Serves canned responses and records request headers"""

    def __init__(self, *answers: tuple[int, bytes] | Exception) -> None:
        self.answers = list(answers)
        self.headers: list[dict[str, str]] = []

    def __call__(self, url: str, headers: dict[str, str], timeout: float) -> tuple[int, bytes]:
        self.headers.append(headers)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def test_source_polls_with_etag_and_survives_outages() -> None:
    """A change is reported once; 304s, errors and garbage keep the last good policy"""
    body = json.dumps(STATE).encode()
    get = FakeGet((200, body), (304, b""), OSError("down"), (500, b""), (200, b"junk"), (200, b"{}"), (200, body))
    source = PolicySource(url="http://mumblermapi/api/v1/agent/state", policy=Policy(), get=get)
    assert not source.ready
    assert source.refresh() is True
    assert source.ready
    assert source.policy.version == 7
    assert get.headers[0] == {}
    for _ in range(5):
        assert source.refresh() is False
    assert get.headers[1] == {"If-None-Match": "7"}
    assert source.refresh() is False  # same document again
    assert source.policy.version == 7


class _Resp(io.BytesIO):
    status = 200


def test_http_get(monkeypatch: pytest.MonkeyPatch) -> None:
    """The transport returns status and body, maps HTTP errors to statuses, and refuses odd schemes"""
    monkeypatch.setattr(urllib.request, "urlopen", lambda request, timeout: _Resp(b"{}"))
    assert http_get("http://x/state", {}, 1.0) == (200, b"{}")

    def not_modified(request: urllib.request.Request, timeout: float) -> _Resp:
        raise urllib.error.HTTPError("http://x", 304, "Not Modified", {}, None)  # type: ignore[arg-type]

    monkeypatch.setattr(urllib.request, "urlopen", not_modified)
    assert http_get("http://x/state", {"If-None-Match": "7"}, 1.0) == (304, b"")
    with pytest.raises(ValueError):
        http_get("file:///etc/passwd", {}, 1.0)


def test_unit_defaults() -> None:
    """A bare unit is open and empty"""
    assert Unit(id=1, name="x").members == frozenset()
