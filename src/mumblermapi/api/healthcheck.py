"""The health check rmapi and the kubelet ask"""

from __future__ import annotations

from fastapi import APIRouter, Request
from libpvarki.schemas.product import ProductHealthCheckResponse

router = APIRouter()


@router.get("")
def healthcheck(request: Request) -> ProductHealthCheckResponse:
    """Voice's health for rmapi, from the background check, with what is wrong in extra. Always 200: the kubelet
    probes this too, and restarting the process mends none of what the check finds."""
    found = request.app.state.health
    return ProductHealthCheckResponse(healthy=not found, extra="; ".join(found))
