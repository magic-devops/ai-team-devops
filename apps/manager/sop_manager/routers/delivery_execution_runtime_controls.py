"""Fixed Manager intent applied through the shared runtime control service."""

from copy import deepcopy

from fastapi import HTTPException
from hermes_core.models import CoreError, Decision, RunAction

from .delivery_execution_runtime import (
    _basis,
    _controls,
    _entry,
    _error,
    _read,
    _require_managed_source,
    _selected_capability,
    record_stop,
)


def _authority(db, project, user, action, principal, run, cached):
    from .delivery import _role_permissions

    permissions = _role_permissions(db, user, project)
    needed = "approve" if action == "execution.approval" else "write"
    if project.status == "archived":
        raise HTTPException(409, {"code": "project_archived", "message": "Restore the project before changing execution."})
    if not permissions[needed] or "execute" not in principal.permissions:
        raise HTTPException(403, {"code": "execution_permission_required",
                                  "message": "Current project and runtime execution permission are required."})
    recovery_review = action == "execution.retry" and (
        (run and run["data"].get("recovery_requires_review"))
        or (cached and cached.get("data", {}).get("recovery_requires_review"))
    )
    if (action == "execution.approval" or recovery_review) and (
        not permissions["approve"] or "approve" not in principal.permissions
    ):
        raise HTTPException(403, {"code": "approval_permission_required",
                                  "message": "Current project and runtime approval permission are required."})
    return permissions


def _transition_cancel(db, project, state, entry, run):
    from .delivery_service import stamp
    from .delivery_verification import VerificationContext

    current = VerificationContext(db, project, state).execution_snapshot_current(entry)
    entry["status"] = "cancelled"
    entry["cancelled_at"] = stamp()
    entry["stale"] = not current
    if run:
        entry["run_id"], entry["run_version"] = run["id"], run["version"]
        record_stop(entry, run)
        if not entry.get("stop_snapshot"):
            entry["stop_pending"] = True
            entry["stop_snapshot"] = {"id": "unrecorded", "state": "unknown", "reason": "Physical stop evidence is unavailable.",
                "node_id": run["data"].get("active_node"), "attempt": run["data"].get("attempt", 1),
                "requested_at": None, "confirmed_at": None, "evidence": "An execution result alone does not confirm process termination."}
    else:
        entry["stop_pending"] = False
        entry["stop_snapshot"] = {"id": "", "state": "not_started", "reason": "No runtime dispatch exists.",
                                  "node_id": None, "attempt": 1, "requested_at": entry["cancelled_at"],
                                  "confirmed_at": None, "evidence": (
                                      "The Core handoff gate is durably closed with no runtime plan."
                                      if entry.get("handoff_id") else "No external dispatch receipt was found.")}
    if current:
        VerificationContext(db, project, state).tasks[entry["task_id"]].status = "blocked"



def _validate_fixed_preview(db, project, state, entry, workspace, run, approval, controls, body, action, capability):
    if run and body.run_version > run["version"]:
        raise HTTPException(409, {"code": "execution_version_changed", "message": "The observed run version is unavailable."})
    basis = _basis(db, project, state, entry, workspace, run, approval, controls)
    if body.control_basis != basis or body.attempt != (run["data"].get("attempt", 1) if run else 1):
        raise HTTPException(409, {"code": "execution_control_basis_changed",
                                  "message": "Execution facts changed. Read and explicitly adopt a new preview."})
    if not capability["allowed"]:
        raise HTTPException(409, capability["reasons"][0])
    if action == "execution.approval" and (
        not approval or body.approval_id != approval["id"] or body.approval_version != approval["version"]
    ):
        raise HTTPException(409, {"code": "approval_changed", "message": "The fixed approval changed."})


def apply_control(db, project, user, state, action, body, store, execution, *, command_key):
    from hermes_core.run_controls import apply_run_action, decide_approval

    from .delivery_execution import _observe

    original = next((row for row in state.get("executions", []) if row["id"] == body.id), None)
    if original is None:
        raise HTTPException(404, "Execution not found in project")
    before = deepcopy(original)
    if action not in {"execution.start", "execution.retry", "execution.cancel", "execution.approval"}:
        raise HTTPException(422, "Unsupported execution control")
    if (action == "execution.approval") != (body.approval_id is not None):
        raise HTTPException(422, "The approval identity must match the selected action")
    try:
        entry, principal, workspace, run = _read(db, project, user, state, original, store)
        if body.run_id != (run["id"] if run else ""):
            raise HTTPException(409, {"code": "execution_identity_changed", "message": "The fixed run identity changed; review a new preview."})
        _require_managed_source(store, principal, entry, run)
        receipt_request = {"project_id": project.id, "action": action,
                           "payload": body.model_dump(mode="json", exclude_none=True)}
        operation = ("approval.decision:" + body.approval_id if action == "execution.approval"
                     else "run." + action.removeprefix("execution.") + ":" + body.run_id)
        cached = store.receipt(principal, entry["workspace_id"], operation, command_key, receipt_request) if run else None
        permissions = _authority(db, project, user, action, principal, run, cached)
        current, approval, controls = _controls(db, project, user, state, entry, store, execution,
                                               principal, workspace, run, permissions)
        capability = _selected_capability(controls, action, body.decision)
        if cached is None:
            _validate_fixed_preview(db, project, state, entry, workspace, run, approval, controls, body, action, capability)
        if action == "execution.cancel" and run is None and entry.get("handoff_id"):
            from .delivery_execution_handoff import close_pending_handoff

            close_pending_handoff(db, project, entry, store, execution)
        # Recover the existing Core receipt before checking the post-effect run status.
        # Current authority is still required above; receipt recovery never authorizes new execution.
        resume = None
        if action == "execution.approval":
            decision = decide_approval(store, execution, principal, entry["workspace_id"], body.approval_id,
                Decision(expected_version=body.approval_version, idempotency_key=command_key,
                         dry_run=False, decision=body.decision), managed=True, receipt_request=receipt_request)
            run, resume = decision["run"], decision["resume"]
        elif run and not (action == "execution.cancel" and run["status"] in {"failed", "completed", "cancelled"}):
            run = apply_run_action(store, execution, principal, entry["workspace_id"], run["id"],
                action.removeprefix("execution."), RunAction(expected_version=run["version"],
                    idempotency_key=command_key, dry_run=False), managed=True, receipt_request=receipt_request)
        canonical = _entry(state, original)
        canonical.update(run_id=entry.get("run_id", ""), runtime_task_id=entry.get("runtime_task_id", ""))
        if action == "execution.cancel":
            _transition_cancel(db, project, state, canonical, run)
        elif run:
            _observe(db, project, state, canonical, store, principal)
        result = {"run_id": run["id"] if run else "", "run_version": run["version"] if run else 0,
                  "replayed_runtime": cached is not None}
        if action in {"execution.start", "execution.retry"} or (action == "execution.approval" and body.decision == "approve"):
            result["start_run"] = {"workspace_id": entry["workspace_id"], "run_id": run["id"],
                                   "attempt": body.attempt + 1 if action == "execution.retry" else body.attempt,
                                   "resume": resume}
        return canonical["id"], before, result
    except CoreError as exc:
        raise _error(exc) from exc
