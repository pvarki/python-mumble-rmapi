"""Stable Murmur user ids for "<callsign>---<slot>" names"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path


class UserIds:
    """Assigns each name a positive id once and remembers it on disk.

    Murmur keys last channels and ACL entries by user id, so an id must never move to another name. Id 0 is
    Murmur's SuperUser and is never handed out.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._by_name = self._load()
        self._by_id = {user_id: name for name, user_id in self._by_name.items()}

    def _load(self) -> dict[str, int]:
        if not self._path.exists():
            return {}
        data = json.loads(self._path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not all(
            isinstance(name, str) and isinstance(user_id, int) and not isinstance(user_id, bool) and user_id > 0
            for name, user_id in data.items()
        ):
            raise ValueError(f"{self._path} is not a name-to-id map")
        if len(set(data.values())) != len(data):
            raise ValueError(f"{self._path} gives one id to several names")
        return data

    def _save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._by_name, indent=1, sort_keys=True), encoding="utf-8")
        os.replace(tmp, self._path)

    def get_or_assign(self, name: str) -> int:
        """The name's id, assigning the next free one the first time"""
        with self._lock:
            user_id = self._by_name.get(name)
            if user_id is None:
                user_id = max(self._by_id, default=0) + 1
                self._by_name[name] = user_id
                self._by_id[user_id] = name
                self._save()
            return user_id

    def id_for(self, name: str) -> int | None:
        """The name's id, if it has one"""
        with self._lock:
            return self._by_name.get(name)

    def name_for(self, user_id: int) -> str | None:
        """The name holding an id, if any"""
        with self._lock:
            return self._by_id.get(user_id)

    def names(self) -> dict[str, int]:
        """Every name and its id"""
        with self._lock:
            return dict(self._by_name)
