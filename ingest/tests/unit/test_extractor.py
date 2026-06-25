from ingest.agents.extractor import build_extractor, ExtractorOutput


def test_extractor_is_configured():
    agent = build_extractor()
    assert agent.name == "html_extractor"
    assert agent.output_schema is ExtractorOutput


def test_extractor_output_schema():
    o = ExtractorOutput(events=[])
    assert o.events == []
