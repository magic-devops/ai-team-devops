"""Small truthful UTC progress series; fixed originals have independent SQL pages."""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select, true

from . import sql_models as m
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_progress_baseline import timestamp
from .delivery_progress_current import current_stamp, scope_metrics, selected_scope
from .delivery_progress_json import (
    baseline_metadata,
    counts_metrics,
    fail,
    field,
    items_query,
    scope_filter,
    source,
    sqlite_only,
)
from .delivery_progress_json import (
    metadata as source_metadata,
)
from .delivery_query_read import _unchanged, metadata
from .delivery_service import stamp


def _observation_scope(project):
    return scope_filter(project, m.DeliveryProgressObservation)


def _scope_valid(scope, scope_id):
    if scope not in {"project", "milestone", "sprint"} or (scope == "project" and scope_id) or (scope != "project" and not scope_id):
        fail("progress_scope_invalid", "Choose project without an ID or a named milestone/sprint", 422)


def _range(starts_on, ends_on, today):
    end = ends_on or today
    start = starts_on or end - timedelta(days=29)
    if start > end or (end - start).days >= 366:
        fail("progress_range_invalid", "Use an ordered date range of at most 366 UTC days", 422)
    return start, end


def _dates(start, end):
    return [start + timedelta(days=index) for index in range((end - start).days + 1)]


def _scope_observations(project, scope, scope_id):
    model = m.DeliveryProgressObservation
    query = select(model.seq, model.id, model.observed_day, model.observed_at, model.source).where(*_observation_scope(project))
    if scope != "project":
        collection = "milestones" if scope == "milestone" else "sprints"
        scopes = func.json_each(model.data, '$.scopes.' + collection).table_valued("key", "value", "type").alias("observed_scopes")
        query = query.where(select(1).select_from(scopes).where(field(scopes, "id") == scope_id).exists())
    return query


def _coverage_bounds(db, project, scope, scope_id):
    if scope != "project":
        sqlite_only(db)
    rows = _scope_observations(project, scope, scope_id).subquery("coverage_observations")
    return db.execute(select(func.min(rows.c.observed_at), func.max(rows.c.observed_at))).one()


def _daily_observations(db, project, scope, scope_id, start, end):
    rows = _scope_observations(project, scope, scope_id).where(
        m.DeliveryProgressObservation.observed_day >= start.isoformat(), m.DeliveryProgressObservation.observed_day <= end.isoformat()
    ).subquery("valid_observations")
    ranked = select(*rows.c, func.row_number().over(partition_by=rows.c.observed_day,
        order_by=(rows.c.observed_at.desc(), rows.c.seq.desc())).label("daily_rank")).subquery("daily_ranked")
    return db.execute(select(ranked).where(ranked.c.daily_rank == 1).order_by(ranked.c.observed_day)).mappings().all()


def _remaining(db, project, original, baseline_id):
    baseline = m.DeliveryProgressBaseline
    fixed = func.json_each(baseline.data, '$.task_ids').table_valued("key", "value", "type").alias("baseline_ids")
    tasks, tq = items_query(original, "tasks", "verified_historical_tasks")
    verified = tq.with_only_columns(1).where(field(tasks, "status") == "verified_completed", field(tasks, "id") == fixed.c.value).exists()
    return db.scalar(select(func.count()).select_from(baseline).join(fixed, true()).where(
        *scope_filter(project, baseline), baseline.id == baseline_id, ~verified))


def _ideal(baseline, start, end):
    if not baseline or not baseline["starts_on"] or not baseline["ends_on"] or baseline["task_count"] is None:
        return []
    plan_start, plan_end = date.fromisoformat(baseline["starts_on"]), date.fromisoformat(baseline["ends_on"])
    span, total = (plan_end - plan_start).days, baseline["task_count"]
    return [{"date": day.isoformat(), "remaining": round(total * (plan_end - day).days / span, 6) if span else 0.0}
        for day in _dates(max(start, plan_start), min(end, plan_end))] if max(start, plan_start) <= min(end, plan_end) else []


