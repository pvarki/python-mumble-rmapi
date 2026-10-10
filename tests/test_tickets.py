"""Voice tickets"""

from __future__ import annotations

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from mumblermapi.identity import IdentityError
from mumblermapi.tickets import TTL_SECONDS, _b64, is_web_slot, mint, public_key, verify, web_username

NOW = 1_800_000_000.0
LEAF = b"\x30\x82leaf-der"


@pytest.fixture(name="key")
def key_fixture() -> Ed25519PrivateKey:
    """mumblermapi's signing key"""
    return Ed25519PrivateKey.generate()


def test_round_trip_yields_the_leaf(key: Ed25519PrivateKey) -> None:
    """A fresh ticket for the right name gives back the leaf it binds"""
    ticket = mint(key, "ALPHA_1---web-1", LEAF, NOW)
    assert verify(ticket, frozenset({public_key(key)}), "ALPHA_1---web-1", NOW + TTL_SECONDS) == LEAF


def test_any_published_key_will_do(key: Ed25519PrivateKey) -> None:
    """Keys from a restarted mumblermapi sit beside the current one"""
    other = public_key(Ed25519PrivateKey.generate())
    ticket = mint(key, "ALPHA_1---web-1", LEAF, NOW)
    assert verify(ticket, frozenset({other, public_key(key)}), "ALPHA_1---web-1", NOW) == LEAF


def test_refuses_another_signer(key: Ed25519PrivateKey) -> None:
    """Only mumblermapi's key signs tickets"""
    ticket = mint(Ed25519PrivateKey.generate(), "ALPHA_1---web-1", LEAF, NOW)
    with pytest.raises(IdentityError, match="not signed"):
        verify(ticket, frozenset({public_key(key)}), "ALPHA_1---web-1", NOW)


def test_refuses_another_name(key: Ed25519PrivateKey) -> None:
    """A ticket logs in only the name it was minted for"""
    ticket = mint(key, "ALPHA_1---web-1", LEAF, NOW)
    with pytest.raises(IdentityError, match="not 'ALPHA_1---web-2'"):
        verify(ticket, frozenset({public_key(key)}), "ALPHA_1---web-2", NOW)


@pytest.mark.parametrize("now", [NOW + TTL_SECONDS + 6, NOW - 6])
def test_refuses_outside_its_minute(key: Ed25519PrivateKey, now: float) -> None:
    """Expired, or claiming to last longer than a ticket may, beyond the clock skew"""
    ticket = mint(key, "ALPHA_1---web-1", LEAF, NOW)
    with pytest.raises(IdentityError, match="expired"):
        verify(ticket, frozenset({public_key(key)}), "ALPHA_1---web-1", now)


@pytest.mark.parametrize("ticket", ["", "x" * 9000, "!!!.???", "e30.AAAA", "a.b.c"])
def test_refuses_garbage(key: Ed25519PrivateKey, ticket: str) -> None:
    """Anything that is not a signed ticket is refused"""
    with pytest.raises(IdentityError):
        verify(ticket, frozenset({public_key(key)}), "ALPHA_1---web-1", NOW)


def test_refuses_tampered_claims(key: Ed25519PrivateKey) -> None:
    """Changing a single claim breaks the signature"""
    head, _, sig = mint(key, "ALPHA_1---web-1", LEAF, NOW).partition(".")
    forged = mint(key, "BRAVO_2---web-1", LEAF, NOW).partition(".")[0]
    with pytest.raises(IdentityError, match="not signed"):
        verify(f"{forged}.{sig}", frozenset({public_key(key)}), "BRAVO_2---web-1", NOW)
    assert head != forged


def test_refuses_signed_nonsense(key: Ed25519PrivateKey) -> None:
    """A correctly signed payload that is not a ticket"""
    data = b'{"u": 1}'
    with pytest.raises(IdentityError, match="malformed"):
        verify(f"{_b64(data)}.{_b64(key.sign(data))}", frozenset({public_key(key)}), "1", NOW)


def test_skips_malformed_keys(key: Ed25519PrivateKey) -> None:
    """A broken key in the published set does not stop the good one"""
    ticket = mint(key, "ALPHA_1---web-1", LEAF, NOW)
    assert verify(ticket, frozenset({"short", "!!", public_key(key)}), "ALPHA_1---web-1", NOW) == LEAF


def test_web_slots() -> None:
    """web-1 to web-9 exist, whatever the case; nothing else is minted"""
    assert web_username("ALPHA_1", 9) == "ALPHA_1---web-9"
    for bad in (0, 10, -1):
        with pytest.raises(ValueError):
            web_username("ALPHA_1", bad)
    assert is_web_slot("web-1") and is_web_slot("WEB-7") and is_web_slot("web-x")
    assert not is_web_slot("vs1") and not is_web_slot("")
