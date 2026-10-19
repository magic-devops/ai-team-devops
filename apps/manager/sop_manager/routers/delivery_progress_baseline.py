"""Append-only, reviewed task scope plans and explicit scope comparisons."""

from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import select

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


def compare_scope(baseline, current):
    before = {task["id"]: task for task in baseline["tasks"]}
    after = {task["id"]: task for task in current["tasks"]}
    changed = []
    unchanged = 0
    incomplete_fields = set()
    incomplete_tasks = []
    # Execution status advances progress; it does not change the frozen work scope.
    planned_fields = {
        "title",
        "basis",
        "req_id",
        "sprint_id",
        "milestone_id",
        "owner_id",
        "estimate",
        "starts_on",
        "ends_on",
        "allocations",
        "acceptance_criteria",
        "requirement_criteria_indices",
        "acceptance",
    }
    for task_id in sorted(before.keys() & after.keys()):
        unknown = {
            key
            for key in ("allocations", "acceptance_criteria", "requirement_criteria_indices", "acceptance")
            if before[task_id].get(key) is None or after[task_id].get(key) is None
        }
        if unknown:
            incomplete_fields.update(unknown)
            incomplete_tasks.append(task_id)
        fields = sorted(
            key
            for key in planned_fields
            if key not in unknown and before[task_id].get(key) != after[task_id].get(key)
        )
        if fields:
            changed.append(
                {
                    "id": task_id,
                    "before": deepcopy(before[task_id]),
                    "after": deepcopy(after[task_id]),
                    "fields": fields,
                }
            )
        elif not unknown:
            unchanged += 1
    return {
        "added": [deepcopy(after[key]) for key in sorted(after.keys() - before.keys())],
        "removed": [deepcopy(before[key]) for key in sorted(before.keys() - after.keys())],
        "changed": changed,
        "unchanged_count": unchanged,
        "incomplete_plan_fields": sorted(incomplete_fields),
        "incomplete_task_ids": incomplete_tasks,
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


def apply_progress(db, project, user, action, payload, *, proof=None):
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
    from .delivery_progress_current import freeze_proof

    proof = proof or freeze_proof(db, project, scope=payload.scope, scope_id=payload.scope_id, internal=True)
    if not proof[0]["available"] or not proof[0]["complete"]:
        raise HTTPException(413, {"code": "progress_proof_unavailable", "message": "No partial scope may be frozen", "reasons": proof[0]["reasons"]})
    # The command holds the Project lock throughout this canonical proof and
    # CAS. Reuse this transaction's complete proof, never a caller's old GET.
    facts, current = proof[3]
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
    from sop_manager.project_write_guard import progress_snapshot_write_scope

    with progress_snapshot_write_scope(db, project.tenant_id, project.id, "baseline"):
        db.add(baseline)
        db.flush()
    record_observation(
        db, project, source="baseline", actor=user.username, source_version=version, force=True
    )
    return baseline.id, None
