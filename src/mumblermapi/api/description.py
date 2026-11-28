"""The product descriptions rmui shows; anyone may read them"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from libpvarki.schemas.product import ProductDescription

from ..config import SHORTNAME, UI_PATH
from .models import ProductComponent, ProductDescriptionExtended

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

router = APIRouter()
router_v2 = APIRouter()
router_v2_admin = APIRouter()


@router.get("/{language}")
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
        icon=f"{UI_PATH[1:]}/voicelogo.svg",
        description=texts[language],
        language=language,
        docs=f"https://docs.opendefence.fi/{language}/guides/voice-guide",
        component=ProductComponent(type="component", ref=f"{UI_PATH}/remoteEntry.js"),
    )


@router_v2.get("/{language}")
def description_v2(language: str) -> ProductDescriptionExtended:
    """The product tile and its UI remote"""
    return _extended(language, DESCRIPTIONS)


@router_v2_admin.get("/{language}")
def admin_description(language: str) -> ProductDescriptionExtended:
    """The admin tools entry; it opens the same remote, which shows admins more"""
    return _extended(language, ADMIN_DESCRIPTIONS)
