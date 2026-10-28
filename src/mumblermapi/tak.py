"""TAK missions and their subscribers, read with mumblermapi's own plain TAK user identity.

The identity is a client certificate that rmapi signs for this product. rmapi's product interop then has
takrmapi register it in TAK's default group, which can list every mission and its subscribers, the same as
any user can, and nothing more.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import ssl
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

import aiohttp
from cryptography import x509
from libpvarki.mtlshelp.csr import async_create_client_csr, async_create_keypair

from . import kraftwerk
from .channels import NAME_RE
from .store import Store

LOGGER = logging.getLogger(__name__)
RENEW_BEFORE = timedelta(days=7)


@dataclass(frozen=True)
class TakSettings:
    """Where rmapi and TAK are, and who mumblermapi is to TAK"""

    tak_url: str  # TAK's API, inside the cluster
    tak_server_name: str  # the name on TAK's certificate
    cn: str  # our certificate's CN, a DNS-style name as takrmapi's interop requires
    rmapi_url: str = "http://rmapi.opendefence-system.svc.cluster.local:8000/"
    ca_bundle: Path = Path("/trust/ca-cert.pem")
    data_dir: Path = Path("/data/tak")
    poll_seconds: float = 30.0

    @classmethod
    def from_env(
        cls, env: Mapping[str, str] = os.environ, manifest: Mapping[str, Any] | None = None
    ) -> TakSettings | None:
        """MUMBLERMAPI_TAK_* variables over the product manifest; None, and no missions, when TAK is not
        configured. Our CN is the product's DNS name and rmapi is where the manifest says."""
        url = env.get("MUMBLERMAPI_TAK_URL")
        if not url:
            return None
        manifest = manifest or {}
        cn = env.get("MUMBLERMAPI_TAK_CN") or kraftwerk.value(manifest, "product", "dns")
        if not cn:
            raise ValueError("TAK needs MUMBLERMAPI_TAK_CN or the manifest's product.dns")
        rmapi_url = kraftwerk.value(manifest, "rasenmaeher", "mtls", "base_uri") or cls.rmapi_url
        return cls(
            tak_url=url.rstrip("/"),
            tak_server_name=env["MUMBLERMAPI_TAK_SERVER_NAME"],
            cn=cn,
            rmapi_url=env.get("MUMBLERMAPI_RMAPI_URL", rmapi_url),
            ca_bundle=Path(env.get("MUMBLERMAPI_CA_BUNDLE", cls.ca_bundle)),
            data_dir=Path(env.get("MUMBLERMAPI_TAK_DIR", cls.data_dir)),
            poll_seconds=float(env.get("MUMBLERMAPI_TAK_POLL_SECONDS", cls.poll_seconds)),
        )

    @property
    def cert(self) -> Path:
        """Our certificate chain"""
        return self.data_dir / "tak.pem"

    @property
    def key(self) -> Path:
        """Our private key"""
        return self.data_dir / "tak.key"


def mission_names(doc: Any) -> list[str]:
    """Names from GET /Marti/api/missions that can be Murmur channel names"""
    names = []
    for mission in doc.get("data", []):
        name = str(mission.get("name", ""))
        if NAME_RE.fullmatch(name):
            names.append(name)
        else:
            LOGGER.info("No voice net for mission %r: Murmur would refuse the name", name)
    return names


def subscribers(doc: Any) -> frozenset[str]:
    """Callsigns from GET /Marti/api/missions/{name}/subscriptions/roles"""
    return frozenset(str(sub["username"]) for sub in doc.get("data", []) if sub.get("username"))


def needs_enrolment(cert: Path, now: datetime) -> bool:
    """No certificate yet, or it expires soon"""
    if not cert.exists():
        return True
    expires = x509.load_pem_x509_certificate(cert.read_bytes()).not_valid_after_utc
    return expires - now < RENEW_BEFORE


