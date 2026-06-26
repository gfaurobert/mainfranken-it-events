import asyncio
import json
import re
import sys
from datetime import datetime, timedelta, timezone
import httpx
from ingest.models import SourceConfig, RawEvent
from ingest.registry.loader import load_sources
from ingest.connectors import ical, confstech, jsonld
from ingest.connectors.fetch import fetch_text, html_to_text
from ingest.agents.extractor import build_extractor
from ingest.agents.normalizer import build_tagger, finalize, TaggedItem, TaggerOutput
from ingest.agents.runner import run_structured
from ingest.dedup import dedupe
from ingest.sink import make_sink
from ingest.report import build_report


def _ensure_aware(dt: datetime | None) -> datetime | None:
    """Naive Datetimes als UTC interpretieren (tz-aware machen)."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _stable_html_external_id(title: str, starts_at: datetime) -> str:
    """Deterministische external_id für LLM-extrahierte html-Events.

    Der Reasoning-LLM formuliert Titel zwischen Läufen leicht unterschiedlich,
    wodurch der content_hash variiert und Duplikate entstehen. Ein über
    Datum + aggressiv normalisierten Titel (klein, nur alphanumerisch)
    gebildeter Schlüssel ist gegenüber solcher Varianz robust und macht den
    Upsert über (source, external_id) idempotent."""
    slug = re.sub(r"[^a-z0-9]+", "", title.lower())
    return f"{starts_at.date().isoformat()}|{slug}"


async def collect_from_source(src: SourceConfig) -> tuple[list[RawEvent], str]:
    # Feed einmal laden. Ein nicht erreichbarer/404-Feed (in der Praxis häufig:
    # Gruppe ohne Termine, Seite umgezogen) ist KEIN harter Pipeline-Fehler —
    # die Quelle liefert dann 0 Events. Echte Parse-/LLM-Fehler propagieren.
    try:
        text = await fetch_text(src.url)
    except httpx.HTTPError as e:
        print(f"[ingest] Feed nicht erreichbar – übersprungen: {src.name} ({e})",
              file=sys.stderr)
        return [], "auto"

    if src.type == "ical":
        return ical.parse_ical(text, src), "auto"
    if src.type == "confstech":
        return confstech.parse_confstech(text, src), "auto"
    if src.type == "jsonld":
        return jsonld.parse_jsonld(text, src), "auto"
    if src.type == "html":
        text = html_to_text(text)
        today = datetime.now(timezone.utc).date().isoformat()
        prompt = (f"Heutiges Datum: {today}\nQuelle: {src.name}\n"
                  f"Seitentext:\n{text[:12000]}")
        out = await run_structured(build_extractor(), prompt)
        events = []
        for ev in out.get("events", []):
            e = RawEvent(**{**ev, "source": src.name, "source_url": src.url})
            # Der LLM liefert starts_at teils ohne TZ-Offset → naive datetime.
            # Downstream (Filter, content_hash, DB) braucht tz-aware → UTC.
            starts_at = _ensure_aware(e.starts_at)
            # Deterministische external_id → idempotenter Upsert trotz
            # Titel-Varianz des LLM. URL bevorzugen, sonst Datum+Titel-Slug.
            external_id = e.external_id or e.url or _stable_html_external_id(
                e.title, starts_at)
            events.append(e.model_copy(update={
                "starts_at": starts_at,
                "ends_at": _ensure_aware(e.ends_at),
                "external_id": external_id,
            }))
        return events, "needs_review"
    return [], "auto"


# Der Tagger läuft in Batches: ein einziger LLM-Call über sehr viele Events ist
# langsam und reißt bei einem Fehler alles mit. Globale Indizes bleiben erhalten.
TAG_BATCH = 15


async def _tag_batch(payload: list[dict]) -> dict[int, TaggedItem]:
    try:
        out = await run_structured(build_tagger(), json.dumps(payload, ensure_ascii=False))
        parsed = TaggerOutput(**out) if out else TaggerOutput()
        return {it.index: it for it in parsed.items}
    except Exception:
        # Batch fehlgeschlagen → diese Events bleiben ohne Tags (kein Crash).
        return {}


async def _tag_all(raw: list[RawEvent]) -> dict[int, TaggedItem]:
    if not raw:
        return {}
    payload = [{"index": i, "title": e.title, "location_name": e.location_name,
                "description": (e.description or "")[:300]} for i, e in enumerate(raw)]
    chunks = [payload[i:i + TAG_BATCH] for i in range(0, len(payload), TAG_BATCH)]
    results = await asyncio.gather(*(_tag_batch(c) for c in chunks))
    merged: dict[int, TaggedItem] = {}
    for r in results:
        merged.update(r)
    return merged


# Events außerhalb dieses Fensters werden verworfen: nichts Vergangenes und
# nichts weiter als HORIZON_DAYS voraus (Serien-/RRULE-Expansion erzeugt sonst
# Geister-Termine Jahre im Voraus).
HORIZON_DAYS = 365


def _upcoming_window() -> tuple[datetime, datetime]:
    """(Beginn heute, Beginn heute + HORIZON_DAYS) in UTC."""
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=HORIZON_DAYS)


def is_upcoming(event: RawEvent, window: tuple[datetime, datetime]) -> bool:
    start, end = window
    return start <= event.starts_at <= end


# Sammel-Parallelität begrenzen: html-Quellen lösen je einen LLM-Call aus;
# zu viele gleichzeitig überlasten den Provider (Rate-Limit/Timeouts).
COLLECT_CONCURRENCY = 6


async def run_ingest(sink=None, sources: list[SourceConfig] | None = None) -> dict:
    sources = sources if sources is not None else load_sources(only_active=True)
    sink = sink if sink is not None else make_sink()

    raw: list[RawEvent] = []
    errors = 0
    sem = asyncio.Semaphore(COLLECT_CONCURRENCY)

    async def _guarded(s: SourceConfig):
        async with sem:
            return await collect_from_source(s)

    results = await asyncio.gather(
        *(_guarded(s) for s in sources), return_exceptions=True
    )
    window = _upcoming_window()
    status_map: dict[int, str] = {}
    for events_or_exc in results:
        if isinstance(events_or_exc, Exception):
            errors += 1
            continue
        events, status = events_or_exc
        for e in events:
            if not is_upcoming(e, window):
                continue
            status_map[len(raw)] = status
            raw.append(e)

    tagged = await _tag_all(raw)
    # finalize per event, using per-event review_status from status_map
    normalized = []
    for i, e in enumerate(raw):
        normalized.extend(finalize([e], {0: tagged[i]} if i in tagged else {},
                                    default_status=status_map.get(i, "auto")))
    deduped = dedupe(normalized)
    res = sink.upsert_batch(deduped)
    return build_report(len(sources), len(raw), len(deduped), res.inserted, errors)
