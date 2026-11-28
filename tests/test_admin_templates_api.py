"""The channel plan templates admins apply"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from mumblermapi.api.admin_templates import templates
from mumblermapi.config import Settings

from .conftest import as_


def test_templates(client: TestClient) -> None:
    """Admins list templates (broken files and unusable names skipped) and apply one; applying again adds
    nothing"""
    assert client.get("/api/v1/admin/templates", headers=as_("VOICE3")).status_code == 403
    assert client.get("/api/v1/admin/templates", headers=as_("VOICE1")).json() == [
        {"id": "company", "name": "Komppania", "description": "Vakiosuunnitelma", "nets": 2}
    ]
    apply = "/api/v1/admin/templates/apply"
    assert client.post(apply, json={"template": "company"}, headers=as_("VOICE1")).json() == {"created": 0}
    assert client.post(apply, json={"template": "nope"}, headers=as_("VOICE1")).status_code == 404
    assert client.post(apply, json={"template": "../etc"}, headers=as_("VOICE1")).status_code == 422
    cross_site_form = as_("VOICE1") | {"Content-Type": "text/plain"}
    assert client.post(apply, content='{"template": "company"}', headers=cross_site_form).status_code == 422


def test_templates_dir_missing(tmp_path: Path) -> None:
    """Without a templates directory there is simply nothing to offer"""
    settings = Settings(templates_dir=tmp_path / "none")
    assert templates(settings) == {}


def test_shipped_templates_are_offered() -> None:
    """Each template the image ships loads: templates() skips a file it cannot read with only a warning"""
    shipped = Path(__file__).parents[1] / "templates"
    offered = templates(Settings(templates_dir=shipped))
    assert "komppania" in offered
    assert sorted(offered) == sorted(path.stem for path in shipped.glob("*.yaml"))
