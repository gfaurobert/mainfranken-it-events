from pathlib import Path
from ingest.connectors.jsonld import parse_jsonld
from ingest.models import SourceConfig

SRC = SourceConfig(name="THWS", url="https://thws/events", type="jsonld", region="Würzburg")

def test_parse_jsonld_event():
    html = (Path(__file__).parents[1] / "fixtures" / "jsonld_event.html").read_text()
    events = parse_jsonld(html, SRC)
    assert len(events) == 1
    e = events[0]
    assert e.title == "KI Vortrag"
    assert e.location_name == "THWS"
    assert e.starts_at.year == 2026 and e.starts_at.month == 7


def test_parse_jsonld_skips_bad_startdate_keeps_good():
    """An event with a malformed startDate is skipped; valid events still parse."""
    html = """<html><head>
<script type="application/ld+json">
[
  {"@type":"Event","name":"BadDate","startDate":"not-a-date","url":"https://x/bad"},
  {"@type":"Event","name":"GoodDate","startDate":"2026-08-01T10:00:00+02:00","url":"https://x/good"}
]
</script>
</head><body></body></html>"""
    events = parse_jsonld(html, SRC)
    assert len(events) == 1
    assert events[0].title == "GoodDate"
