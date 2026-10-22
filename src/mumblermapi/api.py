"""mumblermapi: the Deploy App product integration for voice"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import unquote

import yaml
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from libpvarki.middleware import MTLSHeader
from libpvarki.schemas.generic import OperationResultResponse
from libpvarki.schemas.product import ProductDescription, ProductHealthCheckResponse, UserCRUDRequest
from pydantic import BaseModel, ConfigDict, Field

from .channels import GUARD, ChannelPlanError, ChannelSpec, load_yaml, parse_plan
from .health import watch as watch_health
from .identity import CertVerifier, IdentityError, normalize_callsign
from .store import Channel, NoSuchChannel, Store, StoreError
from .tak import TakSettings, watch
from .tickets import AUDIT, mint, public_key, web_username

LOGGER = logging.getLogger(__name__)
SHORTNAME = "mumble"
# murmur-agent reports presence at least every 30 s; older than this and nobody can say who is online
PRESENCE_TTL = 90.0
UI_PATH = f"/ui/{SHORTNAME}"  # where Traefik serves the UI remote, on rmui's mTLS host
MAX_PLAN_BYTES = 1 << 20  # an imported channel plan; a full plan of 1000 nets with members is about half of this
TITLES = {"fi": "Puhe", "sv": "Röst", "en": "Voice"}
DESCRIPTIONS = {
    "fi": "Puheryhmät TAKiin: PTT-kanavat ryhmälle, joukkueelle ja komppanialle",
    "sv": "Röstkanaler för TAK: tryck-och-tala för grupp, pluton och kompani",
    "en": "Voice for TAK: push-to-talk channels for squad, platoon and company",
}
ADMIN_DESCRIPTIONS = {
    "fi": "Puheverkot: yksiköiden kanavat, jäsenet ja puheen esto",
    "sv": "Röstnät: enheternas kanaler, medlemmar och spärr av röst",
    "en": "Voice nets: unit channels, members and turning voice off",
}


class Settings(BaseModel):
    """Where things are and who the peers are; all from the environment"""

    database: Path = Path("/data/mumblermapi.db")
    templates_dir: Path = Path("/templates")  # channel plan templates an admin may choose to apply
    ui_dir: Path = Path("/ui")  # the built UI remote, served at UI_PATH when present
    tak: TakSettings | None = None  # where to read missions from; None leaves Missions/ empty
    # Linkerd identities of the only callers of the user and agent endpoints
    rmapi_identity: str = "rmapi.opendefence-system.serviceaccount.identity.linkerd.cluster.local"
    agent_identity: str = "murmur.app-mumble.serviceaccount.identity.linkerd.cluster.local"
    # The edge, whose forwarded client certificate voice tickets are minted for, and the CAs it must chain to
    traefik_identity: str = "traefik.traefik-system.serviceaccount.identity.linkerd.cluster.local"
    ca_bundle: Path = Path("/trust/ca-cert.pem")
    # What the health check asks (health.py); an empty URL is not checked
    proxy_ready_url: str = "http://127.0.0.1:4191/ready"  # this pod's Linkerd proxy
    gateway_ready_url: str = "http://voice-gateway.app-mumble.svc.cluster.local:8080/readyz"

    @classmethod
    def from_env(cls) -> Settings:
        """MUMBLERMAPI_* variables"""
        env = os.environ
        return cls(
            database=Path(env.get("MUMBLERMAPI_DATABASE", cls().database)),
            templates_dir=Path(env.get("MUMBLERMAPI_TEMPLATES_DIR", cls().templates_dir)),
            ui_dir=Path(env.get("MUMBLERMAPI_UI_DIR", cls().ui_dir)),
            tak=TakSettings.from_env(env),
            rmapi_identity=env.get("MUMBLERMAPI_RMAPI_IDENTITY", cls().rmapi_identity),
            agent_identity=env.get("MUMBLERMAPI_AGENT_IDENTITY", cls().agent_identity),
            traefik_identity=env.get("MUMBLERMAPI_TRAEFIK_IDENTITY", cls().traefik_identity),
            ca_bundle=Path(env.get("MUMBLERMAPI_CA_BUNDLE", cls().ca_bundle)),
            proxy_ready_url=env.get("MUMBLERMAPI_PROXY_READY_URL", cls().proxy_ready_url),
            gateway_ready_url=env.get("MUMBLERMAPI_GATEWAY_READY_URL", cls().gateway_ready_url),
        )


# ---- request bodies
Access = Literal["open", "invite", "inherit"]


class NewChannel(BaseModel):
    """A channel to create"""

    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    parent: int = 0
    access: Access | None = None


class ChannelEdit(BaseModel):
    """A new name, description or access for a channel; omitted fields stay"""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    access: Access | None = None


# A template's id is its file stem; only such ids are offered or accepted
TEMPLATE_ID = r"^[a-z0-9][a-z0-9-]{0,63}$"


class TemplateChoice(BaseModel):
    """Which template to apply. A JSON body, so a cross-site form cannot send it."""

    template: str = Field(pattern=TEMPLATE_ID)


class VoiceSetting(BaseModel):
    """Whether a callsign may use voice"""

    enabled: bool


class TicketRequest(BaseModel):
    """Which browser slot to log in. A JSON body, so a cross-site form cannot send it."""

    model_config = ConfigDict(extra="forbid")

    slot: int = Field(ge=1, le=9, description="This browser's slot, web-1 to web-9; each browser keeps its own")


class Ticket(BaseModel):
    """What the browser hands the voice gateway"""

    model_config = ConfigDict(extra="forbid")

    ticket: str = Field(description="The gateway's Murmur password for this login; valid for 60 s")
    username: str = Field(description="The Mumble username it logs in, <callsign>---web-<slot>")


class PresenceEntry(BaseModel):
    """One connected session: its callsign as Mumble shows it, and its net"""

    callsign: str = Field(max_length=200)
    channel: str = Field(max_length=2000)


class PresenceReport(BaseModel):
    """Everyone connected, from murmur-agent"""

    sessions: list[PresenceEntry] = Field(max_length=5000)


class ProductComponent(BaseModel):
    """How rmui shows the product"""

    type: Literal["link", "markdown", "component"]
    ref: str


class ProductDescriptionExtended(BaseModel):
    """rmapi's v2 description, which forbids extra keys"""

    model_config = ConfigDict(extra="forbid")

    shortname: str
    title: str
    icon: str | None
    description: str
    language: str
    docs: str | None
    component: ProductComponent


