"""The integration's settings"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from . import kraftwerk
from .store import DatabaseSettings
from .tak import TakSettings

SHORTNAME = "mumble"
UI_PATH = f"/ui/{SHORTNAME}"  # where Traefik serves the UI remote, on rmui's mTLS host


class Settings(BaseModel):
    """Where things are and who the peers are; from the environment and the product manifest"""

    database: DatabaseSettings = DatabaseSettings()
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

    @classmethod
    def from_env(cls, manifest: Mapping[str, Any] | None = None) -> Settings:
        """MUMBLERMAPI_* variables, then the product manifest (kraftwerk.py), then the defaults"""
        env = os.environ
        manifest = kraftwerk.read() if manifest is None else manifest
        rmapi_identity = kraftwerk.value(manifest, "rasenmaeher", "certcn") or cls().rmapi_identity
        return cls(
            database=DatabaseSettings.from_env(env),
            templates_dir=Path(env.get("MUMBLERMAPI_TEMPLATES_DIR", cls().templates_dir)),
            ui_dir=Path(env.get("MUMBLERMAPI_UI_DIR", cls().ui_dir)),
            tak=TakSettings.from_env(env, manifest),
            rmapi_identity=env.get("MUMBLERMAPI_RMAPI_IDENTITY", rmapi_identity),
            agent_identity=env.get("MUMBLERMAPI_AGENT_IDENTITY", cls().agent_identity),
            traefik_identity=env.get("MUMBLERMAPI_TRAEFIK_IDENTITY", cls().traefik_identity),
            ca_bundle=Path(env.get("MUMBLERMAPI_CA_BUNDLE", cls().ca_bundle)),
            proxy_ready_url=env.get("MUMBLERMAPI_PROXY_READY_URL", cls().proxy_ready_url),
            gateway_ready_url=env.get("MUMBLERMAPI_GATEWAY_READY_URL", cls().gateway_ready_url),
        )
