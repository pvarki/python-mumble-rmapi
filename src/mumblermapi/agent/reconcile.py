"""The channel tree the agent keeps in Murmur"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..channels import ChannelSpec


class ChannelRefused(Exception):
    """Murmur will not create the channel there, as when it would nest past Murmur's limit"""


@dataclass(frozen=True)
class ExistingChannel:
    """A channel as Murmur reports it"""

    id: int
    parent: int
    name: str
    temporary: bool = False
    description: str = ""
    links: tuple[int, ...] = ()


class ChannelServer(Protocol):
    """The part of Murmur the reconciler needs"""

    def channels(self) -> list[ExistingChannel]:
        """Every channel on the server"""

    def add_channel(self, name: str, parent: int, description: str) -> int:
        """Create a channel and return its id; raises ChannelRefused when Murmur will not have it there"""

    def set_description(self, channel_id: int, description: str) -> None:
        """Change a channel's description"""

    def remove_channel(self, channel_id: int) -> None:
        """Remove a channel and everything under it"""


def reconcile(server: ChannelServer, desired: tuple[ChannelSpec, ...], root: int = 0) -> tuple[list[str], list[str]]:
    """Create the channels that are missing and correct the descriptions of the others. Returns the paths
    created and the paths Murmur refused.

    Channels are matched by name, so a renamed net is a new channel and the old one is pruned, which moves anyone
    in it to its parent. A temporary channel holding a net's name is replaced. A refused channel is left out with
    everything under it, and the rest of the tree still goes in.
    """
    existing = {(channel.parent, channel.name): channel for channel in server.channels()}
    created: list[str] = []
    refused: list[str] = []

    def walk(specs: tuple[ChannelSpec, ...], parent: int, prefix: str) -> None:
        for spec in specs:
            path = f"{prefix}/{spec.name}"
            channel = existing.get((parent, spec.name))
            if channel is not None and channel.temporary:
                # A user's temporary channel must not stand in for a net: its creator keeps rights over it and
                # whatever is built inside. Murmur moves the people in it to the parent.
                server.remove_channel(channel.id)
                channel = None
            if channel is None:
                try:
                    channel_id = server.add_channel(spec.name, parent, spec.description)
                except ChannelRefused:
                    refused.append(path)
                    continue  # the nets under it cannot exist without it
                created.append(path)
            else:
                channel_id = channel.id
                if channel.description != spec.description:
                    server.set_description(channel_id, spec.description)
            walk(spec.children, channel_id, path)

    walk(desired, root, "")
    return created, refused


def prune(server: ChannelServer, desired: tuple[ChannelSpec, ...], root: int, prefix: str = "") -> list[str]:
    """Remove the permanent channels under root that desired no longer has, and return their paths.

    Temporary channels belong to the users in them, and Murmur removes them once they are empty.
    """
    children: dict[int, list[ExistingChannel]] = {}
    for channel in server.channels():
        children.setdefault(channel.parent, []).append(channel)
    removed: list[str] = []

    def walk(specs: tuple[ChannelSpec, ...], parent: int, prefix: str) -> None:
        wanted = {spec.name: spec for spec in specs}
        for channel in children.get(parent, []):
            path = f"{prefix}/{channel.name}"
            spec = wanted.get(channel.name)
            if spec is not None:
                walk(spec.children, channel.id, path)
            elif not channel.temporary:
                server.remove_channel(channel.id)
                removed.append(path)

    walk(desired, root, prefix)
    return removed
