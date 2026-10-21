"""Immutable original command results and tiny, currently authorized receipts."""

from fastapi import HTTPException
from sqlalchemy import and_, case, select

from .delivery_query_index import SCHEMA_VERSION, scope
from .sql_models import DeliveryEvent, DeliveryQueryState, DeliveryWorkspace, Project


def resource_kind(action):
    precise = {
        "task.delivery.submit": "task_submission",
        "task.delivery.review": "task_review",
        "tasks.schedule": "project",
        "release.policy.save": "release_policy",
        "release.ci.import": "ci_evidence",
    }
    if action in precise:
        return precise[action]
    if action.startswith("baseline."):
        return "baseline"
    if action.startswith("progress."):
        return "observation"
    if action in {"issue.promote", "issue.diagnosis.adopt", "artifact.add", "stage.advance", "stage.reopen"}:
        return "requirement"
    if action.startswith("issue.diagnosis."):
        return "diagnosis"
    if action.startswith("tasks.") or action.startswith("task."):
        return "task_review" if action == "task.manual_review" else "task"
    if action.startswith("release.candidate."):
        return "release_candidate"
    if action.startswith("deployment.environment."):
        return "deployment_environment"
    if action.startswith("member.calendar."):
        return "member"
    return action.split(".")[0]


def recorded_ack(project, action, resource_id, result, applied_version):
    kind = resource_kind(action)
    if action == "sync.record.apply" and isinstance(result, dict):
        kind = {"tasks": "task", "requirements": "requirement", "issues": "issue", "sprints": "sprint"}.get(result.get("module"), kind)
    resource = {"kind": kind, "id": resource_id}
    refs = [resource]
    if isinstance(result, dict):
        refs.extend({"kind": "task", "id": task_id} for task_id in result.get("task_ids", []))
        if result.get("requirement_id"):
            refs.append({"kind": "requirement", "id": result["requirement_id"]})
        if action in {"task.delivery.submit", "task.delivery.review"}:
            if action == "task.delivery.review":
                refs.append({"kind": "task_submission", "id": result["submission_id"]})
            if result.get("issue_id"):
                refs.append({"kind": "issue", "id": result["issue_id"]})
    unique = list({(ref["kind"], ref["id"]): ref for ref in refs}.values())
    return {
        "project_id": project.id,
        "action": action,
        "resource": resource,
        "result": result,
        "affected_refs": unique,
        "applied_version": applied_version,
    }


def current_ack(db, project, recorded, *, replayed):
    statement = (
        select(
            DeliveryWorkspace.version,
            case(
                (DeliveryQueryState.schema_version == SCHEMA_VERSION, DeliveryQueryState.generation),
                else_=None,
            ).label("query_generation"),
        )
        .select_from(Project)
        .outerjoin(
            DeliveryWorkspace,
            and_(
                DeliveryWorkspace.project_id == Project.id, DeliveryWorkspace.tenant_id == Project.tenant_id
            ),
        )
        .outerjoin(
            DeliveryQueryState,
            and_(
                DeliveryQueryState.project_id == Project.id, DeliveryQueryState.tenant_id == Project.tenant_id
            ),
        )
        .where(Project.id == project.id, Project.tenant_id == project.tenant_id)
    )
    row = db.execute(statement).one()
    return {
        **recorded,
        "project_id": project.id,
        "version": row.version or 0,
        "query_generation": row.query_generation,
        "replayed": replayed,
    }


def command_access(state, action, resource_id):
    """Freeze original runtime scopes; later moves must not redefine receipt access."""
    if action.startswith("execution."):
        entry = next((row for row in state.get("executions", []) if row["id"] == resource_id), None)
        return [entry["workspace_id"]] if entry else []
    if action.startswith("deployment.environment."):
        entry = next(
            (row for row in state.get("deployment_environments", []) if row["id"] == resource_id), None
        )
        return [entry["definition"]["workspace_id"]] if entry else []
    if action.startswith("deployment."):
        entry = next((row for row in state.get("deployments", []) if row["id"] == resource_id), None)
        return [entry["snapshot"]["definition"]["workspace_id"]] if entry else []
    return []


def replay_ack(db, project, version, *, user, store=None):
    from .delivery_discussion_sources import assert_runtime_scopes

    rows = db.execute(
        select(DeliveryEvent.data["command_ack"], DeliveryEvent.data["command_ack_access"]).where(
            *scope(project, DeliveryEvent), DeliveryEvent.version == version
        )
    ).all()
    if len(rows) != 1 or not isinstance(rows[0][0], dict) or not isinstance(rows[0][1], list):
        raise HTTPException(
            409,
            {
                "code": "delivery_receipt_result_unavailable",
                "message": "This historical receipt has no recorded original command result.",
            },
        )
    assert_runtime_scopes(store, user, project, rows[0][1])
    return current_ack(db, project, rows[0][0], replayed=True)
