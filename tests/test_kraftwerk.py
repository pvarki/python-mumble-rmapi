"""The product manifest the platform mounts"""

from pathlib import Path

import pytest

from mumblermapi import kraftwerk
from mumblermapi.api import Settings
from mumblermapi.tak import TakSettings

MANIFEST = {
    "rasenmaeher": {
        "mtls": {"base_uri": "http://rmapi.example:8000/"},
        "certcn": "rmapi.example.identity",
    },
    "product": {"dns": "mumble.example.fi"},
}
TAK = {"MUMBLERMAPI_TAK_URL": "https://tak-server:8443", "MUMBLERMAPI_TAK_SERVER_NAME": "tak.example.fi"}


def test_read(tmp_path: Path) -> None:
    """No manifest is no settings; one that is not a JSON object stops the start"""
    assert kraftwerk.read(tmp_path / "none.json") == {}
    path = tmp_path / "kraftwerk-init.json"
    path.write_text('{"product": {"dns": "mumble.example.fi"}}', encoding="utf-8")
    assert kraftwerk.read(path) == {"product": {"dns": "mumble.example.fi"}}
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(TypeError, match="JSON object"):
        kraftwerk.read(path)


def test_value() -> None:
    """A value is text or absent; anything else is a broken manifest"""
    assert kraftwerk.value(MANIFEST, "rasenmaeher", "mtls", "base_uri") == "http://rmapi.example:8000/"
    assert kraftwerk.value(MANIFEST, "product", "uri") is None
    assert kraftwerk.value(MANIFEST, "product", "dns", "deeper") is None
    with pytest.raises(TypeError, match="rasenmaeher.mtls must be text"):
        kraftwerk.value(MANIFEST, "rasenmaeher", "mtls")


def test_settings_follow_the_manifest(monkeypatch: pytest.MonkeyPatch) -> None:
    """rmapi's identity and URL and our TAK CN come from the manifest; the environment still wins"""
    monkeypatch.delenv("MUMBLERMAPI_RMAPI_IDENTITY", raising=False)
    assert Settings.from_env(MANIFEST).rmapi_identity == "rmapi.example.identity"
    assert Settings.from_env({}).rmapi_identity == Settings().rmapi_identity
    monkeypatch.setenv("MUMBLERMAPI_RMAPI_IDENTITY", "rm")
    assert Settings.from_env(MANIFEST).rmapi_identity == "rm"

    tak = TakSettings.from_env(TAK, MANIFEST)
    assert tak is not None
    assert (tak.cn, tak.rmapi_url) == ("mumble.example.fi", "http://rmapi.example:8000/")
    tak = TakSettings.from_env(
        {**TAK, "MUMBLERMAPI_TAK_CN": "voice.example.fi", "MUMBLERMAPI_RMAPI_URL": "http://rm/"}, MANIFEST
    )
    assert tak is not None
    assert (tak.cn, tak.rmapi_url) == ("voice.example.fi", "http://rm/")
    with pytest.raises(ValueError, match="product.dns"):
        TakSettings.from_env(TAK)
