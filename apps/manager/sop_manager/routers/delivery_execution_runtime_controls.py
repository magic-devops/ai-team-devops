"""Fixed control admission; external effects belong to the durable worker."""

from fastapi import HTTPException
from hermes_core.models import CoreError

from .delivery_execution_runtime import (
    _basis,
    _error,
)


def _authority(db, project, user, action, principal, run):
    from .delivery import _role_permissions

    permissions = _role_permissions(db, user, project)
    needed = "approve" if action == "execution.approval" else "write"
    if project.status == "archived":
        raise HTTPException(409, {"code": "project_archived", "message": "Restore the project before changing execution."})
    if not permissions[needed] or "execute" not in principal.permissions:
        raise HTTPException(403, {"code": "execution_permission_required",
                                  "message": "Current project and runtime execution permission are required."})
    recovery_review = action == "execution.retry" and run and run["data"].get("recovery_requires_review")
    if (action == "execution.approval" or recovery_review) and (
        not permissions["approve"] or "approve" not in principal.permissions
    ):
        raise HTTPException(403, {"code": "approval_permission_required",
                                  "message": "Current project and runtime approval permission are required."})
    return permissions


def _validate_fixed_preview(db, project, state, entry, workspace, run, approval, controls, body, action, capability):
    if run and (body.run_version > run["version"] or action != "execution.cancel" and body.run_version != run["version"]):
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
    """Accept the fixed original atomically with the outer SQL command receipt."""
    from .delivery_execution_control_operation_service import accept_control

    try:
        return accept_control(db, project, user, state, action, body, store, execution, command_key=command_key)
    except CoreError as exc:
        raise _error(exc) from exc
