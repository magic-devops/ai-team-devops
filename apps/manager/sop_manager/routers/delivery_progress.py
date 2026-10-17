"""Honest progress series: current observations are not historical measurements."""

from datetime import date, datetime, timedelta, timezone
from math import ceil


def burndown_observation(total, remaining, started, ends, now=None):
    now = now or datetime.now(timezone.utc)
    started = started.replace(tzinfo=timezone.utc) if started and not started.tzinfo else started
    ends = ends.replace(tzinfo=timezone.utc) if ends and not ends.tzinfo else ends
    valid_dates = bool(started and ends and ends > started)
    span = max(1, ceil((ends - started).total_seconds() / 86400)) if valid_dates else 0
    elapsed = max(0, (now - started).days) if started else 0
    # Two endpoints define the ideal line without allocating unbounded daily arrays.
    ideal = [{"day": 0, "remaining": float(total)}, {"day": span, "remaining": 0.0}] if valid_dates else []
    actual = [{"day": elapsed, "remaining": float(remaining)}] if valid_dates and now >= started else []
    return {
        "span_days": span,
        "elapsed_days": elapsed,
        "ideal": ideal,
        "actual": actual,
        "history_available": False,
        "observed_at": now.isoformat(),
        "basis": "current_scope",
    }


def sprint_burndown_history(db, sprint, started, ends, *, now=None):
    """Adapt the durable progress source for legacy numeric-day Sprint consumers."""
    from fastapi import HTTPException

    from .delivery_progress_query import progress
    from .sql_models import Project

    now = now or datetime.now(timezone.utc)
    now = now.replace(tzinfo=timezone.utc) if not now.tzinfo else now.astimezone(timezone.utc)
    started = started.replace(tzinfo=timezone.utc) if started and not started.tzinfo else started
    ends = ends.replace(tzinfo=timezone.utc) if ends and not ends.tzinfo else ends
    started = started.astimezone(timezone.utc) if started else None
    ends = ends.astimezone(timezone.utc) if ends else None
    valid_dates = bool(started and ends and ends > started)
    today = now.date()
    if started and started.date() > today:
        range_start = started.date()
        range_end = min(ends.date(), range_start + timedelta(days=365)) if valid_dates else range_start
        truncated = bool(valid_dates and range_end < ends.date())
    else:
        range_start = (
            max(started.date(), today - timedelta(days=365)) if started else today - timedelta(days=29)
        )
        range_end = today
        truncated = bool(started and range_start > started.date())
    project = db.get(Project, sprint.project_id)
    if project is None or project.tenant_id != sprint.tenant_id:
        raise HTTPException(404, "Sprint project not found")
    result = progress(
        db, project, starts_on=range_start, ends_on=range_end, scope="sprint", scope_id=sprint.id, now=now
    )
    current = result["current"]["metrics"]
    elapsed = max(0, (today - started.date()).days) if started else 0
    span = max(1, (ends.date() - started.date()).days) if valid_dates else 0
    actual = (
        [
            {
                "day": (date.fromisoformat(point["date"]) - started.date()).days,
                "remaining": float(point["metrics"]["remaining"]),
                "date": point["date"],
                "observation_id": point["observation_id"],
                "observed_at": point["observed_at"],
                "source": point["source"],
                "metrics": point["metrics"],
            }
            for point in result["days"]
            if point["metrics"] is not None
        ]
        if valid_dates
        else []
    )
    return {
        "span_days": span,
        "elapsed_days": elapsed,
        "ideal": [{"day": 0, "remaining": float(current["tasks_total"])}, {"day": span, "remaining": 0.0}]
        if valid_dates
        else [],
        "actual": actual,
        "history_available": result["coverage"]["first_observed_at"] is not None,
        "observed_at": result["as_of"],
        "basis": "current_scope",
        "unit": "tasks",
        "remaining_basis": "verified_completion",
        "actual_basis": "persisted_observations",
        "current_metrics": current,
        "current_observation": {
            "day": elapsed if valid_dates and now >= started else None,
            "remaining": float(current["remaining"]),
            "observed_at": result["as_of"],
            "observation_id": None,
            "source": "live",
            "metrics": current,
        },
        "coverage": {**result["coverage"], "range": result["range"], "window_truncated": truncated},
    }
