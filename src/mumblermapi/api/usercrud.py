"""User lifecycle events from rmapi"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from libpvarki.middleware import MTLSHeader
from libpvarki.schemas.generic import OperationResultResponse
from libpvarki.schemas.product import UserCRUDRequest

from .deps import StoreDep, from_rmapi

LOGGER = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(MTLSHeader(auto_error=True)), Depends(from_rmapi)])


@router.post("/created")
def user_created(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user got a certificate"""
    store.upsert_user(user.callsign, user.uuid)
    store.set_user_flag(user.callsign, "revoked", False)
    LOGGER.info("User %s created", user.callsign)
    return OperationResultResponse(success=True)


@router.post("/revoked")
def user_revoked(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user's certificate was revoked: murmur-agent disconnects them on its next poll"""
    store.set_user_flag(user.callsign, "revoked", True, uuid=user.uuid)
    LOGGER.info("User %s revoked", user.callsign)
    return OperationResultResponse(success=True)


@router.post("/promoted")
def user_promoted(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user became an admin"""
    store.set_user_flag(user.callsign, "admin", True, uuid=user.uuid)
    return OperationResultResponse(success=True)


@router.post("/demoted")
def user_demoted(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user is no longer an admin"""
    store.set_user_flag(user.callsign, "admin", False, uuid=user.uuid)
    return OperationResultResponse(success=True)


@router.put("/updated")
def user_updated(user: UserCRUDRequest, store: StoreDep) -> OperationResultResponse:
    """A user's details changed"""
    store.upsert_user(user.callsign, user.uuid)
    return OperationResultResponse(success=True)
