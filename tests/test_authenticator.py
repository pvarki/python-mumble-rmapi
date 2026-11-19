"""Authentication decisions"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import pytest

from mumblermapi.authenticator import MAX_NAME_LENGTH, REJECT, TRY_LATER, UNKNOWN, Authenticator, Refusal
from mumblermapi.identity import CertVerifier, Identity
from mumblermapi.ocsp import OcspUnavailable
from mumblermapi.policy import Policy
from mumblermapi.userids import UserIds

from .conftest import NOW, Pki, issue


class FakeRevocation:
    """Answers from a fixed set; can pretend to be unreachable"""

    def __init__(self, revoked: set[str] | None = None, down: bool = False) -> None:
        self.revoked = revoked or set()
        self.down = down

    def is_revoked(self, identity: Identity, now: datetime) -> bool:
        if self.down:
            raise OcspUnavailable("down")
        return identity.callsign in self.revoked


def _auth(pki: Pki, tmp_path: Path, revocation: FakeRevocation | None = None) -> Authenticator:
    return Authenticator(
        CertVerifier([pki.root.cert, pki.ca.cert]),
        revocation or FakeRevocation(),
        UserIds(tmp_path / "ids.json"),
        clock=lambda: NOW,
    )


def test_accepts_matching_certificate(pki: Pki, tmp_path: Path) -> None:
    """Each slot of a callsign gets its own stable id"""
    auth = _auth(pki, tmp_path)
    first = auth.authenticate("ALPHA_1---vs1", [pki.alpha.der])
    second = auth.authenticate("ALPHA_1---vs2", [pki.alpha.der])
    assert first > 0 and second > 0 and first != second
    assert auth.authenticate("ALPHA_1---vs1", [pki.alpha.der]) == first
    assert auth.name_to_id("ALPHA_1---vs2") == second
    assert auth.id_to_name(first) == "ALPHA_1---vs1"


@pytest.mark.parametrize(
    "name",
    ["BRAVO_2---vs1", "ALPHA 1---vs1", "ALPHA_1---bad slot", ""],
)
def test_rejects_name_not_matching_certificate(pki: Pki, tmp_path: Path, name: str) -> None:
    """A username that is not the certificate's callsign is refused"""
    assert _auth(pki, tmp_path).authenticate(name, [pki.alpha.der]) == REJECT


def test_rejects_without_or_with_foreign_certificate(pki: Pki, tmp_path: Path) -> None:
    """No certificate, or one from another CA, is refused"""
    auth = _auth(pki, tmp_path)
    assert auth.authenticate("ALPHA_1---vs1", []) == REJECT
    stranger = issue("ALPHA 1", issue("Other Root", ca=True))
    assert auth.authenticate("ALPHA_1---vs1", [stranger.der]) == REJECT


def test_rejects_revoked_and_unverifiable(pki: Pki, tmp_path: Path) -> None:
    """Revoked certificates are refused; unknown ones while OCSP is down are told to retry"""
    assert _auth(pki, tmp_path, FakeRevocation({"ALPHA 1"})).authenticate("ALPHA_1---vs1", [pki.alpha.der]) == REJECT
    down = _auth(pki, tmp_path, FakeRevocation(down=True))
    assert down.authenticate("ALPHA_1---vs1", [pki.alpha.der]) == TRY_LATER


def test_refusal_explains(pki: Pki, tmp_path: Path) -> None:
    """refusal() is what the sweep of connected users uses"""
    revocation = FakeRevocation()
    auth = _auth(pki, tmp_path, revocation)
    assert auth.refusal("ALPHA_1---vs1", [pki.alpha.der]) is None
    revocation.revoked.add("ALPHA 1")
    assert auth.refusal("ALPHA_1---vs1", [pki.alpha.der]) == Refusal("certificate revoked")
    revocation.down = True
    assert auth.refusal("ALPHA_1---vs1", [pki.alpha.der]) == Refusal("down", transient=True)


def test_overlong_names_are_refused_unread(pki: Pki, tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    """Murmur asks before checking the length itself; neither the check nor the log takes the whole name"""
    auth = _auth(pki, tmp_path)
    with caplog.at_level(logging.DEBUG):
        assert auth.authenticate("A" * (MAX_NAME_LENGTH + 1) + "---" + "x" * 1_000_000, [pki.alpha.der]) == REJECT
    assert caplog.records[-1].getMessage().endswith(f"username over {MAX_NAME_LENGTH} characters")
    assert all(len(r.getMessage()) < 2 * MAX_NAME_LENGTH for r in caplog.records)
    # Murmur's own limit, 512, still gets as far as the other checks
    longest = auth.refusal("A" * MAX_NAME_LENGTH, [pki.alpha.der])
    assert MAX_NAME_LENGTH == 512 and longest is not None and "characters" not in longest.reason


def test_unknown_names_and_ids(pki: Pki, tmp_path: Path) -> None:
    """Names and ids the agent never assigned fall through to Murmur"""
    auth = _auth(pki, tmp_path)
    assert auth.name_to_id("SuperUser") == UNKNOWN
    assert auth.id_to_name(0) == ""


def test_rejects_callsigns_mumblermapi_refuses(pki: Pki, tmp_path: Path) -> None:
    """A refused callsign is out for good, even while OCSP cannot answer"""
    policy = Policy(refused=frozenset({"ALPHA 1"}))
    auth = Authenticator(
        CertVerifier([pki.root.cert, pki.ca.cert]),
        FakeRevocation(down=True),
        UserIds(tmp_path / "ids.json"),
        clock=lambda: NOW,
        policy=lambda: policy,
    )
    assert auth.authenticate("ALPHA_1---vs1", [pki.alpha.der]) == REJECT
    assert auth.refusal("ALPHA_1---vs1", [pki.alpha.der]) == Refusal("revoked or voice disabled in Deploy App")
