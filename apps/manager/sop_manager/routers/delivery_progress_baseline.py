"""Append-only, reviewed task scope plans and explicit scope comparisons."""

from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import select

from .delivery_progress_facts import capture_facts, select_scope
from .delivery_service import identifier
from .sql_models import DeliveryProgressBaseline, DeliveryWorkspace


def timestamp(value):
    if value is None:
        return None
    from datetime import timezone

    return (
        value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        if value.tzinfo is None
        else value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    )


def baseline_view(row, *, summary=False):
    frozen = deepcopy(row.data)
    result = {
        "id": row.id,
        "title": row.title,
        "scope": frozen["scope"],
        "basis": row.basis,
        "starts_on": row.starts_on,
        "ends_on": row.ends_on,
        "created_at": timestamp(row.created_at),
        "created_by": row.created_by,
        "source_version": row.source_version,
        "note": row.note,
        "task_ids": frozen["task_ids"],
        "metrics": frozen["metrics"],
    }
    if not summary:
        result.update(tasks=frozen["tasks"], requirements=frozen["requirements"])
    return result


def get_baseline(db, project, baseline_id):
    row = db.scalar(
        select(DeliveryProgressBaseline).where(
            DeliveryProgressBaseline.id == baseline_id,
            DeliveryProgressBaseline.project_id == project.id,
            DeliveryProgressBaseline.tenant_id == project.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(404, "Progress baseline not found in this project")
    return row


def compare_scope(baseline, current):
    before = {task["id"]: task for task in baseline["tasks"]}
    after = {task["id"]: task for task in current["tasks"]}
    changed = []
    unchanged = 0
    # Execution status advances progress; it does not change the frozen work scope.
    planned_fields = {
        "title",
        "basis",
        "req_id",
        "sprint_id",
        "milestone_id",
        "owner_id",
        "assigned_to",
        "estimate",
        "starts_on",
        "ends_on",
    }
    for task_id in sorted(before.keys() & after.keys()):
        fields = sorted(key for key in planned_fields if before[task_id].get(key) != after[task_id].get(key))
        if fields:
            changed.append(
                {
                    "id": task_id,
                    "before": deepcopy(before[task_id]),
                    "after": deepcopy(after[task_id]),
                    "fields": fields,
                }
            )
        else:
            unchanged += 1
    return {
        "added": [deepcopy(after[key]) for key in sorted(after.keys() - before.keys())],
        "removed": [deepcopy(before[key]) for key in sorted(before.keys() - after.keys())],
        "changed": changed,
        "unchanged_count": unchanged,
    }


def _validate_associations(facts, current):
    known = {
        "req_id": {row["id"] for row in facts["requirements"]},
        "sprint_id": {row["id"] for row in facts["scopes"]["sprints"]},
        "milestone_id": {row["id"] for row in facts["scopes"]["milestones"]},
    }
    for row in [*current["tasks"], *current["requirements"]]:
        for field, valid in known.items():
            if row.get(field) and row[field] not in valid:
                raise HTTPException(
                    422,
                    "Repair task and requirement associations to this project's current scope before freezing",
                )


def apply_progress(db, project, user, action, payload):
    from .delivery_progress_capture import record_observation

    version = db.scalar(
        select(DeliveryWorkspace.version).where(
            DeliveryWorkspace.project_id == project.id,
            DeliveryWorkspace.tenant_id == project.tenant_id,
        )
    )
    if action == "progress.record":
        observation = record_observation(
            db, project, source="manual", actor=user.username, source_version=version, force=True
        )
        return observation.id, None
    facts = capture_facts(db, project)
    current = select_scope(facts, payload.scope, payload.scope_id)
    if set(payload.task_ids) != set(current["task_ids"]) or payload.basis != current["basis"]:
        raise HTTPException(
            409, "Progress scope changed. Reload and review the current task scope before freezing."
        )
    _validate_associations(facts, current)
    baseline = DeliveryProgressBaseline(
        id=identifier("baseline"),
        project_id=project.id,
        tenant_id=project.tenant_id,
        title=payload.title,
        scope_kind=payload.scope,
        scope_id=payload.scope_id,
        basis=current["basis"],
        starts_on=payload.starts_on.isoformat() if payload.starts_on else None,
        ends_on=payload.ends_on.isoformat() if payload.ends_on else None,
        created_by=user.id,
        source_version=version,
        data=deepcopy(current),
        note=payload.note,
    )
    db.add(baseline)
    db.flush()
    record_observation(
        db, project, source="baseline", actor=user.username, source_version=version, force=True
    )
    return baseline.id, None
