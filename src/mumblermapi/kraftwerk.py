"""The product manifest. The platform mounts one for every Deploy App product at /pvarki/kraftwerk-init.json,
naming rmapi and the product itself. Without it, the in-cluster defaults apply."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

MANIFEST = Path("/pvarki/kraftwerk-init.json")


def read(path: Path | None = None) -> dict[str, Any]:
    """The manifest, or {} when none is mounted. A malformed one stops the start."""
    path = path or MANIFEST
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise TypeError(f"{path}: expected a JSON object")
    return data


def value(manifest: Mapping[str, Any], *keys: str) -> str | None:
    """The text at keys, or None when the manifest does not have it"""
    node: Any = manifest
    for key in keys:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    if not isinstance(node, str):
        raise TypeError(f"kraftwerk-init.json: {'.'.join(keys)} must be text")
    return node
