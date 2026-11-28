"""murmur-agent settings, from the environment"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AgentConfig(BaseSettings):
    """Where Murmur is, what to trust, and how often to look; AGENT_* variables, and MURMUR_* for Murmur's own"""

    ice_secret: str = Field(default="", validation_alias="MURMUR_ICE_SECRET")  # required, see _secret
    ice_host: str = Field(default="127.0.0.1", validation_alias="MURMUR_ICE_HOST")
    ice_port: int = Field(default=6502, validation_alias="MURMUR_ICE_PORT")
    callback_port: int = 6503
    # None: the one virtual server Murmur runs (1.6 numbers it 0, older ones 1)
    server_id: int | None = Field(default=None, validation_alias="MURMUR_SERVER_ID")
    ca_bundle: Path = Path("/trust/ca-cert.pem")
    channels_file: Path = Path("/config/channels.yaml")
    data_dir: Path = Path("/data/agent")
    ocsp_url: str | None = None
    ocsp_cache_seconds: float = 300.0
    sweep_seconds: float = 60.0  # full certificate and OCSP recheck of everyone connected
    state_url: str | None = None  # mumblermapi's /api/v1/agent/state; None runs on the channels file alone
    poll_seconds: float = 5.0  # how soon mumblermapi changes reach Murmur
    presence_url: str | None = None  # where to report who is connected; None reports nothing
    gateway_ca: Path | None = None  # the voice gateway's own CA; None lets no browser in

    model_config = SettingsConfigDict(env_prefix="AGENT_", frozen=True)

    @field_validator("ice_secret")
    @classmethod
    def _secret(cls, secret: str) -> str:
        if not secret:
            raise ValueError("MURMUR_ICE_SECRET must be set: Murmur's Ice interface must never run without a secret")
        return secret

    @field_validator("server_id", "ocsp_url", "state_url", "presence_url", "gateway_ca", mode="before")
    @classmethod
    def _empty_is_unset(cls, value: object) -> object:
        return None if value == "" else value