# ---- identity checks
def _cn(request: Request) -> str:
    return str(request.state.mtlsdn.get("CN", ""))


def from_rmapi(request: Request) -> None:
    """Only rmapi may send user lifecycle events"""
    if _cn(request) != request.app.state.settings.rmapi_identity:
        raise HTTPException(status_code=403)


def from_agent(request: Request) -> None:
    """Only the murmur pod's agent may read the desired state"""
    if _cn(request) != request.app.state.settings.agent_identity:
        raise HTTPException(status_code=403)


def admin_callsign(request: Request) -> str:
    """The caller must be a Deploy App admin"""
    callsign = _cn(request)
    user = request.app.state.store.user(callsign)
    if user is None or not user.admin or user.revoked:
        raise HTTPException(status_code=403)
    return callsign


def get_store(request: Request) -> Store:
    """The app's store"""
    store: Store = request.app.state.store
    return store


StoreDep = Annotated[Store, Depends(get_store)]
AdminDep = Annotated[str, Depends(admin_callsign)]


# ---- routes
users = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True)), Depends(from_rmapi)])


@users.post("/created")
def user_created(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user got a certificate"""
    store.upsert_user(user.callsign, user.uuid)
    store.set_user_flag(user.callsign, "revoked", False)
    LOGGER.info("User %s created", user.callsign)
    return OperationResultResponse(success=True)


@users.post("/revoked")
def user_revoked(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user's certificate was revoked: murmur-agent disconnects them on its next poll"""
    store.set_user_flag(user.callsign, "revoked", True, uuid=user.uuid)
    LOGGER.info("User %s revoked", user.callsign)
    return OperationResultResponse(success=True)


@users.post("/promoted")
def user_promoted(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user became an admin"""
    store.set_user_flag(user.callsign, "admin", True, uuid=user.uuid)
    return OperationResultResponse(success=True)


@users.post("/demoted")
def user_demoted(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user is no longer an admin"""
    store.set_user_flag(user.callsign, "admin", False, uuid=user.uuid)
    return OperationResultResponse(success=True)


@users.put("/updated")
def user_updated(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user's details changed"""
    store.upsert_user(user.callsign, user.uuid)
    return OperationResultResponse(success=True)


agent = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True)), Depends(from_agent)])


def _channel_dict(channel: Channel) -> dict[str, Any]:
    return asdict(channel)


