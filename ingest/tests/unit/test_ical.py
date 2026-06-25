from pathlib import Path
from ingest.connectors.ical import parse_ical
from ingest.models import SourceConfig

SRC = SourceConfig(name="Schaffenburg", url="https://x/cal.ics", type="ical", region="Aschaffenburg")

def test_parse_ical_basic():
    text = (Path(__file__).parents[1] / "fixtures" / "sample.ics").read_text()
    events = parse_ical(text, SRC)
    assert len(events) == 1
    e = events[0]
    assert e.title == "Linux Stammtisch"
    assert e.external_id == "evt-123@schaffenburg.org"
    assert e.url == "https://schaffenburg.org/event/123"
    assert e.source == "Schaffenburg"
    assert e.starts_at.year == 2026
