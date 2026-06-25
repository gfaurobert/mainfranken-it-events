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


def test_parse_ical_whitespace_location_becomes_none():
    """A LOCATION field containing only whitespace should be normalised to None."""
    ics = (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
        "BEGIN:VEVENT\r\n"
        "UID:ws-test@example.org\r\n"
        "SUMMARY:Whitespace Location Test\r\n"
        "DTSTART:20260801T180000Z\r\n"
        "LOCATION:   \r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    )
    events = parse_ical(ics, SRC)
    assert len(events) == 1
    assert events[0].location_name is None
