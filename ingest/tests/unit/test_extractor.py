from ingest.agents.extractor import build_extractor, ExtractedEvent, ExtractorOutput


def test_extractor_is_configured():
    agent = build_extractor()
    assert agent.name == "html_extractor"
    # output_schema absichtlich None: DeepSeek/OpenCode Go kann kein
    # response_format mit JSON-Schema; Struktur kommt per Prompt.
    assert agent.output_schema is None
    assert "JSON" in agent.instruction


def test_extractor_output_schema():
    o = ExtractorOutput(events=[])
    assert o.events == []


def test_extracted_event_has_no_source_field():
    assert "source" not in ExtractedEvent.model_fields
    assert "source_url" not in ExtractedEvent.model_fields
