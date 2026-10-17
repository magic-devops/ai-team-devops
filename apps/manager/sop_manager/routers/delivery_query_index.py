"""Atomic disposable query facts derived from the canonical write evaluation."""

from collections import Counter, defaultdict
from datetime import datetime, timezone

from sqlalchemy import delete, insert, select, update

from .delivery_progress_facts import metrics
from .delivery_scheduling import planning_basis
from .sql_models import DeliveryQueryFact, DeliveryQueryState, DeliveryWorkspace

SCHEMA_VERSION = 1
FLOW_FIELDS = (
    "stage",
    "revision",
    "owner_id",
    "due_on",
    "milestone_id",
    "blocked_reason",
    "closed",
    "legacy_completed",
)


def scope(project, model):
    return model.tenant_id == project.tenant_id, model.project_id == project.id


def _fact(project, kind, entity_id, data, **fields):
    return {
        "tenant_id": project.tenant_id,
        "project_id": project.id,
        "kind": kind,
        "entity_id": entity_id,
        "parent_id": "",
        "owner_id": "",
        "milestone_id": "",
        "status": "",
        "due_on": None,
        "label": "",
        "data": data,
        **fields,
    }


def _requirement_facts(project, evaluation):
    accepted = {row["id"]: row["accepted"] for row in evaluation.facts["requirements"]}
    grouped = defaultdict(list)
    for task in evaluation.snapshot["tasks"]:
        grouped[task["req_id"]].append(task)
    rows = []
    for requirement in evaluation.snapshot["requirements"]:
        flow = requirement["flow"]
        linked = grouped[requirement["id"]]
        data = {
            "basis": requirement["basis"],
            "tasks_total": len(linked),
            "tasks_done": sum(bool(task["verified"]) for task in linked),
            "tasks_recorded_done": sum(task["recorded_status"] == "completed" for task in linked),
            "accepted": accepted[requirement["id"]],
            "deployment_verified": requirement.get("deployment_verified", False),
            "flow": {key: flow.get(key) for key in FLOW_FIELDS},
            "gates": flow["gates"],
        }
        rows.append(
            _fact(
                project,
                "requirement",
                requirement["id"],
                data,
                status=flow["stage"],
                owner_id=flow.get("owner_id") or "",
                milestone_id=flow.get("milestone_id") or "",
                due_on=flow.get("due_on"),
            )
        )
    return rows


def _task_facts(project, evaluation):
    rows = []
    flows = evaluation.state.get("flows", {})
    for task in evaluation.snapshot["tasks"]:
        planning = task["planning"]
        data = {
            key: task[key]
            for key in (
                "basis",
                "status",
                "recorded_status",
                "delivery_status",
                "verified",
                "assigned_to",
                "owner_active",
                "execution_id",
                "dependency_blocked",
                "execution_gate",
            )
        }
        data["owner"] = task.get("owner")
        data["planning"] = {key: planning.get(key) for key in ("starts_on", "ends_on", "blocked_reason")}
        rows.append(
            _fact(
                project,
                "task",
                task["id"],
                data,
                parent_id=task["req_id"],
                owner_id=task.get("owner_id") or "",
                status=task["delivery_status"],
                milestone_id=flows.get(task["req_id"], {}).get("milestone_id") or "",
            )
        )
    return rows


def _execution_facts(project, evaluation):
    rows = []
    for position, entry in enumerate(evaluation.state.get("executions", [])):
        data = {
            key: entry.get(key)
            for key in (
                "id",
                "task_id",
                "workspace_id",
                "status",
                "run_id",
                "run_version",
                "progress",
                "created_at",
                "stale",
                "issue_id",
                "attempt",
            )
        }
        data["position"] = position
        rows.append(
            _fact(
                project,
                "execution",
                entry["id"],
                data,
                parent_id=entry["task_id"],
                status=entry["status"],
                label=entry["id"],
            )
        )
    return rows


def _milestone_counts(evaluation):
    result = defaultdict(Counter)
    for row in evaluation.facts["tasks"]:
        counts = result[row["milestone_id"]]
        counts["task_count"] += 1
        counts["verified_task_count"] += row["status"] == "verified_completed"
    for row in evaluation.facts["requirements"]:
        counts = result[row["milestone_id"]]
        counts["requirement_count"] += 1
        counts["accepted_requirement_count"] += bool(row["accepted"])
    return result


