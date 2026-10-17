"""Pure project-scoped reads of persistent UTC progress and immutable baselines."""

from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select

from .delivery_progress_baseline import baseline_view, compare_scope, get_baseline, timestamp
from .delivery_progress_facts import capture_facts, metrics, select_scope
from .sql_models import DeliveryProgressBaseline, DeliveryProgressObservation, DeliveryWorkspace

_METADATA_BATCH = 128


def _observation_scope(project):
    return (
        DeliveryProgressObservation.project_id == project.id,
        DeliveryProgressObservation.tenant_id == project.tenant_id,
    )


def _scope_projection(scope):
    collection = "milestones" if scope == "milestone" else "sprints"
    # Project only the small scope collection, never the lifetime task snapshots.
    return DeliveryProgressObservation.data["scopes"][collection].label("progress_scope_projection")


def _contains_scope(projected, scope_id):
    return isinstance(projected, list) and any(
        isinstance(item, dict) and item.get("id") == scope_id for item in projected
    )


def _scope_boundary(db, project, scope, scope_id, *, reverse=False):
    observation = DeliveryProgressObservation
    cursor = None
    while True:
        query = select(observation.observed_at, observation.seq, _scope_projection(scope)).where(
            *_observation_scope(project)
        )
        if cursor is not None:
            at, seq = cursor
            query = query.where(
                or_(observation.observed_at < at, and_(observation.observed_at == at, observation.seq < seq))
                if reverse
                else or_(
                    observation.observed_at > at, and_(observation.observed_at == at, observation.seq > seq)
                )
            )
        ordering = (
            (observation.observed_at.desc(), observation.seq.desc())
            if reverse
            else (observation.observed_at, observation.seq)
        )
        batch = db.execute(query.order_by(*ordering).limit(_METADATA_BATCH)).all()
        if not batch:
            return None
        for row in batch:
            if _contains_scope(row.progress_scope_projection, scope_id):
                return row.observed_at
        cursor = (batch[-1].observed_at, batch[-1].seq)


def _coverage_bounds(db, project, scope, scope_id):
    observation = DeliveryProgressObservation
    if scope == "project":
        return db.execute(
            select(func.min(observation.observed_at), func.max(observation.observed_at)).where(
                *_observation_scope(project)
            )
        ).one()
    first = _scope_boundary(db, project, scope, scope_id)
    return (
        (first, _scope_boundary(db, project, scope, scope_id, reverse=True))
        if first is not None
        else (None, None)
    )


def _daily_observations(db, project, scope, scope_id, start, end):
    if start > end:
        return []
    observation = DeliveryProgressObservation
    filters = (
        *_observation_scope(project),
        observation.observed_day >= start.isoformat(),
        observation.observed_day <= end.isoformat(),
    )
    if scope == "project":
        ranked = (
            select(
                observation.seq,
                func.row_number()
                .over(
                    partition_by=observation.observed_day,
                    order_by=(observation.observed_at.desc(), observation.seq.desc()),
                )
                .label("daily_rank"),
            )
            .where(*filters)
            .subquery()
        )
        query = (
            select(observation).join(ranked, observation.seq == ranked.c.seq).where(ranked.c.daily_rank == 1)
        )
    else:
        # A scope can disappear later on the same day. Find the latest *valid*
        # scope record using bounded, small projections before loading facts.
        projected = db.execute(
            select(
                observation.seq,
                observation.observed_day,
                _scope_projection(scope),
            )
            .where(*filters)
            .order_by(
                observation.observed_day,
                observation.observed_at.desc(),
                observation.seq.desc(),
            )
            .execution_options(stream_results=True)
        ).yield_per(_METADATA_BATCH)
        selected = {}
        try:
            for row in projected:
                if row.observed_day not in selected and _contains_scope(
                    row.progress_scope_projection, scope_id
                ):
                    selected[row.observed_day] = row.seq
        finally:
            projected.close()
        if not selected:
            return []
        query = select(observation).where(
            *_observation_scope(project), observation.seq.in_(selected.values())
        )
    # This is the only full-facts query: at most one observation per requested UTC date.
    return db.scalars(query.order_by(observation.observed_day)).all()


def _version(db, project):
    row = db.get(DeliveryWorkspace, project.id)
    return row.version if row else 0


def _scope_valid(scope, scope_id):
    if (
        scope not in {"project", "milestone", "sprint"}
        or (scope == "project" and scope_id)
        or (scope != "project" and not scope_id)
    ):
        raise HTTPException(422, "Choose a project scope without scope_id or a named milestone/sprint scope")


def _range(starts_on, ends_on, today):
    end = ends_on or today
    start = starts_on or end - timedelta(days=29)
    if start > end or (end - start).days >= 366:
        raise HTTPException(422, "Use an ordered date range of at most 366 UTC days")
    return start, end


def _dates(start, end):
    return [start + timedelta(days=index) for index in range((end - start).days + 1)]


def _remaining(tasks, task_ids):
    verified = {task["id"] for task in tasks if task["status"] == "verified_completed"}
    return len(set(task_ids) - verified)


