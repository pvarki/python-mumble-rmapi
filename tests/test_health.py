"""Voice's health check: what it finds and why, and what rmapi reads from it"""

from __future__ import annotations

import asyncio
import logging
import socket
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import aiohttp
import pytest
from aiohttp.abc import AbstractResolver, ResolveResult
from fastapi.testclient import TestClient

from mumblermapi.api import PRESENCE_TTL, Settings, create_app
from mumblermapi.health import Answer, fetcher, problems, watch, why

PROXY = "http://proxy/ready"
GATEWAY = "http://gateway/readyz"


def check(answers: dict[str, Answer], presence_age: float = 10.0, uptime: float = 1000.0) -> list[str]:
    """problems() against fixed answers: an URL missing from answers timed out"""

    async def fetch(url: str) -> Answer:
        return answers.get(url, "timed out")

    return asyncio.run(problems(fetch, PROXY, GATEWAY, presence_age, uptime, PRESENCE_TTL))


def test_all_well() -> None:
    assert check({PROXY: 200, GATEWAY: 204}) == []


def test_each_problem_named_with_its_cause() -> None:
    """The night the node restarted before Linkerd's injector was ready, every one of these held"""
    found = check({PROXY: "connection refused"}, presence_age=float("inf"))
    assert found == [
        (
            "no ready Linkerd proxy in mumblermapi's pod (connection refused): rmapi, murmur-agent and browser "
            "tickets are refused"
        ),
        "murmur-agent has not reported since mumblermapi started: Murmur or the agent is away or refused",
        "the voice gateway is not ready (timed out): browsers cannot talk",
    ]
    assert "for 120 s" in check({PROXY: 200, GATEWAY: 204}, presence_age=120.0)[0]
    assert check({PROXY: 503, GATEWAY: 204}) == [
        "no ready Linkerd proxy in mumblermapi's pod (HTTP 503): rmapi, murmur-agent and browser tickets are refused"
    ]
    for cause in ("name resolution failed", "connection refused"):
        assert check({PROXY: 200, GATEWAY: cause}) == [
            f"the voice gateway is not ready ({cause}): browsers cannot talk"
        ]
    assert check({PROXY: 200, GATEWAY: 503}) == ["the voice gateway is not ready (HTTP 503): browsers cannot talk"]


def test_agent_gets_its_first_report_window() -> None:
    """Right after a start the agent has not reported yet; that is no problem until PRESENCE_TTL passed"""
    assert check({PROXY: 200, GATEWAY: 204}, presence_age=float("inf"), uptime=5.0) == []


def test_unchecked_urls() -> None:
    async def fetch(url: str) -> Answer:
        raise AssertionError(url)

    assert asyncio.run(problems(fetch, "", "", 1.0, 1000.0, PRESENCE_TTL)) == []


class NoNames(AbstractResolver):
    """A resolver that knows no names, as in-cluster DNS while it is away"""

    async def resolve(
        self, host: str, port: int = 0, family: socket.AddressFamily = socket.AF_INET
    ) -> list[ResolveResult]:
        raise OSError(f"Domain name not found: {host}")

    async def close(self) -> None:
        """Nothing to close"""


Handler = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]


async def _answer_from(handler: Handler) -> Answer:
    """What the fetcher makes of a local server that runs handler for each connection"""
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=0.3)) as session:
            return await fetcher(session)(f"http://127.0.0.1:{port}/readyz")
    finally:
        server.close()
        await server.wait_closed()


async def _status_503(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.readuntil(b"\r\n\r\n")
    writer.write(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    await writer.drain()
    writer.close()


async def _silent(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.read()  # until the client gives up and closes
    writer.close()


async def _hang_up(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.readuntil(b"\r\n\r\n")  # read first, or the close resets the connection on some systems
    writer.close()


def _closed_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
    return port


def test_fetcher_names_why_there_was_no_answer() -> None:
    """The causes the whole-quail outages showed, from real sockets: no name, no listener, no answer"""
    assert asyncio.run(_answer_from(_status_503)) == 503
    assert asyncio.run(_answer_from(_silent)) == "timed out"
    assert asyncio.run(_answer_from(_hang_up)) == "Server disconnected"

    async def refused() -> Answer:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=2)) as session:
            return await fetcher(session)(f"http://127.0.0.1:{_closed_port()}/ready")

    assert asyncio.run(refused()) == "connection refused"

    async def unresolved() -> Answer:
        connector = aiohttp.TCPConnector(resolver=NoNames())
        async with aiohttp.ClientSession(connector=connector, timeout=aiohttp.ClientTimeout(total=2)) as session:
            return await fetcher(session)("http://voice-gateway.app-mumble.svc.cluster.local:8080/readyz")

    assert asyncio.run(unresolved()) == "name resolution failed"


def test_why_falls_back_to_the_error_itself() -> None:
    assert why(OSError("no route")) == "no route"
    assert why(aiohttp.ClientPayloadError()) == "ClientPayloadError"


def test_watch_logs_each_change(caplog: pytest.LogCaptureFixture) -> None:
    """A problem is logged with its cause when it appears, and the recovery when it goes"""
    gone = f"http://127.0.0.1:{_closed_port()}/readyz"
    state = SimpleNamespace(
        settings=SimpleNamespace(proxy_ready_url="", gateway_ready_url=gone), presence=(time.monotonic(), {}), health=[]
    )
    app: Any = SimpleNamespace(state=state)

    async def one_round() -> None:
        stop = asyncio.Event()
        task = asyncio.create_task(watch(app, stop, PRESENCE_TTL))
        while not caplog.records:
            await asyncio.sleep(0.01)
        stop.set()
        await task

    with caplog.at_level(logging.INFO, logger="mumblermapi.health"):
        asyncio.run(one_round())
        assert state.health == ["the voice gateway is not ready (connection refused): browsers cannot talk"]
        assert caplog.records[-1].getMessage() == f"Voice is unhealthy: {state.health[0]}"
        state.settings.gateway_ready_url = ""
        caplog.clear()
        asyncio.run(one_round())
    assert state.health == []
    assert caplog.records[-1].getMessage() == "Voice is healthy"


def test_healthcheck_reports_the_last_check(tmp_path: Path) -> None:
    """Always 200 for the kubelet; rmapi reads healthy and why not"""
    app = create_app(Settings(database=tmp_path / "db.sqlite", templates_dir=tmp_path, ui_dir=tmp_path / "none"))
    client = TestClient(app)
    assert client.get("/api/v1/healthcheck").json() == {"healthy": True, "extra": ""}
    problem = "the voice gateway is not ready (name resolution failed): browsers cannot talk"
    app.state.health = [problem]
    response = client.get("/api/v1/healthcheck")
    assert response.status_code == 200
    assert response.json() == {"healthy": False, "extra": problem}


def test_lifespan_runs_the_health_check(tmp_path: Path) -> None:
    """With nothing to ask (empty URLs) and the agent's first window still open, the running check finds nothing"""
    settings = Settings(
        database=tmp_path / "db.sqlite",
        templates_dir=tmp_path,
        ui_dir=tmp_path / "none",
        proxy_ready_url="",
        gateway_ready_url="",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.get("/api/v1/healthcheck").json()["healthy"] is True
