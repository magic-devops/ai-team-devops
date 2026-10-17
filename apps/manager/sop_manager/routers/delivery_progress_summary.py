"""Light current project metrics and UTC coverage without loading observation facts."""

from datetime import datetime, timezone

from sqlalchemy import select

from .delivery_progress_baseline import timestamp
from .delivery_progress_query import _coverage_bounds, _dates, _observation_scope, _range
from .delivery_query_read import _stamp, _unchanged, metadata
from .sql_models import DeliveryProgressObservation


def progress_summary(db, project, *, starts_on=None, ends_on=None, now=None):
    stamp = _stamp(db, project)
    instant = now or datetime.now(timezone.utc)
    today = instant.date()
    start, end = _range(starts_on, ends_on, today)
    first, last = _coverage_bounds(db, project, "project", "")
    observed = set(
        db.scalars(
            select(DeliveryProgressObservation.observed_day)
            .where(
                *_observation_scope(project),
                DeliveryProgressObservation.observed_day >= start.isoformat(),
                DeliveryProgressObservation.observed_day <= min(end, today).isoformat(),
            )
            .distinct()
        ).all()
    )
    observed_days, missing_days, future_days = [], [], []
    for day in _dates(start, end):
        target = (
            future_days if day > today else observed_days if day.isoformat() in observed else missing_days
        )
        target.append(day.isoformat())
    _unchanged(db, project, stamp)
    return {
        **metadata(db, project, stamp),
        "as_of": timestamp(instant),
        "timezone": "UTC",
        "range": {"starts_on": start.isoformat(), "ends_on": end.isoformat()},
        "current": {"metrics": stamp["metrics"]},
        "coverage": {
            "first_observed_at": timestamp(first),
            "last_observed_at": timestamp(last),
            "observed_days": observed_days,
            "missing_days": missing_days,
            "future_days": future_days,
        },
    }
