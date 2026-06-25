from ingest.agents.extractor import build_extractor, ExtractedEvent, ExtractorOutput


def test_extractor_is_configured():
    agent = build_extractor()
    assert agent.name == "html_extractor"
    assert agent.output_schema is ExtractorOutput


def test_extractor_output_schema():
    o = ExtractorOutput(events=[])
    assert o.events == []


def test_extracted_event_has_no_source_field():
    assert "source" not in ExtractedEvent.model_fields
    assert "source_url" not in ExtractedEvent.model_fields
