"""Minimal, deterministic progress facts; no permission or runtime side effects."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import date, datetime, timezone

from fastapi import HTTPException

from .delivery_service import initial_state, materialize, reconcile, records
from .sql_models import DeliveryWorkspace, Sprint, Task

STATUSES = (
    "pending",
    "in_progress",
    "blocked",
    "awaiting_review",
    "recorded_completed",
    "verified_completed",
)


def fact_basis(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _date(value):
    if isinstance(value, datetime):
        return (
            value.replace(tzinfo=timezone.utc).date().isoformat()
            if not value.tzinfo
            else value.astimezone(timezone.utc).date().isoformat()
        )
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            pass
    return None


def _accepted(requirement, tasks, issues):
    from .delivery_contract import stage_gates

    flow = requirement["flow"]
    if flow["stage"] not in {"release", "operations"} or flow.get("legacy_completed"):
        return False
    if not any(
        r.get("stage") == "acceptance"
        and r.get("revision") == flow["revision"]
        and r.get("decision") == "approved"
        for r in flow["reviews"]
    ):
        return False
    acceptance = {**flow, "stage": "acceptance"}
    return all(gate["ok"] for gate in stage_gates(requirement, acceptance, tasks, issues))


def capture_facts(db, project):
    """Read canonical rows plus effective reconciled approvals within the caller's SQL transaction."""
    row = db.get(DeliveryWorkspace, project.id)
    data = reconcile(db, project, row.data) if row else initial_state()
    snapshot = materialize(db, project, data, None)
    from .delivery_verification import VerificationContext

    verification = VerificationContext(db, project, data)
    accepted = {
        r["id"]: _accepted(r, snapshot["tasks"], snapshot["issues"]) for r in snapshot["requirements"]
    }
    requirements = []
    for requirement in sorted(snapshot["requirements"], key=lambda r: r["id"]):
        flow = requirement["flow"]
        requirements.append(
            {
                "id": requirement["id"],
                "title": requirement["title"],
                "milestone_id": flow.get("milestone_id", ""),
                "sprint_id": requirement.get("sprint_id") or "",
                "stage": flow["stage"],
                "revision": flow["revision"],
                "basis": requirement["basis"],
                "accepted": accepted[requirement["id"]],
                "released": accepted[requirement["id"]] and flow["stage"] == "operations",
            }
        )
    by_requirement = {r["id"]: r for r in snapshot["requirements"]}
    canonical = {t.id: t for t in records(db, Task, project).all()}
    tasks = []
    for task in sorted(snapshot["tasks"], key=lambda t: t["id"]):
        requirement = by_requirement.get(task["req_id"])
        flow = requirement["flow"] if requirement else {}
        planning = task["planning"]
        recorded_status = canonical[task["id"]].status
        status = verification.delivery_status(task["id"])
        tasks.append(
            {
                "id": task["id"],
                "title": task["title"],
                "req_id": task["req_id"],
                "sprint_id": task.get("sprint_id") or "",
                "milestone_id": flow.get("milestone_id", ""),
                "owner_id": task.get("owner_id") or "",
                "assigned_to": task.get("assigned_to") or "",
                "estimate": task.get("estimate") or None,
                "starts_on": _date(planning.get("starts_on")),
                "ends_on": _date(planning.get("ends_on")),
                "allocations": deepcopy(planning.get("allocations", [])),
                "acceptance_criteria": deepcopy(task["acceptance_criteria"]),
                "requirement_criteria_indices": deepcopy(planning.get("requirement_criteria_indices", [])),
                "acceptance": deepcopy(task["acceptance"]),
                "basis": fact_basis(
                    {
                        "title": task["title"],
                        "description": task["description"],
                        "requirement_basis": requirement["basis"] if requirement else None,
                        "requirement_revision": flow.get("revision"),
                        "acceptance_criteria": task["acceptance_criteria"],
                        "requirement_criteria_indices": planning.get("requirement_criteria_indices"),
                        "acceptance": task["acceptance"],
                        "depends_on": planning.get("depends_on"),
                        "blocked_reason": planning.get("blocked_reason"),
                    }
                ),
                "status": status,
                "recorded_status": recorded_status,
            }
        )
    sprints = [
        {"id": s.id, "title": s.goal or s.id, "starts_on": _date(s.started_at), "ends_on": _date(s.ends_at)}
        for s in records(db, Sprint, project).order_by(Sprint.id).all()
    ]
    milestones = [
        {
            "id": m["id"],
            "title": m["title"],
            "starts_on": _date(m.get("starts_on")),
            "ends_on": _date(m.get("ends_on")),
        }
        for m in sorted(snapshot["milestones"], key=lambda m: m["id"])
    ]
    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "starts_on": _date(snapshot["project"].get("starts_on")),
            "ends_on": _date(snapshot["project"].get("ends_on")),
        },
        "tasks": tasks,
        "requirements": requirements,
        "scopes": {"milestones": milestones, "sprints": sprints},
    }


def metrics(tasks, requirements):
    counts = {status: sum(t["status"] == status for t in tasks) for status in STATUSES}
    return {
        "tasks_total": len(tasks),
        "recorded_completed": counts["recorded_completed"],
        "verified_completed": counts["verified_completed"],
        "awaiting_review": counts["awaiting_review"],
        "remaining": len(tasks) - counts["verified_completed"],
        "requirements_total": len(requirements),
        "requirements_accepted": sum(bool(r["accepted"]) for r in requirements),
        "requirements_released": sum(bool(r["released"]) for r in requirements),
        "status_counts": counts,
    }


def select_scope(facts, kind="project", scope_id=""):
    if kind not in {"project", "milestone", "sprint"}:
        raise HTTPException(422, "Choose a project, milestone or sprint progress scope")
    if kind == "project":
        if scope_id and scope_id != facts["project"]["id"]:
            raise HTTPException(422, "Project progress does not accept another scope ID")
        scope = {"kind": kind, "id": "", "label": facts["project"]["name"]}
        tasks, requirements = facts["tasks"], facts["requirements"]
    else:
        collection = facts["scopes"]["milestones" if kind == "milestone" else "sprints"]
        selected = next((s for s in collection if s["id"] == scope_id), None)
        if not selected:
            raise HTTPException(404, "Progress scope not found in this project")
        scope = {"kind": kind, "id": scope_id, "label": selected["title"]}
        key = "milestone_id" if kind == "milestone" else "sprint_id"
        tasks = [t for t in facts["tasks"] if t.get(key) == scope_id]
        linked = {t["req_id"] for t in tasks}
        requirements = [r for r in facts["requirements"] if r.get(key) == scope_id or r["id"] in linked]
    value = {
        "scope": scope,
        "tasks": tasks,
        "requirements": requirements,
        "task_ids": [t["id"] for t in tasks],
    }
    semantic = {
        **value,
        "tasks": [{key: item for key, item in task.items() if key != "assigned_to"} for task in tasks],
    }
    return {**value, "basis": fact_basis(semantic), "metrics": metrics(tasks, requirements)}
