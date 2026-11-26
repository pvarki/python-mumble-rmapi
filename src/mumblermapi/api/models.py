"""Request and response bodies"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import Path
from pydantic import BaseModel, ConfigDict, Field

from ..channels import MAX_DESCRIPTION, Access

# Postgres text cannot hold NUL
Description = Annotated[str, Field(max_length=MAX_DESCRIPTION, pattern=r"^[^\x00]*$")]
Callsign = Annotated[str, Path(pattern=r"^[^\x00]+$")]


class NewChannel(BaseModel):
    """A channel to create"""

    name: str = Field(min_length=1, max_length=100)
    description: Description = ""
    parent: int = 0
    access: Access | None = None


class ChannelEdit(BaseModel):
    """A new name, description or access for a channel; omitted fields stay"""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: Description | None = None
    access: Access | None = None


# A template's id is its file stem; only such ids are offered or accepted
TEMPLATE_ID = r"^[a-z0-9][a-z0-9-]{0,63}$"


class TemplateChoice(BaseModel):
    """Which template to apply. A JSON body, so a cross-site form cannot send it."""

    template: str = Field(pattern=TEMPLATE_ID)


class VoiceSetting(BaseModel):
    """Whether a callsign may use voice"""

    enabled: bool


class TicketRequest(BaseModel):
    """Which browser is joining. A JSON body, so a cross-site form cannot send it."""

    model_config = ConfigDict(extra="forbid")

    # Only a hint within the caller's own callsign, which comes from the certificate: a made-up id can only move
    # that person's own browsers.
    browser: str = Field(
        pattern=r"^[A-Za-z0-9-]{16,64}$",
        description="A random id this browser keeps, so each of the caller's browsers gets its own web slot",
    )


class Ticket(BaseModel):
    """What the browser hands the voice gateway"""

    model_config = ConfigDict(extra="forbid")

    ticket: str = Field(description="The gateway's Murmur password for this login; valid for 60 s")
    username: str = Field(description="The Mumble username it logs in: <callsign>---web-<this browser's slot>")


class PresenceEntry(BaseModel):
    """One connected session: its callsign as Mumble shows it, and its net"""

    callsign: str = Field(max_length=200)
    channel: str = Field(max_length=2000)


class PresenceReport(BaseModel):
    """Everyone connected, from murmur-agent"""

    sessions: list[PresenceEntry] = Field(max_length=5000)


class ProductComponent(BaseModel):
    """How rmui shows the product"""

    type: Literal["link", "markdown", "component"]
    ref: str


class ProductDescriptionExtended(BaseModel):
    """rmapi's v2 description, which forbids extra keys"""

    model_config = ConfigDict(extra="forbid")

    shortname: str
    title: str
    icon: str | None
    description: str
    language: str
    docs: str | None
    component: ProductComponent
