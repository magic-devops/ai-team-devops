"""SQL-windowed discussion and immutable provenance projections."""

from sqlalchemy import and_, func, literal, select

from . import sql_models as m
from .delivery_discussion_common import (
    cursor,
    date,
    entity,
    event_stamp,
    fail,
    message,
    now,
    page,
    position,
    scope,
    subject,
    thread,
    unchanged,
    version,
)
from .delivery_discussion_sources import public_link, public_refs


def _resolution(db, project, row):
    if not row.current_resolution_event_id:
        return None
    event = db.scalar(
        select(m.DeliveryDiscussionEvent).where(
            *scope(project, m.DeliveryDiscussionEvent),
            m.DeliveryDiscussionEvent.id == row.current_resolution_event_id,
            m.DeliveryDiscussionEvent.thread_id == row.id,
        )
    )
    if event is None:
        return None
    return {
        "event_id": event.id,
        "message_id": event.data["message_id"],
        "message_revision": event.data["message_revision"],
        "note": event.data.get("note", ""),
    }


def thread_item(db, project, row, *, selected_subject=None, selected_resolution=None, preloaded=False):
    return {
        "id": row.id,
        "subject": selected_subject if preloaded else subject(db, project, row.subject_kind, row.subject_id),
        "title": row.title,
        "state": row.state,
        "version": row.version,
        "created_seq": row.created_seq,
        "created_by": {"id": row.created_by_id, "name": row.created_by_name},
        "created_at": date(row.created_at),
        "last_activity_at": date(row.last_activity_at),
        "current_resolution": selected_resolution if preloaded else _resolution(db, project, row),
    }


def _thread_items(db, project, rows):
    subjects, resolutions = {}, {}
    for kind, model in (("requirement", m.Requirement), ("task", m.Task), ("issue", m.Issue)):
        ids = {row.subject_id for row in rows if row.subject_kind == kind}
        if not ids:
            continue
        requirement = model.req_id if kind == "task" else literal(None)
        for entity_id, title, req_id in db.execute(
            select(model.id, model.title, requirement).where(*scope(project, model), model.id.in_(ids))
        ):
            subjects[(kind, entity_id)] = {
                "kind": kind,
                "id": entity_id,
                "missing": False,
                "title": title,
                "current_requirement_id": req_id or None,
            }
    event_ids = [row.current_resolution_event_id for row in rows if row.current_resolution_event_id]
    if event_ids:
        for event_id, data in db.execute(
            select(m.DeliveryDiscussionEvent.id, m.DeliveryDiscussionEvent.data).where(
                *scope(project, m.DeliveryDiscussionEvent), m.DeliveryDiscussionEvent.id.in_(event_ids)
            )
        ):
            resolutions[event_id] = {
                "event_id": event_id,
                "message_id": data["message_id"],
                "message_revision": data["message_revision"],
                "note": data.get("note", ""),
            }
    return [
        thread_item(
            db,
            project,
            row,
            preloaded=True,
            selected_subject=subjects.get(
                (row.subject_kind, row.subject_id),
                {
                    "kind": row.subject_kind,
                    "id": row.subject_id,
                    "missing": True,
                    "title": None,
                    "current_requirement_id": None,
                },
            ),
            selected_resolution=resolutions.get(row.current_resolution_event_id),
        )
        for row in rows
    ]


def thread_page(db, project, user, *, subject_kind=None, subject_id=None, state="all", limit=20, token=""):
    if bool(subject_kind) != bool(subject_id):
        fail(
            "discussion_scope_invalid",
            "Select both subject kind and subject ID, or explicit project scope",
            422,
        )
    filters = {"subject_kind": subject_kind, "subject_id": subject_id}
    stamp = event_stamp(db, project, **filters)
    query = select(m.DeliveryDiscussionThread).where(*scope(project, m.DeliveryDiscussionThread))
    if subject_kind:
        query = query.where(
            m.DeliveryDiscussionThread.subject_kind == subject_kind,
            m.DeliveryDiscussionThread.subject_id == subject_id,
        )
    if state != "all":
        query = query.where(m.DeliveryDiscussionThread.state == state)
    signature = [
        project.tenant_id,
        project.id,
        user.id,
        "discussion_threads",
        subject_kind,
        subject_id,
        state,
        limit,
    ]
    after = position(token, signature, [stamp])
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(
        query.where(m.DeliveryDiscussionThread.created_seq > after)
        .order_by(m.DeliveryDiscussionThread.created_seq)
        .limit(limit + 1)
    ).all()
    response = {
        **page(project, rows, total, limit, signature, [stamp]),
        "discussion_stamp": str(stamp),
        "scope": {**filters, "state": state},
        "items": _thread_items(db, project, rows[:limit]),
    }
    unchanged(db, project, stamp, **filters)
    return response


