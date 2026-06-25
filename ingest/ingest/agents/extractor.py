from datetime import datetime

from google.adk.agents import LlmAgent
from pydantic import BaseModel
from ingest.config import get_model

INSTRUCTION = """Du extrahierst IT-/Tech-Veranstaltungen aus dem gelieferten Seitentext.
Gib NUR Events zurück, die ein erkennbares Startdatum haben. Erfinde nichts.
Felder, die nicht im Text stehen, lässt du leer. starts_at als ISO-8601.
Setze source und source_url NICHT (macht der Aufrufer)."""


class ExtractedEvent(BaseModel):
    title: str
    starts_at: datetime
    ends_at: datetime | None = None
    description: str | None = None
    location_name: str | None = None
    city: str | None = None
    url: str | None = None
    organizer: str | None = None
    is_online: bool | None = None
    is_free: bool | None = None
    price: str | None = None
    external_id: str | None = None


class ExtractorOutput(BaseModel):
    events: list[ExtractedEvent]


def build_extractor() -> LlmAgent:
    return LlmAgent(
        name="html_extractor",
        model=get_model(),
        instruction=INSTRUCTION,
        output_schema=ExtractorOutput,
    )
