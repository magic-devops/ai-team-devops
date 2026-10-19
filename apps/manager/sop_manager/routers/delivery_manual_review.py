"""Human task review decisions, query projection and permanent invalidation."""

from datetime import datetime, timezone

from fastapi import HTTPException

from .delivery_service import identifier, initial_state, reconcile
from .delivery_task_contract import snapshots_match
from .delivery_verification import VerificationContext
from .sql_models import DeliveryTaskReview, DeliveryWorkspace

REASONS = {
    "manual_review_execution_managed": "Review this task through its execution evidence.",
    "task_owner_missing": "Assign a responsible project person or agent.",
    "task_owner_unavailable": "Choose an active available responsible project person or agent.",
    "manual_review_requirement_missing": "The linked requirement is no longer in this project.",
    "manual_review_permission_required": "Project approval permission is required.",
    "manual_review_not_completed": "Record task completion before accepting manual delivery.",
    "manual_review_task_blocked": "Resolve task and requirement blocking reasons first.",
    "manual_review_dependencies_blocked": "Verify predecessor delivery before accepting this task.",
}


def _fail(code, message=None):
    raise HTTPException(409, {"code": code, "message": message or REASONS[code]})


def current_review(context, task_id, *, can_approve):
    snapshot = context.snapshot(task_id)
    if snapshot is None:
        return None
    codes = []
    if task_id in context.executions:
        codes.append("manual_review_execution_managed")
    if not snapshot["owner"]:
        codes.append("task_owner_missing")
    elif not snapshot["owner"]["available"]:
        codes.append("task_owner_unavailable")
    if snapshot["task"]["req_id"] and snapshot["requirement"] is None:
        codes.append("manual_review_requirement_missing")
    eligible = not codes
    if not can_approve:
        codes.append("manual_review_permission_required")
    can_review = eligible and can_approve
    if snapshot["task"]["status"] != "completed":
        codes.append("manual_review_not_completed")
    if snapshot["task"]["blocked_reason"] or (snapshot["requirement"] or {}).get("blocked_reason"):
        codes.append("manual_review_task_blocked")
    blocked = context.blocked(task_id)
    if blocked:
        codes.append("manual_review_dependencies_blocked")
    definition_reasons = context.definition(task_id)["execution_gate"]["reasons"]
    return {
        **snapshot,
        "basis": context.basis(task_id),
        "eligible": eligible,
        "can_review": can_review,
        "can_accept": not codes and not definition_reasons,
        "reasons": [{"code": code, "message": REASONS[code]} for code in codes] + definition_reasons,
        "dependency_blocked": blocked,
        "verified": context.verified(task_id),
    }


def apply_review(db, project, user, data, body):
    context = VerificationContext(db, project, data)
    current = current_review(context, body.task_id, can_approve=True)
    if current is None:
        raise HTTPException(404, "Task not found in this project")
    if current["basis"] != body.basis:
        _fail(
            "task_review_basis_changed",
            "Task scope changed. Review and explicitly adopt the latest task basis.",
        )
    if not current["eligible"]:
        _fail(current["reasons"][0]["code"], current["reasons"][0]["message"])
    if body.decision == "accept" and not current["can_accept"]:
        _fail(current["reasons"][0]["code"], current["reasons"][0]["message"])
    review = DeliveryTaskReview(
        id=identifier("task-review"),
        tenant_id=project.tenant_id,
        project_id=project.id,
        task_id=body.task_id,
        reviewer_id=user.id,
        reviewer_name=user.username,
        decision=body.decision,
        task_basis=current["basis"],
        snapshot=context.snapshot(body.task_id),
        comment=body.comment,
        evidence_content=body.evidence_content,
        evidence_url=body.evidence_url,
    )
    db.add(review)
    if body.decision == "request_changes":
        context.tasks[body.task_id].status = "in_progress"
    return review.id, None, {"task_ids": [body.task_id]}


def invalidate_reviews(db, project, *, verification=None):
    """Called in a business transaction before its progress facts are captured."""
    if verification is None:
        workspace = db.get(DeliveryWorkspace, project.id)
        data = reconcile(db, project, workspace.data) if workspace else initial_state()
        verification = VerificationContext(db, project, data)
    context = verification
    rows = (
        db.query(DeliveryTaskReview)
        .filter_by(
            tenant_id=project.tenant_id,
            project_id=project.id,
            decision="accept",
            invalidated=False,
        )
        .all()
    )
    for row in rows:
        missing = row.task_id not in context.tasks
        if (
            missing
            or not snapshots_match(row.snapshot, context.snapshot(row.task_id))
            or row.task_id in context.executions
        ):
            row.invalidated = True
            row.invalidated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            row.invalidated_reason = "task_review_task_missing" if missing else "task_review_basis_changed"
    db.flush()
    context.reset_proof()
