"""Browser sessions through the voice gateway (VOICE-PLAN §4.10)"""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from mumblermapi.authenticator import REJECT, TRY_LATER, Authenticator
from mumblermapi.identity import CertVerifier
from mumblermapi.policy import Policy, PolicySource, parse_state
from mumblermapi.tickets import mint, public_key
from mumblermapi.userids import UserIds

from .conftest import NOW, Issued, Pki, issue
from .test_authenticator import FakeRevocation

KEY = Ed25519PrivateKey.generate()
GATEWAY_CA = issue("Voice Gateway CA", ca=True)
GATEWAY = issue("voice-gateway", GATEWAY_CA)


class Setup:
    """An authenticator trusting the fixture PKI and the gateway CA, and the policy it reads"""

    def __init__(self, pki: Pki, tmp_path: Path, revoked: set[str] | None = None, gateway: bool = True) -> None:
        self.policy = Policy(ticket_keys=frozenset({public_key(KEY)}))
        self.revocation = FakeRevocation(revoked)
        self.auth = Authenticator(
            CertVerifier([pki.root.cert, pki.ca.cert]),
            self.revocation,
            UserIds(tmp_path / "ids.json"),
            clock=lambda: NOW,
            policy=lambda: self.policy,
            gateway=CertVerifier([GATEWAY_CA.cert]) if gateway else None,
        )


def ticket(name: str, leaf: Issued, key: Ed25519PrivateKey = KEY, at: float = NOW.timestamp()) -> str:
    """mumblermapi's ticket for name"""
    return mint(key, name, leaf.der, at)


def test_gateway_logs_in_a_browser(pki: Pki, tmp_path: Path) -> None:
    """The gateway's certificate plus a ticket for the user's own certificate gets a user id"""
    setup = Setup(pki, tmp_path)
    user_id = setup.auth.authenticate("ALPHA_1---web-1", [GATEWAY.der], ticket("ALPHA_1---web-1", pki.alpha))
    assert user_id > 0
    assert setup.auth.refusal("ALPHA_1---web-1", [GATEWAY.der]) is None  # the sweep, from the stored leaf


@pytest.mark.parametrize(
    ("name", "password"),
    [
        ("ALPHA_1---web-1", ""),  # no ticket
        ("ALPHA_1---web-1", "not-a-ticket"),
        ("ALPHA_1---web-2", "ALPHA_1---web-1"),  # someone else's slot (resolved below)
        ("ALPHA_1---vs1", "ALPHA_1---vs1"),  # a phone slot
        ("ALPHA_1", "ALPHA_1"),  # a bare callsign
    ],
)
def test_gateway_needs_a_ticket_for_exactly_that_web_slot(pki: Pki, tmp_path: Path, name: str, password: str) -> None:
    """The gateway cannot log in anything a ticket does not name, nor phone slots"""
    setup = Setup(pki, tmp_path)
    if password.startswith("ALPHA"):
        password = ticket(password, pki.alpha)
    assert setup.auth.authenticate(name, [GATEWAY.der], password) == REJECT


def test_gateway_ticket_from_another_key(pki: Pki, tmp_path: Path) -> None:
    """Only mumblermapi's published keys sign tickets"""
    setup = Setup(pki, tmp_path)
    forged = ticket("ALPHA_1---web-1", pki.alpha, key=Ed25519PrivateKey.generate())
    assert setup.auth.authenticate("ALPHA_1---web-1", [GATEWAY.der], forged) == REJECT


def test_gateway_expired_ticket(pki: Pki, tmp_path: Path) -> None:
    """A ticket is good for its minute only"""
    setup = Setup(pki, tmp_path)
    stale = ticket("ALPHA_1---web-1", pki.alpha, at=(NOW - timedelta(minutes=2)).timestamp())
    assert setup.auth.authenticate("ALPHA_1---web-1", [GATEWAY.der], stale) == REJECT


