from google.adk.agents import LlmAgent
from pydantic import BaseModel
from ingest.models import RawEvent, NormalizedEvent, ReviewStatus
from ingest.dedup import compute_content_hash
from ingest.config import get_model

INSTRUCTION = """Du erhältst eine nummerierte Liste von Events (JSON).
Vergib pro Event 1-5 prägnante, kleingeschriebene Tags (Themen/Technologien,
z.B. 'python', 'ki', 'devops', 'meetup', 'konferenz') und entscheide is_online
(true, wenn Ort/Beschreibung auf online/virtuell/zoom hindeutet).
Gib für jeden index genau ein Ergebnis zurück."""


class TaggedItem(BaseModel):
    index: int
    tags: list[str] = []
    is_online: bool = False


class TaggerOutput(BaseModel):
    items: list[TaggedItem] = []


def build_tagger() -> LlmAgent:
    return LlmAgent(
        name="tagger",
        model=get_model(),
        instruction=INSTRUCTION,
        output_schema=TaggerOutput,
    )


def finalize(
    raw: list[RawEvent],
    tagged: dict[int, TaggedItem],
    default_status: ReviewStatus = "auto",
) -> list[NormalizedEvent]:
    out: list[NormalizedEvent] = []
    for i, e in enumerate(raw):
        t = tagged.get(i)
        # LLM value takes precedence; fall back to RawEvent value, then False
        if t is not None:
            is_online: bool = t.is_online
        else:
            is_online = bool(e.is_online) if e.is_online is not None else False
        dump = e.model_dump()
        dump.pop("is_online", None)
        out.append(
            NormalizedEvent(
                **dump,
                tags=(t.tags if t else []),
                content_hash=compute_content_hash(
                    e.title, e.starts_at, e.city, e.location_name
                ),
                review_status=default_status,
                is_online=is_online,
            )
        )
    return out
