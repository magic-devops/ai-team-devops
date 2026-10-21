"""Bounded external work-order metadata and explicit protected packet reads."""
from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select

from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_external_work_order_contract import MAX_PACKET_BYTES
from .delivery_external_work_order_model import DeliveryExternalWorkOrder as Order
from .delivery_external_work_order_service import (
    _fresh, access, assert_order_access, current_sources, date, executors, fail, load_order, prepare,
)
from .delivery_query_index import scope
from .delivery_query_read import _now, _stamp, metadata

PUBLIC_COLUMNS = [column for column in Order.__table__.c if column.key != "original"]


def _metadata(db, project):
    return metadata(db, project, _stamp(db, project, required=False))


def _same(db, project, stamp):
    if _metadata(db, project) != stamp:
        fail("work_order_catalogue_changed", "External work or project facts changed; reload this view.")


def current(db, project, user, task_id, *, store=None, execution=None):
    stamp = _metadata(db, project)
    _actor, _permissions, _context, fixed, boundary, reasons, selected = current_sources(db, project, user, task_id, store=store, execution=execution)
    resources = executors(db, project)
    if not any(resource["available"] for resource in resources):
        reasons.append({"code": "work_order_executor_unavailable", "message": "Add and enable a formal team agent or tool before dispatching."})
    _same(db, project, stamp)
    return {**stamp, "as_of": _now(), "task_id": task_id, "task_basis": fixed["task_basis"], "definition_digest": fixed["definition_digest"],
        "native_boundary_digest": boundary["digest"] if not boundary["reasons"] else None, "definition": fixed["definition"],
        "executors": resources, "active_work_order_id": selected.id if selected else None, "can_dispatch": not reasons, "reasons": reasons}


def preview(db, project, user, task_id, body, *, store=None, execution=None):
    view = current(db, project, user, task_id, store=store, execution=execution)
    try:
        proposal = prepare(db, project, user, task_id, body, store=store, execution=execution)
        _same(db, project, {key: view[key] for key in ("project_id", "version", "query_generation")})
        from .delivery_feedback_service import context_fields

        return {**view, **context_fields(proposal), "complete": True, "allowed": True, "preview_basis": proposal["preview_basis"],
            "packet_digest": proposal["packet_digest"], "executor": proposal["executor"], "max_packet_bytes": MAX_PACKET_BYTES}
    except HTTPException as exc:
        if exc.status_code not in {409, 413} or not isinstance(exc.detail, dict):
            raise
        return {**view, "complete": False, "allowed": False, "preview_basis": None, "packet_digest": None,
            "executor": None, "max_packet_bytes": MAX_PACKET_BYTES, "reasons": [*view["reasons"], exc.detail]}


def _delivery_states(db, project, rows):
    from .delivery_task_submission_model import DeliveryTaskSubmission as Submission, DeliveryTaskSubmissionDecision as Decision
    from .sql_models import DeliveryTaskReview

    ids = {row.submission_id for row in rows if row.submission_id}
    if not ids:
        return {}
    query = select(Submission.id, Submission.invalidated, Decision.decision, DeliveryTaskReview.invalidated.label("review_invalidated")).outerjoin(
        Decision, Decision.submission_id == Submission.id).outerjoin(DeliveryTaskReview, DeliveryTaskReview.id == Decision.review_id).where(
            *scope(project, Submission), Submission.id.in_(ids))
    return {row.id: "invalidated" if row.invalidated or row.review_invalidated else "accepted" if row.decision == "accept" else
        "changes_requested" if row.decision == "request_changes" else "awaiting_review" for row in db.execute(query)}


def summary(row, states):
    return {"id": row.id, "task_id": row.task_id, "task_title": row.task_title, "order_revision": row.revision, "state": row.state,
        "request_digest": row.request_digest, "packet_digest": row.packet_digest, "definition_digest": row.definition_digest,
        "native_boundary_digest": row.native_boundary_digest, "executor": deepcopy(row.executor), "requested_by": deepcopy(row.requested_by),
        "claimed_by": deepcopy(row.claimed_by), "created_at": date(row.created_at), "updated_at": date(row.updated_at), "claimed_at": date(row.claimed_at),
        "invalidated": row.invalidated, "invalidated_reason": row.invalidated_reason, "progress": deepcopy(row.progress),
        "submission": {"id": row.submission_id, "digest": row.submission_digest} if row.submission_id else None,
        "delivery_state": "invalidated" if row.invalidated and row.submission_id else states.get(row.submission_id), "closure": deepcopy(row.closure)}


