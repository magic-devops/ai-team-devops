"""Current project dependencies and verified delivery from their canonical SQL owner."""

from __future__ import annotations

from fastapi import HTTPException

from sop_manager.path_config import (
    request_scope_active,
    resolved_project_id,
    resolved_tenant_id,
)


def scoped_dependencies():
    """Return current verified completion and edges without creating business state."""
    if not request_scope_active():
        raise HTTPException(400, "An authenticated project scope is required")
    from . import sql_models
    from .delivery_service import initial_state, reconcile, records
    from .delivery_verification import VerificationContext

    tenant_id, project_id = resolved_tenant_id(), resolved_project_id()
    with sql_models.SessionLocal() as db:
        project = db.query(sql_models.Project).filter_by(id=project_id, tenant_id=tenant_id).first()
        if project is None:
            raise HTTPException(404, "Project not found in the authenticated scope")
        workspace = (
            db.query(sql_models.DeliveryWorkspace)
            .filter_by(
                project_id=project_id,
                tenant_id=tenant_id,
            )
            .first()
        )
        data = reconcile(db, project, workspace.data) if workspace else initial_state()
        context = VerificationContext(db, project, data)
        task_rows = records(db, sql_models.Task, project).all()
        task_ids = {task.id for task in task_rows}
        edges, explicit_blocks = [], {}
        for task in task_rows:
            planning = data.get("task_details", {}).get(task.id, {})
            for predecessor in dict.fromkeys(planning.get("depends_on") or []):
                edges.append(
                    {
                        "source_id": predecessor,
                        "target_id": task.id,
                        "type": "blocks",
                    }
                )
            reason = planning.get("blocked_reason") or data.get("flows", {}).get(task.req_id, {}).get(
                "blocked_reason"
            )
            if reason:
                explicit_blocks[task.id] = str(reason)
        return {
            "task_ids": task_ids,
            "edges": edges,
            "verified_completed": {task_id for task_id in task_ids if context.verified(task_id)},
            "explicit_blocks": explicit_blocks,
        }