def thread_detail(db, project, user, permissions, thread_id):
    stamp = event_stamp(db, project, thread_id=thread_id)
    row = thread(db, project, thread_id)
    item = thread_item(db, project, row)
    writable = permissions["write"]
    creator = row.created_by_id == user.id or permissions["configure"]
    live = row.state != "archived"
    result = {
        "project_id": project.id,
        "discussion_stamp": str(stamp),
        "as_of": date(now()),
        "thread": item,
        "permissions": {"write": writable, "configure": permissions["configure"]},
        "capabilities": {
            "reply": writable and live and not item["subject"]["missing"],
            "resolve": writable and live and not item["subject"]["missing"],
            "reopen": writable and live,
            "archive": writable and live and creator,
            "restore": writable and not live and creator,
        },
    }
    unchanged(db, project, stamp, thread_id=thread_id)
    return result


def version_item(row, store, user, project):
    return {
        "revision": row.revision,
        "state": row.state,
        "body": row.body,
        "reason": row.reason,
        "refs": public_refs(row.refs, store, user, project),
        "editor": {"id": row.editor_id, "name": row.editor_name},
        "created_at": date(row.created_at),
    }


def message_item(
    db, project, user, permissions, current_thread, row, current_version, *, store=None, subject_missing=None
):
    if subject_missing is None:
        subject_missing = (
            entity(db, project, current_thread.subject_kind, current_thread.subject_id, required=False)
            is None
        )
    live = permissions["write"] and current_thread.state != "archived" and current_version.state == "active"
    return {
        "id": row.id,
        "thread_id": row.thread_id,
        "parent_message_id": row.parent_message_id,
        "author": {"id": row.author_id, "name": row.author_name},
        "created_seq": row.created_seq,
        "created_at": date(row.created_at),
        "revision": row.current_revision,
        "state": current_version.state,
        "body": current_version.body,
        "reason": current_version.reason,
        "refs": public_refs(current_version.refs, store, user, project),
        "edited_at": date(current_version.created_at),
        "can_edit": live and not subject_missing and user.id == row.author_id,
        "can_withdraw": live and (user.id == row.author_id or permissions["configure"]),
    }


def message_page(db, project, user, permissions, thread_id, *, limit=20, token="", store=None):
    stamp = event_stamp(db, project, thread_id=thread_id)
    current = thread(db, project, thread_id)
    missing = entity(db, project, current.subject_kind, current.subject_id, required=False) is None
    model, versions = m.DeliveryDiscussionMessage, m.DeliveryDiscussionMessageVersion
    query = (
        select(model, versions)
        .join(versions, and_(versions.message_id == model.id, versions.revision == model.current_revision))
        .where(*scope(project, model), *scope(project, versions), model.thread_id == current.id)
    )
    signature = [project.tenant_id, project.id, user.id, "discussion_messages", current.id, limit]
    upper = [stamp, current.version]
    after = position(token, signature, upper)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(
        query.where(model.created_seq > after).order_by(model.created_seq).limit(limit + 1)
    ).all()
    result = {
        **page(project, [row[0] for row in rows], total, limit, signature, upper),
        "thread_id": current.id,
        "thread_version": current.version,
        "discussion_stamp": str(stamp),
        "items": [
            message_item(
                db, project, user, permissions, current, row, revision, store=store, subject_missing=missing
            )
            for row, revision in rows[:limit]
        ],
    }
    unchanged(db, project, stamp, thread_id=current.id)
    return result


def message_detail(db, project, user, permissions, thread_id, message_id, *, store=None):
    stamp = event_stamp(db, project, thread_id=thread_id)
    current = thread(db, project, thread_id)
    row = message(db, project, thread_id, message_id)
    result = {
        "project_id": project.id,
        "thread_id": thread_id,
        "thread_version": current.version,
        "message": message_item(
            db,
            project,
            user,
            permissions,
            current,
            row,
            version(db, project, thread_id, row.id, row.current_revision),
            store=store,
        ),
    }
    unchanged(db, project, stamp, thread_id=thread_id)
    return result


def version_page(db, project, user, thread_id, message_id, *, limit=20, token="", store=None):
    thread(db, project, thread_id)
    row = message(db, project, thread_id, message_id)
    signature = [project.tenant_id, project.id, user.id, "discussion_versions", thread_id, message_id, limit]
    upper, after = row.current_revision, 0
    if token:
        saved, saved_after = cursor(token, signature)
        if (
            len(saved) != 1
            or type(saved[0]) is not int
            or not 1 <= saved[0] <= row.current_revision
            or len(saved_after) != 1
            or type(saved_after[0]) is not int
        ):
            fail("discussion_cursor_invalid", "Invalid history cursor", 422)
        upper, after = saved[0], saved_after[0]
    model = m.DeliveryDiscussionMessageVersion
    query = select(model).where(
        *scope(project, model),
        model.thread_id == thread_id,
        model.message_id == message_id,
        model.revision <= upper,
    )
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.where(model.revision > after).order_by(model.revision).limit(limit + 1)).all()
    return {
        **page(project, rows, total, limit, signature, [upper], seq="revision"),
        "thread_id": thread_id,
        "message_id": message_id,
        "upper_revision": upper,
        "items": [version_item(row, store, user, project) for row in rows[:limit]],
    }


