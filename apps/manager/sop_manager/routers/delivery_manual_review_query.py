"""Independent current proof, small decision history and exact retained originals."""

from fastapi import HTTPException
from sqlalchemy import LargeBinary, Text, cast, func, or_, select

from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_manual_review import current_review
from .delivery_quality_scope import load_task_scope
from .delivery_query_index import scope
from .delivery_query_read import _now, _stamp, _unchanged, metadata
from .delivery_task_contract import snapshots_match
from .sql_models import DeliveryTaskReview, Task


def _date(value):
    return value.isoformat() + "Z" if value else None


def review_current(db, project, task_id, *, can_approve):
    with db.no_autoflush:
        stamp = _stamp(db, project)
        context = load_task_scope(db, project, task_id)
        current = current_review(context, task_id, can_approve=can_approve)
        latest = context.reviews.get(task_id)
        effective = bool(
            latest is not None
            and task_id not in context.executions
            and latest.decision == "accept"
            and not latest.invalidated
            and current["verified"]
            and snapshots_match(latest.snapshot, context.snapshot(task_id))
        )
        _unchanged(db, project, stamp)
        return {
            **metadata(db, project, stamp),
            "task_id": task_id,
            "as_of": _now(),
            "current": current,
            "effective_review_id": latest.id if effective else None,
        }


def _reviews(project, task_id):
    return (*scope(project, DeliveryTaskReview), DeliveryTaskReview.task_id == task_id)


def _summary(row):
    return {
        "id": row.id,
        "task_id": row.task_id,
        "decision": row.decision,
        "created_at": _date(row.created_at),
        "reviewer": {"id": row.reviewer_id, "name": row.reviewer_name},
        "task_basis": row.task_basis,
        "comment_summary": row.comment_summary,
        "has_evidence": bool(row.has_evidence),
        "source": "manual",
        "invalidated": row.invalidated,
        "invalidated_at": _date(row.invalidated_at),
        "invalidated_reason": row.invalidated_reason,
    }


def list_reviews(db, project, user, task_id, *, limit=20, cursor=""):
    if type(limit) is not int or not 1 <= limit <= 100:
        raise HTTPException(422, "Use a review page size of 1..100")
    review = DeliveryTaskReview
    filters = [project.tenant_id, project.id, user.id, "task-review-history", task_id, limit]
    with db.no_autoflush:
        after = None
        if cursor:
            upper, position = decode_cursor(cursor, filters)
            if (
                len(upper) != 1
                or len(position) != 1
                or type(upper[0]) is not int
                or type(position[0]) is not int
                or not 0 < position[0] <= upper[0]
            ):
                raise HTTPException(422, "Malformed review history cursor")
            maximum, after = upper[0], position[0]
        else:
            maximum = db.scalar(select(func.max(review.seq)).where(*_reviews(project, task_id))) or 0
        bounded = (*_reviews(project, task_id), review.seq <= maximum)
        total = db.scalar(select(func.count()).select_from(review).where(*bounded))
        if not total and not db.scalar(select(Task.id).where(*scope(project, Task), Task.id == task_id)):
            raise HTTPException(404, "Task reviews not found in this project")
        query = select(
            review.seq,
            review.id,
            review.task_id,
            review.decision,
            review.created_at,
            review.reviewer_id,
            review.reviewer_name,
            review.task_basis,
            func.substr(review.comment, 1, 240).label("comment_summary"),
            or_(review.evidence_content != "", review.evidence_url != "").label("has_evidence"),
            review.invalidated,
            review.invalidated_at,
            review.invalidated_reason,
        ).where(*bounded)
        if after is not None:
            query = query.where(review.seq < after)
        page = db.execute(query.order_by(review.seq.desc()).limit(limit + 1)).all()
        rows = page[:limit]
        return {
            "project_id": project.id,
            "task_id": task_id,
            "as_of": _now(),
            "reviews": [_summary(row) for row in rows],
            "total": total,
            "limit": limit,
            "next_cursor": encode_cursor(filters, [maximum], [rows[-1].seq]) if len(page) > limit else None,
        }


def review_detail(db, project, task_id, review_id):
    review = DeliveryTaskReview
    filters = (*_reviews(project, task_id), review.id == review_id)
    with db.no_autoflush:
        fields = (review.snapshot, review.comment, review.evidence_content, review.evidence_url)
        sizes = db.execute(
            select(
                *(
                    func.length(cast(field, LargeBinary))
                    if db.bind.dialect.name == "sqlite"
                    else func.octet_length(cast(field, Text))
                    for field in fields
                )
            ).where(*filters)
        ).first()
        if sizes is None:
            raise HTTPException(404, "Review not found for this project and task")
        if any((size or 0) > 1024 * 1024 for size in sizes):
            raise HTTPException(
                413,
                {
                    "code": "task_review_original_too_large",
                    "message": "The selected review original exceeds its bounded read budget.",
                },
            )
        row = db.execute(select(review.__table__).where(*filters)).mappings().one()
        value = {
            "id": row["id"],
            "task_id": row["task_id"],
            "decision": row["decision"],
            "created_at": _date(row["created_at"]),
            "reviewer": {"id": row["reviewer_id"], "name": row["reviewer_name"]},
            "task_basis": row["task_basis"],
            "snapshot": row["snapshot"],
            "comment": row["comment"],
            "evidence_content": row["evidence_content"],
            "evidence_url": row["evidence_url"],
            "source": "manual",
            "invalidated": row["invalidated"],
            "invalidated_at": _date(row["invalidated_at"]),
            "invalidated_reason": row["invalidated_reason"],
        }
        return {"project_id": project.id, "task_id": task_id, "as_of": _now(), "review": value}
