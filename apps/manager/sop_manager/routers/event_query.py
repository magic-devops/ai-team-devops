"""Bounded SQL event facts and exact immutable attempt history."""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import load_only

from . import sql_models as m
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .event_common import authorize, date, fail, inbox, now, processing, scope


def watermark(db, project):
    return [
        db.scalar(select(func.max(m.EventInbox.seq)).where(*scope(project, m.EventInbox))) or 0,
        db.scalar(
            select(func.max(m.EventProcessingAttempt.seq)).where(*scope(project, m.EventProcessingAttempt))
        )
        or 0,
    ]


def cursor_position(token, signature, upper, *, mutable=True):
    if not token:
        return upper, 0
    try:
        saved, after = decode_cursor(token, signature)
    except HTTPException:
        fail("event_cursor_invalid", "Cursor does not match this scope and filter", 422)
    if (
        len(after) != 1
        or type(after[0]) is not int
        or after[0] < 0
        or not saved
        or any(type(v) is not int or v < 0 for v in saved)
    ):
        fail("event_cursor_invalid", "Invalid event cursor", 422)
    if mutable and saved != upper:
        fail("event_cursor_stale", "Events changed; reload the first page")
    return saved, after[0]


def summary(original, row):
    return {
        "id": original.id,
        "event_id": original.event_id,
        "digest": original.digest,
        "type": original.event_type,
        "subject": original.subject,
        "source": original.source,
        "producer": {"kind": "user", "id": original.producer_id},
        "stored_at": date(original.stored_at),
        "processing": processing(row),
    }


def page(project, items, total, limit, signature, upper, last):
    more = len(items) > limit
    return {
        "project_id": project.id,
        "as_of": date(now()),
        "items": items[:limit],
        "total": total,
        "limit": limit,
        "has_more": more,
        "next_cursor": encode_cursor(signature, upper, [last]) if more else None,
    }


def list_events(db, project, user, permissions, *, state, event_type, producer_id, limit, cursor, store=None):
    saved = watermark(db, project)
    signature = ["event-list", project.tenant_id, project.id, user.id, state, event_type, producer_id, limit]
    upper, after = cursor_position(cursor, signature, saved)
    filters = [*scope(project, m.EventInbox), m.EventInbox.seq <= upper[0]]
    if state != "all":
        filters.append(m.EventProcessing.state == state)
    if event_type:
        filters.append(m.EventInbox.event_type == event_type)
    if producer_id:
        filters.append(m.EventInbox.producer_id == producer_id)
    query = (
        select(m.EventInbox, m.EventProcessing)
        .join(m.EventProcessing, m.EventProcessing.id == m.EventInbox.id)
        .where(*filters)
    )
    total = db.scalar(
        select(func.count())
        .select_from(m.EventInbox)
        .join(m.EventProcessing, m.EventProcessing.id == m.EventInbox.id)
        .where(*filters)
    )
    query = query.options(
        load_only(
            m.EventInbox.seq,
            m.EventInbox.id,
            m.EventInbox.event_id,
            m.EventInbox.digest,
            m.EventInbox.event_type,
            m.EventInbox.subject,
            m.EventInbox.source,
            m.EventInbox.producer_id,
            m.EventInbox.stored_at,
        ),
        load_only(
            m.EventProcessing.id,
            m.EventProcessing.state,
            m.EventProcessing.revision,
            m.EventProcessing.handler,
            m.EventProcessing.operation_id,
            m.EventProcessing.attempts,
            m.EventProcessing.updated_at,
            m.EventProcessing.processed_at,
            m.EventProcessing.reason_code,
            m.EventProcessing.retryable,
            m.EventProcessing.result,
        ),
    )
    rows = db.execute(query.where(m.EventInbox.seq > after).order_by(m.EventInbox.seq).limit(limit + 1)).all()
    # A light generic directory cannot verify the original bytes. It always
    # redacts reflection source/subject/effect; exact views use the full shared
    # visibility and integrity check before exposing any original or attempt.
    from .reflection_intake import is_reflection, recorded_receipts

    recorded = recorded_receipts(db, project, [original.id for original, _ in rows])
    items = []
    for original, row in rows:
        value = summary(original, row)
        if original.event_type == "sop.task.delivery_submitted":
            value["source"], value["subject"] = "", ""
            value["processing"] = {**value["processing"], "result": None}
        if is_reflection(original, row, recorded=original.id in recorded, metadata_only=True):
            value["source"], value["subject"] = "", ""
            value["processing"] = {**value["processing"], "result": None}
        items.append(value)
    answer = page(
        project,
        items,
        total,
        limit,
        signature,
        upper,
        rows[limit - 1][0].seq if len(rows) > limit else 0,
    )
    answer["permissions"] = {
        "read": True,
        "configure": permissions["configure"] and project.status != "archived",
    }
    if watermark(db, project) != saved:
        fail("event_cursor_stale", "Events changed during this read")
    return answer


