"""The tables mumblermapi keeps in Postgres"""

from __future__ import annotations

from sqlalchemy import Column, Identity, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel


class UserRow(SQLModel, table=True):
    """A Deploy App user as rmapi reported it"""

    __tablename__ = "users"

    callsign: str = Field(primary_key=True)
    uuid: str
    admin: bool = False
    revoked: bool = False
    voice_disabled: bool = False


class ChannelRow(SQLModel, table=True):
    """A Units/ net. Ids come from an identity column and are never reused, so a stale admin page cannot reach
    a net made after the one it shows."""

    __tablename__ = "channels"
    __table_args__ = (UniqueConstraint("parent", "name"),)

    id: int = Field(sa_column=Column(Integer, Identity(), primary_key=True))
    parent: int = 0  # 0 is Units/ itself
    name: str
    description: str = ""
    access: str  # open, invite or inherit (channels.ACCESS)


class MemberRow(SQLModel, table=True):
    """A callsign invited to a net"""

    __tablename__ = "members"

    channel: int = Field(primary_key=True)
    callsign: str = Field(primary_key=True)


class MissionMemberRow(SQLModel, table=True):
    """The last mission list read from TAK, with subscriber callsigns; kept while TAK cannot be reached"""

    __tablename__ = "mission_members"

    mission: str = Field(primary_key=True)
    callsign: str = Field(primary_key=True)


class WebSlotRow(SQLModel, table=True):
    """Which web slot each of a callsign's browsers logs in with, so two browsers never share one"""

    __tablename__ = "web_slots"
    __table_args__ = (UniqueConstraint("callsign", "slot"),)

    callsign: str = Field(primary_key=True)  # as in the Mumble username
    browser: str = Field(primary_key=True)  # the id the browser keeps for itself
    slot: int
    used_at: float  # wall-clock seconds of the last ticket


class MetaRow(SQLModel, table=True):
    """Counters: "version" changes whenever anything murmur-agent enforces does"""

    __tablename__ = "meta"

    key: str = Field(primary_key=True)
    value: int