def _current_scope(facts, scope, scope_id, baseline=None):
    try:
        return select_scope(facts, scope, scope_id)
    except HTTPException as exc:
        if exc.status_code != 404 or baseline is None:
            raise
        return {
            "scope": baseline["scope"],
            "tasks": [],
            "requirements": [],
            "task_ids": [],
            "basis": "",
            "metrics": metrics([], []),
        }


def _ideal(baseline, start, end):
    if not baseline or not baseline["starts_on"] or not baseline["ends_on"]:
        return []
    plan_start = date.fromisoformat(baseline["starts_on"])
    plan_end = date.fromisoformat(baseline["ends_on"])
    total = len(baseline["task_ids"])
    span = (plan_end - plan_start).days
    return (
        [
            {
                "date": day.isoformat(),
                "remaining": round(total * (plan_end - day).days / span, 6) if span else 0.0,
            }
            for day in _dates(max(start, plan_start), min(end, plan_end))
        ]
        if max(start, plan_start) <= min(end, plan_end)
        else []
    )


def progress(
    db, project, *, starts_on=None, ends_on=None, scope="project", scope_id="", baseline_id="", now=None
):
    _scope_valid(scope, scope_id)
    now = now or datetime.now(timezone.utc)
    start, end = _range(starts_on, ends_on, now.date())
    facts = capture_facts(db, project)
    selected = None
    if baseline_id:
        selected_row = get_baseline(db, project, baseline_id)
        if selected_row.scope_kind != scope or selected_row.scope_id != scope_id:
            raise HTTPException(422, "Choose the baseline's original project, milestone or sprint scope")
        selected = baseline_view(selected_row)
    current = _current_scope(facts, scope, scope_id, selected)
    rows = _daily_observations(db, project, scope, scope_id, start, min(end, now.date()))
    first_observed, last_observed = _coverage_bounds(db, project, scope, scope_id)
    baseline_rows = db.scalars(
        select(DeliveryProgressBaseline)
        .where(
            DeliveryProgressBaseline.project_id == project.id,
            DeliveryProgressBaseline.tenant_id == project.tenant_id,
            DeliveryProgressBaseline.scope_kind == scope,
            DeliveryProgressBaseline.scope_id == scope_id,
        )
        .order_by(DeliveryProgressBaseline.created_at.desc(), DeliveryProgressBaseline.id.desc())
    ).all()
    by_day = {}
    for row in rows:
        try:
            historical = select_scope(row.data, scope, scope_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            continue
        by_day[row.observed_day] = (row, historical)
    days = []
    observed_days, missing_days, future_days = [], [], []
    for day in _dates(start, end):
        key = day.isoformat()
        pair = by_day.get(key) if day <= now.date() else None
        if pair:
            row, historical = pair
            observed_days.append(key)
            days.append(
                {
                    "date": key,
                    "observation_id": row.id,
                    "observed_at": timestamp(row.observed_at),
                    "source": row.source,
                    "metrics": historical["metrics"],
                    "baseline_remaining": _remaining(historical["tasks"], selected["task_ids"])
                    if selected
                    else None,
                }
            )
        else:
            (future_days if day > now.date() else missing_days).append(key)
            days.append(
                {
                    "date": key,
                    "observation_id": None,
                    "observed_at": None,
                    "source": None,
                    "metrics": None,
                    "baseline_remaining": None,
                }
            )
    return {
        "project_id": project.id,
        "version": _version(db, project),
        "as_of": timestamp(now),
        "timezone": "UTC",
        "scope": current["scope"],
        "range": {"starts_on": start.isoformat(), "ends_on": end.isoformat()},
        "scopes": facts["scopes"],
        "current": current,
        "coverage": {
            "first_observed_at": timestamp(first_observed),
            "last_observed_at": timestamp(last_observed),
            "observed_days": observed_days,
            "missing_days": missing_days,
            "future_days": future_days,
        },
        "days": days,
        "baselines": [baseline_view(row, summary=True) for row in baseline_rows],
        "baseline": selected,
        "comparison": compare_scope(selected, current) if selected else None,
        "ideal": _ideal(selected, start, end),
    }


def observation_detail(db, project, observation_id, *, scope="project", scope_id=""):
    _scope_valid(scope, scope_id)
    row = db.scalar(
        select(DeliveryProgressObservation).where(
            DeliveryProgressObservation.id == observation_id,
            DeliveryProgressObservation.project_id == project.id,
            DeliveryProgressObservation.tenant_id == project.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(404, "Progress observation not found in this project")
    frozen = select_scope(row.data, scope, scope_id)
    return {
        "id": row.id,
        "project_id": project.id,
        "observed_at": timestamp(row.observed_at),
        "observed_day": row.observed_day,
        "source": row.source,
        "actor": row.actor,
        "source_version": row.source_version,
        "scope": frozen["scope"],
        "current": frozen,
    }


def baseline_detail(db, project, baseline_id, *, now=None):
    row = get_baseline(db, project, baseline_id)
    frozen = baseline_view(row)
    facts = capture_facts(db, project)
    # Deleting a scope must preserve the historical plan and labels.
    current = _current_scope(facts, row.scope_kind, row.scope_id, frozen)
    return {
        "project_id": project.id,
        "version": _version(db, project),
        "as_of": timestamp(now or datetime.now(timezone.utc)),
        "baseline": frozen,
        "current": current,
        "comparison": compare_scope(frozen, current),
    }
