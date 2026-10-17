"""Schedule only the exact attempt authorized by a committed delivery event."""

from fastapi import HTTPException
from hermes_core.models import CoreError
from hermes_core.run_controls import pending_stop
from sqlalchemy import select

from .sql_models import DeliveryEvent, DeliveryWorkspace, User


def _resume_valid(store, principal, entry, run, action, resume, attempt):
    if resume is None:
        return action != "execution.approval" and run["status"] in {"queued", "retrying"}
    if (
        action != "execution.approval"
        or "approve" not in principal.permissions
        or run["status"] != "interrupted"
        or not isinstance(resume, dict)
    ):
        return False
    approval = store.get(principal, entry["workspace_id"], "approvals", resume.get("approval_id", ""))
    return (
        approval["status"] == "approved"
        and approval["version"] == resume.get("approval_version")
        and approval["data"].get("run_id") == run["id"]
        and approval["data"].get("node_id") == run["data"].get("active_node")
        and approval["data"].get("attempt", 1) == attempt
    )


def schedule_committed_execution(db, project, user, body, request, background_tasks, applied_version):
    if request is None or background_tasks is None:
        return
    from .auth_sql import check_project_access
    from .delivery import _role_permissions
    from .delivery_execution import CLOSED, context
    from .delivery_execution_runtime import _require_managed_source
    from .delivery_plan import require_dependencies
    from .delivery_service import reconcile
    from .delivery_verification import VerificationContext

    store = getattr(request.app.state, "hermes_store", None)
    execution = getattr(request.app.state, "hermes_execution", None)
    if store is None or execution is None:
        return
    row = db.get(DeliveryWorkspace, project.id, populate_existing=True)
    actor = db.get(User, user.id, populate_existing=True)
    if row is None or actor is None or actor.status != "active" or project.status != "active":
        return
    state = reconcile(db, project, row.data)
    entry = next((item for item in state.get("executions", []) if item["id"] == body.payload["id"]), None)
    if not entry or entry["status"] in CLOSED or entry.get("stop_pending") or not entry.get("run_id"):
        return
    event = db.scalar(
        select(DeliveryEvent).where(
            DeliveryEvent.project_id == project.id,
            DeliveryEvent.tenant_id == project.tenant_id,
            DeliveryEvent.version == applied_version,
            DeliveryEvent.action == body.action,
            DeliveryEvent.resource_id == entry["id"],
        )
    )
    committed = event.data.get("result", {}).get("start_run") if event else None
    if not isinstance(committed, dict) or (
        committed.get("workspace_id") != entry["workspace_id"]
        or committed.get("run_id") != entry["run_id"]
        or type(committed.get("attempt")) is not int
        or committed["attempt"] != entry.get("attempt", 1)
    ):
        return
    resume = committed.get("resume")
    try:
        check_project_access(actor, project.id, db)
        permissions = _role_permissions(db, actor, project)
        if not permissions["write"] or (body.action == "execution.approval" and not permissions["approve"]):
            return
        if not VerificationContext(db, project, state).execution_snapshot_current(entry):
            return
        require_dependencies(db, project, state, entry["task_id"])
        principal, workspace = context(store, actor, entry["workspace_id"], "execute")
        run = store.get(principal, entry["workspace_id"], "runs", entry["run_id"])
        _require_managed_source(store, principal, entry, run)
        data = run["data"]
        if (
            data.get("attempt", 1) != committed["attempt"]
            or data.get("target_device_id")
            or data.get("workspace_version") != workspace["version"]
            or pending_stop(run)
            or data.get("task_source", {}).get("task_id") != entry.get("runtime_task_id")
        ):
            return
        if (
            body.action == "execution.retry"
            and data.get("recovery_requires_review")
            and (not permissions["approve"] or "approve" not in principal.permissions)
        ):
            return
        if not _resume_valid(store, principal, entry, run, body.action, resume, committed["attempt"]):
            return
    except (HTTPException, CoreError):
        # A saved receipt never restores authority revoked after its commit.
        # The queued run remains visible for a new, explicit recovery preview.
        return
    background_tasks.add_task(
        execution.execute,
        principal,
        entry["workspace_id"],
        run["id"],
        expected_attempt=committed["attempt"],
        resume=resume,
    )
