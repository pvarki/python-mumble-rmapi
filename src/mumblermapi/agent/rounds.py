"""What murmur-agent does with Murmur each round: the certificate sweep, the enforcement pass and presence"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from types import ModuleType
from typing import Any

from ..channels import desired_tree
from .authenticator import Authenticator
from .enforce import Acl, Session, acl_of, combine, plan, refused, shadows, violations
from .ice import ICE_MESSAGE_KIB, IceChannels, may_be_gone
from .policy import Policy
from .presence import Entry, PresenceReporter, channel_paths, presence
from .reconcile import prune, reconcile
from .userids import UserIds

LOGGER = logging.getLogger(__name__)


def _sweep(mumble: ModuleType, server: Any, auth: Authenticator) -> None:
    """Disconnect users whose certificate no longer passes, such as after a revocation"""
    for session, user in server.getUsers().items():
        try:
            chain = [bytes(cert) for cert in server.getCertificateList(session)]
        except mumble.InvalidSessionException:
            continue  # left meanwhile
        refusal = auth.refusal(user.name, chain)
        if refusal is not None and not refusal.transient:
            with may_be_gone(mumble):
                LOGGER.warning("Disconnecting %r: %s", user.name, refusal.reason)
                server.kickUser(session, refusal.reason)


def _set_acl(mumble: ModuleType, server: Any, channel_id: int, acl: Acl) -> None:
    inherit, rules, groups = acl
    server.setACL(
        channel_id,
        [mumble.ACL(here, subs, False, user, group, allow, deny) for here, subs, user, group, allow, deny in rules],
        [
            mumble.Group(name, False, inh, inheritable, list(add), list(rem), [])
            for name, inh, inheritable, add, rem in groups
        ],
        inherit,
    )


def _sessions(server: Any) -> list[Session]:
    return [Session(session, user.name, user.channel) for session, user in server.getUsers().items()]


def _enforce(ice: ModuleType, mumble: ModuleType, server: Any, policy: Policy, ids: UserIds, units: bool) -> list[str]:
    """Make Murmur match the policy, and return the paths of nets Murmur refused to create. Until the policy is
    known, Units/ and Missions/ are left as they are.

    Refused callsigns go first, so that nothing later in the pass can hold their disconnection up. A net Murmur
    refuses is left out with the nets under it, as if it were not created yet, and the other nets go on.
    """
    sessions = _sessions(server)
    kicked = refused(policy, sessions)
    for session in kicked:
        with may_be_gone(mumble):
            LOGGER.warning("Disconnecting session %d: refused by mumblermapi", session)
            server.kickUser(session, "revoked or voice disabled in Deploy App")

    channels = IceChannels(server, mumble)
    desired = desired_tree(policy.specs(), policy.mission_specs()) if units else desired_tree(())
    created, left_out = reconcile(channels, desired)
    if created:
        LOGGER.info("Created channels: %s", ", ".join(created))
    if not units:
        return left_out
    existing = channels.channels()
    roots = {c.name: c.id for c in existing if c.parent == 0}
    removed = prune(channels, policy.specs(), roots["Units"], "/Units")
    removed += prune(channels, policy.mission_specs(), roots["Missions"], "/Missions")
    if removed:
        LOGGER.info("Removed channels: %s", ", ".join(removed))
        existing = channels.channels()
    names = ids.names()
    access = combine(
        plan(policy.units, existing, roots["Units"], names),
        plan(policy.missions, existing, roots["Missions"], names),
    )
    for channel_id, acl in access.acls.items():
        with may_be_gone(mumble):
            try:
                current: Acl | None = acl_of(*server.getACL(channel_id))
            except ice.MemoryLimitException:
                # Rules too large to read, such as a member's own in their temporary channel: ours replace them
                current = None
            if current != acl:
                _set_acl(mumble, server, channel_id, acl)
                LOGGER.info("Set access rules of channel %d", channel_id)
    # A link carries a restricted net's audio to whoever is in the other channel, and one made while its maker
    # still had access outlives the access. Restricted nets are never linked.
    for channel in existing:
        if channel.links and channel.id in access.admitted:
            with may_be_gone(mumble):
                state = server.getChannelState(channel.id)
                LOGGER.info("Unlinking channel %d from %s", channel.id, state.links)
                state.links = []
                server.setChannelState(state)

    # Read again: anyone who entered a net before its rules were written is still inside, and reconcile may
    # have moved people
    remaining = [s for s in _sessions(server) if s.session not in kicked]
    # Murmur's slice declares no exceptions for the listener calls, so Ice reports a session or channel that is
    # gone as an unknown one
    listeners = {}
    for channel_id in access.admitted:
        with may_be_gone(mumble, ice.UnknownUserException):
            listeners[channel_id] = server.getListeningUsers(channel_id)
    actions = violations(access, remaining, listeners, shadows(existing, roots["Missions"]))
    for session, target in actions.move:
        with may_be_gone(mumble):
            state = server.getState(session)
            LOGGER.info("Moving %r from channel %d to %d", state.name, state.channel, target)
            state.channel = target
            server.setState(state)
    for session, channel_id in actions.unlisten:
        with may_be_gone(mumble, ice.UnknownUserException):
            LOGGER.info("Stopping session %d listening to channel %d", session, channel_id)
            server.stopListening(session, channel_id)
    return left_out


def _warn_left_out(left_out: list[str], before: list[str]) -> list[str]:
    """Warn about the nets Murmur refuses when they change, not every round; returns them for the next round"""
    if left_out and set(left_out) != set(before):
        LOGGER.warning(
            "Murmur refused these nets, so they and the nets under them are left out: %s", ", ".join(left_out)
        )
    return left_out


def _presence(mumble: ModuleType, server: Any) -> list[Entry]:
    """Who is connected, and in which net"""
    return presence(_sessions(server), channel_paths(IceChannels(server, mumble).channels()))


@dataclass
class Rounds:
    """What murmur-agent does with Murmur each round, and what it carries from one round to the next"""

    ice: ModuleType
    mumble: ModuleType
    auth: Authenticator
    ids: UserIds
    reporter: PresenceReporter | None
    sweep_seconds: float
    next_sweep: float = field(default=0.0, init=False)
    left_out: list[str] = field(default_factory=list, init=False)

    def round(self, server: Any, policy: Policy, units: bool) -> None:
        """Sweep certificates when due, then make Murmur match the policy and report presence.

        The sweep goes first, on its own, so that no lasting failure to enforce the policy stops disconnecting
        revoked certificates. Presence follows enforcement, so a pass that keeps failing stops the reports and
        mumblermapi's health shows it. No error ends the agent: Murmur's authenticator, and so every login, would
        go with it.
        """
        not_ready = (self.ice.Exception, RuntimeError)
        if time.monotonic() >= self.next_sweep:
            try:
                _sweep(self.mumble, server, self.auth)
            except not_ready as exc:
                self._failed("the certificate sweep", exc)
            except Exception:
                LOGGER.exception("Unexpected error in the certificate sweep")
            else:
                self.next_sweep = time.monotonic() + self.sweep_seconds
        try:
            left_out = _enforce(self.ice, self.mumble, server, policy, self.ids, units)
            if self.reporter:
                self.reporter.report(_presence(self.mumble, server), time.monotonic())
        except not_ready as exc:
            self._failed("the plan", exc)
        except Exception:
            LOGGER.exception("Unexpected error in the plan")
        else:
            self.left_out = _warn_left_out(left_out, self.left_out)

    def _failed(self, what: str, exc: Exception) -> None:
        if isinstance(exc, self.ice.MemoryLimitException):
            LOGGER.error("Murmur's answer for %s is over the agent's %d KiB limit: %s", what, ICE_MESSAGE_KIB, exc)
        else:
            LOGGER.warning("Murmur not ready for %s: %s", what, exc)
