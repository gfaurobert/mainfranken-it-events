"""Unit tests for _structured_from_events — no live LLM required."""
from types import SimpleNamespace
from ingest.agents.runner import _structured_from_events


def _make_event(*, text=None, output=None, partial=None, thought=False):
    """Build a fake ADK-event-like object."""
    parts = []
    if text is not None:
        parts.append(SimpleNamespace(text=text, thought=thought))
    content = SimpleNamespace(parts=parts) if parts else None
    return SimpleNamespace(output=output, content=content, partial=partial)


def test_text_content_path_real_adk_chat_mode():
    """ADK 2.3 chat-mode: structured JSON arrives as text in content.parts."""
    payload = {"title": "PyCon", "city": "Berlin"}
    event = _make_event(text='{"title":"PyCon","city":"Berlin"}')
    assert _structured_from_events([event]) == payload


def test_output_dict_workflow_path():
    """Workflow/task-mode: event.output is already the parsed dict."""
    payload = {"tags": ["python", "oss"]}
    event = _make_event(output=payload)
    assert _structured_from_events([event]) == payload


def test_no_structured_output_returns_empty():
    """No structured output → returns {}."""
    event = _make_event(text="just some prose, no JSON here")
    assert _structured_from_events([event]) == {}


def test_partial_events_are_skipped():
    """Partial/streaming events must be ignored; only final events count."""
    partial = _make_event(text='{"incomplete": true}', partial=True)
    final = _make_event(text='{"complete": true}')
    assert _structured_from_events([partial, final]) == {"complete": True}


def test_json_parse_error_returns_empty():
    """Malformed JSON in content must not raise — returns {}."""
    event = _make_event(text="{not valid json")
    assert _structured_from_events([event]) == {}


def test_thought_parts_are_excluded():
    """Parts marked as thought (extended thinking) must not be included."""
    thought_part = SimpleNamespace(text='{"should": "be ignored"}', thought=True)
    text_part = SimpleNamespace(text='{"answer": 42}', thought=False)
    content = SimpleNamespace(parts=[thought_part, text_part])
    event = SimpleNamespace(output=None, content=content, partial=None)
    assert _structured_from_events([event]) == {"answer": 42}


def test_last_structured_event_wins():
    """When multiple final events carry JSON, the last one wins."""
    e1 = _make_event(text='{"v": 1}')
    e2 = _make_event(text='{"v": 2}')
    assert _structured_from_events([e1, e2]) == {"v": 2}


def test_empty_event_list():
    """Empty event list → {}."""
    assert _structured_from_events([]) == {}
