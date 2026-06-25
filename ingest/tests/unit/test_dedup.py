from datetime import datetime, timezone
from ingest.dedup import compute_content_hash, dedupe
from ingest.models import NormalizedEvent

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)

def _ev(**kw):
    base = dict(title="X", starts_at=DT, source="s", is_online=False,
                content_hash="", review_status="auto", tags=[])
    base.update(kw)
    base["content_hash"] = compute_content_hash(base["title"], base["starts_at"],
                                                base.get("city"), base.get("location_name"))
    return NormalizedEvent(**base)

def test_hash_stable_and_city_fallback():
    h1 = compute_content_hash("X", DT, None, "Hubland")
    h2 = compute_content_hash("X", DT, None, "Hubland")
    h3 = compute_content_hash("X", DT, None, None)  # → 'online'
    assert h1 == h2 and h1 != h3

def test_dedupe_by_external_id():
    a = _ev(source="meetup", external_id="42")
    b = _ev(source="meetup", external_id="42", title="X (updated)")
    out = dedupe([a, b])
    assert len(out) == 1

def test_dedupe_by_content_hash_when_no_id():
    a = _ev(city="Würzburg")
    b = _ev(city="Würzburg")
    out = dedupe([a, b])
    assert len(out) == 1