def catalogue(db, project, user, *, task_id="", state="", limit=20, cursor="", store=None):
    if type(limit) is not int or not 1 <= limit <= 100 or state not in {"", "queued", "claimed", "cancel_requested", "reported", "closed"}:
        fail("work_order_page_invalid", "Choose a valid work-order state and page size 1..100.", 422)
    actor, _permissions = access(db, project, user)
    stamp = _metadata(db, project)
    filters = [project.tenant_id, project.id, actor.id, task_id, state, limit, stamp["version"], stamp["query_generation"]]
    predicate = [*scope(project, Order)]
    if task_id:
        predicate.append(Order.task_id == task_id)
    if state:
        predicate.append(Order.state == state)
    total = db.scalar(select(func.count()).select_from(Order).where(*predicate))
    query = select(*PUBLIC_COLUMNS).where(*predicate)
    if cursor:
        upper, position = decode_cursor(cursor, filters)
        if (upper != [stamp["version"], stamp["query_generation"]] or len(position) != 2
                or not all(isinstance(value, str) for value in position) or not position[0].endswith("Z")):
            fail("work_order_cursor_invalid", "Use the exact current work-order cursor.", 422)
        try:
            instant = datetime.fromisoformat(position[0][:-1])
        except ValueError:
            fail("work_order_cursor_invalid", "Use the exact current work-order cursor.", 422)
        query = query.where(or_(Order.created_at < instant, and_(Order.created_at == instant, Order.id < position[1])))
    query = query.order_by(Order.created_at.desc(), Order.id.desc()).limit(limit + 1)
    from .delivery_input_budget import CanonicalInputBudget

    # Fix the exact page identities before the budget helper removes ordering.
    # Measuring an unordered LIMIT could otherwise inspect a different page.
    identities = query.with_only_columns(Order.id, maintain_column_froms=True).subquery("work_order_page_ids")
    query = select(*PUBLIC_COLUMNS).where(*scope(project, Order), Order.id.in_(select(identities.c.id))).order_by(
        Order.created_at.desc(), Order.id.desc())
    CanonicalInputBudget({"bytes_used": 0}, code="work_order_page_budget").rows(db, query, PUBLIC_COLUMNS)
    rows = [SimpleNamespace(**dict(value)) for value in db.execute(query).mappings()]
    page = rows[:limit]
    for row in page:
        assert_order_access(db, project, actor, row, store=store)
    states = _delivery_states(db, project, page)
    _same(db, project, stamp)
    return {**stamp, "as_of": _now(), "items": [summary(row, states) for row in page], "total": total, "limit": limit,
        "next_cursor": encode_cursor(filters, [stamp["version"], stamp["query_generation"]], [date(page[-1].created_at), page[-1].id]) if len(rows) > limit else None}


def detail(db, project, user, identity, *, store=None, execution=None):
    from .delivery_feedback_service import context_fields

    actor, permissions = access(db, project, user)
    stamp = _metadata(db, project)
    row = load_order(db, project, identity)
    assert_order_access(db, project, actor, row, store=store)
    own = bool(row.claimed_by and row.claimed_by["id"] == actor.id)
    fresh, reasons = row.active_task_id is not None, []
    if not permissions["write"]:
        fresh = False
        reasons.append({"code": "work_order_write_required", "message": "Current project write permission is required."})
    elif row.active_task_id is not None:
        try:
            _fresh(db, project, actor, row, store, execution)
        except HTTPException as exc:
            fresh = False
            reasons.append(exc.detail if isinstance(exc.detail, dict) else {"code": "work_order_current_unavailable", "message": "The current fixed external scope is unavailable."})
    writable = permissions["write"]
    holding = row.state in {"claimed", "cancel_requested"}
    if row.state == "queued" and project.status != "active":
        reasons.append({"code": "project_not_active", "message": "Activate the project before claiming new external work."})
    _same(db, project, stamp)
    return {**stamp, **context_fields(row.original["packet"]), "as_of": _now(), "work_order": summary(row, _delivery_states(db, project, [row])),
        "definition": deepcopy(row.original["packet"]["definition"]), "instructions": row.original["packet"]["instructions"],
        "permissions": {"can_claim": fresh and row.state == "queued" and project.status == "active", "can_progress": fresh and own and holding,
            "can_cancel": writable and row.state in {"queued", "claimed"}, "can_release": writable and own and holding,
            "can_report": fresh and own and holding, "reasons": reasons}}


def packet(db, project, user, identity, *, store=None):
    actor, _permissions = access(db, project, user)
    stamp = _metadata(db, project)
    row = load_order(db, project, identity)
    assert_order_access(db, project, actor, row, store=store)
    _same(db, project, stamp)
    return {**stamp, "as_of": _now(), "work_order_id": row.id, "request_digest": row.request_digest,
        "packet_digest": row.packet_digest, "packet": deepcopy(row.original["packet"]), "max_packet_bytes": MAX_PACKET_BYTES}
