"""Same-generation progress facts and explicit bounded complete-scope proof."""

import json
from collections import defaultdict, deque

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import LargeBinary, case, cast, func, or_, select

from . import sql_models as m
from .delivery_contract import ProgressRequirementFact, ProgressTaskFact
from .delivery_progress_facts import STATUSES, fact_basis
from .delivery_progress_json import empty_budget, fail, invalid_fact, scope_filter
from .delivery_query_read import _stamp, _unchanged, metadata
from .delivery_service import stamp

MAX_TASKS = 10000
MAX_BYTES = 16 * 1024 * 1024
MAX_ITEM_BYTES = 1024 * 1024


def current_stamp(db, project, generation=None):
    current = _stamp(db, project)
    if generation is not None and current["generation"] != generation:
        fail("delivery_query_cursor_stale", "Current progress changed; reload its first page")
    for model, kind in ((m.Task, "progress_task"), (m.Requirement, "progress_requirement")):
        fact = m.DeliveryQueryFact
        canonical = db.scalar(select(func.count()).select_from(model).where(*scope_filter(project, model)))
        projected = db.scalar(select(func.count()).select_from(m.DeliveryQueryFact).where(
            *scope_filter(project, m.DeliveryQueryFact), m.DeliveryQueryFact.kind == kind))
        if canonical != projected:
            fail("delivery_query_rebuild_required", "Complete current progress facts require an explicit rebuild")
        actual = select(model.id).where(*scope_filter(project, model), model.id == fact.entity_id).exists()
        invalid = invalid_fact(fact.data, "tasks" if kind == "progress_task" else "requirements", identity=fact.entity_id, current=True)
        if db.execute(select(fact.entity_id).where(*scope_filter(project, fact), fact.kind == kind,
                or_(~actual, invalid)).limit(1)).first():
            fail("delivery_query_rebuild_required", "Current progress identities or required fact shapes cannot be verified; rebuild explicitly")
    return current


def selected_scope(db, project, kind="project", identity="", *, fallback=None):
    if kind not in {"project", "milestone", "sprint"} or (kind == "project" and identity) or (kind != "project" and not identity):
        fail("progress_scope_invalid", "Choose project without an ID or a named milestone/sprint", 422)
    if kind == "project":
        return {"kind": kind, "id": "", "label": project.name}, True
    value = db.scalar(select(m.DeliveryQueryFact.data).where(*scope_filter(project, m.DeliveryQueryFact),
        m.DeliveryQueryFact.kind == kind, m.DeliveryQueryFact.entity_id == identity))
    if value is None:
        if fallback:
            return fallback, False
        fail("progress_scope_missing", "This current progress scope was not found", 404)
    return {"kind": kind, "id": identity, "label": value.get("title") or identity}, True


def task_query(project, selected):
    fact = m.DeliveryQueryFact
    query = select(fact.entity_id, fact.data).where(*scope_filter(project, fact), fact.kind == "progress_task")
    if selected["kind"] != "project":
        query = query.where(fact.data["milestone_id" if selected["kind"] == "milestone" else "sprint_id"].as_string() == selected["id"])
    return query


def requirement_query(project, selected):
    fact = m.DeliveryQueryFact
    query = select(fact.entity_id, fact.data).where(*scope_filter(project, fact), fact.kind == "progress_requirement")
    if selected["kind"] != "project":
        tasks = task_query(project, selected).subquery("scope_parent_tasks")
        query = query.where(or_(fact.data["milestone_id" if selected["kind"] == "milestone" else "sprint_id"].as_string() == selected["id"],
            fact.entity_id.in_(select(tasks.c.data["req_id"].as_string()))))
    return query


