"""A Murmur virtual server in memory, shaped like the Ice proxies murmur-agent talks to"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import ModuleType, SimpleNamespace
from typing import Any


class InvalidSessionException(Exception):
    """Murmur's: the session is gone"""


class InvalidChannelException(Exception):
    """Murmur's: the channel is gone"""


class ServerAuthenticator:
    """Base class the agent's servant derives from"""


class ACL(SimpleNamespace):
    """MumbleServer.ACL, positional like the generated struct"""

    def __init__(
        self, applyHere: bool, applySubs: bool, inherited: bool, userid: int, group: str, allow: int, deny: int
    ) -> None:
        super().__init__(
            applyHere=applyHere, applySubs=applySubs, inherited=inherited, userid=userid, group=group,
            allow=allow, deny=deny,
        )  # fmt: skip


class Group(SimpleNamespace):
    """MumbleServer.Group, positional like the generated struct"""

    def __init__(
        self, name: str, inherited: bool, inherit: bool, inheritable: bool, add: list[int], remove: list[int],
        members: list[int],
    ) -> None:  # fmt: skip
        super().__init__(
            name=name, inherited=inherited, inherit=inherit, inheritable=inheritable, add=add, remove=remove,
            members=members,
        )  # fmt: skip


# Stands in for the MumbleServer module that Ice generates from the slice
MUMBLE = ModuleType("MumbleServer")
MUMBLE.InvalidSessionException = InvalidSessionException  # type: ignore[attr-defined]
MUMBLE.InvalidChannelException = InvalidChannelException  # type: ignore[attr-defined]
MUMBLE.ServerAuthenticator = ServerAuthenticator  # type: ignore[attr-defined]
MUMBLE.UserInfo = SimpleNamespace(UserName=0)  # type: ignore[attr-defined]
MUMBLE.ACL = ACL  # type: ignore[attr-defined]
MUMBLE.Group = Group  # type: ignore[attr-defined]


@dataclass
class FakeServer:
    """Channels, ACLs, sessions and listeners, with a log of what was changed"""

    channels: dict[int, SimpleNamespace] = field(default_factory=dict)
    acls: dict[int, tuple[list[Any], list[Any], bool]] = field(default_factory=dict)
    users: dict[int, SimpleNamespace] = field(default_factory=dict)
    listeners: dict[int, list[int]] = field(default_factory=dict)
    certificates: dict[int, list[bytes]] = field(default_factory=dict)
    log: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.channels.setdefault(
            0, SimpleNamespace(id=0, parent=-1, name="Root", temporary=False, description="", links=[])
        )

    # ---- setup helpers
    def channel(self, channel_id: int, parent: int, name: str, temporary: bool = False) -> None:
        """Add a channel as if a user or admin had made it"""
        self.channels[channel_id] = SimpleNamespace(
            id=channel_id, parent=parent, name=name, temporary=temporary, description="", links=[]
        )

    def connect(self, session: int, name: str, channel: int = 0, userid: int = 1) -> None:
        """A user logs in"""
        self.users[session] = SimpleNamespace(session=session, name=name, channel=channel, userid=userid)

    def id_of(self, path: str) -> int:
        """Channel id by path, e.g. "/Missions/RECON" """
        channel_id = 0
        for name in path.strip("/").split("/"):
            channel_id = next(c.id for c in self.channels.values() if c.parent == channel_id and c.name == name)
        return channel_id

    # ---- the Ice operations the agent uses
    def getChannels(self) -> dict[int, SimpleNamespace]:
        return dict(self.channels)

    def addChannel(self, name: str, parent: int) -> int:
        channel_id = max(self.channels) + 1
        self.channel(channel_id, parent, name)
        return channel_id

    def getChannelState(self, channel_id: int) -> SimpleNamespace:
        if channel_id not in self.channels:
            raise InvalidChannelException()
        return SimpleNamespace(**vars(self.channels[channel_id]))

    def setChannelState(self, state: SimpleNamespace) -> None:
        # Murmur keeps links symmetric
        for other in set(self.channels[state.id].links) ^ set(state.links):
            linked = self.channels[other].links
            linked[:] = [*linked, state.id] if other in state.links else [c for c in linked if c != state.id]
        self.channels[state.id] = state

    def removeChannel(self, channel_id: int) -> None:
        parent = self.channels[channel_id].parent
        gone = {channel_id}
        while more := {c.id for c in self.channels.values() if c.parent in gone} - gone:
            gone |= more
        for channel in gone:
            del self.channels[channel]
        for user in self.users.values():
            if user.channel in gone:
                user.channel = parent
        self.log.append(f"remove {channel_id}")

    def getACL(self, channel_id: int) -> tuple[list[Any], list[Any], bool]:
        if channel_id not in self.channels:
            raise InvalidChannelException()
        return self.acls.get(channel_id, ([], [], True))

    def setACL(self, channel_id: int, acls: list[Any], groups: list[Any], inherit: bool) -> None:
        self.acls[channel_id] = (acls, groups, inherit)
        self.log.append(f"acl {channel_id}")

    def getUsers(self) -> dict[int, SimpleNamespace]:
        return dict(self.users)

    def _user(self, session: int) -> SimpleNamespace:
        if session not in self.users:
            raise InvalidSessionException()
        return self.users[session]

    def kickUser(self, session: int, reason: str) -> None:
        self._user(session)
        del self.users[session]
        self.log.append(f"kick {session}")

    def getState(self, session: int) -> SimpleNamespace:
        return SimpleNamespace(**vars(self._user(session)))

    def setState(self, state: SimpleNamespace) -> None:
        self._user(state.session).channel = state.channel
        self.log.append(f"move {state.session} {state.channel}")

    def getListeningUsers(self, channel_id: int) -> list[int]:
        if channel_id not in self.channels:
            raise InvalidChannelException()
        return list(self.listeners.get(channel_id, []))

    def stopListening(self, session: int, channel_id: int) -> None:
        self.listeners[channel_id].remove(session)
        self.log.append(f"unlisten {session} {channel_id}")

    def getCertificateList(self, session: int) -> list[bytes]:
        self._user(session)
        return self.certificates.get(session, [])
