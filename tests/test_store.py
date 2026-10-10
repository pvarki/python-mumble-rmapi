"""The mumblermapi store"""

import sqlite3
from pathlib import Path

import pytest

from mumblermapi.channels import ChannelSpec
from mumblermapi.store import Store, StoreError


@pytest.fixture(name="store")
def store_fixture(tmp_path: Path) -> Store:
    """A fresh store"""
    return Store(tmp_path / "state.db")


def test_users_and_flags(store: Store) -> None:
    """Users arrive from rmapi; flags change them and bump the version"""
    v0 = store.version()
    store.upsert_user("ALPHA 1", "uuid-a")
    store.set_user_flag("ALPHA 1", "admin", True)
    store.set_user_flag("BRAVO 2", "revoked", True, uuid="uuid-b")  # created event was missed
    store.upsert_user("ALPHA 1", "uuid-a2")
    alpha, bravo = store.users()
    assert (alpha.callsign, alpha.uuid, alpha.admin, alpha.revoked) == ("ALPHA 1", "uuid-a2", True, False)
    assert (bravo.callsign, bravo.revoked, bravo.voice_disabled) == ("BRAVO 2", True, False)
    assert store.user("BRAVO 2") == bravo
    assert store.user("NOBODY") is None
    assert store.version() == v0 + 4
    with pytest.raises(StoreError):
        store.set_user_flag("ALPHA 1", "root", True)


def test_channel_tree_and_members(store: Store) -> None:
    """Channels nest, carry members, and go away with their subtree"""
    assert store.is_empty()
    platoon = store.add_channel("10", "Alfa-joukkue")
    squad = store.add_channel("101", "Ryhmä 1", parent=platoon)
    store.add_channel("20")
    store.set_member(squad, "ALPHA 1", True)
    store.set_member(squad, "BRAVO 2", True)
    store.set_member(squad, "BRAVO 2", False)
    tree = store.tree()
    assert [c.name for c in tree] == ["10", "20"]
    assert tree[0].children[0].name == "101"
    assert tree[0].children[0].members == ["ALPHA 1"]
    with pytest.raises(StoreError):
        store.add_channel("10")
    with pytest.raises(StoreError):
        store.add_channel("x", parent=999)
    store.remove_channel(platoon)
    assert [c.name for c in store.tree()] == ["20"]
    with pytest.raises(StoreError):
        store.remove_channel(platoon)
    with pytest.raises(StoreError):
        store.set_member(squad, "ALPHA 1", True)


def test_import_plan_is_idempotent(store: Store) -> None:
    """Importing the same plan twice adds nothing the second time"""
    plan = (ChannelSpec("10", "A", (ChannelSpec("101"), ChannelSpec("102"))), ChannelSpec("07 TJ"))
    assert store.import_plan(plan) == 4
    assert store.import_plan(plan) == 0
    assert not store.is_empty()


def test_persists(tmp_path: Path) -> None:
    """State survives a restart"""
    first = Store(tmp_path / "state.db")
    first.add_channel("10")
    assert [c.name for c in Store(tmp_path / "state.db").tree()] == ["10"]


def test_missions(tmp_path: Path) -> None:
    """Missions are replaced as a whole; only a change bumps the version; missions without subscribers are dropped"""
    store = Store(tmp_path / "db.sqlite")
    before = store.version()
    assert store.set_missions({"RECON": frozenset({"VOICE1", "VOICE3"}), "EMPTY": frozenset()})
    assert store.missions() == {"RECON": frozenset({"VOICE1", "VOICE3"})}
    assert store.version() == before + 1
    assert not store.set_missions({"RECON": frozenset({"VOICE3", "VOICE1"})})
    assert store.version() == before + 1
    assert store.set_missions({})
    assert store.missions() == {}


def test_channel_ids_are_never_reused(tmp_path: Path) -> None:
    """A stale reference to a removed channel cannot reach a channel made after it"""
    store = Store(tmp_path / "db.sqlite")
    first = store.add_channel("10")
    store.remove_channel(first)
    assert store.add_channel("20") > first


def test_update_channel(tmp_path: Path) -> None:
    """Names and descriptions change in place; a clash with a sibling is refused"""
    store = Store(tmp_path / "db.sqlite")
    ten = store.add_channel("10", "Alfa")
    store.add_channel("20")
    before = store.version()
    store.update_channel(ten, description="Alfa-joukkue")
    store.update_channel(ten, name="11")
    assert [(c.name, c.description) for c in store.tree()] == [("11", "Alfa-joukkue"), ("20", "")]
    assert store.version() == before + 2
    with pytest.raises(StoreError):
        store.update_channel(ten, name="20")
    with pytest.raises(StoreError):
        store.update_channel(999, description="x")


