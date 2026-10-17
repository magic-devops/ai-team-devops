"""Honest progress series: current observations are not historical measurements."""

from datetime import datetime, timezone
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
