import pytest
from datetime import datetime, timezone
from ingest import pipeline
from ingest.models import SourceConfig, RawEvent

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_run_ingest_happy_path(monkeypatch):
    src = SourceConfig(name="meetup", url="https://x/ical", type="ical", region="Würzburg")

    async def fake_collect(s):
        return [RawEvent(title="Dev Meetup", starts_at=DT, source=s.name, external_id="1",
                         city="Würzburg")], "auto"
    monkeypatch.setattr(pipeline, "collect_from_source", fake_collect)

    # Tagger-Aufruf überspringen → leere Tags
    async def fake_tag(raw):
        return {}
    monkeypatch.setattr(pipeline, "_tag_all", fake_tag)

    written = {}

    class FakeSink:
        def upsert_batch(self, events):
            written["n"] = len(events)
            from ingest.sink import UpsertResult
            return UpsertResult(inserted=len(events))

    report = await pipeline.run_ingest(sink=FakeSink(), sources=[src])
    assert report["written"] == 1
    assert report["deduped"] == 1
    assert written["n"] == 1
