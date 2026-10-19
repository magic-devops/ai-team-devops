"""Frozen ed00a4b original pure preview semantics for differential contract tests.

The new implementation uses SQL relationships and bounded canonical closure.
This test oracle intentionally retains the original full-scope algorithm.
"""

from sop_manager.routers.delivery_activity_contract import DefinitionChanges
from sop_manager.routers.delivery_plan import requirement_basis, requirement_snapshot
from sop_manager.routers.delivery_service import _fingerprint, records
from sop_manager.routers.sql_models import Task

DEFINITION_FIELDS = ("title", "description", "acceptance_criteria")


def legacy_impact(db, project, state, requirement_id):
    tasks = records(db, Task, project).all()
    direct = {row.id for row in tasks if row.req_id == requirement_id}
    affected = set(direct)
    while True:
        added = {
            row.id
            for row in tasks
            if affected.intersection(state.get("task_details", {}).get(row.id, {}).get("depends_on", []))
        }
        if added <= affected:
            break
        affected.update(added)
    executions = [row for row in state.get("executions", []) if row["task_id"] in affected]
    candidates = [
        row
        for row in state.get("release_candidates", [])
        if requirement_id in row["snapshot"]["selected"]["requirement_ids"]
        or affected.intersection(row["snapshot"]["selected"]["task_ids"])
    ]
    candidate_ids = {row["id"] for row in candidates}
    deployments = [row for row in state.get("deployments", []) if row["candidate_id"] in candidate_ids]
    flow = state.get("flows", {}).get(requirement_id, {})
    return {
        "task_ids": sorted(direct),
        "dependent_task_ids": sorted(affected - direct),
        "execution_ids": sorted(row["id"] for row in executions),
        "release_candidate_ids": sorted(candidate_ids),
        "deployment_ids": sorted(row["id"] for row in deployments),
        "invalidates_current_acceptance": bool(
            flow.get("accepted_work")
            or flow.get("tested_work")
            or flow.get("stage") in {"testing", "acceptance", "release", "operations"}
        ),
    }


def legacy_change_facts(db, project, state, requirement, changes):
    normalized = DefinitionChanges.normalized(changes)
    current = requirement_snapshot(requirement)
    differences = [
        {"field": key, "before": current[key], "after": normalized[key]}
        for key in DEFINITION_FIELDS
        if key in normalized and normalized[key] != current[key]
    ]
    impact = legacy_impact(db, project, state, requirement.id)
    if not differences:
        impact["invalidates_current_acceptance"] = False
    # Detail semantics participate, not a volatile heartbeat/run version.
    semantic = {
        "tasks": [
            dict(
                id=row.id,
                req_id=row.req_id,
                title=row.title,
                description=row.description,
                acceptance_criteria=row.acceptance_criteria,
                owner_id=row.owner_id,
                depends_on=state.get("task_details", {}).get(row.id, {}).get("depends_on", []),
            )
            for row in records(db, Task, project)
            .filter(Task.id.in_(impact["task_ids"] + impact["dependent_task_ids"]))
            .order_by(Task.id)
        ],
        "flows": {
            "stage": state.get("flows", {}).get(requirement.id, {}).get("stage"),
            "revision": state.get("flows", {}).get(requirement.id, {}).get("revision"),
        },
        "impact": impact,
    }
    basis = requirement_basis(requirement)
    preview_basis = _fingerprint(
        {"project_id": project.id, "requirement_basis": basis, "changes": differences, "impact": semantic}
    )
    return basis, preview_basis, differences, impact