def attempts(db, project, user, rid, limit, cursor, *, store=None):
    original = inbox(db, project, rid)
    from .reflection_intake import require_visible

    require_visible(original, db.get(m.EventProcessing, rid), project, user, store)
    from .task_submission_event_access import require_submission_event_access

    require_submission_event_access(db, project, user, original, db.get(m.EventProcessing, rid), store)
    statement = select(m.EventProcessingAttempt).where(
        *scope(project, m.EventProcessingAttempt), m.EventProcessingAttempt.receipt_id == rid
    )
    latest = (
        db.scalar(
            select(func.max(m.EventProcessingAttempt.seq)).where(
                *scope(project, m.EventProcessingAttempt), m.EventProcessingAttempt.receipt_id == rid
            )
        )
        or 0
    )
    signature = ["event-attempts", project.tenant_id, project.id, user.id, rid, limit]
    upper, after = cursor_position(cursor, signature, [latest], mutable=False)
    query = statement.where(m.EventProcessingAttempt.seq <= upper[0])
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(
        query.where(m.EventProcessingAttempt.seq > after)
        .order_by(m.EventProcessingAttempt.seq)
        .limit(limit + 1)
    ).all()
    items = [
        {
            "id": r.id,
            "seq": r.seq,
            "actor": {"kind": "user", "id": r.actor_id},
            "action": r.action,
            "created_at": date(r.created_at),
            "from_state": r.from_state,
            "to_state": r.to_state,
            "error": r.error,
            "result": r.result,
        }
        for r in rows
    ]
    return {
        **page(
            project, items, total, limit, signature, upper, rows[limit - 1].seq if len(rows) > limit else 0
        ),
        "receipt_id": rid,
    }


def capability(db, project, user, permissions, original, row):
    reason = None
    if not permissions["configure"]:
        reason = "configure_required"
    elif project.status == "archived":
        reason = "project_archived"
    elif row.state == "processed":
        reason = "already_processed"
    elif not row.handler:
        reason = "handler_not_configured"
    elif row.state == "failed" and not row.retryable:
        reason = "nonretryable"
    else:
        try:
            _, _, producer_permissions, _ = authorize(db, db.get(m.User, original.producer_id), project.id)
            if not producer_permissions["write"]:
                reason = "producer_denied"
        except HTTPException:
            reason = "producer_denied"
    return {"retry": reason is None, "retry_reason_code": reason}


def detail(db, project, user, permissions, rid, *, store=None):
    saved = watermark(db, project)
    original = inbox(db, project, rid)
    row = db.get(m.EventProcessing, rid)
    from .reflection_intake import require_visible

    require_visible(original, row, project, user, store)
    from .task_submission_event_access import require_submission_event_access

    require_submission_event_access(db, project, user, original, row, store)
    result = {
        "project_id": project.id,
        "as_of": date(now()),
        "event": summary(original, row),
        "event_json": original.event_json,
        "attempts": attempts(db, project, user, rid, 20, None, store=store),
        "permissions": {"read": True, "configure": permissions["configure"] and project.status != "archived"},
        "capabilities": capability(db, project, user, permissions, original, row),
    }
    if watermark(db, project) != saved:
        fail("event_cursor_stale", "Events changed during this read")
    return result
