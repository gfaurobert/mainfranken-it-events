import asyncio
import json
from ingest.models import SourceConfig, RawEvent
from ingest.registry.loader import load_sources
from ingest.connectors import ical, confstech, jsonld
from ingest.connectors.fetch import fetch_text
from ingest.agents.extractor import build_extractor
from ingest.agents.normalizer import build_tagger, finalize, TaggedItem, TaggerOutput
from ingest.agents.runner import run_structured
from ingest.dedup import dedupe
from ingest.sink import make_sink
from ingest.report import build_report


async def collect_from_source(src: SourceConfig) -> tuple[list[RawEvent], str]:
    if src.type == "ical":
        return ical.parse_ical(await fetch_text(src.url), src), "auto"
    if src.type == "confstech":
        return confstech.parse_confstech(await fetch_text(src.url), src), "auto"
    if src.type == "jsonld":
        return jsonld.parse_jsonld(await fetch_text(src.url), src), "auto"
    if src.type == "html":
        html = await fetch_text(src.url)
        prompt = f"Quelle: {src.name}\nSeitentext:\n{html[:20000]}"
        out = await run_structured(build_extractor(), prompt)
        events = [RawEvent(**{**ev, "source": src.name, "source_url": src.url})
                  for ev in out.get("events", [])]
        return events, "needs_review"
    return [], "auto"


async def _tag_all(raw: list[RawEvent]) -> dict[int, TaggedItem]:
    if not raw:
        return {}
    payload = [{"index": i, "title": e.title, "location_name": e.location_name,
                "description": (e.description or "")[:300]} for i, e in enumerate(raw)]
    out = await run_structured(build_tagger(), json.dumps(payload, ensure_ascii=False))
    parsed = TaggerOutput(**out) if out else TaggerOutput()
    return {it.index: it for it in parsed.items}


async def run_ingest(sink=None, sources: list[SourceConfig] | None = None) -> dict:
    sources = sources if sources is not None else load_sources(only_active=True)
    sink = sink if sink is not None else make_sink()

    raw: list[RawEvent] = []
    errors = 0
    results = await asyncio.gather(
        *(collect_from_source(s) for s in sources), return_exceptions=True
    )
    status_map: dict[int, str] = {}
    for events_or_exc in results:
        if isinstance(events_or_exc, Exception):
            errors += 1
            continue
        events, status = events_or_exc
        for e in events:
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
