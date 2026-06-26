import hashlib
from datetime import datetime, timezone
from ingest.models import NormalizedEvent


def compute_content_hash(title: str, starts_at: datetime, city: str | None,
                         location_name: str | None) -> str:
    """Compute the canonical dedup key shared with the core/DB side.

    CANONICAL FORMULA:
        md5(lower(title) | starts_at-as-UTC-ISO-8601 | lower(coalesce(city, location_name, 'online')))

    The timestamp is always normalised to UTC before calling .isoformat() so that
    the same instant expressed in different timezones (or as a naive datetime
    treated as UTC) produces identical hashes.  Whoever implements the core side
    must mirror this formula exactly.
    """
    if starts_at.tzinfo is None:
        # Naive datetime — treat as UTC
        starts_at_utc = starts_at.replace(tzinfo=timezone.utc)
    else:
        # Timezone-aware — convert to UTC
        starts_at_utc = starts_at.astimezone(timezone.utc)
    place = (city or location_name or "online").lower()
    raw = f"{title.lower()}|{starts_at_utc.isoformat()}|{place}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def dedupe(events: list[NormalizedEvent]) -> list[NormalizedEvent]:
    seen_ids: set[tuple[str, str]] = set()
    seen_hashes: set[str] = set()
    out: list[NormalizedEvent] = []
    for e in events:
        if e.external_id is not None:
            key = (e.source, e.external_id)
            if key in seen_ids:
                continue
            seen_ids.add(key)
        else:
            if e.content_hash in seen_hashes:
                continue
        seen_hashes.add(e.content_hash)
        out.append(e)
    return out
