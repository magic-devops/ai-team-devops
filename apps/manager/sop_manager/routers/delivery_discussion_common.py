"""Narrow scope, identity and cursor primitives for independent discussion facts."""

import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select

from . import sql_models as m
from .auth_sql import check_project_access
from .delivery_activity_cursor import decode_cursor, encode_cursor


def fail(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def identifier():
    return uuid4().hex


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def date(value):
    return value.isoformat() + "Z"


def scope(project, model):
    return model.tenant_id == project.tenant_id, model.project_id == project.id


def authorize(db, user, pid):
    from .delivery import _permissions

    if not pid:
        raise HTTPException(400, "Select a project using X-Project-Id")
    if user is None:
        raise HTTPException(403, "An active account is required")
    actor = db.get(m.User, user.id, populate_existing=True)
    if actor is None or actor.status != "active":
        raise HTTPException(403, "An active account is required")
    project = db.get(m.Project, pid, populate_existing=True)
    if project is None:
        raise HTTPException(404, "Project not found")
    check_project_access(actor, pid, db)
    return project, actor, _permissions(db, actor, project)


def entity(db, project, kind, entity_id, *, required=True):
    model = {"requirement": m.Requirement, "task": m.Task, "issue": m.Issue}.get(kind)
    if model is None:
        fail("discussion_reference_invalid", "Unsupported canonical reference", 422)
    row = db.scalar(select(model).where(*scope(project, model), model.id == entity_id))
    if row is None and required:
        raise HTTPException(404, "Object not found in this project")
    return row


def subject(db, project, kind, entity_id):
    row = entity(db, project, kind, entity_id, required=False)
    return {
        "kind": kind,
        "id": entity_id,
        "missing": row is None,
        "title": row.title if row else None,
        "current_requirement_id": row.req_id or None if row is not None and kind == "task" else None,
    }


def thread(db, project, thread_id, *, lock=False):
    query = select(m.DeliveryDiscussionThread).where(
        *scope(project, m.DeliveryDiscussionThread), m.DeliveryDiscussionThread.id == thread_id
    )
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise HTTPException(404, "Discussion not found in this project")
    return row


def message(db, project, thread_id, message_id):
    row = db.scalar(
        select(m.DeliveryDiscussionMessage).where(
            *scope(project, m.DeliveryDiscussionMessage),
            m.DeliveryDiscussionMessage.thread_id == thread_id,
            m.DeliveryDiscussionMessage.id == message_id,
        )
    )
    if row is None:
        raise HTTPException(404, "Message not found in this discussion")
    return row


def version(db, project, thread_id, message_id, revision):
    row = db.scalar(
        select(m.DeliveryDiscussionMessageVersion).where(
            *scope(project, m.DeliveryDiscussionMessageVersion),
            m.DeliveryDiscussionMessageVersion.thread_id == thread_id,
            m.DeliveryDiscussionMessageVersion.message_id == message_id,
            m.DeliveryDiscussionMessageVersion.revision == revision,
        )
    )
    if row is None:
        raise HTTPException(404, "Message revision not found in this discussion")
    return row


def event_stamp(db, project, *, subject_kind=None, subject_id=None, thread_id=None):
    model = m.DeliveryDiscussionEvent
    query = select(func.max(model.seq)).where(*scope(project, model))
    if subject_kind:
        query = query.where(model.subject_kind == subject_kind, model.subject_id == subject_id)
    if thread_id:
        query = query.where(model.thread_id == thread_id)
    return db.scalar(query) or 0


def cursor(value, signature):
    try:
        return decode_cursor(value, signature)
    except HTTPException as exc:
        fail("discussion_cursor_invalid", "Cursor does not belong to this user, project or filter", 422)
        raise exc


def position(value, signature, upper, *, mutable=True):
    if not value:
        return 0
    saved, after = cursor(value, signature)
    if mutable and saved != upper:
        fail("discussion_cursor_stale", "Discussion changed. Reload the first page.")
    if len(after) != 1 or type(after[0]) is not int or after[0] < 0:
        fail("discussion_cursor_invalid", "Invalid discussion position", 422)
    return after[0]


def page(project, rows, total, limit, signature, upper, *, seq="created_seq"):
    has_more = len(rows) > limit
    token = encode_cursor(signature, upper, [getattr(rows[limit - 1], seq)]) if has_more else None
    return {
        "project_id": project.id,
        "as_of": date(now()),
        "total": total,
        "limit": limit,
        "has_more": has_more,
        "next_cursor": token,
    }


def unchanged(db, project, saved, **filters):
    if event_stamp(db, project, **filters) != saved:
        fail("discussion_cursor_stale", "Discussion changed during this read. Reload the first page.")
