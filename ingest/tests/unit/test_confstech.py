import json
from pathlib import Path
from ingest.connectors.confstech import parse_confstech
from ingest.models import SourceConfig

SRC = SourceConfig(name="confs.tech", url="https://raw/x.json", type="confstech", region="Germany")

def test_parse_filters_germany():
    text = (Path(__file__).parents[1] / "fixtures" / "confstech.json").read_text()
    events = parse_confstech(text, SRC)
    assert [e.title for e in events] == ["PyConDE"]
    e = events[0]
    assert e.city == "Darmstadt"
    assert e.external_id == "https://pycon.de"
    assert e.starts_at.year == 2026 and e.starts_at.month == 4


def test_parse_confstech_skips_bad_date_keeps_good():
    """An event with a malformed startDate is skipped; good events still parse."""
    data = [
        {"name": "BadConf", "startDate": "not-a-date", "country": "Germany",
         "url": "https://bad.de", "city": "Berlin", "online": False},
        {"name": "GoodConf", "startDate": "2026-09-10", "country": "Germany",
         "url": "https://good.de", "city": "München", "online": False},
    ]
    events = parse_confstech(json.dumps(data), SRC)
    assert len(events) == 1
    assert events[0].title == "GoodConf"
