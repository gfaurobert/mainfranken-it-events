from datetime import datetime, timedelta, timezone
from ingest.pipeline import (
    is_upcoming, _upcoming_window, HORIZON_DAYS, _ensure_aware, apply_geo_filter,
)
from ingest.models import RawEvent, NormalizedEvent


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


def _norm(city=None, location_name=None, is_online=False, status="auto") -> NormalizedEvent:
    return NormalizedEvent(
        title="x", starts_at=datetime(2026, 7, 1, tzinfo=timezone.utc), source="s",
        city=city, location_name=location_name, is_online=is_online,
        content_hash="h", review_status=status,
    )


def test_geo_filter_keeps_mainfranken_event():
    out = apply_geo_filter([_norm(city="Würzburg")])
    assert len(out) == 1
    assert out[0].review_status == "auto"


def test_geo_filter_drops_outside_event():
    assert apply_geo_filter([_norm(city="Berlin")]) == []


def test_geo_filter_keeps_online_event_regardless_of_region():
    # Online-Events sind ortsunabhängig und werden immer behalten.
    out = apply_geo_filter([_norm(city="Berlin", is_online=True)])
    assert len(out) == 1


def test_geo_filter_flags_unknown_location_for_review():
    out = apply_geo_filter([_norm(location_name="Online via Zoom")])
    assert len(out) == 1
    assert out[0].review_status == "needs_review"


def test_geo_filter_does_not_downgrade_verified_unknown():
    out = apply_geo_filter([_norm(location_name="irgendwo", status="verified")])
    assert out[0].review_status == "verified"


def test_geo_filter_keeps_existing_needs_review_for_unknown():
    out = apply_geo_filter([_norm(location_name="irgendwo", status="needs_review")])
    assert len(out) == 1
    assert out[0].review_status == "needs_review"
