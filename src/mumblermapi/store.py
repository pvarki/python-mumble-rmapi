"""mumblermapi's state: users from rmapi, the Units/ channel tree and its members, and TAK missions"""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass, field
from pathlib import Path

from .channels import ACCESS, GUARD, ChannelSpec

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    callsign TEXT PRIMARY KEY,
    uuid TEXT NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0,
    voice_disabled INTEGER NOT NULL DEFAULT 0
);
-- AUTOINCREMENT: a removed channel's id is never reused, so a stale admin page cannot hit a new channel
CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent INTEGER NOT NULL DEFAULT 0,  -- 0 is Units/ itself
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    access TEXT NOT NULL DEFAULT '',  -- open, invite or inherit; '' only in stores older than the column
    UNIQUE (parent, name)
);
CREATE TABLE IF NOT EXISTS members (
    channel INTEGER NOT NULL,
    callsign TEXT NOT NULL,
    PRIMARY KEY (channel, callsign)
);
-- The last mission list read from TAK, with subscriber callsigns; kept while TAK cannot be reached
CREATE TABLE IF NOT EXISTS mission_members (
    mission TEXT NOT NULL,
    callsign TEXT NOT NULL,
    PRIMARY KEY (mission, callsign)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (key, value) VALUES ('version', 1);
"""


_SET_FLAG = {
    "admin": "UPDATE users SET admin = ? WHERE callsign = ?",
    "revoked": "UPDATE users SET revoked = ? WHERE callsign = ?",
    "voice_disabled": "UPDATE users SET voice_disabled = ? WHERE callsign = ?",
}


class StoreError(ValueError):
    """The change is not possible"""


class NoSuchChannel(StoreError):
    """The channel does not exist"""


@dataclass(frozen=True)
class User:
    """A Deploy App user as rmapi reported it"""

    callsign: str
    uuid: str
    admin: bool
    revoked: bool
    voice_disabled: bool


@dataclass
class Channel:
    """A Units/ channel; access says whether its members restrict it (see channels.ACCESS)"""

    id: int
    name: str
    description: str
    access: str = "open"
    members: list[str] = field(default_factory=list)
    children: list[Channel] = field(default_factory=list)


class Store:
    """SQLite-backed state. Every change bumps a version so murmur-agent can poll cheaply."""

    def __init__(self, path: Path) -> None:
        # Default isolation: "with self._db" then wraps each change in one transaction, so a multi-statement
        # change (a subtree removal, a plan clear) lands whole or not at all.
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.executescript(SCHEMA)
        self._migrate()
        self._lock = threading.Lock()

    def _migrate(self) -> None:
        """Give stores from before explicit access the access they had implicitly: members restricted a net"""
        with self._db:
            columns = {row[1] for row in self._db.execute("PRAGMA table_info(channels)")}
            if "access" not in columns:
                self._db.execute("ALTER TABLE channels ADD COLUMN access TEXT NOT NULL DEFAULT ''")
            self._db.execute(
                "UPDATE channels SET access = CASE"
                " WHEN EXISTS (SELECT 1 FROM members m WHERE m.channel = channels.id) THEN 'invite'"
                " WHEN parent = 0 THEN 'open' ELSE 'inherit' END WHERE access = ''"
            )

    @staticmethod
    def _access(access: str | None, parent: int) -> str:
        """The default, and a top-level net cannot inherit from anything: that is open"""
        if access is not None and access not in ACCESS:
            raise StoreError(f"access must be one of {', '.join(ACCESS)}")
        if parent == 0 and access in (None, "inherit"):
            return "open"
        return access or "inherit"

    # ---- version
    def version(self) -> int:
        """Changes whenever anything murmur-agent cares about changes"""
        with self._lock:
            row = self._db.execute("SELECT value FROM meta WHERE key = 'version'").fetchone()
            return int(row[0])

    def _bump(self) -> None:
        self._db.execute("UPDATE meta SET value = value + 1 WHERE key = 'version'")

    # ---- users
    def upsert_user(self, callsign: str, uuid: str) -> None:
        """A user was created or updated in rmapi"""
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO users (callsign, uuid) VALUES (?, ?) ON CONFLICT (callsign) DO UPDATE SET uuid = ?",
                (callsign, uuid, uuid),
            )
            self._bump()

    def set_user_flag(self, callsign: str, flag: str, value: bool, uuid: str = "") -> None:
        """Set admin, revoked or voice_disabled; creates the user if rmapi's created event was missed"""
        if flag not in _SET_FLAG:
            raise StoreError(f"unknown flag {flag}")
        with self._lock, self._db:
            self._db.execute("INSERT OR IGNORE INTO users (callsign, uuid) VALUES (?, ?)", (callsign, uuid))
            self._db.execute(_SET_FLAG[flag], (int(value), callsign))
            self._bump()

    def users(self) -> list[User]:
        """Every known user"""
        with self._lock:
            rows = self._db.execute(
                "SELECT callsign, uuid, admin, revoked, voice_disabled FROM users ORDER BY callsign"
            ).fetchall()
        return [User(r[0], r[1], bool(r[2]), bool(r[3]), bool(r[4])) for r in rows]

    def user(self, callsign: str) -> User | None:
        """One user, if known"""
        return next((u for u in self.users() if u.callsign == callsign), None)

    # ---- channels
    def add_channel(self, name: str, description: str = "", parent: int = 0, access: str | None = None) -> int:
        """Create a channel under Units/ (parent 0) or under another channel. By default a top-level net is open
        and a sub-net follows its parent."""
        access = self._access(access, parent)
        with self._lock, self._db:
            if parent and not self._db.execute("SELECT 1 FROM channels WHERE id = ?", (parent,)).fetchone():
                raise NoSuchChannel(f"no channel {parent}")
            try:
                cur = self._db.execute(
                    "INSERT INTO channels (parent, name, description, access) VALUES (?, ?, ?, ?)",
                    (parent, name, description, access),
                )
            except sqlite3.IntegrityError as exc:
                raise StoreError(f"channel {name!r} already exists there") from exc
            self._bump()
            return int(cur.lastrowid or 0)

    def remove_channel(self, channel_id: int) -> None:
        """Remove a channel with everything under it"""
        with self._lock, self._db:
            if not self._db.execute("SELECT 1 FROM channels WHERE id = ?", (channel_id,)).fetchone():
                raise NoSuchChannel(f"no channel {channel_id}")
            ids = [
                r[0]
                for r in self._db.execute(
                    "WITH RECURSIVE sub(id) AS (SELECT ? UNION SELECT c.id FROM channels c JOIN sub ON c.parent = sub.id)"
                    " SELECT id FROM sub",
                    (channel_id,),
                )
            ]
            self._db.executemany("DELETE FROM members WHERE channel = ?", [(i,) for i in ids])
            self._db.executemany("DELETE FROM channels WHERE id = ?", [(i,) for i in ids])
            self._bump()

    def update_channel(
        self, channel_id: int, name: str | None = None, description: str | None = None, access: str | None = None
    ) -> None:
        """Rename a channel, change its description, or change who may use it"""
        with self._lock, self._db:
            row = self._db.execute(
                "SELECT name, description, access, parent FROM channels WHERE id = ?", (channel_id,)
            ).fetchone()
            if not row:
                raise NoSuchChannel(f"no channel {channel_id}")
            new_access = row[2] if access is None else self._access(access, row[3])
            try:
                self._db.execute(
                    "UPDATE channels SET name = ?, description = ?, access = ? WHERE id = ?",
                    (
                        row[0] if name is None else name,
                        row[1] if description is None else description,
                        new_access,
                        channel_id,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise StoreError(f"channel {name!r} already exists there") from exc
            self._bump()

    def clear(self) -> int:
        """Remove every Units/ channel and membership; returns how many channels went"""
        with self._lock, self._db:
            removed = int(self._db.execute("SELECT COUNT(*) FROM channels").fetchone()[0])
            self._db.execute("DELETE FROM members")
            self._db.execute("DELETE FROM channels")
            self._bump()
            return removed

    def set_member(self, channel_id: int, callsign: str, member: bool) -> None:
        """Add or remove a member. Members are invited, so adding one makes the net invite-only."""
        with self._lock, self._db:
            if not self._db.execute("SELECT 1 FROM channels WHERE id = ?", (channel_id,)).fetchone():
                raise NoSuchChannel(f"no channel {channel_id}")
            if member:
                self._db.execute(
                    "INSERT OR IGNORE INTO members (channel, callsign) VALUES (?, ?)", (channel_id, callsign)
                )
                self._db.execute("UPDATE channels SET access = 'invite' WHERE id = ?", (channel_id,))
            else:
                self._db.execute("DELETE FROM members WHERE channel = ? AND callsign = ?", (channel_id, callsign))
            self._bump()

    def tree(self) -> list[Channel]:
        """The Units/ tree with members"""
        with self._lock:
            rows = self._db.execute(
                "SELECT id, parent, name, description, access FROM channels ORDER BY name"
            ).fetchall()
            members = self._db.execute("SELECT channel, callsign FROM members ORDER BY callsign").fetchall()
        nodes = {r[0]: Channel(r[0], r[2], r[3], r[4]) for r in rows}
        for channel, callsign in members:
            nodes[channel].members.append(callsign)
        top: list[Channel] = []
        for r in rows:
            (nodes[r[1]].children if r[1] in nodes else top).append(nodes[r[0]])
        return top

    def import_plan(self, plan: tuple[ChannelSpec, ...], parent: int = 0) -> int:
        """Add a channel plan (the 2022 YAML schema) under a channel; returns how many channels were created.
        Nets that exist are kept as they are; new ones get the plan's access and members."""
        created = 0
        for spec in plan:
            try:
                channel_id = self.add_channel(spec.name, spec.description, parent, spec.access or None)
                created += 1
                if spec.members:
                    with self._lock, self._db:
                        self._db.executemany(
                            "INSERT OR IGNORE INTO members (channel, callsign) VALUES (?, ?)",
                            [(channel_id, callsign) for callsign in spec.members],
                        )
                        self._bump()
            except StoreError:
                with self._lock:
                    row = self._db.execute(
                        "SELECT id FROM channels WHERE parent = ? AND name = ?", (parent, spec.name)
                    ).fetchone()
                channel_id = int(row[0])
            created += self.import_plan(spec.children, channel_id)
        return created

    # ---- missions
    def missions(self) -> dict[str, frozenset[str]]:
        """TAK missions and their subscribers, as last read"""
        with self._lock:
            rows = self._db.execute("SELECT mission, callsign FROM mission_members").fetchall()
        result: dict[str, set[str]] = {}
        for mission, callsign in rows:
            result.setdefault(mission, set()).add(callsign)
        return {mission: frozenset(members) for mission, members in result.items()}

    def set_missions(self, missions: dict[str, frozenset[str]]) -> bool:
        """Replace the missions; True, and a new version, only when something changed. A TAK mission named
        like Guard is left out: Guard stays open to everyone."""
        wanted = {mission: members for mission, members in missions.items() if members and mission != GUARD}
        if wanted == self.missions():
            return False
        with self._lock, self._db:
            self._db.execute("DELETE FROM mission_members")
            self._db.executemany(
                "INSERT INTO mission_members (mission, callsign) VALUES (?, ?)",
                [(mission, callsign) for mission, members in wanted.items() for callsign in members],
            )
            self._bump()
        return True

    def is_empty(self) -> bool:
        """No channels yet"""
        with self._lock:
            return bool(self._db.execute("SELECT COUNT(*) FROM channels").fetchone()[0] == 0)
