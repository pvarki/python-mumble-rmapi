"""Where mumblermapi's Postgres is"""

from __future__ import annotations

from functools import cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL, Engine
from sqlmodel import create_engine


class DatabaseSettings(BaseSettings):
    """The parts of the DSN, as the keys of CloudNativePG's app secret hold them; MUMBLERMAPI_DATABASE_* variables"""

    host: str = "mumble-postgres-rw"
    port: int = 5432
    name: str = "mumble"
    user: str = "mumble"
    password: str = Field(default="", repr=False)

    model_config = SettingsConfigDict(env_prefix="MUMBLERMAPI_DATABASE_", frozen=True)

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
