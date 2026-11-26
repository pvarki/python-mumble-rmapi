"""What anyone may read: the product descriptions and the UI remote"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_descriptions(client: TestClient) -> None:
    """Descriptions need no identity"""
    assert client.get("/api/v1/description/fi").json()["shortname"] == "mumble"
    assert client.get("/api/v1/description/de").status_code == 404


def test_v2_descriptions(client: TestClient) -> None:
    """rmui gets the tile, the admin entry and the remote's address; unknown languages fall back to English"""
    tile = client.get("/api/v2/description/fi").json()
    assert tile["title"] == "Puhe"
    assert tile["component"] == {"type": "component", "ref": "/ui/mumble/remoteEntry.js"}
    assert tile["icon"] == "ui/mumble/voicelogo.svg"
    assert client.get("/api/v2/description/de").json()["language"] == "en"
    assert "members" in client.get("/api/v2/admin/description/en").json()["description"]
    remote = client.get("/ui/mumble/remoteEntry.js")
    assert remote.status_code == 200 and "javascript" in remote.headers["content-type"]
    assert remote.headers["cache-control"] == "no-cache"  # a new release shows on the next load
    assert client.get("/ui/mumble/%2e%2e/templates/company.yaml").status_code == 404


def test_v2_descriptions_link_the_voice_guide(client: TestClient) -> None:
    """Both entries link the guide in their language; unknown languages get the English page"""
    guide = "https://docs.opendefence.fi/{}/guides/voice-guide"
    for language in ("fi", "sv", "en"):
        assert client.get(f"/api/v2/description/{language}").json()["docs"] == guide.format(language)
    assert client.get("/api/v2/description/de").json()["docs"] == guide.format("en")
    assert client.get("/api/v2/admin/description/en").json()["docs"] == guide.format("en")
