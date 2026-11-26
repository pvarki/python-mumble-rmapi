"""The integration's settings"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from . import kraftwerk
from .store import DatabaseSettings
from .tak import TakSettings

SHORTNAME = "mumble"
UI_PATH = f"/ui/{SHORTNAME}"  # where Traefik serves the UI remote, on rmui's mTLS host


class Settings(BaseSettings):
    """Where things are and who the peers are; MUMBLERMAPI_* variables, and the product manifest through from_env"""

    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    sqlite_file: Path = Path("/data/mumblermapi.db")  # the store of earlier releases, copied once
    templates_dir: Path = Path("/templates")  # channel plan templates an admin may choose to apply
    ui_dir: Path = Path("/ui")  # the built UI remote, served at UI_PATH when present
    tak: TakSettings | None = None  # where to read missions from; None leaves Missions/ empty
    # Linkerd identities of the only callers of the user and agent endpoints
    rmapi_identity: str = "rmapi.opendefence-system.serviceaccount.identity.linkerd.cluster.local"
    agent_identity: str = "murmur.app-mumble.serviceaccount.identity.linkerd.cluster.local"
    # The edge, whose forwarded client certificate voice tickets are minted for, and the CAs it must chain to
    traefik_identity: str = "traefik.traefik-system.serviceaccount.identity.linkerd.cluster.local"
    ca_bundle: Path = Path("/trust/ca-cert.pem")
    # What the health check asks (health.py); an empty URL is not checked
    proxy_ready_url: str = "http://127.0.0.1:4191/ready"  # this pod's Linkerd proxy
    gateway_ready_url: str = "http://voice-gateway.app-mumble.svc.cluster.local:8080/readyz"

    model_config = SettingsConfigDict(env_prefix="MUMBLERMAPI_")

    @classmethod
    def from_env(cls, manifest: Mapping[str, Any] | None = None) -> Settings:
        """MUMBLERMAPI_* variables, then the product manifest (kraftwerk.py), then the defaults"""
        manifest = kraftwerk.read() if manifest is None else manifest
        settings = cls(tak=TakSettings.from_env(manifest=manifest))
        certcn = kraftwerk.value(manifest, "rasenmaeher", "certcn")
        if certcn and "rmapi_identity" not in settings.model_fields_set:
            return settings.model_copy(update={"rmapi_identity": certcn})
        return settings