def scope_metrics(db, project, selected, *, available=True):
    tasks = task_query(project, selected).subquery("current_progress_tasks")
    requirements = requirement_query(project, selected).subquery("current_progress_requirements")
    if not available:
        counts, req = {}, (0, 0, 0)
    else:
        counts = dict(db.execute(select(tasks.c.data["status"].as_string(), func.count()).group_by(tasks.c.data["status"].as_string())).all())
        if set(counts) - set(STATUSES):
            fail("delivery_query_rebuild_required", "Current progress status facts are invalid; rebuild explicitly")
        req = db.execute(select(func.count(),
            func.coalesce(func.sum(case((requirements.c.data["accepted"].as_boolean().is_(True), 1), else_=0)), 0),
            func.coalesce(func.sum(case((requirements.c.data["released"].as_boolean().is_(True), 1), else_=0)), 0)).select_from(requirements)).one()
    statuses = {name: counts.get(name, 0) for name in STATUSES}
    total = sum(statuses.values())
    return {"tasks_total": total, "recorded_completed": statuses["recorded_completed"], "verified_completed": statuses["verified_completed"],
        "awaiting_review": statuses["awaiting_review"], "remaining": total - statuses["verified_completed"],
        "requirements_total": req[0], "requirements_accepted": req[1], "requirements_released": req[2], "status_counts": statuses}


def _closure(db, project, task_ids, requirement_ids, budget):
    from .delivery_progress_proof import release_closure

    wanted, parents, loaded, plans_bytes = set(task_ids), set(requirement_ids), set(), 0
    dependencies = {}
    for _ in range(MAX_TASKS + 1):
        previous_parents = len(parents)
        rows = db.execute(select(m.Task.id, m.Task.req_id).where(*scope_filter(project, m.Task),
            or_(m.Task.id.in_(wanted), m.Task.req_id.in_(parents))).limit(MAX_TASKS + 1)).all()
        if len(rows) > MAX_TASKS or len(wanted) > MAX_TASKS:
            budget["closure_task_count"] = max(len(rows), len(wanted))
            return None, None, "progress_proof_task_budget", plans_bytes
        found = {row.id for row in rows}
        if wanted - found:
            return None, None, "progress_proof_dependency_missing", plans_bytes
        wanted.update(found)
        parents.update(row.req_id for row in rows if row.req_id)
        released_tasks, released_requirements = release_closure(db, project, parents)
        if released_tasks is None:
            return None, None, "progress_proof_task_budget", plans_bytes
        wanted.update(released_tasks)
        parents.update(released_requirements)
        if len(parents) > MAX_TASKS:
            budget["requirement_count"] = len(parents)
            return None, None, "progress_proof_requirement_budget", plans_bytes
        fresh = sorted(found - loaded)
        if not fresh and wanted <= loaded and len(parents) == previous_parents:
            break
        if not fresh:
            continue
        for offset in range(0, len(fresh), 100):
            group = fresh[offset:offset + 100]
            paths = [m.DeliveryWorkspace.data[("task_details", tid, "depends_on")] for tid in group]
            sizes = db.execute(select(*[func.length(cast(path, LargeBinary)) for path in paths])
                .where(*scope_filter(project, m.DeliveryWorkspace))).first()
            if sizes:
                plans_bytes += sum(value or 0 for value in sizes)
                if max(value or 0 for value in sizes) > MAX_ITEM_BYTES or plans_bytes > MAX_BYTES:
                    budget["bytes_used"] = plans_bytes
                    return None, None, "progress_proof_bytes_budget", plans_bytes
            values = db.execute(select(*paths).where(*scope_filter(project, m.DeliveryWorkspace))).first()
            types = db.execute(select(*[func.json_type(m.DeliveryWorkspace.data, '$."task_details".' + json.dumps(tid) + '."depends_on"') for tid in group])
                .where(*scope_filter(project, m.DeliveryWorkspace))).first() if db.bind.dialect.name == "sqlite" else None
            for index, tid in enumerate(group):
                value = values[index] if values else None
                present = types[index] if types else None
                if value is None and present is None:
                    value = []
                if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
                    return None, None, "progress_proof_dependency_invalid", plans_bytes
                wanted.update(value)
                dependencies[tid] = set(value)
        loaded.update(fresh)
    if len(wanted) > MAX_TASKS:
        budget["closure_task_count"] = len(wanted)
        return None, None, "progress_proof_task_budget", plans_bytes
    budget.update(closure_task_count=len(wanted), requirement_count=len(parents))
    dependents, degree, depth = defaultdict(set), {}, {}
    for identity, values in dependencies.items():
        degree[identity] = len(values)
        for predecessor in values:
            dependents[predecessor].add(identity)
    ready = deque(identity for identity, value in degree.items() if not value)
    while ready:
        identity = ready.popleft()
        depth.setdefault(identity, 1)
        if depth[identity] > 64:
            return None, None, "progress_proof_dependency_depth", plans_bytes
        for following in dependents[identity]:
            depth[following] = max(depth.get(following, 1), depth[identity] + 1)
            degree[following] -= 1
            if not degree[following]:
                ready.append(following)
    if any(degree.values()):
        return None, None, "progress_proof_dependency_cycle", plans_bytes
    actual_parents = set(db.scalars(select(m.Requirement.id).where(*scope_filter(project, m.Requirement), m.Requirement.id.in_(parents))))
    if parents - actual_parents:
        return None, None, "progress_proof_dependency_missing", plans_bytes
    return wanted, parents, None, plans_bytes


