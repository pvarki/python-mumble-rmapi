"""mumblermapi entrypoint"""

from __future__ import annotations

import logging

import uvicorn
from libpvarki.logging import init_logging

from .api import create_app


def main() -> None:  # pragma: no cover  # the container entrypoint
    """Serve the integration API"""
    init_logging(logging.INFO)
    # The pod network is the only interface; Linkerd and the API's own identity checks guard it.
    uvicorn.run(create_app(), host="0.0.0.0", port=8000, log_config=None)  # nosec B104
