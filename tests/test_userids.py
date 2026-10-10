"""Stable user ids"""

from pathlib import Path

import pytest

from mumblermapi.userids import UserIds


def test_assign_and_persist(tmp_path: Path) -> None:
    """Ids start at 1, stay put, and survive a restart"""
    path = tmp_path / "ids.json"
    ids = UserIds(path)
    assert ids.get_or_assign("ALPHA_1---a") == 1
    assert ids.get_or_assign("ALPHA_1---b") == 2
    assert ids.get_or_assign("ALPHA_1---a") == 1
    again = UserIds(path)
    assert again.id_for("ALPHA_1---b") == 2
    assert again.name_for(1) == "ALPHA_1---a"
    assert again.get_or_assign("BRAVO_2---a") == 3
    assert again.id_for("nobody") is None
    assert again.name_for(99) is None


@pytest.mark.parametrize(
    "content",
    ['["a"]', '{"a": 0}', '{"a": "1"}', '{"a": true}', '{"a": 1, "b": 1}'],
)
def test_refuses_corrupt_store(tmp_path: Path, content: str) -> None:
    """A damaged store stops the agent instead of reshuffling ids"""
    path = tmp_path / "ids.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(ValueError):
        UserIds(path)


def test_names(tmp_path: Path) -> None:
    """All assignments, as a copy"""
    ids = UserIds(tmp_path / "ids.json")
    ids.get_or_assign("A---vs1")
    names = ids.names()
    names["B"] = 9
    assert ids.names() == {"A---vs1": 1}
