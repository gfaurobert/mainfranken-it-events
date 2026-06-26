import json
from datetime import datetime, time, timezone
from ingest.models import RawEvent, SourceConfig


def _parse_date(s: str) -> datetime:
    d = datetime.strptime(s, "%Y-%m-%d").date()
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def parse_confstech(json_text: str, source: SourceConfig) -> list[RawEvent]:
    items = json.loads(json_text)
    out: list[RawEvent] = []
    for it in items:
        if it.get("country") != "Germany":
            continue
        try:
            starts_at = _parse_date(it["startDate"])
        except (ValueError, KeyError):
            continue
        try:
            ends_at = _parse_date(it["endDate"]) if it.get("endDate") else None
        except ValueError:
            ends_at = None
        out.append(RawEvent(
            title=it["name"],
            starts_at=starts_at,
            ends_at=ends_at,
            city=it.get("city"),
            url=it.get("url"),
            is_online=bool(it.get("online", False)),
            source=source.name,
            source_url=source.url,
            external_id=it.get("url"),
        ))
    return out