def _legacy(db, project, user, kind, target_id, *, store=None):
    from fastapi import HTTPException

    from .delivery_discussion_sources import assert_runtime_scopes
    from .delivery_query_read import workspace_path

    result = []
    if kind == "requirement":
        issue_id = workspace_path(db, project, "flows", target_id, "source_issue_id")
        diagnosis = workspace_path(db, project, "flows", target_id, "source_diagnosis")
        if issue_id:
            issue = entity(db, project, "issue", str(issue_id), required=False)
            result.append(
                {
                    "kind": "issue",
                    "id": str(issue_id),
                    "label": issue.title if issue else "Recorded issue",
                    "target": {
                        "project_id": project.id,
                        "view": "issues",
                        "detail": "details",
                        "issue_id": str(issue_id),
                    }
                    if issue
                    else None,
                    "unavailable": issue is None,
                }
            )
        if isinstance(diagnosis, dict) and diagnosis.get("id"):
            model = m.IssueDiagnosis
            row = db.execute(
                select(model.issue_id, model.data["runtime_scopes"]).where(
                    *scope(project, model), model.id == diagnosis["id"]
                )
            ).first()
            available = row is not None
            if available:
                try:
                    assert_runtime_scopes(store, user, project, row[1] or [])
                except HTTPException:
                    available = False
            result.append(
                {
                    "kind": "diagnosis",
                    "id": diagnosis["id"],
                    "label": "Recorded issue diagnosis",
                    "target": {
                        "project_id": project.id,
                        "view": "issues",
                        "detail": "details",
                        "issue_id": row[0],
                    }
                    if available
                    else None,
                    "unavailable": not available,
                }
            )
    elif kind == "task":
        preview_id = workspace_path(db, project, "task_details", target_id, "preview_id")
        if preview_id:
            model = m.DeliveryPlanPreview
            row = db.execute(
                select(model.user_id, model.data[("snapshot", "id")].as_string()).where(
                    *scope(project, model), model.id == str(preview_id)
                )
            ).first()
            available = row is not None and row[0] == user.id and bool(row[1])
            if available:
                available = entity(db, project, "requirement", row[1], required=False) is not None
            result.append(
                {
                    "kind": "plan",
                    "id": str(preview_id),
                    "label": "Recorded task plan",
                    "target": {
                        "project_id": project.id,
                        "view": "requirements",
                        "detail": "tasks",
                        "requirement_id": row[1],
                        "task_id": target_id,
                    }
                    if available
                    else None,
                    "unavailable": not available,
                }
            )
    return result


def source_page(
    db,
    project,
    user,
    *,
    target_kind=None,
    target_id=None,
    thread_id=None,
    resolution_event_id=None,
    limit=20,
    token="",
    store=None,
):
    model = m.DeliverySourceLink
    filters = [*scope(project, model)]
    if thread_id:
        thread(db, project, thread_id)
        filters.append(model.thread_id == thread_id)
        if resolution_event_id:
            filters.append(model.source_id == resolution_event_id)
    else:
        if not target_kind or not target_id:
            fail("discussion_scope_invalid", "Select a target kind and ID", 422)
        filters += [model.target_kind == target_kind, model.target_id == target_id]

    def watermark():
        links = db.scalar(select(func.max(model.seq)).where(*filters)) or 0
        events = (
            db.scalar(
                select(func.max(m.DeliveryDiscussionEvent.seq)).where(
                    *scope(project, m.DeliveryDiscussionEvent),
                    m.DeliveryDiscussionEvent.thread_id.in_(select(model.thread_id).where(*filters)),
                )
            )
            or 0
        )
        return [events, links]

    stamp = watermark()
    signature = [
        project.tenant_id,
        project.id,
        user.id,
        "discussion_sources",
        target_kind,
        target_id,
        thread_id,
        resolution_event_id,
        limit,
    ]
    after = position(token, signature, stamp)
    query = select(model).where(*filters)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.where(model.seq > after).order_by(model.seq).limit(limit + 1)).all()
    result = {
        **page(project, rows, total, limit, signature, stamp, seq="seq"),
        "discussion_stamp": ":".join(map(str, stamp)),
        "items": [public_link(db, project, user, row, store=store) for row in rows[:limit]],
        "legacy_sources": _legacy(db, project, user, target_kind, target_id, store=store)
        if not thread_id
        else [],
    }
    if watermark() != stamp:
        fail("discussion_cursor_stale", "Discussion sources changed during this read")
    return result
