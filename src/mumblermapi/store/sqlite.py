"""The SQLite store that releases before Postgres kept, copied into Postgres once"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from sqlalchemy import func
from sqlmodel import Session, SQLModel, select

from .tables import ChannelRow, MemberRow, MetaRow, MissionMemberRow, UserRow, WebSlotRow

# Copied as they are. web_slots came in 1.0.5, so older stores lack it.
_TABLES: tuple[tuple[str, type[SQLModel], str], ...] = (
    ("users", UserRow, "SELECT callsign, uuid, admin, revoked, voice_disabled FROM users"),
    ("channels", ChannelRow, "SELECT id, parent, name, description, access FROM channels"),
    ("members", MemberRow, "SELECT channel, callsign FROM members"),
    ("mission_members", MissionMemberRow, "SELECT mission, callsign FROM mission_members"),
    ("web_slots", WebSlotRow, "SELECT callsign, browser, slot, used_at FROM web_slots"),
    ("meta", MetaRow, "SELECT key, value FROM meta"),
)


def copy_sqlite(path: Path, session: Session) -> None:
    """Copy every table of the SQLite store into the session's empty database. Nets keep their ids, and new ones
    get ids above any SQLite ever gave, so not even a removed net's id is used again."""
    with closing(sqlite3.connect(path)) as old:
        old.row_factory = sqlite3.Row
        tables = {name for (name,) in old.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        for table, model, query in _TABLES:
            if table in tables:
                session.add_all(model.model_validate(dict(row)) for row in old.execute(query))
        issued = old.execute("SELECT seq FROM sqlite_sequence WHERE name = 'channels'").fetchone()
    if issued:
        session.exec(select(func.setval(func.pg_get_serial_sequence("channels", "id"), issued["seq"])))