async def enrol(session: aiohttp.ClientSession, settings: TakSettings) -> None:
    """A new key, a certificate for it from rmapi, and TAK user rights for it through rmapi's interop.

    The new key and certificate replace the old ones only once takrmapi has accepted the certificate. Until then
    they wait beside them, so a refused interop is retried with the same certificate: rmapi signs once.
    """
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    new_key, new_cert = settings.data_dir / "tak.key.new", settings.data_dir / "tak.pem.new"
    if not new_key.exists() or needs_enrolment(new_cert, datetime.now(UTC)):
        new_cert.unlink(missing_ok=True)  # never pair an older certificate with the new key
        new_cert.write_text(await sign(session, settings, new_key), encoding="utf-8")
    cert = new_cert.read_text(encoding="utf-8")
    interop = {"certcn": settings.cn, "x509cert": cert.replace("\n", "\\n")}
    async with session.post(f"{settings.rmapi_url}api/v1/product/interop/tak", json=interop) as resp:
        resp.raise_for_status()
        result = await resp.json()
    if not result.get("success"):
        raise RuntimeError(f"takrmapi did not register us: {result.get('error')}")
    new_cert.replace(settings.cert)
    new_key.replace(settings.key)


async def sign(session: aiohttp.ClientSession, settings: TakSettings, new_key: Path) -> str:
    """A new key at new_key, and rmapi's certificate for it"""
    pub, csr_path = settings.data_dir / "tak.pub", settings.data_dir / "tak.csr"
    # libpvarki writes these read-only, so a failed attempt's files would block the next one
    for leftover in (new_key, pub, csr_path):
        leftover.unlink(missing_ok=True)
    keypair = await async_create_keypair(new_key, pub, ktype="ECDSA")
    csr = await async_create_client_csr(keypair, csr_path, {"CN": settings.cn})
    async with session.post(f"{settings.rmapi_url}api/v1/product/sign_csr/mtls", json={"csr": csr}) as resp:
        resp.raise_for_status()
        return str((await resp.json())["certificate"]).replace("\\n", "\n")


def tls_context(settings: TakSettings) -> ssl.SSLContext:
    """Trust only the platform CA for TAK, and present our certificate"""
    context = ssl.create_default_context(cafile=str(settings.ca_bundle))
    context.load_cert_chain(settings.cert, settings.key)
    return context


async def read_missions(
    session: aiohttp.ClientSession, settings: TakSettings, context: ssl.SSLContext | bool
) -> dict[str, frozenset[str]]:
    """Every mission we can see, with its subscribers' callsigns"""

    async def get(path: str) -> Any:
        # TAK is reached by its service name but its certificate carries the public name.
        name = settings.tak_server_name if isinstance(context, ssl.SSLContext) else None
        async with session.get(settings.tak_url + path, ssl=context, server_hostname=name) as resp:
            resp.raise_for_status()
            return await resp.json(content_type=None)

    # TAK's own service identity (takrmapi's admin, named like TAK's certificate) and ours are no voice users
    services = {settings.tak_server_name, settings.cn}
    missions: dict[str, frozenset[str]] = {}
    for name in mission_names(await get("/Marti/api/missions")):
        try:
            path = f"/Marti/api/missions/{quote(name, safe='')}/subscriptions/roles"
            missions[name] = subscribers(await get(path)) - services
        except aiohttp.ClientResponseError as exc:
            # Password-protected missions, or one deleted meanwhile: no net
            LOGGER.info("No subscribers for mission %r: HTTP %d", name, exc.status)
    return missions


async def watch(store: Store, settings: TakSettings, stop: asyncio.Event) -> None:
    """Keep the store's missions current until stopped; while TAK or rmapi is away, keep the last known"""
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
        while not stop.is_set():
            try:
                if needs_enrolment(settings.cert, datetime.now(UTC)):
                    await enrol(session, settings)
                    LOGGER.info("Registered with TAK as %s", settings.cn)
                missions = await read_missions(session, settings, tls_context(settings))
                if store.set_missions(missions):
                    LOGGER.info("Mission nets: %s", ", ".join(sorted(store.missions())) or "none")
            except (aiohttp.ClientError, OSError, ValueError, KeyError, RuntimeError, TimeoutError) as exc:
                LOGGER.warning("Keeping the last known missions: %r", exc)  # a timeout's str() is empty
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), settings.poll_seconds)
