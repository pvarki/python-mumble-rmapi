"""murmur-agent settings, from the environment"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AgentConfig:
    """Where Murmur is, what to trust, and how often to look"""

    ice_secret: str
    ice_host: str = "127.0.0.1"
    ice_port: int = 6502
    callback_port: int = 6503
    server_id: int | None = None  # None: the one virtual server Murmur runs (1.6 numbers it 0, older ones 1)
    ca_bundle: Path = Path("/trust/ca-cert.pem")
    channels_file: Path = Path("/config/channels.yaml")
    data_dir: Path = Path("/data/agent")
    ocsp_url: str | None = None
    ocsp_cache_seconds: float = 300.0
    sweep_seconds: float = 60.0  # full certificate and OCSP recheck of everyone connected
    state_url: str | None = None  # mumblermapi's /api/v1/agent/state; None runs on the channels file alone
    poll_seconds: float = 5.0  # how soon mumblermapi changes reach Murmur
    presence_url: str | None = None  # where to report who is connected; None reports nothing

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> AgentConfig:
        """Read MURMUR_* and AGENT_* variables; the Ice secret is mandatory"""
        secret = env.get("MURMUR_ICE_SECRET", "")
        if not secret:
            raise ValueError("MURMUR_ICE_SECRET must be set: Murmur's Ice interface must never run without a secret")
        defaults = cls(ice_secret=secret)
        return cls(
            ice_secret=secret,
            ice_host=env.get("MURMUR_ICE_HOST", defaults.ice_host),
            ice_port=int(env.get("MURMUR_ICE_PORT", defaults.ice_port)),
            callback_port=int(env.get("AGENT_CALLBACK_PORT", defaults.callback_port)),
            server_id=int(env["MURMUR_SERVER_ID"]) if env.get("MURMUR_SERVER_ID") else None,
            ca_bundle=Path(env.get("AGENT_CA_BUNDLE", defaults.ca_bundle)),
            channels_file=Path(env.get("AGENT_CHANNELS_FILE", defaults.channels_file)),
            data_dir=Path(env.get("AGENT_DATA_DIR", defaults.data_dir)),
            ocsp_url=env.get("AGENT_OCSP_URL") or None,
            ocsp_cache_seconds=float(env.get("AGENT_OCSP_CACHE_SECONDS", defaults.ocsp_cache_seconds)),
            sweep_seconds=float(env.get("AGENT_SWEEP_SECONDS", defaults.sweep_seconds)),
            state_url=env.get("AGENT_STATE_URL") or None,
            poll_seconds=float(env.get("AGENT_POLL_SECONDS", defaults.poll_seconds)),
            presence_url=env.get("AGENT_PRESENCE_URL") or None,
        )
