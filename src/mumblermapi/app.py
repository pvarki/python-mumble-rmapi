"""mumblermapi: the Deploy App product integration for voice"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, Response
from fastapi.staticfiles import StaticFiles

from .api import all_routers, all_routers_v2
from .api.murmur_agent import PRESENCE_TTL
from .config import UI_PATH, Settings
from .health import watch as watch_health
from .identity import CertVerifier
from .store import Store, engine
from .tak import watch


class UiFiles(StaticFiles):
    """The UI remote. Browsers revalidate every file, so a new release shows on the next load rather than
    whenever a heuristically cached remoteEntry.js expires."""

    def file_response(self, *args: Any, **kwargs: Any) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


def create_app(settings: Settings | None = None) -> FastAPI:
    """The FastAPI app"""
    settings = settings or Settings.from_env()
    store = Store(engine(settings.database.url), settings.sqlite_file)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        stop = asyncio.Event()
        missions = asyncio.create_task(watch(store, settings.tak, stop)) if settings.tak else None
        health = asyncio.create_task(watch_health(app, stop, PRESENCE_TTL))
        yield
        stop.set()
        await health
        if missions:
            await missions

    app = FastAPI(docs_url="/api/docs", openapi_url="/api/openapi.json", lifespan=lifespan)
    app.state.settings = settings
    app.state.store = store
    app.state.presence = (float("-inf"), {})
    app.state.health = []  # what keeps voice from working, from the background check (health.py)
    # Voice tickets live a minute, so the signing key lives in memory only and changes with every start.
    app.state.ticket_key = Ed25519PrivateKey.generate()
    app.state.verifier = CertVerifier.from_pem_file(settings.ca_bundle) if settings.ca_bundle.is_file() else None
    app.include_router(all_routers, prefix="/api/v1")
    app.include_router(all_routers_v2, prefix="/api/v2")
    if settings.ui_dir.is_dir():
        app.mount(UI_PATH, UiFiles(directory=settings.ui_dir), name="ui")
    return app
