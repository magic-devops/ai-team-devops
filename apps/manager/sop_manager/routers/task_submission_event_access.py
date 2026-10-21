"""The event receipt cannot bypass the fixed report's original runtime scopes."""
from fastapi import HTTPException

from .delivery_issue_evidence import assert_evidence_access
from .delivery_task_submission_service import _actor, submission_runtime_scopes

EVENT_TYPE = "sop.task.delivery_submitted"
PLAN_KIND = "task-delivery-scope.v1"


def plan_submission_event(db, project, event):
    """Freeze opaque original scopes at intake, without runtime calls or writes."""
    from .delivery_task_submission_query import _context

    report = event.data.get("report")
    task_id = report.get("task_id") if isinstance(report, dict) else event.subject
    if not isinstance(task_id, str) or not 1 <= len(task_id) <= 64:
        return {"kind": PLAN_KIND, "unavailable": True}
    try:
        context = _context(db, project, task_id)
        scopes = sorted({entry["workspace_id"] for entry in context.data.get("executions", [])
                         if entry.get("task_id") == task_id and entry.get("workspace_id")})
        return {"kind": PLAN_KIND, "runtime_scopes": scopes}
    except HTTPException:
        # Durable intake still retains an invalid/unavailable report. No guessed
        # empty runtime scope permits reading that original as project-only data.
        return {"kind": PLAN_KIND, "unavailable": True}


def require_submission_event_access(db, project, user, original, processing, store=None):
    if original.event_type != EVENT_TYPE:
        return
    current, _permissions = _actor(db, project, user)
    effect = processing.result or {}
    if (processing.state == "processed" and effect.get("kind") == "task_delivery_submitted"
            and effect.get("target_kind") == "task_submission" and isinstance(effect.get("target_id"), str)):
        scopes = submission_runtime_scopes(db, project, effect["target_id"])
    else:
        plan = processing.plan
        if (not isinstance(plan, dict) or plan.get("kind") != PLAN_KIND or plan.get("unavailable")
                or set(plan) != {"kind", "runtime_scopes"} or not isinstance(plan["runtime_scopes"], list)
                or any(not isinstance(value, str) or not value or len(value) > 64 for value in plan["runtime_scopes"])):
            raise HTTPException(403, {"code": "submission_event_scope_unavailable", "message": "The original report scope cannot be verified."})
        scopes = plan["runtime_scopes"]
    assert_evidence_access(store, current, project, scopes)