def test_ticket_leaf_gets_every_check(pki: Pki, tmp_path: Path) -> None:
    """The leaf in the ticket passes the same chain, name, policy and OCSP checks as a phone's"""
    rogue = issue("ALPHA 1", issue("Rogue CA", ca=True))
    setup = Setup(pki, tmp_path, revoked={"ALPHA 1"})
    assert setup.auth.authenticate("ALPHA_1---web-1", [GATEWAY.der], ticket("ALPHA_1---web-1", rogue)) == REJECT
    assert setup.auth.authenticate("ALPHA_1---web-1", [GATEWAY.der], ticket("ALPHA_1---web-1", pki.alpha)) == REJECT
    setup.revocation.revoked.clear()
    setup.revocation.down = True
    assert setup.auth.authenticate("ALPHA_1---web-1", [GATEWAY.der], ticket("ALPHA_1---web-1", pki.alpha)) == TRY_LATER
    setup.revocation.down = False
    setup.policy = Policy(refused=frozenset({"ALPHA 1"}), ticket_keys=setup.policy.ticket_keys)
    assert setup.auth.authenticate("ALPHA_1---web-1", [GATEWAY.der], ticket("ALPHA_1---web-1", pki.alpha)) == REJECT


def test_ticket_for_a_name_its_leaf_does_not_carry(pki: Pki, tmp_path: Path) -> None:
    """mumblermapi would never mint it, but the agent still binds the name to the leaf's CN"""
    setup = Setup(pki, tmp_path)
    assert setup.auth.authenticate("BRAVO_2---web-1", [GATEWAY.der], ticket("BRAVO_2---web-1", pki.alpha)) == REJECT


def test_web_slots_only_through_the_gateway(pki: Pki, tmp_path: Path) -> None:
    """A phone cannot take a web slot, in any case, even holding a valid ticket"""
    setup = Setup(pki, tmp_path)
    for name in ("ALPHA_1---web-1", "ALPHA_1---WEB-1"):
        assert setup.auth.authenticate(name, [pki.alpha.der], ticket(name, pki.alpha)) == REJECT


def test_phones_unchanged_with_a_gateway(pki: Pki, tmp_path: Path) -> None:
    """Phone logins ignore the password and are checked as before"""
    setup = Setup(pki, tmp_path)
    assert setup.auth.authenticate("ALPHA_1---vs1", [pki.alpha.der], "anything") > 0


def test_no_gateway_configured_no_browsers(pki: Pki, tmp_path: Path) -> None:
    """Without AGENT_GATEWAY_CA the gateway's certificate is just an unknown certificate"""
    setup = Setup(pki, tmp_path, gateway=False)
    assert setup.auth.authenticate("ALPHA_1---web-1", [GATEWAY.der], ticket("ALPHA_1---web-1", pki.alpha)) == REJECT


def test_sweep_rechecks_the_stored_leaf_and_fails_closed(pki: Pki, tmp_path: Path) -> None:
    """A revoked browser user is caught by the sweep; a session the agent has no ticket for is refused"""
    setup = Setup(pki, tmp_path)
    assert setup.auth.authenticate("ALPHA_1---web-1", [GATEWAY.der], ticket("ALPHA_1---web-1", pki.alpha)) > 0
    setup.revocation.revoked.add("ALPHA 1")
    refusal = setup.auth.refusal("ALPHA_1---web-1", [GATEWAY.der])
    assert refusal is not None and refusal.reason == "certificate revoked"
    unknown = setup.auth.refusal("ALPHA_1---web-2", [GATEWAY.der])
    assert unknown is not None and "no ticket on record" in unknown.reason


def test_state_carries_ticket_keys_and_etag() -> None:
    """The agent learns the keys and polls with the ETag mumblermapi sent"""
    state = {"version": 3, "etag": "3-abc", "ticket_keys": ["k1"]}
    assert parse_state(state).ticket_keys == frozenset({"k1"})
    with pytest.raises(TypeError):
        parse_state({"version": 3, "ticket_keys": "k1"})
    answers = iter([(200, json.dumps(state).encode()), (304, b"")])
    seen: list[dict[str, str]] = []

    def get(url: str, headers: dict[str, str], timeout: float) -> tuple[int, bytes]:
        seen.append(headers)
        return next(answers)

    source = PolicySource(url="http://mumblermapi/api/v1/agent/state", policy=Policy(), get=get)
    assert source.refresh() and not source.refresh()
    assert seen[1] == {"If-None-Match": "3-abc"}
