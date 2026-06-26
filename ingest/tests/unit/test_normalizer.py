from datetime import datetime, timezone
from ingest.agents.normalizer import build_tagger, TaggerOutput, TaggedItem, finalize
from ingest.models import RawEvent

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)


def test_tagger_configured():
    agent = build_tagger()
    assert agent.name == "tagger"
    # output_schema absichtlich None (siehe extractor): Struktur per Prompt.
    assert agent.output_schema is None
    assert "JSON" in agent.instruction


def test_finalize_merges_tags_and_sets_hash():
    raw = [RawEvent(title="Python Meetup", starts_at=DT, source="meetup", city="Würzburg")]
    tagged = {0: TaggedItem(index=0, tags=["python", "meetup"], is_online=False)}
    out = finalize(raw, tagged)
    assert len(out) == 1
    assert out[0].tags == ["python", "meetup"]
    assert out[0].review_status == "auto"
    assert out[0].content_hash  # gesetzt


def test_finalize_marks_needs_review_via_default_status():
    # review_status wird vom Aufrufer (collect) über default_status gesetzt
    raw = [RawEvent(title="X", starts_at=DT, source="zdi")]
    out = finalize(raw, {}, default_status="needs_review")
    assert out[0].review_status == "needs_review"
    assert out[0].tags == []


def test_is_online_is_always_bool():
    """NormalizedEvent.is_online must never be None, even when RawEvent.is_online is None."""
    raw = [RawEvent(title="Test", starts_at=DT, source="test", is_online=None)]
    out = finalize(raw, {})
    assert isinstance(out[0].is_online, bool)
    assert out[0].is_online is False


def test_llm_is_online_takes_precedence_over_raw():
    """LLM TaggedItem.is_online=True overrides RawEvent.is_online=False."""
    raw = [RawEvent(title="Online Talk", starts_at=DT, source="test", is_online=False)]
    tagged = {0: TaggedItem(index=0, tags=["webinar"], is_online=True)}
    out = finalize(raw, tagged)
    assert out[0].is_online is True
