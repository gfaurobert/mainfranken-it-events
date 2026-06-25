import json
from datetime import datetime
from bs4 import BeautifulSoup
from ingest.models import RawEvent, SourceConfig


def _iter_events(obj):
    if isinstance(obj, list):
        for x in obj:
            yield from _iter_events(x)
    elif isinstance(obj, dict):
        if obj.get("@graph"):
            yield from _iter_events(obj["@graph"])
        t = obj.get("@type")
        types = t if isinstance(t, list) else [t]
        if "Event" in types or any(str(x).endswith("Event") for x in types if x):
            yield obj


def _loc(obj):
    loc = obj.get("location")
    if isinstance(loc, dict):
        return loc.get("name"), loc.get("address") if isinstance(loc.get("address"), str) else None
    if isinstance(loc, str):
        return loc, None
    return None, None


def parse_jsonld(html_text: str, source: SourceConfig) -> list[RawEvent]:
    soup = BeautifulSoup(html_text, "html.parser")
    out: list[RawEvent] = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for ev in _iter_events(data):
            start = ev.get("startDate")
            if not start:
                continue
            try:
                starts_at = datetime.fromisoformat(start)
            except ValueError:
                continue
            try:
                ends_at = datetime.fromisoformat(ev["endDate"]) if ev.get("endDate") else None
            except ValueError:
                ends_at = None
            name, city = _loc(ev)
            out.append(RawEvent(
                title=ev.get("name", "(ohne Titel)"),
                starts_at=starts_at,
                ends_at=ends_at,
                description=ev.get("description"),
                location_name=name,
                city=city,
                url=ev.get("url"),
                organizer=source.organizer,
                source=source.name,
                source_url=source.url,
                external_id=ev.get("url"),
            ))
    return out
