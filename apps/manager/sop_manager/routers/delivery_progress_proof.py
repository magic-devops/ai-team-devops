"""Measured original inputs for complete, selected canonical progress proof."""

from copy import deepcopy

from sqlalchemy import func, select, true
from sqlalchemy.orm import load_only

from . import sql_models as m
from .delivery_input_budget import CanonicalInputBudget
from .delivery_progress_json import fail, field, scope_filter

MAX_TASKS = 10000
MAX_BYTES = 16 * 1024 * 1024
MAX_ITEM_BYTES = 1024 * 1024


def release_inputs(db, project, requirement_ids):
    """Only active candidates intersecting this proof can add dependencies."""
    workspace = m.DeliveryWorkspace
    rows = (
        func.json_each(workspace.data, "$.release_candidates")
        .table_valued("key", "value", "type")
        .alias("proof_candidates")
    )
    requirements = (
        func.json_each(rows.c.value, "$.snapshot.selected.requirement_ids")
        .table_valued("value")
        .alias("candidate_requirements")
    )
    match = select(1).select_from(requirements).where(requirements.c.value.in_(requirement_ids)).exists()
    return (
        select(
            rows.c.key,
            field(rows, "id").label("id"),
            func.json_extract(rows.c.value, "$.snapshot.ci.id").label("evidence_id"),
        )
        .select_from(workspace)
        .join(rows, true())
        .where(
            *scope_filter(project, workspace),
            rows.c.type == "object",
            field(rows, "decision") == "approved",
            func.coalesce(field(rows, "invalidated"), 0) == 0,
            match,
        )
    )


def release_closure(db, project, requirements):
    candidates = release_inputs(db, project, requirements).subquery("required_candidates")
    workspace = m.DeliveryWorkspace
    rows = (
        func.json_each(workspace.data, "$.release_candidates")
        .table_valued("key", "value", "type")
        .alias("closure_candidates")
    )
    result = []
    for collection in ("task_ids", "requirement_ids"):
        ids = (
            func.json_each(rows.c.value, "$.snapshot.selected." + collection)
            .table_valued("value", "type")
            .alias("release_" + collection)
        )
        query = (
            select(ids.c.value, ids.c.type)
            .select_from(workspace)
            .join(rows, true())
            .join(ids, true())
            .where(*scope_filter(project, workspace), rows.c.key.in_(select(candidates.c.key)))
            .distinct()
            .limit(MAX_TASKS + 1)
        )
        values = db.execute(query).all()
        if len(values) > MAX_TASKS or any(kind != "text" or not value for value, kind in values):
            return None, None
        result.append({value for value, _ in values})
    return tuple(result)


def _array_originals(db, project, loader, collection, identities, key="id"):
    rows = (
        func.json_each(m.DeliveryWorkspace.data, "$." + collection)
        .table_valued("key", "value", "type")
        .alias("original_" + collection)
    )
    positions = db.scalars(
        select(rows.c.key)
        .select_from(m.DeliveryWorkspace)
        .join(rows, true())
        .where(*scope_filter(project, m.DeliveryWorkspace), field(rows, key).in_(identities))
        .limit(MAX_TASKS + 1)
    ).all()
    if len(positions) > MAX_TASKS:
        fail("progress_proof_task_budget", "The complete proof contains too many original sources", 413)
    result = loader.paths({position: (collection, position) for position in positions})
    if any(not isinstance(value, dict) for value in result.values()):
        fail("progress_proof_source_unavailable", "A necessary canonical source is not an object")
    return list(result.values())


def canonical_scope(db, project, proof, task_ids, requirement_ids, *, budget=None):
    """GET proof and write recheck share exactly the same bounded canonical inputs."""
    from .delivery_progress_baseline import _validate_associations
    from .delivery_progress_facts import _facts_from_evaluation, select_scope
    from .delivery_quality_scope import _Scope
    from .delivery_service import materialize, reconcile

    tracker = CanonicalInputBudget(budget or deepcopy(proof["budget"]), code="progress_proof_bytes_budget")
    loader = _Scope(db, project, requirement_ids, task_ids, MAX_TASKS, input_budget=tracker)
    plans = loader.paths({identity: ("task_details", identity) for identity in sorted(task_ids)})
    flows = loader.paths({identity: ("flows", identity) for identity in sorted(requirement_ids)})
    context = loader.context()
    if set(context.tasks) != task_ids or set(context.requirements) != requirement_ids:
        fail(
            "progress_proof_source_changed", "The complete canonical proof closure changed; reload the proof"
        )
    selected = deepcopy(loader.data)
    selected["project"] = loader.paths({"project": ("project",)})["project"] or {}
    selected["task_details"] = {
        identity: value if value is not None else {} for identity, value in plans.items()
    }
    selected["flows"] = {identity: value for identity, value in flows.items() if value is not None}
    candidates = db.execute(release_inputs(db, project, requirement_ids).limit(MAX_TASKS + 1)).all()
    if len(candidates) > MAX_TASKS:
        fail("progress_proof_task_budget", "The complete proof contains too many release sources", 413)
    candidate_ids, evidence_ids = {row.id for row in candidates}, {row.evidence_id for row in candidates}
    selected["release_candidates"] = list(
        loader.paths({row.key: ("release_candidates", row.key) for row in candidates}).values()
    )
    selected["ci_evidence"] = _array_originals(db, project, loader, "ci_evidence", evidence_ids)
    selected["deployments"] = _array_originals(
        db, project, loader, "deployments", candidate_ids, "candidate_id"
    )
    if candidate_ids:
        selected["release_policy"] = loader.paths({"policy": ("release_policy",)})["policy"]
    milestones = {flow.get("milestone_id") for flow in selected["flows"].values()} - {None, ""}
    if proof["scope"]["kind"] == "milestone":
        milestones.add(proof["scope"]["id"])
    selected["milestones"] = _array_originals(db, project, loader, "milestones", milestones)
    sprint_ids = {
        row.sprint_id for row in (*context.tasks.values(), *context.requirements.values()) if row.sprint_id
    }
    if proof["scope"]["kind"] == "sprint":
        sprint_ids.add(proof["scope"]["id"])
    columns = [m.Sprint.id, m.Sprint.goal]
    query = select(m.Sprint).where(*scope_filter(project, m.Sprint), m.Sprint.id.in_(sprint_ids))
    tracker.rows(db, query, columns)
    sprints = db.scalars(query.options(load_only(*columns))).all()
    scopes = {
        "milestones": selected["milestones"],
        "sprints": [{"id": row.id, "title": row.goal or row.id} for row in sprints],
    }
    context.data = selected
    reconcile(db, project, selected, verification=context)
    snapshot = materialize(db, project, selected, None, verification=context, progress_only=True)
    facts = _facts_from_evaluation(db, project, snapshot, context, scopes=scopes)
    current = select_scope(facts, proof["scope"]["kind"], proof["scope"]["id"])
    _validate_associations(facts, current)
    return facts, current