@agent.get("/state")
def agent_state(request: Request, store: StoreDep) -> Response:
    """Everything murmur-agent enforces; 304 while nothing has changed. The ticket key changes on every start
    while the store's version does not, so the ETag carries both."""
    version = store.version()
    ticket_key = public_key(request.app.state.ticket_key)
    etag = f"{version}-{ticket_key[:16]}"
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    all_users = store.users()
    body = {
        "version": version,
        "etag": etag,
        "ticket_keys": [ticket_key],
        "refused": sorted(u.callsign for u in all_users if u.revoked or u.voice_disabled),
        "units": [_channel_dict(c) for c in store.tree()],
        "missions": [{"name": name, "members": sorted(members)} for name, members in sorted(store.missions().items())],
    }
    return Response(json.dumps(body), media_type="application/json", headers={"ETag": etag})


@agent.post("/presence")
def agent_presence(report: PresenceReport, request: Request) -> None:
    """Who is connected where, for the admin UI; kept in memory only"""
    online: dict[str, list[str]] = {}
    for entry in report.sessions:
        online.setdefault(entry.callsign, []).append(entry.channel)
    request.app.state.presence = (time.monotonic(), online)


def presence_of(request: Request) -> dict[str, list[str]] | None:
    """Callsign (in Mumble's form) to nets, or None when murmur-agent has not reported lately"""
    received, online = request.app.state.presence
    if time.monotonic() - received > PRESENCE_TTL:
        return None
    return dict(online)


admin = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True))])


@admin.get("/channels")
def list_channels(_: AdminDep, store: StoreDep) -> list[dict[str, Any]]:
    """The Units/ tree with members"""
    return [_channel_dict(c) for c in store.tree()]


