from datetime import datetime, timedelta, timezone

from sop_manager.routers.delivery_progress import burndown_observation


def test_burndown_reports_only_the_observed_point():
    now = datetime(2026, 10, 16, tzinfo=timezone.utc)
    result = burndown_observation(10, 3, now - timedelta(days=4), now + timedelta(days=6), now)
    assert result["actual"] == [{"day": 4, "remaining": 3.0}]
    assert result["span_days"] == 10
    assert result["history_available"] is False


def test_burndown_does_not_guess_dates_from_completion_or_clamp_overdue_day():
    now = datetime(2026, 10, 16, tzinfo=timezone.utc)
    assert burndown_observation(10, 0, None, None, now)["actual"] == []
    result = burndown_observation(10, 0, now - timedelta(days=14), now - timedelta(days=4), now)
    assert result["actual"] == [{"day": 14, "remaining": 0.0}]
    assert result["elapsed_days"] == 14
