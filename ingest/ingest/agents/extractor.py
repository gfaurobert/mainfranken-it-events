from google.adk.agents import LlmAgent
from pydantic import BaseModel
from ingest.models import RawEvent
from ingest.config import get_model

INSTRUCTION = """Du extrahierst IT-/Tech-Veranstaltungen aus dem gelieferten Seitentext.
Gib NUR Events zurück, die ein erkennbares Startdatum haben. Erfinde nichts.
Felder, die nicht im Text stehen, lässt du leer. starts_at als ISO-8601.
Setze source und source_url NICHT (macht der Aufrufer)."""


class ExtractorOutput(BaseModel):
    events: list[RawEvent]


def build_extractor() -> LlmAgent:
    return LlmAgent(
        name="html_extractor",
        model=get_model(),
        instruction=INSTRUCTION,
        output_schema=ExtractorOutput,
    )