@admin.post("/channels")
def create_channel(channel: NewChannel, who: AdminDep, store: StoreDep) -> dict[str, int]:
    """Create a Units/ channel"""
    try:
        parse_plan({"channels": [{"name": channel.name, "description": channel.description}]})
        channel_id = store.add_channel(channel.name, channel.description, channel.parent, channel.access)
    except (StoreError, ChannelPlanError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    LOGGER.info("%s created channel %r", who, channel.name)
    return {"id": channel_id}


@admin.delete("/channels/{channel_id}")
def delete_channel(channel_id: int, who: AdminDep, store: StoreDep) -> None:
    """Remove a channel and everything under it"""
    try:
        store.remove_channel(channel_id)
    except StoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    LOGGER.info("%s removed channel %d", who, channel_id)


@admin.patch("/channels/{channel_id}")
def edit_channel(channel_id: int, edit: ChannelEdit, who: AdminDep, store: StoreDep) -> None:
    """Rename a channel, change its description, or change who may use it"""
    try:
        if edit.name is not None:
            parse_plan({"channels": [{"name": edit.name}]})
        store.update_channel(channel_id, edit.name, edit.description, edit.access)
    except NoSuchChannel as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ChannelPlanError, StoreError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    LOGGER.info("%s edited channel %d", who, channel_id)


@admin.delete("/channels")
def clear_channels(who: AdminDep, store: StoreDep) -> dict[str, int]:
    """Remove the whole channel plan; the voice server moves everyone out of the removed nets"""
    removed = store.clear()
    LOGGER.info("%s removed the channel plan, %d channels", who, removed)
    return {"removed": removed}


@admin.put("/channels/{channel_id}/members/{callsign}")
def add_member(channel_id: int, callsign: str, _: AdminDep, store: StoreDep) -> None:
    """Make a callsign a member of a channel"""
    if store.user(callsign) is None:
        raise HTTPException(status_code=404, detail=f"unknown callsign {callsign}")
    try:
        store.set_member(channel_id, callsign, True)
    except StoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@admin.delete("/channels/{channel_id}/members/{callsign}")
def remove_member(channel_id: int, callsign: str, _: AdminDep, store: StoreDep) -> None:
    """Take a callsign off a channel"""
    try:
        store.set_member(channel_id, callsign, False)
    except StoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _plan_of(channels: list[Channel]) -> list[dict[str, Any]]:
    return [
        {"name": c.name, "description": c.description, "access": c.access}
        | ({"members": sorted(c.members)} if c.members else {})
        | ({"channels": _plan_of(c.children)} if c.children else {})
        for c in channels
    ]


@admin.get("/channels/export", response_class=PlainTextResponse)
def export_channels(_: AdminDep, store: StoreDep) -> str:
    """The tree in the 2022 channel plan schema"""
    return str(yaml.safe_dump({"channels": _plan_of(store.tree())}, allow_unicode=True, sort_keys=False))


@admin.post("/channels/import")
async def import_channels(request: Request, who: AdminDep, store: StoreDep) -> dict[str, int]:
    """Add a channel plan (YAML, 2022 schema); existing channels are kept"""
    # The browser sends the client certificate to any site's request, so refuse the content types a cross-site
    # form can POST without a CORS preflight.
    if request.headers.get("content-type", "").split(";")[0].strip() not in ("application/yaml", "application/x-yaml"):
        raise HTTPException(status_code=415, detail="send the plan as application/yaml")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_PLAN_BYTES:
            raise HTTPException(status_code=413, detail=f"a channel plan may be at most {MAX_PLAN_BYTES} bytes")
    # Parsed and stored in the thread pool, as the other admin routes are, so a large plan stalls no other request
    try:
        plan: tuple[ChannelSpec, ...] = await run_in_threadpool(lambda: parse_plan(load_yaml(bytes(body))))
    except (ChannelPlanError, yaml.YAMLError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    created = await run_in_threadpool(store.import_plan, plan)
    LOGGER.info("%s imported a channel plan, %d new channels", who, created)
    return {"created": created}


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


@admin.get("/templates")
def list_templates(request: Request, _: AdminDep) -> list[dict[str, Any]]:
    """Channel plan templates an admin can apply, such as the standard company plan"""
    return [
        {"id": key, "name": t["name"], "description": t["description"], "nets": _count(t["plan"])}
        for key, t in templates(request.app.state.settings).items()
    ]


@admin.post("/templates/apply")
def apply_template(choice: TemplateChoice, request: Request, who: AdminDep, store: StoreDep) -> dict[str, int]:
    """Add a template's nets; nets that already exist are kept as they are"""
    template = templates(request.app.state.settings).get(choice.template)
    if template is None:
        raise HTTPException(status_code=404, detail=f"no template {choice.template}")
    created = store.import_plan(template["plan"])
    LOGGER.info("%s applied template %s, %d new channels", who, choice.template, created)
    return {"created": created}


@admin.get("/users")
def list_users(request: Request, _: AdminDep, store: StoreDep) -> list[dict[str, Any]]:
    """Every known callsign, for the member picker, with the nets each is connected to (None: unknown)"""
    online = presence_of(request)
    return [
        asdict(u) | {"uuid": None, "online": None if online is None else online.get(normalize_callsign(u.callsign), [])}
        for u in store.users()
    ]


@admin.get("/missions")
def list_missions(_: AdminDep, store: StoreDep) -> list[dict[str, Any]]:
    """Guard, open to everyone, then the mission nets and their subscribers as last read from TAK; those are
    managed in TAK, not here"""
    return [{"name": GUARD, "members": [], "open": True}] + [
        {"name": name, "members": sorted(members), "open": False} for name, members in sorted(store.missions().items())
    ]


@admin.put("/users/{callsign}/voice")
def set_voice(callsign: str, setting: VoiceSetting, who: AdminDep, store: StoreDep) -> None:
    """Turn voice off or on for one callsign, without touching their Deploy App identity"""
    if store.user(callsign) is None:
        raise HTTPException(status_code=404, detail=f"unknown callsign {callsign}")
    store.set_user_flag(callsign, "voice_disabled", not setting.enabled)
    LOGGER.info("%s set voice %s for %s", who, "on" if setting.enabled else "off", callsign)


FORWARDED_CERT = "x-forwarded-tls-client-cert"


def forwarded_leaf(request: Request) -> bytes:
    """The client certificate Traefik verified, as DER. Traefik sends each certificate's PEM body, leaf first,
    comma-separated, and overwrites the header when a client sends one of its own."""
    first = unquote(request.headers.get(FORWARDED_CERT, "")).split(",")[0]
    try:
        return base64.b64decode(first, validate=True)
    except (binascii.Error, ValueError):
        return b""


voice = APIRouter()


def _refuse(status: int, why: str, who: str = "") -> HTTPException:
    LOGGER.log(AUDIT, "Refused a voice ticket%s: %s", f" for {who}" if who else "", why)
    return HTTPException(status_code=status, detail=why)


@voice.post("/token")
def voice_ticket(choice: TicketRequest, request: Request, store: StoreDep) -> Ticket:
    """A ticket for the caller's browser to join voice through the voice gateway, as the person whose client
    certificate Traefik verified. murmur-agent checks that certificate again when the gateway logs in."""
    settings: Settings = request.app.state.settings
    if request.headers.get("l5d-client-id") != settings.traefik_identity:
        raise _refuse(403, "tickets are only for requests through the edge")
    verifier: CertVerifier | None = request.app.state.verifier
    if verifier is None:
        raise HTTPException(status_code=503, detail="no CA bundle to check client certificates against")
    try:
        identity = verifier.verify([forwarded_leaf(request)], datetime.now(UTC))
    except IdentityError as exc:
        raise _refuse(403, str(exc)) from exc
    record = store.user(identity.callsign)
    if record is None:
        # Users enrolled before voice was installed stay unknown until rmapi next tells us about them
        raise _refuse(404, "voice does not know this callsign yet", identity.callsign)
    if record.revoked or record.voice_disabled:
        raise _refuse(403, "voice is not enabled for this callsign in Deploy App", identity.callsign)
    username = web_username(normalize_callsign(identity.callsign), choice.slot)
    LOGGER.info("Voice ticket for %s", username)
    leaf = identity.leaf.public_bytes(Encoding.DER)
    return Ticket(ticket=mint(request.app.state.ticket_key, username, leaf, time.time()), username=username)


public = APIRouter()


@public.get("/healthcheck")
def healthcheck(request: Request) -> ProductHealthCheckResponse:
    """Voice's health for rmapi, from the background check, with what is wrong in extra. Always 200: the kubelet
    probes this too, and restarting the process mends none of what the check finds."""
    found = request.app.state.health
    return ProductHealthCheckResponse(healthy=not found, extra="; ".join(found))


@public.get("/description/{language}")
def description(language: str) -> ProductDescription:
    """What rmui shows for this product"""
    if language not in DESCRIPTIONS:
        raise HTTPException(status_code=404)
    return ProductDescription(
        shortname=SHORTNAME, title="Voice", icon=None, description=DESCRIPTIONS[language], language=language
    )


def _extended(language: str, texts: dict[str, str]) -> ProductDescriptionExtended:
    language = language if language in texts else "en"
    return ProductDescriptionExtended(
        shortname=SHORTNAME,
        title=TITLES[language],
        icon=f"{UI_PATH[1:]}/icon.svg",
        description=texts[language],
        language=language,
        docs=None,
        component=ProductComponent(type="component", ref=f"{UI_PATH}/remoteEntry.js"),
    )


public_v2 = APIRouter()


@public_v2.get("/description/{language}")
def description_v2(language: str) -> ProductDescriptionExtended:
    """The product tile and its UI remote"""
    return _extended(language, DESCRIPTIONS)


@public_v2.get("/admin/description/{language}")
def admin_description(language: str) -> ProductDescriptionExtended:
    """The admin tools entry; it opens the same remote, which shows admins more"""
    return _extended(language, ADMIN_DESCRIPTIONS)


clients = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True)), Depends(from_rmapi)])


