"""murmur-agent: the Ice glue between Murmur and the authentication and channel logic.

Ice comes from the container image (Ubuntu's python3-zeroc-ice, the same Ice 3.7 that Murmur links), so the
agent imports it lazily. The glue is unit-tested against a fake Murmur; loading Ice and the run loop need
the real one.
"""

from __future__ import annotations

import logging
import signal
import threading

from libpvarki.logging import add_trace_and_audit, init_logging

from ..channels import load_plan
from ..identity import CertVerifier
from .authenticator import Authenticator
from .config import AgentConfig
from .ice import ADAPTER, load_ice, properties, servant, virtual_server
from .ocsp import OcspChecker
from .policy import Policy, PolicySource, from_plan
from .presence import PresenceReporter
from .rounds import Rounds
from .userids import UserIds

LOGGER = logging.getLogger(__name__)


def run(config: AgentConfig, stop: threading.Event) -> None:  # pragma: no cover  # needs Ice and Murmur
    """Register with Murmur and keep it in shape until stopped"""
    ice, mumble = load_ice()
    config.data_dir.mkdir(parents=True, exist_ok=True)
    ids = UserIds(config.data_dir / "user-ids.json")
    # With mumblermapi, its store is the plan; without it, the channels file is.
    source = PolicySource(config.state_url, Policy()) if config.state_url else None
    fixed = None if source else from_plan(load_plan(config.channels_file))

    def policy() -> Policy:
        return source.policy if source else fixed or Policy()

    reporter = PresenceReporter(config.presence_url) if config.presence_url else None

    auth = Authenticator(
        CertVerifier.from_pem_file(config.ca_bundle),
        OcspChecker(url_override=config.ocsp_url, cache_seconds=config.ocsp_cache_seconds),
        ids,
        policy=policy,
        gateway=CertVerifier.from_pem_file(config.gateway_ca) if config.gateway_ca else None,
    )

    init_data = ice.InitializationData()
    init_data.properties = properties(ice)
    with ice.initialize(init_data) as communicator:
        communicator.getImplicitContext().put("secret", config.ice_secret)
        adapter = communicator.createObjectAdapterWithEndpoints(ADAPTER, f"tcp -h 127.0.0.1 -p {config.callback_port}")
        adapter.activate()
        authenticator = mumble.ServerAuthenticatorPrx.uncheckedCast(adapter.addWithUUID(servant(mumble, auth)))
        meta = mumble.MetaPrx.uncheckedCast(
            communicator.stringToProxy(f"Meta:tcp -h {config.ice_host} -p {config.ice_port}")
        )
        rounds = Rounds(ice, mumble, auth, ids, reporter, config.sweep_seconds)
        while not stop.is_set():
            if source:
                source.refresh()
            try:
                server = virtual_server(meta, config.server_id)
                # Re-registering every round re-attaches the authenticator after a Murmur restart.
                server.setAuthenticator(authenticator)
            except (ice.Exception, RuntimeError) as exc:
                LOGGER.warning("Murmur not ready: %s", exc)
            else:
                rounds.round(server, policy(), units=source is None or source.ready)
            stop.wait(config.poll_seconds)


def main() -> None:  # pragma: no cover  # the container entrypoint
    """murmur-agent entrypoint"""
    add_trace_and_audit()
    init_logging(logging.INFO)
    config = AgentConfig.from_env()
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    LOGGER.info("murmur-agent starting for Murmur at %s:%d", config.ice_host, config.ice_port)
    run(config, stop)
