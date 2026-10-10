"""Agent settings"""

from pathlib import Path

import pytest

from mumblermapi.config import AgentConfig

FAKE_SECRET = "not-a-real-ice-secret"  # nosec B105  # pragma: allowlist secret


def test_defaults() -> None:
    """Only the secret is required"""
    config = AgentConfig.from_env({"MURMUR_ICE_SECRET": FAKE_SECRET})
    assert config == AgentConfig(ice_secret=FAKE_SECRET)
    assert config.ocsp_url is None


def test_overrides() -> None:
    """Every setting can come from the environment"""
    config = AgentConfig.from_env(
        {
            "MURMUR_ICE_SECRET": FAKE_SECRET,
            "MURMUR_ICE_HOST": "10.0.0.1",
            "MURMUR_ICE_PORT": "7000",
            "AGENT_CALLBACK_PORT": "7001",
            "MURMUR_SERVER_ID": "2",
            "AGENT_CA_BUNDLE": "/ca.pem",
            "AGENT_CHANNELS_FILE": "/c.yaml",
            "AGENT_DATA_DIR": "/d",
            "AGENT_OCSP_URL": "http://ocsp",
            "AGENT_OCSP_CACHE_SECONDS": "10",
            "AGENT_SWEEP_SECONDS": "5",
            "AGENT_STATE_URL": "http://mumblermapi/api/v1/agent/state",
            "AGENT_POLL_SECONDS": "2",
            "AGENT_PRESENCE_URL": "http://mumblermapi/api/v1/agent/presence",
        }
    )
    assert config == AgentConfig(
        ice_secret=FAKE_SECRET,
        ice_host="10.0.0.1",
        ice_port=7000,
        callback_port=7001,
        server_id=2,
        ca_bundle=Path("/ca.pem"),
        channels_file=Path("/c.yaml"),
        data_dir=Path("/d"),
        ocsp_url="http://ocsp",
        ocsp_cache_seconds=10.0,
        sweep_seconds=5.0,
        state_url="http://mumblermapi/api/v1/agent/state",
        poll_seconds=2.0,
        presence_url="http://mumblermapi/api/v1/agent/presence",
    )


@pytest.mark.parametrize("env", [{}, {"MURMUR_ICE_SECRET": ""}])
def test_secret_required(env: dict[str, str]) -> None:
    """No secret, no agent"""
    with pytest.raises(ValueError, match="never run without a secret"):
        AgentConfig.from_env(env)
