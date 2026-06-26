"""Tests für den AI-Week-Connector (timetable session.json → RawEvents)."""
from pathlib import Path

from ingest.connectors.aiweek import parse_aiweek
from ingest.models import SourceConfig

_FIXTURE = (Path(__file__).parent.parent / "fixtures" / "aiweek_session.json").read_text(
    encoding="utf-8"
)
_SRC = SourceConfig(name="AI Week Mainfranken",
                    url="https://backend.timetable.ai-week.de/export/session.json",
                    type="aiweek", region="Mainfranken",
                    organizer="AI Week Mainfranken")


def _parse():
    return parse_aiweek(_FIXTURE, _SRC)


def _by_id(events, ext_id):
    return next(e for e in events if e.external_id == ext_id)


def test_parses_all_non_cancelled_sessions():
    # Fixture hat 5 Sessions, davon 1 abgesagt (id 101) → 4 Events.
    events = _parse()
    assert len(events) == 4
    assert all(e.external_id != "101" for e in events)


def test_maps_core_fields():
    e = _by_id(_parse(), "66")
    assert e.title == "Fake-Rechnungen entlarven"
    assert e.starts_at.isoformat() == "2026-06-22T09:00:00+02:00"
    assert e.ends_at.isoformat() == "2026-06-22T10:00:00+02:00"
    assert e.description == "Wie KI verdächtige Rechnungen erkennt."
    assert e.organizer == "finception GmbH"
    assert e.source == "AI Week Mainfranken"
    assert e.source_url == _SRC.url


def test_external_id_is_stable_session_id():
    # Stabile numerische ID → idempotenter Upsert, robust gegen Titel-Varianz.
    assert _by_id(_parse(), "58").external_id == "58"


def test_online_event_has_no_location_and_is_online():
    e = _by_id(_parse(), "66")
    assert e.is_online is True
    assert e.location_name is None
    assert e.city is None


def test_onsite_event_maps_location_and_city():
    e = _by_id(_parse(), "58")
    assert e.is_online is False
    assert e.location_name == "JUN Legal GmbH"
    assert e.city == "Würzburg"


def test_onsite_event_outside_wuerzburg_keeps_its_city():
    e = _by_id(_parse(), "75")
    assert e.city == "Lohr a.Main"


def test_detail_link_used_as_url():
    assert _by_id(_parse(), "58").url == "https://example.org/ki-code"


def test_missing_detail_link_yields_no_url():
    e = _by_id(_parse(), "200")
    assert e.url is None
    assert e.external_id == "200"  # external_id bleibt stabil trotz fehlendem Link