def test_clear(tmp_path: Path) -> None:
    """The whole plan goes at once, members too, and new ids do not reuse old ones"""
    store = Store(tmp_path / "db.sqlite")
    ten = store.add_channel("10")
    store.add_channel("101", parent=ten)
    store.upsert_user("VOICE1", "u1")
    store.set_member(ten, "VOICE1", True)
    assert store.clear() == 2
    assert store.tree() == [] and store.is_empty()
    assert store.add_channel("10") > ten


def test_changes_are_atomic(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A change that fails halfway leaves nothing behind"""
    store = Store(tmp_path / "db.sqlite")
    ten = store.add_channel("10")
    store.add_channel("101", parent=ten)
    store.upsert_user("VOICE1", "u1")
    store.set_member(ten, "VOICE1", True)
    before = store.version()

    class Boom(Exception):
        pass

    def fail(*args: object) -> None:
        raise Boom

    monkeypatch.setattr(store, "_bump", fail)
    with pytest.raises(Boom):
        store.clear()
    assert [c.name for c in store.tree()] == ["10"] and store.tree()[0].members == ["VOICE1"]
    assert store.version() == before


def test_access_defaults_and_changes(tmp_path: Path) -> None:
    """Top-level nets start open and sub-nets follow their parent; a top-level net cannot inherit"""
    store = Store(tmp_path / "db.sqlite")
    ten = store.add_channel("10")
    squad = store.add_channel("101", parent=ten)
    fire = store.add_channel("07 TJ", access="invite")
    assert [(c.name, c.access, [k.access for k in c.children]) for c in store.tree()] == [
        ("07 TJ", "invite", []),
        ("10", "open", ["inherit"]),
    ]
    store.update_channel(squad, access="open")
    store.update_channel(ten, access="inherit")
    store.update_channel(fire, description="Tulenjohto")
    assert [(c.name, c.access) for c in store.tree()] == [("07 TJ", "invite"), ("10", "open")]
    assert store.tree()[1].children[0].access == "open"
    with pytest.raises(StoreError):
        store.update_channel(ten, access="secret")
    with pytest.raises(StoreError):
        store.add_channel("20", access="secret")


def test_member_makes_net_invite_only(tmp_path: Path) -> None:
    """Adding a member closes an open net; removing the last one leaves it closed, and opening it keeps them"""
    store = Store(tmp_path / "db.sqlite")
    ten = store.add_channel("10")
    store.set_member(ten, "ALPHA", True)
    assert store.tree()[0].access == "invite"
    store.set_member(ten, "ALPHA", False)
    assert store.tree()[0].access == "invite"
    store.set_member(ten, "ALPHA", True)
    store.update_channel(ten, access="open")
    assert (store.tree()[0].access, store.tree()[0].members) == ("open", ["ALPHA"])


def test_import_keeps_plan_access(tmp_path: Path) -> None:
    """A plan's access lands as written; unspecified access takes the default"""
    store = Store(tmp_path / "db.sqlite")
    store.import_plan((ChannelSpec("10", access="invite", children=(ChannelSpec("101"),)),))
    platoon = store.tree()[0]
    assert (platoon.access, platoon.children[0].access) == ("invite", "inherit")


def test_import_restores_members(tmp_path: Path) -> None:
    """New nets get the plan's members; a net that exists keeps its own"""
    store = Store(tmp_path / "db.sqlite")
    kept = store.add_channel("20", access="invite")
    store.set_member(kept, "BRAVO", True)
    plan = (
        ChannelSpec("10", access="invite", members=("VOICE1",)),
        ChannelSpec("20", access="invite", members=("OTHER",)),
    )
    assert store.import_plan(plan) == 1
    assert {c.name: c.members for c in store.tree()} == {"10": ["VOICE1"], "20": ["BRAVO"]}


def test_migrates_implicit_access(tmp_path: Path) -> None:
    """A store from before explicit access keeps the access its members gave it"""
    path = tmp_path / "db.sqlite"
    old = sqlite3.connect(path)
    old.executescript(
        """
        CREATE TABLE channels (id INTEGER PRIMARY KEY AUTOINCREMENT, parent INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', UNIQUE (parent, name));
        CREATE TABLE members (channel INTEGER NOT NULL, callsign TEXT NOT NULL, PRIMARY KEY (channel, callsign));
        INSERT INTO channels (id, parent, name) VALUES (1, 0, '10'), (2, 1, '101'), (3, 1, '102'), (4, 0, '20');
        INSERT INTO members VALUES (1, 'LEADER'), (2, 'ALPHA');
        """
    )
    old.commit()
    old.close()
    store = Store(path)
    platoon, company = store.tree()
    assert (platoon.access, [c.access for c in platoon.children], company.access) == (
        "invite",
        ["invite", "inherit"],
        "open",
    )
