"""Explicit project state transitions in the existing delivery CAS transaction."""

from copy import deepcopy

from fastapi import HTTPException

from .delivery_progress_facts import fact_basis
from .delivery_service import identifier, serialize, stamp
from .delivery_team import TeamContext
from .project_portfolio import project_capabilities, project_facts
from .sql_models import ProjectMember


def require_active(project):
    if project.status != "active":
        raise HTTPException(
            409,
            {
                "code": "project_not_active",
                "message": "Activate the project before preparing or dispatching new execution.",
            },
        )


def _facts(value):
    return {key: value[key] for key in ("as_of", "basis", "metrics", "risk_counts", "unclosed_intents_total")}


def preview(db, project, user, data, body, *, version):
    from .delivery_deployment import active_deployment_ids
    from .delivery_external_work_order_service import project_has_active_work_orders
    from .delivery_execution import CLOSED
    from .delivery_execution_runtime import unresolved_stop_targets

    facts = project_facts(db, project, data)
    members = [
        serialize(row)
        for row in db.query(ProjectMember)
        .filter_by(project_id=project.id)
        .order_by(ProjectMember.user_id)
        .all()
    ]
    roster = TeamContext(db, project, data).roster
    intents = data.get("executions", [])
    unresolved_stops = unresolved_stop_targets(db, project, data)
    has_external_work = project_has_active_work_orders(db, project)
    basis = fact_basis(
        {
            "project": serialize(project),
            "project_members": members,
            "team": roster,
            "delivery_members": data.get("members", []),
            "facts_basis": facts["basis"],
            "intents": intents,
            "unresolved_stops": unresolved_stops,
            "external_work_order_active": has_external_work,
            "deployments": data.get("deployments", []),
            "target_status": body.target_status,
            "reason": body.reason,
        }
    )
    blockers = []
    if body.target_status == "archived":
        from .delivery_issue_diagnosis import active_diagnosis_ids
        from .sql_models import IssueDiagnosis

        if has_external_work:
            blockers.append({
                "code": "external_work_order_active",
                "message": "Cancel unclaimed work or have the claimant release active external work before archiving.",
                "target": {"project_id": project.id, "kind": "project", "view": "external-work-orders", "detail": "details"},
                "status": "unclosed", "run_id": None,
            })

        for diagnosis_id in active_diagnosis_ids(db, project):
            diagnosis = db.get(IssueDiagnosis, diagnosis_id)
            blockers.append({
                "code": "project_diagnosis_unclosed",
                "message": "Review or dismiss the pending diagnosis request before archiving.",
                "target": {
                    "project_id": project.id, "kind": "issue", "view": "issues", "detail": "details",
                    "issue_id": diagnosis.issue_id, "diagnosis_id": diagnosis.id,
                },
                "status": diagnosis.status, "run_id": None,
            })
        active_deployments = set(active_deployment_ids(data))
        for deployment in data.get("deployments", []):
            if deployment["id"] in active_deployments:
                blockers.append({
                    "code": "project_deployment_unclosed",
                    "message": "Resolve this deployment or its unknown outcome before archiving.",
                    "target": {
                        "project_id": project.id, "kind": "deployment", "view": "releases",
                        "detail": "details", "deployment_id": deployment["id"],
                    },
                    "status": deployment["status"],
                    "run_id": next((operation.get("run_id") for operation in reversed(deployment.get("operations", [])) if operation.get("run_id")), None),
                })
        blockers.extend(unresolved_stops)
        stop_ids = {item["target"]["execution_id"] for item in unresolved_stops}
        for entry in intents:
            if entry["status"] not in CLOSED and entry["id"] not in stop_ids:
                blockers.append(
                    {
                        "code": "project_execution_unclosed",
                        "message": "Review or cancel this delivery intent before archiving the project.",
                        "target": {
                            "project_id": project.id,
                            "kind": "execution",
                            "view": "list",
                            "detail": "tasks",
                            "execution_id": entry["id"],
                            "task_id": entry.get("task_id") or None,
                        },
                        "status": entry["status"],
                        "run_id": entry.get("run_id") or None,
                    }
                )
    warnings = []
    for code, count in (
        ("unfinished_tasks", facts["metrics"]["remaining"]),
        (
            "unaccepted_requirements",
            facts["metrics"]["requirements_total"] - facts["metrics"]["requirements_accepted"],
        ),
        ("open_issues", facts["risk_counts"]["open_issues"]),
    ):
        if count:
            warnings.append(
                {"code": code, "message": "This project contains unfinished delivery work.", "count": count}
            )
    can_transition = project_capabilities(db, project, user)["can_transition"]
    return {
        "project_id": project.id,
        "version": version,
        "from_status": project.status,
        "target_status": body.target_status,
        "reason": body.reason,
        "preview_basis": basis,
        "allowed": can_transition and project.status != body.target_status and not blockers,
        "blockers": blockers,
        "warnings": warnings,
        "facts": _facts(facts),
        "permissions": {"can_transition": can_transition},
    }


def apply_lifecycle(db, project, user, data, body):
    current = preview(db, project, user, data, body, version=0)
    if not current["permissions"]["can_transition"]:
        raise HTTPException(403, "Project lifecycle permission required")
    if project.status == body.target_status:
        raise HTTPException(
            409, {"code": "project_state_unchanged", "message": "Choose a different project state."}
        )
    if body.preview_basis != current["preview_basis"]:
        raise HTTPException(
            409,
            {
                "code": "project_lifecycle_basis_changed",
                "message": "Project facts changed. Review a new lifecycle preview.",
            },
        )
    if current["blockers"]:
        raise HTTPException(
            409,
            {
                "code": "project_archive_blocked",
                "message": "Close all delivery intents before archiving.",
                "blockers": current["blockers"],
            },
        )
    before = {"status": project.status, "lifecycle": deepcopy(data.get("lifecycle", {}))}
    archive = None
    if body.target_status == "archived":
        archive = {
            "id": identifier("archive"),
            "at": stamp(),
            "actor_id": user.id,
            "actor_name": user.username,
            "reason": body.reason,
            "preview_basis": body.preview_basis,
            "facts": current["facts"],
        }
        data.setdefault("lifecycle", {})["last_archive"] = archive
    project.status = body.target_status
    return (
        project.id,
        before,
        {
            "from_status": before["status"],
            "target_status": body.target_status,
            "reason": body.reason,
            "archive": archive,
        },
    )
