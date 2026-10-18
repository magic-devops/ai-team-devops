"""Commit-free canonical event business effects, shared with direct sync."""

from types import SimpleNamespace

from fastapi import HTTPException

from sop_manager.task_acceptance import normalize_task_acceptance
from sop_manager.task_owner import validate_task_owner_values

from . import sql_models as m
from .event_common import digest, fail, now, scope

FIELDS = {
    "tasks": {
        "title",
        "description",
        "acceptance_criteria",
        "status",
        "priority",
        "estimate",
        "owner_id",
        "actual_hours",
        "confidence",
        "human_notes",
        "req_id",
        "sprint_id",
    },
    "requirements": {
        "title",
        "description",
        "status",
        "priority",
        "sprint_id",
        "story_points",
        "acceptance_criteria",
        "tags",
        "human_notes",
        "confidence",
    },
    "issues": {"title", "description", "type", "severity", "status", "task_id", "sprint_id", "resolution"},
    "sprints": {
        "goal",
        "status",
        "planned_points",
        "velocity",
        "completion_rate",
        "retrospective",
        "started_at",
        "ends_at",
    },
}
MODELS = {"tasks": m.Task, "requirements": m.Requirement, "issues": m.Issue, "sprints": m.Sprint}


def _references(db, project, values):
    for key, model in (("req_id", m.Requirement), ("task_id", m.Task), ("sprint_id", m.Sprint)):
        value = values.get(key)
        if value and db.query(model).filter(*scope(project, model), model.id == value).first() is None:
            fail("event_reference_missing", "Reference not found in this project", 404)


def _issue(db, project, user, data, body, key):
    _references(db, project, body.model_dump())
    iid = "ISSUE-" + digest("\0".join([project.tenant_id, project.id, user.id, key]))[:32]
    if db.get(m.Issue, iid) is not None:
        fail("event_target_conflict", "Issue target already exists")
    row = m.Issue(
        id=iid,
        tenant_id=project.tenant_id,
        project_id=project.id,
        reported_by=user.username,
        status="open",
        **body.model_dump(),
    )
    db.add(row)
    return iid, None, {"issue_id": iid}


def _task_guard(db, project, data, row, values, *, deleting=False):
    from .delivery_service import _require_task_transition

    changed = row is None or deleting or any(values[key] != getattr(row, key) for key in values)
    requirements = {row.req_id if row else "", values.get("req_id", "")}
    if changed and any(
        data.get("flows", {}).get(rid, {}).get("stage") in {"release", "operations"} for rid in requirements
    ):
        raise HTTPException(409, "Reopen the requirement before changing accepted work")
    if row is not None and not deleting:
        _require_task_transition(db, project, data, row, SimpleNamespace(status=values.get("status")))


def _requirement_guard(db, project, data, row, values):
    if "status" in values and values["status"] != (row.status if row else "pending"):
        fail(
            "event_requirement_stage_required", "Change requirement status through delivery stage review", 422
        )
    if row is not None:
        from .delivery_contract import RequirementEdit
        from .delivery_requirement_history import require_change_preview

        definition = {
            key: values[key] for key in ("title", "description", "acceptance_criteria") if key in values
        }
        require_change_preview(db, project, data, row, RequirementEdit(id=row.id, **definition))


def _reconcile_sync(db, project, data):
    from .delivery_service import reconcile

    revisions = {rid: flow["revision"] for rid, flow in data["flows"].items()}
    # Preserve the original approved definition/work until canonical reconciliation
    # invalidates it. remember_basis must only run after this comparison.
    db.flush()
    current = reconcile(db, project, data)
    for rid, flow in current["flows"].items():
        if flow["revision"] != revisions.get(rid, flow["revision"]):
            requirement = db.get(m.Requirement, rid)
            if requirement is not None:
                requirement.status = "pending"
    data.clear()
    data.update(current)


def _new_record(db, project, model, rid, values):
    required = "goal" if model is m.Sprint else "title"
    if not isinstance(values.get(required), str) or not values[required].strip():
        fail("event_record_invalid", "Creation requires a nonempty " + required, 422)
    if model is m.Task and values.get("status") == "completed":
        fail("event_record_invalid", "New Task completion requires explicit delivery review", 422)
    row = model(id=rid, tenant_id=project.tenant_id, project_id=project.id)
    db.add(row)
    return row


def _assign_record(db, user, row, model, values):
    from .sync_api import _coerce_column_value

    for key, value in values.items():
        if value is None:
            fail("event_record_invalid", "Explicit null canonical fields are unsupported", 422)
        setattr(row, key, _coerce_column_value(model.__table__.c[key], value))
    if hasattr(row, "updated_at"):
        row.updated_at = now()
    if model is m.Issue:
        if row.status in {"resolved", "closed"}:
            row.resolved_by = user.username
            row.resolved_at = now()
        elif row in db.new:
            row.reported_by = user.username


def apply_sync_record(db, project, user, data, body):
    model = MODELS[body.module]
    values = dict(body.record)
    rid = values.pop("id", None)
    if not isinstance(rid, str) or not rid.strip() or len(rid) > 64:
        fail("event_record_invalid", "A canonical record ID is required", 422)
    if set(values) - FIELDS[body.module]:
        fail("event_record_invalid", "Unsupported canonical record fields", 422)
    from .event_records import validate_values

    values = validate_values(model, values)
    _references(db, project, values)
    row = db.query(model).filter(*scope(project, model), model.id == rid).first()
    if body.action == "delete":
        if values:
            fail("event_record_invalid", "Delete accepts only record.id", 422)
        if row is not None:
            if model is m.Task:
                _task_guard(db, project, data, row, {}, deleting=True)
            db.delete(row)
            _reconcile_sync(db, project, data)
        return rid, None, {"record_id": rid, "module": body.module, "action": "delete"}
    if model is m.Task:
        values = validate_task_owner_values(db, project, values)
        if "acceptance_criteria" in values:
            values["acceptance_criteria"] = normalize_task_acceptance(values["acceptance_criteria"])
        _task_guard(db, project, data, row, values)
    if model is m.Requirement:
        _requirement_guard(db, project, data, row, values)
    if row is None:
        row = _new_record(db, project, model, rid, values)
    _assign_record(db, user, row, model, values)
    if model is m.Task:
        from .delivery_service import _require_task_transition

        # A same-command requirement move must satisfy the final scope too.
        # The earlier check still protects the original managed execution/scope.
        db.flush()
        _require_task_transition(db, project, data, row, SimpleNamespace(status=values.get("status")))
    _reconcile_sync(db, project, data)
    return rid, None, {"record_id": rid, "module": body.module, "action": "upsert"}


def apply_canonical(db, project, user, data, action, body, command_key):
    if action == "issue.create":
        return _issue(db, project, user, data, body, command_key)
    return apply_sync_record(db, project, user, data, body)
