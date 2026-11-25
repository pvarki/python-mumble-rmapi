"""The one-time copy of the SQLite store that releases before Postgres kept"""

import sqlite3
from contextlib import closing
from dataclasses import astuple
from pathlib import Path

import pytest

from mumblermapi.store import DatabaseSettings, Store, engine

# The tables as 1.0.5 creates them
SCHEMA_1_0_5 = """
CREATE TABLE users (callsign TEXT PRIMARY KEY, uuid TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0, voice_disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE channels (id INTEGER PRIMARY KEY AUTOINCREMENT, parent INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', access TEXT NOT NULL DEFAULT '', UNIQUE (parent, name));
CREATE TABLE members (channel INTEGER NOT NULL, callsign TEXT NOT NULL, PRIMARY KEY (channel, callsign));
CREATE TABLE mission_members (mission TEXT NOT NULL, callsign TEXT NOT NULL, PRIMARY KEY (mission, callsign));
CREATE TABLE web_slots (callsign TEXT NOT NULL, browser TEXT NOT NULL, slot INTEGER NOT NULL, used_at REAL NOT NULL,
    PRIMARY KEY (callsign, browser), UNIQUE (callsign, slot));
CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO meta VALUES ('version', 1);
"""
# A net was removed after id 7, so SQLite's sequence is past the highest id still there
DATA = """
INSERT INTO users VALUES ('ALPHA 1', 'uuid-a', 1, 0, 0), ('BRAVO 2', 'uuid-b', 0, 1, 0), ('CHARLIE 3', 'uuid-c', 0, 0, 1);
INSERT INTO channels VALUES (1, 0, '10', 'Alfa', 'open'), (2, 1, '101', 'Ryhmä 1', 'invite'), (5, 0, '20', '', 'open'),
    (7, 0, 'gone', '', 'open');
DELETE FROM channels WHERE id = 7;
INSERT INTO members VALUES (2, 'ALPHA 1'), (2, 'CHARLIE 3');
INSERT INTO mission_members VALUES ('RECON', 'ALPHA 1'), ('RECON', 'BRAVO 2');
INSERT INTO web_slots VALUES ('ALPHA_1', 'laptop-browser-01', 2, 100.0);
UPDATE meta SET value = 42 WHERE key = 'version';
"""


def _sqlite(path: Path, script: str) -> Path:
    with closing(sqlite3.connect(path)) as old:
        old.executescript(script)
    return path


@pytest.fixture(name="old_store")
def old_store_fixture(tmp_path: Path) -> Path:
    """A SQLite store as 1.0.5 left it"""
    return _sqlite(tmp_path / "mumblermapi.db", SCHEMA_1_0_5 + DATA)


def test_copies_every_table(old_store: Path, database: DatabaseSettings) -> None:
    """Users keep their flags, nets their ids and members, and the agent sees the same version"""
    store = Store(engine(database.url), old_store)
    assert [astuple(u) for u in store.users()] == [
        ("ALPHA 1", "uuid-a", True, False, False),
        ("BRAVO 2", "uuid-b", False, True, False),
        ("CHARLIE 3", "uuid-c", False, False, True),
    ]
    platoon, company = store.tree()
    squad = platoon.children[0]
    assert (platoon.id, platoon.name, platoon.description, platoon.access) == (1, "10", "Alfa", "open")
    assert (squad.id, squad.description, squad.access, squad.members) == (
        2,
        "Ryhmä 1",
        "invite",
        ["ALPHA 1", "CHARLIE 3"],
    )
    assert (company.id, company.children) == (5, [])
    assert store.missions() == {"RECON": frozenset({"ALPHA 1", "BRAVO 2"})}
    assert store.version() == 42
    assert store.web_slot("ALPHA_1", "laptop-browser-01", 200.0) == 2
    assert store.web_slot("ALPHA_1", "phone-browser-0002", 201.0) == 1


def test_new_nets_get_ids_sqlite_never_gave(old_store: Path, database: DatabaseSettings) -> None:
    """Not even the removed net's id comes back"""
    store = Store(engine(database.url), old_store)
    assert store.add_channel("30") == 8


def test_copies_once_and_leaves_the_file(old_store: Path, database: DatabaseSettings) -> None:
    """A restart does not copy again, so what changed since stays; the old file is as it was"""
    before = old_store.read_bytes()
    Store(engine(database.url), old_store).remove_channel(1)
    restarted = Store(engine(database.url), old_store)
    assert [c.name for c in restarted.tree()] == ["20"]
    assert old_store.read_bytes() == before


def test_a_store_with_no_nets_ever(tmp_path: Path, database: DatabaseSettings) -> None:
    """SQLite has no sequence for nets until the first one, and the first new net is 1"""
    old = _sqlite(tmp_path / "mumblermapi.db", SCHEMA_1_0_5)
    assert Store(engine(database.url), old).add_channel("10") == 1
