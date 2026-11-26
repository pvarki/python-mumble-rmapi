"""Admin routes for the channel plan templates the image ships"""

from __future__ import annotations

import logging
import re
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from libpvarki.middleware import MTLSHeader

from ..channels import ChannelPlanError, ChannelSpec, load_yaml, parse_plan
from ..config import Settings
from .deps import AdminDep, StoreDep
from .models import TEMPLATE_ID, TemplateChoice

LOGGER = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True))])


def templates(settings: Settings) -> dict[str, dict[str, Any]]:
    """The plan templates on disk by id (file stem): name, description and the plan itself"""
    found: dict[str, dict[str, Any]] = {}
    if not settings.templates_dir.is_dir():
        return found
    for path in sorted(settings.templates_dir.glob("*.yaml")):
        if not re.match(TEMPLATE_ID, path.stem):
            LOGGER.warning("Skipping template %s: name it in lowercase letters, digits and dashes", path.name)
            continue
        try:
            data = load_yaml(path.read_text(encoding="utf-8"))
            plan = parse_plan(data)
        except (OSError, yaml.YAMLError, ChannelPlanError) as exc:
            LOGGER.warning("Skipping template %s: %s", path.name, exc)
            continue
        found[path.stem] = {
            "name": str(data.get("name", path.stem)),
            "description": str(data.get("description", "")),
            "plan": plan,
        }
    return found


def _count(plan: tuple[ChannelSpec, ...]) -> int:
    return sum(1 + _count(spec.children) for spec in plan)


@router.get("/templates")
def list_templates(request: Request, _: AdminDep) -> list[dict[str, Any]]:
    """Channel plan templates an admin can apply, such as the standard company plan"""
    return [
        {"id": key, "name": t["name"], "description": t["description"], "nets": _count(t["plan"])}
        for key, t in templates(request.app.state.settings).items()
    ]


@router.post("/templates/apply")
def apply_template(choice: TemplateChoice, request: Request, who: AdminDep, store: StoreDep) -> dict[str, int]:
    """Add a template's nets; nets that already exist are kept as they are"""
    template = templates(request.app.state.settings).get(choice.template)
    if template is None:
        raise HTTPException(status_code=404, detail=f"no template {choice.template}")
    created = store.import_plan(template["plan"])
    LOGGER.info("%s applied template %s, %d new channels", who, choice.template, created)
    return {"created": created}
