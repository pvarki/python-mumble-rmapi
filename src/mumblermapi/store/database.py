"""Where mumblermapi's Postgres is"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from functools import cache

from sqlalchemy import URL, Engine
from sqlmodel import create_engine


@dataclass(frozen=True)
class DatabaseSettings:
    """The parts of the DSN, as the keys of CloudNativePG's app secret hold them"""

    host: str = "mumble-postgres-rw"
    port: int = 5432
    name: str = "mumble"
    user: str = "mumble"
    password: str = field(default="", repr=False)

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> DatabaseSettings:
        """MUMBLERMAPI_DATABASE_* variables"""
        return cls(
            host=env.get("MUMBLERMAPI_DATABASE_HOST", cls.host),
            port=int(env.get("MUMBLERMAPI_DATABASE_PORT", cls.port)),
            name=env.get("MUMBLERMAPI_DATABASE_NAME", cls.name),
            user=env.get("MUMBLERMAPI_DATABASE_USER", cls.user),
            password=env.get("MUMBLERMAPI_DATABASE_PASSWORD", cls.password),
        )

    @property
    def url(self) -> URL:
        """The DSN"""
        return URL.create(
            "postgresql+psycopg2",
            username=self.user,
            password=self.password,
            host=self.host,
            port=self.port,
            database=self.name,
        )


@cache
def engine(url: URL) -> Engine:
    """One engine, and so one connection pool, per database for the life of the process"""
    return create_engine(url, pool_pre_ping=True)
