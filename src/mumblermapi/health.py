"""Voice's health for rmapi: what browsers and phones need to talk, checked in the background, so the kubelet's
probes of the same endpoint stay cheap"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import time
from collections.abc import Awaitable, Callable
from typing import Any

import aiohttp

LOGGER = logging.getLogger(__name__)

HEALTH_SECONDS = 15.0  # how often the check runs; rmapi's health call reads the last result
FETCH_SECONDS = 2.0  # how long each of its requests may take

# A check request's outcome: the HTTP status it got, or why it got none
Answer = int | str
Fetch = Callable[[str], Awaitable[Answer]]


def why(exc: Exception) -> str:
    """Why a check request got no answer, in a few words, so an outage's cause shows in rmui and the log"""
    if isinstance(exc, aiohttp.ClientConnectorDNSError):
        return "name resolution failed"
    if isinstance(exc, TimeoutError):  # aiohttp's total timeout, and its connect and read timeouts
        return "timed out"
    if isinstance(exc, aiohttp.ClientConnectorError) and isinstance(exc.os_error, ConnectionRefusedError):
        return "connection refused"
    return str(exc) or type(exc).__name__


def fetcher(session: aiohttp.ClientSession) -> Fetch:
    """GET a URL through session"""

    async def fetch(url: str) -> Answer:
        try:
            async with session.get(url) as response:
                return response.status
        except (aiohttp.ClientError, OSError, TimeoutError) as exc:
            return why(exc)

    return fetch


def _cause(answer: Answer) -> str:
    return answer if isinstance(answer, str) else f"HTTP {answer}"


async def problems(
    fetch: Fetch,
    proxy_ready_url: str,
    gateway_ready_url: str,
    presence_age: float,
    uptime: float,
    presence_ttl: float,
) -> list[str]:
    """What keeps voice from working now, each with its cause; empty when nothing does. A URL left empty is not
    checked.

    Without its Linkerd proxy (a pod created before the injector was ready) every caller's identity is missing, so
    rmapi, murmur-agent and the browsers' tickets are all refused. murmur-agent reports presence every 30 s once it
    reaches both Murmur and this service. The gateway's readiness is its own proxy, without which Traefik's identity
    never reaches it.
    """
    found = []
    if proxy_ready_url and (answer := await fetch(proxy_ready_url)) != 200:
        found.append(
            f"no ready Linkerd proxy in mumblermapi's pod ({_cause(answer)}): rmapi, murmur-agent and browser "
            "tickets are refused"
        )
    if uptime > presence_ttl and presence_age > presence_ttl:
        since = "since mumblermapi started" if math.isinf(presence_age) else f"for {presence_age:.0f} s"
        found.append(f"murmur-agent has not reported {since}: Murmur or the agent is away or refused")
    if gateway_ready_url and (answer := await fetch(gateway_ready_url)) != 204:
        found.append(f"the voice gateway is not ready ({_cause(answer)}): browsers cannot talk")
    return found


async def watch(app: Any, stop: asyncio.Event, presence_ttl: float) -> None:
    """Keep app.state.health current until stopped, logging each change"""
    settings = app.state.settings
    started = time.monotonic()
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=FETCH_SECONDS)) as session:
        fetch = fetcher(session)
        while not stop.is_set():
            now = time.monotonic()
            received, _ = app.state.presence
            found = await problems(
                fetch, settings.proxy_ready_url, settings.gateway_ready_url, now - received, now - started, presence_ttl
            )
            if found != app.state.health:
                if found:
                    LOGGER.warning("Voice is unhealthy: %s", "; ".join(found))
                else:
                    LOGGER.info("Voice is healthy")
            app.state.health = found
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), HEALTH_SECONDS)
