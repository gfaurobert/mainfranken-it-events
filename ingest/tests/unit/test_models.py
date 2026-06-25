from datetime import datetime, timezone
from ingest.models import SourceConfig, RawEvent, NormalizedEvent

def test_source_config_defaults():
    s = SourceConfig(name="Schaffenburg", url="https://x/cal.ics", type="ical", region="Aschaffenburg")
    assert s.active is True and s.headless is False

def test_raw_event_minimal():
    e = RawEvent(title="Meetup", starts_at=datetime(2026,7,1,18,tzinfo=timezone.utc), source="meetup")
    assert e.city is None and e.external_id is None

def test_normalized_event_requires_hash():
    e = NormalizedEvent(
        title="Meetup", starts_at=datetime(2026,7,1,18,tzinfo=timezone.utc),
        source="meetup", tags=["dev"], is_online=False,
        content_hash="abc", review_status="auto",
    )
    assert e.review_status == "auto"
