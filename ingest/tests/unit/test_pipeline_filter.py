from datetime import datetime, timedelta, timezone
from ingest.pipeline import is_upcoming, _upcoming_window, HORIZON_DAYS, _ensure_aware
from ingest.models import RawEvent


def _ev(dt: datetime) -> RawEvent:
    return RawEvent(title="x", starts_at=dt, source="s")


def test_keeps_event_inside_window():
    now = datetime.now(timezone.utc)
    window = (now - timedelta(days=1), now + timedelta(days=365))
    assert is_upcoming(_ev(now + timedelta(days=30)), window)


def test_drops_past_event():
    now = datetime.now(timezone.utc)
    window = (now, now + timedelta(days=365))
    assert not is_upcoming(_ev(now - timedelta(days=2)), window)


def test_drops_far_future_event():
    now = datetime.now(timezone.utc)
    window = (now, now + timedelta(days=365))
    assert not is_upcoming(_ev(now + timedelta(days=500)), window)


def test_ensure_aware_coerces_naive_to_utc():
    naive = datetime(2026, 7, 1, 18, 0, 0)
    aware = _ensure_aware(naive)
    assert aware.tzinfo is timezone.utc


def test_ensure_aware_keeps_existing_tz():
    aware_in = datetime(2026, 7, 1, 18, 0, 0, tzinfo=timezone.utc)
    assert _ensure_aware(aware_in) is aware_in
    assert _ensure_aware(None) is None


def test_upcoming_window_spans_horizon():
    start, end = _upcoming_window()
    assert (end - start).days == HORIZON_DAYS
    assert start.hour == 0 and start.minute == 0
