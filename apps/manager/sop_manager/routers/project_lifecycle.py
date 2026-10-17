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
    from .delivery_execution import CLOSED

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
    basis = fact_basis(
        {
            "project": serialize(project),
            "project_members": members,
            "team": roster,
            "delivery_members": data.get("members", []),
            "facts_basis": facts["basis"],
            "intents": intents,
            "target_status": body.target_status,
            "reason": body.reason,
        }
    )
    blockers = []
    if body.target_status == "archived":
        for entry in intents:
            if entry["status"] not in CLOSED:
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
