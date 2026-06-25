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
