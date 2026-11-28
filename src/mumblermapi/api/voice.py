"""Voice tickets: how a browser joins voice through the voice gateway"""

from __future__ import annotations

import base64
import binascii
import logging
import time
from datetime import UTC, datetime
from urllib.parse import unquote

from cryptography.hazmat.primitives.serialization import Encoding
from fastapi import APIRouter, HTTPException, Request

from ..config import Settings
from ..identity import CertVerifier, IdentityError, normalize_callsign
from ..tickets import AUDIT, mint, web_username
from .deps import StoreDep
from .models import Ticket, TicketRequest

LOGGER = logging.getLogger(__name__)
FORWARDED_CERT = "x-forwarded-tls-client-cert"

router = APIRouter()


def forwarded_leaf(request: Request) -> bytes:
    """The client certificate Traefik verified, as DER. Traefik sends each certificate's PEM body, leaf first,
    comma-separated, and overwrites the header when a client sends one of its own."""
    first = unquote(request.headers.get(FORWARDED_CERT, "")).split(",")[0]
    try:
        return base64.b64decode(first, validate=True)
    except (binascii.Error, ValueError):
        return b""


def _refuse(status: int, why: str, who: str = "") -> HTTPException:
    LOGGER.log(AUDIT, "Refused a voice ticket%s: %s", f" for {who}" if who else "", why)
    return HTTPException(status_code=status, detail=why)


@router.post("/token")
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
    callsign, now = normalize_callsign(identity.callsign), time.time()  # wall-clock: slots outlive a restart
    username = web_username(callsign, store.web_slot(callsign, choice.browser, now))
    LOGGER.info("Voice ticket for %s", username)
    leaf = identity.leaf.public_bytes(Encoding.DER)
    return Ticket(ticket=mint(request.app.state.ticket_key, username, leaf, now), username=username)