def freeze_proof(db, project, *, scope="project", scope_id="", internal=False):
    from .delivery_progress_json import sqlite_only

    sqlite_only(db)
    current = current_stamp(db, project)
    selected, _ = selected_scope(db, project, scope, scope_id)
    tasks, reqs = task_query(project, selected), requirement_query(project, selected)
    task_count = db.scalar(select(func.count()).select_from(tasks.subquery()))
    req_count = db.scalar(select(func.count()).select_from(reqs.subquery()))
    budget = empty_budget(task_count=task_count, requirement_count=req_count)
    result = {**metadata(db, project, current), "as_of": stamp(), "scope": selected,
        "available": False, "complete": False, "basis": None, "task_ids": None,
        "metrics": scope_metrics(db, project, selected), "budget": budget, "reasons": []}

    def unavailable(code):
        result["reasons"] = [{"code": code, "message": "The complete scope proof cannot be verified within its fixed budget; no partial scope can be frozen"}]
        _unchanged(db, project, current)
        return (result, set(), set(), None) if internal else result

    if task_count > MAX_TASKS:
        return unavailable("progress_proof_task_budget")
    if req_count > MAX_TASKS:
        return unavailable("progress_proof_requirement_budget")
    ids = set(db.scalars(tasks.with_only_columns(m.DeliveryQueryFact.entity_id)))
    parents = set(db.scalars(reqs.with_only_columns(m.DeliveryQueryFact.entity_id)))
    closure, required, error, plan_bytes = _closure(db, project, ids, parents, budget)
    if error:
        return unavailable(error)
    fact = m.DeliveryQueryFact
    sizes = db.execute(select(func.coalesce(func.sum(func.length(cast(fact.data, LargeBinary))), 0),
        func.coalesce(func.max(func.length(cast(fact.data, LargeBinary))), 0)).where(*scope_filter(project, fact),
            or_(and_kind(fact, "progress_task", closure), and_kind(fact, "progress_requirement", required)))).one()
    budget["bytes_used"] = sizes[0] + plan_bytes
    if sizes[1] > MAX_ITEM_BYTES or budget["bytes_used"] > MAX_BYTES:
        return unavailable("progress_proof_bytes_budget")
    task_values = [value for _, value in db.execute(tasks.order_by(fact.entity_id))]
    req_values = [value for _, value in db.execute(reqs.order_by(fact.entity_id))]
    try:
        for value in task_values:
            ProgressTaskFact.model_validate(value, strict=True)
        for value in req_values:
            ProgressRequirementFact.model_validate(value, strict=True)
    except (ValidationError, TypeError, ValueError):
        return unavailable("progress_proof_source_unavailable")
    value = {"scope": selected, "tasks": task_values, "requirements": req_values, "task_ids": [item["id"] for item in task_values]}
    semantic = {**value, "tasks": [{key: item for key, item in task.items() if key != "assigned_to"} for task in task_values]}
    from .delivery_progress_proof import canonical_scope

    try:
        canonical_facts, canonical = canonical_scope(db, project, {"scope": selected, "budget": budget}, closure, required, budget=budget)
    except HTTPException as exc:
        code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
        return unavailable(code if code and code.startswith("progress_proof_") else "progress_proof_source_unavailable")
    if canonical["basis"] != fact_basis(semantic):
        return unavailable("progress_proof_source_changed")
    result.update(available=True, complete=True, basis=fact_basis(semantic), task_ids=value["task_ids"])
    _unchanged(db, project, current)
    return (result, closure, required, (canonical_facts, canonical)) if internal else result


def and_kind(fact, kind, identities):
    from sqlalchemy import and_

    return and_(fact.kind == kind, fact.entity_id.in_(identities))