def _reference_facts(project, evaluation):
    owners = Counter(task.get("owner_id") for task in evaluation.snapshot["tasks"])
    counts = _milestone_counts(evaluation)
    rows = []
    for member in evaluation.snapshot["members"]:
        rows.append(
            _fact(
                project,
                "member",
                member["id"],
                {**member, "task_count": owners[member["id"]]},
                label=member.get("name") or member["id"],
                status="active" if member["active"] else "inactive",
            )
        )
    for milestone in evaluation.snapshot["milestones"]:
        aggregate = {
            key: counts[milestone["id"]][key]
            for key in (
                "requirement_count",
                "accepted_requirement_count",
                "task_count",
                "verified_task_count",
            )
        }
        rows.append(
            _fact(
                project,
                "milestone",
                milestone["id"],
                {**milestone, **aggregate},
                label=milestone["title"],
                due_on=milestone.get("ends_on"),
            )
        )
    for position, resource in enumerate(evaluation.snapshot.get("resources", [])):
        safe = {
            key: resource.get(key)
            for key in ("id", "kind", "title", "url", "ref", "archived", "created_at", "updated_at")
        }
        safe["position"] = position
        rows.append(
            _fact(
                project,
                "resource",
                resource["id"],
                safe,
                label=resource["title"],
                status="archived" if resource.get("archived") else "active",
            )
        )
    for sprint in evaluation.facts["scopes"]["sprints"]:
        rows.append(_fact(project, "sprint", sprint["id"], sprint, label=sprint["title"]))
    return rows


def replace_from_evaluation(db, project, evaluation):
    """Caller owns Project lock and canonical transaction; no commit or history write."""
    connection = db.connection()
    current = connection.execute(
        select(DeliveryQueryState.generation).where(*scope(project, DeliveryQueryState))
    ).scalar()
    generation = (current or 0) + 1
    rows = _requirement_facts(project, evaluation) + _task_facts(project, evaluation)
    rows += _execution_facts(project, evaluation) + _reference_facts(project, evaluation)
    linked_issues = {
        flow["source_issue_id"]: requirement_id
        for requirement_id, flow in evaluation.state.get("flows", {}).items()
        if flow.get("source_issue_id")
    }
    for issue in evaluation.snapshot["issues"]:
        rows.append(
            _fact(
                project,
                "issue",
                issue["id"],
                {
                    "source_kinds": issue.get("source_kinds", []),
                    "linked_requirement_id": linked_issues.get(issue["id"]),
                },
                parent_id=issue["task_id"] or "",
                status=issue["status"],
            )
        )
    connection.execute(delete(DeliveryQueryFact).where(*scope(project, DeliveryQueryFact)))
    for start in range(0, len(rows), 250):
        connection.execute(insert(DeliveryQueryFact), rows[start : start + 250])
    metric = metrics(evaluation.facts["tasks"], evaluation.facts["requirements"])
    metric["requirement_stage_counts"] = dict(
        Counter(row["stage"] for row in evaluation.facts["requirements"])
    )
    summary = {**evaluation.snapshot["summary"], "tasks_done": metric["verified_completed"]}
    version = (
        connection.execute(
            select(DeliveryWorkspace.version).where(*scope(project, DeliveryWorkspace))
        ).scalar()
        or 0
    )
    values = {
        "schema_version": SCHEMA_VERSION,
        "generation": generation,
        "source_version": version,
        "computed_at": datetime.now(timezone.utc).replace(tzinfo=None),
        "summary": summary,
        "metrics": metric,
        "planning_basis": planning_basis(db, project, evaluation.state, verification=evaluation.verification),
    }
    if current is None:
        connection.execute(
            insert(DeliveryQueryState), {"tenant_id": project.tenant_id, "project_id": project.id, **values}
        )
    else:
        connection.execute(update(DeliveryQueryState).where(*scope(project, DeliveryQueryState)), values)
    return generation


def rebuild(db, project, user):
    """Explicit derived-only maintenance, including previously unindexed databases."""
    from fastapi import HTTPException

    from sop_manager.project_write_guard import lock_project_scopes

    from .auth_sql import check_project_access
    from .delivery import _role_permissions
    from .delivery_progress_facts import evaluate_project
    from .delivery_query_read import metadata, query_state
    from .sql_models import User

    lock_project_scopes(db, [(project.tenant_id, project.id)])
    db.refresh(project)
    actor = db.get(User, user.id, populate_existing=True)
    if actor is None or actor.status != "active":
        raise HTTPException(403, "An active account is required")
    check_project_access(actor, project.id, db)
    if not _role_permissions(db, actor, project)["configure"]:
        raise HTTPException(403, "Project configure permission required")
    evaluation = evaluate_project(db, project)
    replace_from_evaluation(db, project, evaluation)
    db.commit()
    row = (
        db.execute(select(DeliveryQueryState.__table__).where(*scope(project, DeliveryQueryState)))
        .mappings()
        .one()
    )
    return {**metadata(db, project, row), "query_state": query_state(row)}