@clients.post("/data")
def client_data(user: UserCRUDRequest, store: StoreDep) -> dict[str, dict[str, Any]]:
    """What the UI remote shows this user; rmapi asks on the user's behalf"""
    record = store.user(user.callsign)
    nets: list[str] = []

    def walk(channels: list[Channel], path: str) -> None:
        for channel in channels:
            here = f"{path}/{channel.name}"
            # Kept members of a net that is not members-only are not let in by it
            if channel.access == "invite" and user.callsign in channel.members:
                nets.append(here)
            walk(channel.children, here)

    walk(store.tree(), "/Units")
    nets += [f"/Missions/{name}" for name, members in sorted(store.missions().items()) if user.callsign in members]
    return {
        "data": {
            "admin": bool(record and record.admin and not record.revoked),
            # Callsigns mumblermapi has not heard of yet are not refused either
            "voice": not (record and (record.revoked or record.voice_disabled)),
            "nets": nets,
        }
    }


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
    store = Store(settings.database)

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
    app.include_router(users, prefix="/api/v1/users")
    app.include_router(agent, prefix="/api/v1/agent")
    app.include_router(admin, prefix="/api/v1/admin")
    app.include_router(voice, prefix="/api/v1/voice")
    app.include_router(public, prefix="/api/v1")
    app.include_router(clients, prefix="/api/v2/clients")
    app.include_router(public_v2, prefix="/api/v2")
    if settings.ui_dir.is_dir():
        app.mount(UI_PATH, UiFiles(directory=settings.ui_dir), name="ui")
    return app
