"""murmur-agent's Ice glue, against an in-memory Murmur"""

from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Any

import pytest

from mumblermapi.agent import ice
from mumblermapi.agent.authenticator import TRY_LATER, UNKNOWN

from .agent_helpers import FakeAuth
from .fake_murmur import MUMBLE, FakeServer


def test_servant() -> None:
    """Murmur's ServerAuthenticator calls reach the authenticator"""
    servant = ice.servant(MUMBLE, FakeAuth())  # type: ignore[arg-type]
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
    servant = ice.servant(MUMBLE, BrokenAuth(error))  # type: ignore[arg-type]
    with caplog.at_level(logging.ERROR, logger=ice.__name__):
        assert servant.authenticate("VOICE1---a", "", [b"cert"], "hash", True) == (TRY_LATER, "", [])
        assert servant.getInfo(7) == (False, {})
        assert servant.nameToId("VOICE1---a") == UNKNOWN and servant.idToName(7) == ""
    assert len(caplog.records) == 4 and all(r.exc_info for r in caplog.records)


def test_ice_takes_what_murmur_sends() -> None:
    """Murmur's largest login, with every invalid UTF-8 byte re-encoded as three, fits the agent's adapter with
    room for a certificate chain; Murmur's answers to the agent get their own limit"""
    properties: dict[str, str] = {}
    runtime: Any = SimpleNamespace(createProperties=lambda: SimpleNamespace(setProperty=properties.__setitem__))
    ice.properties(runtime)
    assert int(properties[f"{ice.ADAPTER}.MessageSizeMax"]) * 1024 >= 3 * 0x7FFFFF + 512 * 1024
    assert properties["Ice.MessageSizeMax"] == str(ice.ICE_MESSAGE_KIB)
    assert properties["Ice.ImplicitContext"] == "Shared"


def test_a_channel_already_gone_counts_as_removed() -> None:
    """Such as a squatting temporary channel that emptied between reading the tree and removing it"""
    server = FakeServer()
    server.channel(5, 0, "RECON", temporary=True)
    channels = ice.IceChannels(server, MUMBLE)
    channels.remove_channel(5)
    channels.remove_channel(5)
    assert server.log == ["remove 5"]


def test_channel_description() -> None:
    """New channels get their description"""
    server = FakeServer()
    channel_id = ice.IceChannels(server, MUMBLE).add_channel("10", 0, "Alfa")
    assert server.channels[channel_id].description == "Alfa"


def test_server_lookup() -> None:
    """A configured server id, or the one running server"""
    one = SimpleNamespace(name="one")
    meta: Any = SimpleNamespace(getServer=lambda i: one if i == 1 else None, getBootedServers=lambda: [one])
    assert ice.virtual_server(meta, 1) is one and ice.virtual_server(meta, None) is one
    with pytest.raises(RuntimeError):
        ice.virtual_server(meta, 2)
    meta.getBootedServers = list
    with pytest.raises(RuntimeError):
        ice.virtual_server(meta, None)