def progress(db, project, *, starts_on=None, ends_on=None, scope="project", scope_id="", baseline_id="", now=None):
    sqlite_only(db)
    _scope_valid(scope, scope_id)
    now = now or datetime.now(timezone.utc)
    start, end = _range(starts_on, ends_on, now.date())
    current = current_stamp(db, project)
    baseline = None
    if baseline_id:
        original = source(db, project, "baseline", baseline_id)
        if original["scope"]["kind"] != scope or original["scope"]["id"] != scope_id:
            fail("progress_baseline_scope_invalid", "Choose the baseline's original scope", 422)
        baseline = baseline_metadata(db, original)
        if not baseline["available"]:
            fail("progress_snapshot_unavailable", "The selected baseline cannot be verified")
    selected, available = selected_scope(db, project, scope, scope_id, fallback=baseline["scope"] if baseline else None)
    metrics = scope_metrics(db, project, selected, available=available)
    rows = _daily_observations(db, project, scope, scope_id, start, min(end, now.date())) if start <= min(end, now.date()) else []
    by_day = {}
    for row in rows:
        original = source(db, project, "observation", row["id"], scope=scope, scope_id=scope_id)
        by_day[row["observed_day"]] = {"date": row["observed_day"], "observation_id": row["id"],
            "observed_at": timestamp(row["observed_at"]), "source": row["source"], "metrics": counts_metrics(db, original),
            "baseline_remaining": _remaining(db, project, original, baseline_id) if baseline else None}
    first, last = _coverage_bounds(db, project, scope, scope_id)
    days, observed, missing, future = [], [], [], []
    for day in _dates(start, end):
        key = day.isoformat()
        if key in by_day and day <= now.date():
            observed.append(key)
            days.append(by_day[key])
        else:
            (future if day > now.date() else missing).append(key)
            days.append({"date": key, "observation_id": None, "observed_at": None, "source": None, "metrics": None, "baseline_remaining": None})
    _unchanged(db, project, current)
    return {**metadata(db, project, current), "as_of": timestamp(now), "timezone": "UTC", "scope": selected,
        "range": {"starts_on": start.isoformat(), "ends_on": end.isoformat()}, "current": {"scope": selected, "metrics": metrics},
        "coverage": {"first_observed_at": timestamp(first), "last_observed_at": timestamp(last),
            "observed_days": observed, "missing_days": missing, "future_days": future},
        "days": days, "baseline": baseline, "ideal": _ideal(baseline, start, end)}


def observation_detail(db, project, observation_id, *, scope="project", scope_id=""):
    _scope_valid(scope, scope_id)
    return source_metadata(db, project, "observation", observation_id, scope=scope, scope_id=scope_id)


def baseline_detail(db, project, baseline_id):
    return source_metadata(db, project, "baseline", baseline_id)


def baselines(db, project, user, *, scope="project", scope_id="", limit=20, cursor=""):
    sqlite_only(db)
    _scope_valid(scope, scope_id)
    if type(limit) is not int or not 1 <= limit <= 100:
        fail("progress_page_invalid", "Choose a page size between 1 and 100", 422)
    model = m.DeliveryProgressBaseline
    filters = (*scope_filter(project, model), model.scope_kind == scope, model.scope_id == scope_id)
    signature = [project.tenant_id, project.id, user.id, "progress-baselines", scope, scope_id, limit]
    if cursor:
        upper, after = decode_cursor(cursor, signature)
        if (len(upper) != 2 or type(upper[0]) is not int or upper[0] < 0 or not isinstance(upper[1], str)
                or len(after) != 2 or not all(isinstance(value, str) for value in after)):
            fail("progress_cursor_invalid", "Invalid baseline catalogue cursor", 422)
        try:
            previous = datetime.fromisoformat(after[0])
        except ValueError:
            fail("progress_cursor_invalid", "Invalid baseline catalogue position", 422)
    else:
        upper, after = [db.scalar(select(func.max(model.source_version)).where(*filters)) or 0, stamp()], None
    query = select(model.id, model.created_at).where(*filters, model.source_version <= upper[0])
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    if after:
        query = query.where(or_(model.created_at < previous, and_(model.created_at == previous, model.id < after[1])))
    rows = db.execute(query.order_by(model.created_at.desc(), model.id.desc()).limit(limit + 1)).all()
    items = [baseline_metadata(db, source(db, project, "baseline", row.id)) for row in rows[:limit]]
    if items:
        selected = items[0]["scope"]
    else:
        first = db.scalar(select(model.id).where(*filters).order_by(model.created_at.desc(), model.id.desc()).limit(1))
        selected = source(db, project, "baseline", first)["scope"] if first else selected_scope(db, project, scope, scope_id)[0]
    return {"project_id": project.id, "as_of": upper[1], "scope": selected, "items": items, "total": total, "limit": limit,
        "next_cursor": encode_cursor(signature, upper, [rows[limit - 1].created_at.isoformat(), rows[limit - 1].id]) if len(rows) > limit else None}
