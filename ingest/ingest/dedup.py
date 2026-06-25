import hashlib
from datetime import datetime
from ingest.models import NormalizedEvent


def compute_content_hash(title: str, starts_at: datetime, city: str | None,
                         location_name: str | None) -> str:
    place = (city or location_name or "online").lower()
    raw = f"{title.lower()}|{starts_at.isoformat()}|{place}"
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
