"""Who is connected and in which net, as murmur-agent reports it to mumblermapi for the admin UI"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field

from .channels import ExistingChannel
from .enforce import Session, callsign_of

LOGGER = logging.getLogger(__name__)

Entry = dict[str, str]
Post = Callable[[str, object, float], int]


def channel_paths(channels: Iterable[ExistingChannel]) -> dict[int, str]:
    """Every channel's path from the root, which is "/" """
    by_id = {c.id: c for c in channels}
    paths: dict[int, str] = {}

    def path(channel_id: int) -> str:
        if channel_id not in paths:
            channel = by_id.get(channel_id)
            if channel is None or channel.id == 0:
                paths[channel_id] = "/"
            else:
                paths[channel_id] = f"{path(channel.parent).rstrip('/')}/{channel.name}"
        return paths[channel_id]

    for channel_id in by_id:
        path(channel_id)
    return paths


def presence(sessions: Iterable[Session], paths: Mapping[int, str]) -> list[Entry]:
    """Each session's callsign (in username form) and net, in a stable order"""
    entries = [
        {"callsign": callsign, "channel": paths.get(s.channel, "/")}
        for s in sessions
        if (callsign := callsign_of(s.name))
    ]
    return sorted(entries, key=lambda e: (e["callsign"], e["channel"]))


def http_post_json(url: str, body: object, timeout: float) -> int:
    """POST JSON and return the status"""
    if not url.startswith(("http://", "https://")):
        raise ValueError(f"refusing presence URL {url!r}")
    request = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        # The scheme is checked above, so urlopen cannot be steered to file:// or similar.
        with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310
            return int(response.status)
    except urllib.error.HTTPError as exc:
        return exc.code


@dataclass
class PresenceReporter:
    """Reports presence when it changes, and at least every heartbeat seconds so mumblermapi knows it is current"""

    url: str
    post: Post = http_post_json
    heartbeat: float = 30.0
    timeout: float = 5.0
    _sent: list[Entry] | None = field(default=None, init=False)
    _sent_at: float = field(default=float("-inf"), init=False)

    def report(self, entries: list[Entry], now: float) -> None:
        """Send if changed or due; failures are retried on the next call"""
        if entries == self._sent and now - self._sent_at < self.heartbeat:
            return
        try:
            status = self.post(self.url, {"sessions": entries}, self.timeout)
        except (OSError, ValueError) as exc:
            LOGGER.warning("Could not report presence: %s", exc)
            return
        if status != 200:
            LOGGER.warning("mumblermapi did not take presence: HTTP %d", status)
            return
        self._sent, self._sent_at = entries, now
