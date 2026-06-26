"""Tests für das Batching/Resilienz-Verhalten von _tag_all (ohne echten LLM)."""
import json
from datetime import datetime, timezone
import httpx
import pytest
import ingest.pipeline as pipe
from ingest.models import RawEvent, SourceConfig

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)


def _raw(n: int) -> list[RawEvent]:
    return [RawEvent(title=f"E{i}", starts_at=DT, source="s") for i in range(n)]


@pytest.mark.asyncio
async def test_tag_all_batches_and_merges_global_indices(monkeypatch):
    calls = []

    async def fake_run_structured(agent, text):
        payload = json.loads(text)
        calls.append(len(payload))
        return {"items": [{"index": p["index"], "tags": ["t"], "is_online": False}
                          for p in payload]}

    monkeypatch.setattr(pipe, "run_structured", fake_run_structured)
    out = await pipe._tag_all(_raw(32))
    assert len(out) == 32
    assert all(i in out for i in range(32))           # globale Indizes intakt
    assert len(calls) == 3                             # 32/15 → 3 Batches
    assert max(calls) <= pipe.TAG_BATCH


@pytest.mark.asyncio
async def test_tag_all_survives_single_batch_failure(monkeypatch):
    async def fake_run_structured(agent, text):
        payload = json.loads(text)
        if payload[0]["index"] == 0:                   # erster Batch fällt aus
            raise RuntimeError("boom")
        return {"items": [{"index": p["index"], "tags": ["t"], "is_online": False}
                          for p in payload]}

    monkeypatch.setattr(pipe, "run_structured", fake_run_structured)
    out = await pipe._tag_all(_raw(20))
    assert 0 not in out and 14 not in out              # ausgefallener Batch ohne Tags
    assert 15 in out and 19 in out                     # restliche Batches getaggt


@pytest.mark.asyncio
async def test_collect_soft_skips_unreachable_feed(monkeypatch):
    """Ein nicht erreichbarer Feed (HTTP-Fehler) ist kein harter Fehler:
    die Quelle liefert 0 Events, der Lauf bleibt fehlerfrei."""
    async def boom(url, **kwargs):
        raise httpx.ConnectError("404 Group not found")

    monkeypatch.setattr(pipe, "fetch_text", boom)
    src = SourceConfig(name="Tote Quelle", url="https://x/ical",
                       type="ical", region="Würzburg")
    events, status = await pipe.collect_from_source(src)
    assert events == [] and status == "auto"


def test_stable_html_external_id_absorbs_title_variance():
    dt = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)
    a = pipe._stable_html_external_id("KI-Vortrag: Quo vadis?", dt)
    b = pipe._stable_html_external_id("ki vortrag  quo vadis ", dt)
    assert a == b                                   # Normalisierung absorbiert Varianz
    assert a == "2026-07-01|kivortragquovadis"


def test_stable_html_external_id_differs_by_date():
    t = "Meetup"
    d1 = datetime(2026, 7, 1, tzinfo=timezone.utc)
    d2 = datetime(2026, 7, 2, tzinfo=timezone.utc)
    assert pipe._stable_html_external_id(t, d1) != pipe._stable_html_external_id(t, d2)


@pytest.mark.asyncio
async def test_html_events_get_deterministic_external_id(monkeypatch):
    async def fake_fetch(url, **kwargs):
        return "<html><body>egal</body></html>"

    async def fake_run(agent, text):
        return {"events": [{"title": "AI Day", "starts_at": "2026-07-01T00:00:00+00:00"}]}

    monkeypatch.setattr(pipe, "fetch_text", fake_fetch)
    monkeypatch.setattr(pipe, "run_structured", fake_run)
    src = SourceConfig(name="S", url="https://s", type="html", region="Würzburg")
    events, status = await pipe.collect_from_source(src)
    assert status == "needs_review" and len(events) == 1
    assert events[0].external_id == "2026-07-01|aiday"
