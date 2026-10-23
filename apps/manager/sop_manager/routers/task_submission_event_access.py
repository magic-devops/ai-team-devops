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
        scopes = {entry["workspace_id"] for entry in context.data.get("executions", [])
                  if entry.get("task_id") == task_id and entry.get("workspace_id")}
        binding = report.get("work_order") if isinstance(report, dict) else None
        if binding is not None:
            from sqlalchemy import select
            from .delivery_external_work_order_model import DeliveryExternalWorkOrder as Order
            from .delivery_external_work_order_service import byte_size
            from .delivery_task_submission_contract import SubmissionWorkOrderBinding

            selected = SubmissionWorkOrderBinding.model_validate(binding)
            predicate = (Order.tenant_id == project.tenant_id, Order.project_id == project.id,
                         Order.task_id == task_id, Order.id == selected.id)
            size = db.scalar(select(byte_size(db, Order.runtime_scopes)).where(*predicate))
            if size is None or size > 1024 * 1024:
                return {"kind": PLAN_KIND, "unavailable": True}
            original_scopes = db.scalar(select(Order.runtime_scopes).where(*predicate))
            if (not isinstance(original_scopes, list)
                    or any(not isinstance(value, str) or not value or len(value) > 64 for value in original_scopes)):
                return {"kind": PLAN_KIND, "unavailable": True}
            scopes.update(original_scopes)
        if isinstance(report, dict) and {"rework_reference", "rework_basis"}.intersection(report):
            from sqlalchemy import select
            from .delivery_feedback_contract import FeedbackReference
            from .delivery_external_work_order_model import DeliveryExternalWorkOrder as Order
            from .delivery_external_work_order_service import byte_size
            from .delivery_task_submission_model import DeliveryTaskSubmission as Submission, DeliveryTaskSubmissionDecision as Decision
            from .delivery_feedback_service import _scopes

            selected = FeedbackReference.model_validate(report.get("rework_reference"))
            basis = report.get("rework_basis")
            if not isinstance(basis, str) or len(basis) != 64 or any(char not in "0123456789abcdef" for char in basis):
                return {"kind": PLAN_KIND, "unavailable": True}
            source = db.scalar(select(Submission.id).join(Decision, Decision.submission_id == Submission.id).where(
                Submission.tenant_id == project.tenant_id, Submission.project_id == project.id, Submission.task_id == task_id,
                Submission.id == selected.submission_id, Submission.submission_digest == selected.submission_digest,
                Decision.tenant_id == project.tenant_id, Decision.project_id == project.id, Decision.task_id == task_id,
                Decision.id == selected.decision_id, Decision.submission_digest == selected.submission_digest,
                Decision.decision == "request_changes"))
            if source is None:
                return {"kind": PLAN_KIND, "unavailable": True}
            scopes.update(submission_runtime_scopes(db, project, source))
            # The preview's current W may be displayed without a new explicit
            # stop binding. Retain its opaque scope at intake in that case too.
            predicate = (Order.tenant_id == project.tenant_id, Order.project_id == project.id, Order.active_task_id == task_id)
            size = db.scalar(select(byte_size(db, Order.runtime_scopes)).where(*predicate))
            if size is not None:
                if size > 1024 * 1024:
                    return {"kind": PLAN_KIND, "unavailable": True}
                scopes.update(_scopes(db.scalar(select(Order.runtime_scopes).where(*predicate))))
        return {"kind": PLAN_KIND, "runtime_scopes": sorted(scopes)}
    except (HTTPException, ValueError, TypeError):
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
