from datetime import datetime, timezone
from ingest.sink import SupabaseSink, to_row
from ingest.models import NormalizedEvent

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)


def _ev():
    return NormalizedEvent(title="X", starts_at=DT, source="meetup", external_id="42",
                           is_online=False, content_hash="abc", review_status="auto",
                           tags=["dev"])


def test_to_row_maps_columns():
    row = to_row(_ev())
    assert row["title"] == "X"
    assert row["source"] == "meetup"
    assert row["external_id"] == "42"
    assert row["content_hash"] == "abc"
    assert "last_seen_at" in row
    assert "lat" not in row and "lng" not in row


def test_supabase_sink_upserts():
    calls = {}
    class FakeTable:
        def upsert(self, rows, on_conflict=None):
            calls["rows"] = rows; calls["on_conflict"] = on_conflict; return self
        def execute(self):
            class R: data = calls["rows"]
            return R()
    class FakeClient:
        def table(self, name): calls["table"] = name; return FakeTable()
    res = SupabaseSink(FakeClient()).upsert_batch([_ev()])
    assert res.inserted == 1
    assert calls["table"] == "events"
    assert calls["on_conflict"] == "source,external_id"
