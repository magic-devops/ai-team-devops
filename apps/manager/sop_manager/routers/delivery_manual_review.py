"""Human task review decisions, query projection and permanent invalidation."""

from datetime import datetime, timezone

from fastapi import HTTPException

from .delivery_service import identifier, initial_state, reconcile
from .delivery_verification import VerificationContext
from .sql_models import DeliveryTaskReview, DeliveryWorkspace

REASONS = {
    "manual_review_execution_managed": "Review this task through its execution evidence.",
    "manual_review_requires_human": "Assign this task to one active project human member.",
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
    if not snapshot["owner"] or snapshot["owner"]["kind"] != "human":
        codes.append("manual_review_requires_human")
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
    return {
        **snapshot,
        "basis": context.basis(task_id),
        "eligible": eligible,
        "can_review": can_review,
        "can_accept": not codes,
        "reasons": [{"code": code, "message": REASONS[code]} for code in codes],
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
        _fail(current["reasons"][0]["code"])
    if body.decision == "accept" and not current["can_accept"]:
        _fail(current["reasons"][0]["code"])
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
    return review.id, None


def _stamp(value):
    return value.isoformat() + "Z" if value else None


def list_reviews(db, project, task_id, *, can_approve, limit=20, cursor=""):
    workspace = db.get(DeliveryWorkspace, project.id)
    data = reconcile(db, project, workspace.data) if workspace else initial_state()
    context = VerificationContext(db, project, data)
    query = db.query(DeliveryTaskReview).filter_by(
        tenant_id=project.tenant_id,
        project_id=project.id,
        task_id=task_id,
    )
    total = query.count()
    if task_id not in context.tasks and not total:
        raise HTTPException(404, "Task reviews not found in this project")
    current = current_review(context, task_id, can_approve=can_approve)
    if cursor:
        previous = query.filter_by(id=cursor).first()
        if previous is None:
            raise HTTPException(404, "Review cursor not found for this project and task")
        query = query.filter(DeliveryTaskReview.seq < previous.seq)
    page = query.order_by(DeliveryTaskReview.seq.desc()).limit(limit + 1).all()
    rows = page[:limit]
    latest = context.reviews.get(task_id)
    result = []
    for row in rows:
        valid = (
            latest is row
            and row.decision == "accept"
            and not row.invalidated
            and current is not None
            and current["verified"]
            and row.task_basis == current["basis"]
        )
        result.append(
            {
                "id": row.id,
                "task_id": row.task_id,
                "decision": row.decision,
                "created_at": _stamp(row.created_at),
                "reviewer": {"id": row.reviewer_id, "name": row.reviewer_name},
                "task_basis": row.task_basis,
                "snapshot": row.snapshot,
                "comment": row.comment,
                "evidence_content": row.evidence_content,
                "evidence_url": row.evidence_url,
                "source": "manual",
                "invalidated": row.invalidated,
                "invalidated_at": _stamp(row.invalidated_at),
                "invalidated_reason": row.invalidated_reason,
                "valid": bool(valid),
            }
        )
    return {
        "project_id": project.id,
        "task_id": task_id,
        "version": workspace.version if workspace else 0,
        "as_of": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "current": current,
        "reviews": result,
        "total": total,
        "next_cursor": rows[-1].id if len(page) > limit else None,
        "limit": limit,
    }


def invalidate_reviews(db, project):
    """Called in a business transaction before its progress facts are captured."""
    workspace = db.get(DeliveryWorkspace, project.id)
    data = reconcile(db, project, workspace.data) if workspace else initial_state()
    context = VerificationContext(db, project, data)
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
        if missing or row.task_basis != context.basis(row.task_id) or row.task_id in context.executions:
            row.invalidated = True
            row.invalidated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            row.invalidated_reason = "task_review_task_missing" if missing else "task_review_basis_changed"
    db.flush()
