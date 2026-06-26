from datetime import datetime, timezone
from ingest.sink import SupabaseSink, to_row
from ingest.models import NormalizedEvent

DT = datetime(2026, 7, 1, 18, tzinfo=timezone.utc)


def _ev(*, external_id="42", content_hash="abc"):
    return NormalizedEvent(title="X", starts_at=DT, source="meetup",
                           external_id=external_id,
                           is_online=False, content_hash=content_hash,
                           review_status="auto", tags=["dev"])


def test_to_row_maps_columns():
    row = to_row(_ev())
    assert row["title"] == "X"
    assert row["source"] == "meetup"
    assert row["external_id"] == "42"
    assert row["content_hash"] == "abc"
    assert "last_seen_at" in row
    assert "lat" not in row and "lng" not in row


class _FakeTable:
    """Fake Supabase table that records every upsert call."""

    def __init__(self, calls: list):
        self._calls = calls
        self._last_rows = None
        self._last_conflict = None

    def upsert(self, rows, on_conflict=None):
        self._calls.append({"rows": rows, "on_conflict": on_conflict})
        self._last_rows = rows
        return self

    def execute(self):
        class R:
            data = self._last_rows

        r = R()
        r.data = self._last_rows
        return r


class _FakeClient:
    def __init__(self, calls: list):
        self._calls = calls

    def table(self, name):
        return _FakeTable(self._calls)


def test_supabase_sink_upserts_with_external_id():
    """Rows that have an external_id use the source,external_id conflict target."""
    calls = []

    class FakeTable:
        def upsert(self, rows, on_conflict=None):
            calls.append({"rows": rows, "on_conflict": on_conflict})
            return self
        def execute(self):
            class R: data = calls[-1]["rows"]
            return R()

    class FakeClient:
        def table(self, name): return FakeTable()

    ev = _ev(external_id="42")
    res = SupabaseSink(FakeClient()).upsert_batch([ev])
    assert res.inserted == 1
    assert len(calls) == 1
    assert calls[0]["on_conflict"] == "source,external_id"


def test_supabase_sink_upserts_without_external_id():
    """Rows without an external_id use the content_hash conflict target."""
    calls = []

    class FakeTable:
        def upsert(self, rows, on_conflict=None):
            calls.append({"rows": rows, "on_conflict": on_conflict})
            return self
        def execute(self):
            class R: data = calls[-1]["rows"]
            return R()

    class FakeClient:
        def table(self, name): return FakeTable()

    ev = _ev(external_id=None, content_hash="hash_no_id")
    res = SupabaseSink(FakeClient()).upsert_batch([ev])
    assert res.inserted == 1
    assert len(calls) == 1
    assert calls[0]["on_conflict"] == "content_hash"


def test_supabase_sink_mixed_batch_two_upsert_calls():
    """Mixed batch: one call per conflict target, counts are summed."""
    calls = []

    class FakeTable:
        def upsert(self, rows, on_conflict=None):
            calls.append({"rows": rows, "on_conflict": on_conflict})
            return self
        def execute(self):
            class R: data = calls[-1]["rows"]
            return R()

    class FakeClient:
        def table(self, name): return FakeTable()

    ev_with = _ev(external_id="id-1", content_hash="h1")
    ev_without = _ev(external_id=None, content_hash="h2")
    res = SupabaseSink(FakeClient()).upsert_batch([ev_with, ev_without])

    assert res.inserted == 2
    assert len(calls) == 2
    conflict_targets = {c["on_conflict"] for c in calls}
    assert conflict_targets == {"source,external_id", "content_hash"}


def test_supabase_sink_empty_batch():
    """Empty batch short-circuits without touching the client."""
    calls = []

    class FakeClient:
        def table(self, name):
            calls.append(name)
            raise AssertionError("should not be called for empty batch")

    res = SupabaseSink(FakeClient()).upsert_batch([])
    assert res.inserted == 0
    assert calls == []
