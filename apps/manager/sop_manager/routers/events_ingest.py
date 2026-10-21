"""Durable authenticated frozen-event handoff, separate from business completion."""

import json
import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from sop_manager.project_write_guard import require_project_operation

from . import event_contract as c
from . import sql_models as m
from .auth_sql import current_user_or_apikey
from .event_common import (
    authorize,
    date,
    digest,
    fail,
    identifier,
    inbox,
    now,
    parse,
    processing,
    scope_key,
)
from .event_contract import IngestIn as IngestIn
from .event_contract import IngestOut as IngestOut
from .event_processing import handler, original_version, process

router = APIRouter(prefix="/api/v1/events", tags=["events"])
_log = logging.getLogger("sop.events")


def _identity(project, user):
    return {"tenant_id": project.tenant_id, "project_id": project.id, "producer_id": user.id}


@router.get(":identity", response_model=c.Identity)
def identity(
    user: Annotated[m.User, Depends(current_user_or_apikey)],
    db: Annotated[Session, Depends(m.get_session)],
    request: Request,
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    project, actor, _, _ = authorize(db, user, project_id, request)
    return _identity(project, actor)


def _intake(db, project, user, credential, item, event):
    key = scope_key(project, user.id, item.id)
    row = db.scalar(select(m.EventInbox).where(m.EventInbox.scope_key == key))
    if row:
        if row.digest != item.digest:
            fail("event_digest_conflict", "This scoped ID already has different frozen bytes")
        return row, "duplicate"
    require_project_operation(db, project.tenant_id, project.id)
    rid = identifier()
    kind = handler(event)
    plan = None
    if event.type == "sop.task.delivery_submitted":
        from .task_submission_event_access import plan_submission_event

        plan = plan_submission_event(db, project, event)
    if kind == "sync.asset":
        from .event_assets import plan_asset

        try:
            expected = original_version(event.data)
            workspace = db.get(m.DeliveryWorkspace, project.id)
            if expected != (workspace.version if workspace else 0):
                fail("event_business_conflict", "Original project version changed")
            plan = plan_asset(project, event)
        except HTTPException as exc:
            plan = {
                "error": exc.detail["code"] if isinstance(exc.detail, dict) else "event_asset_plan_invalid"
            }
        except (OSError, ValueError):
            plan = {"error": "event_asset_plan_invalid"}
    row = m.EventInbox(
        id=rid,
        scope_key=key,
        tenant_id=project.tenant_id,
        project_id=project.id,
        producer_id=user.id,
        credential_id=credential,
        event_id=item.id,
        event_json=item.event_json,
        digest=item.digest,
        event_type=event.type,
        subject=event.subject,
        source=event.source,
        event_time=event.time,
    )
    db.add(row)
    db.flush()
    db.add(
        m.EventProcessing(
            id=rid,
            tenant_id=project.tenant_id,
            project_id=project.id,
            handler=kind,
            operation_id=rid if kind == "sync.asset" else None,
            plan=plan,
            state="pending",
            reason_code=None if kind else "handler_not_configured",
            retryable=bool(kind),
        )
    )
    db.flush()
    return row, "stored"


def _hint(project, row, state):
    try:
        from .ws_events import broadcast

        broadcast(
            project.id,
            {
                "type": "sop.event.received",
                "receipt_id": row.id,
                "event_id": row.event_id,
                "digest": row.digest,
                "processing_state": state,
            },
        )
    except Exception:
        _log.warning("event notification failed after committed receipt")


def _validate_batch(body, project, actor, permissions):
    if not permissions["write"]:
        fail("event_write_denied", "Project write permission required", 403)
    expected = (body.expected_tenant_id, body.expected_project_id, body.expected_producer_id)
    if expected != (project.tenant_id, project.id, actor.id):
        fail("event_identity_mismatch", "Authenticated identity does not match the frozen queue binding")
    if len({i.id for i in body.events}) != len(body.events):
        fail("event_batch_invalid", "Duplicate event IDs in one batch", 422)
    if sum(len(i.event_json.encode("utf-8", errors="surrogatepass")) for i in body.events) > 1048576:
        fail("event_batch_too_large", "Batch exceeds 1MiB", 422)


def _persist_batch(db, project, actor, credential, events):
    results = []
    accepted = []
    try:
        for item in events:
            try:
                event = parse(item, project)
                with db.begin_nested():
                    row, outcome = _intake(db, project, actor, credential, item, event)
                accepted.append((row.id, outcome))
                results.append(
                    {
                        "id": item.id,
                        "digest": item.digest,
                        "outcome": outcome,
                        "receipt_id": row.id,
                        "stored_at": date(row.stored_at),
                        "processing": None,
                        "error": None,
                    }
                )
            except HTTPException as exc:
                if exc.status_code >= 500:
                    raise
                detail = (
                    exc.detail
                    if isinstance(exc.detail, dict)
                    else {"code": "event_invalid", "message": "Event rejected"}
                )
                results.append(
                    {
                        "id": item.id,
                        "digest": item.digest,
                        "outcome": "rejected",
                        "receipt_id": None,
                        "stored_at": None,
                        "processing": None,
                        "error": {**detail, "retryable": False},
                    }
                )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return results, accepted


@router.post(":ingest", response_model=c.IngestOut)
def ingest(
    body: c.IngestIn,
    user: Annotated[m.User, Depends(current_user_or_apikey)],
    db: Annotated[Session, Depends(m.get_session)],
    request: Request,
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    project, actor, permissions, credential = authorize(db, user, project_id, request)
    _validate_batch(body, project, actor, permissions)
    # A duplicate-only request remains read-only even after project archive.
    existing = {scope_key(project, actor.id, i.id) for i in body.events}
    known = set(db.scalars(select(m.EventInbox.scope_key).where(m.EventInbox.scope_key.in_(existing))))
    if existing - known:
        require_project_operation(db, project.tenant_id, project.id)
        project, actor, permissions, credential = authorize(db, actor, project.id, request)
        if not permissions["write"]:
            fail("event_write_denied", "Project write permission required", 403)
    results, accepted = _persist_batch(db, project, actor, credential, body.events)
    for rid, outcome in accepted:
        row = db.get(m.EventProcessing, rid, populate_existing=True)
        if row.state == "pending" and row.handler and project.status != "archived":
            row = process(db, project, actor, rid, request)
        from .task_submission_event_access import require_submission_event_access

        require_submission_event_access(db, project, actor, inbox(db, project, rid), row,
            getattr(request.app.state, "hermes_store", None))
        for result in results:
            if result["receipt_id"] == rid:
                result["processing"] = processing(row)
        if outcome == "stored":
            _hint(project, inbox(db, project, rid), row.state)
    return {
        "tenant_id": project.tenant_id,
        "project_id": project.id,
        "producer": {"kind": "user", "id": actor.id},
        "as_of": date(now()),
        "results": results,
    }


@router.get("", response_model=c.EventPage)
def list_events(
    user: Annotated[m.User, Depends(current_user_or_apikey)],
    db: Annotated[Session, Depends(m.get_session)],
    request: Request,
    project_id: str = Header(default="", alias="X-Project-Id"),
    state: Literal["all", "pending", "processed", "failed"] = "all",
    type: str = Query(default="", max_length=160),
    producer_id: str = Query(default="", max_length=64),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
):
    from .event_query import list_events as query

    project, actor, permissions, _ = authorize(db, user, project_id, request)
    return query(
        db,
        project,
        actor,
        permissions,
        state=state,
        event_type=type,
        producer_id=producer_id,
        limit=limit,
        cursor=cursor,
    )


@router.get("/{receipt_id}", response_model=c.EventDetail)
def event_detail(
    receipt_id: str,
    user: Annotated[m.User, Depends(current_user_or_apikey)],
    db: Annotated[Session, Depends(m.get_session)],
    request: Request,
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .event_query import detail

    project, actor, permissions, _ = authorize(db, user, project_id, request)
    return detail(db, project, actor, permissions, receipt_id, store=getattr(request.app.state, "hermes_store", None))


@router.get("/{receipt_id}/attempts", response_model=c.AttemptPage)
def event_attempts(
    receipt_id: str,
    user: Annotated[m.User, Depends(current_user_or_apikey)],
    db: Annotated[Session, Depends(m.get_session)],
    request: Request,
    project_id: str = Header(default="", alias="X-Project-Id"),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
):
    from .event_query import attempts

    project, actor, _, _ = authorize(db, user, project_id, request)
    return attempts(db, project, actor, receipt_id, limit, cursor, store=getattr(request.app.state, "hermes_store", None))


@router.post("/{receipt_id}:retry", response_model=c.RetryAck)
def retry_event(
    receipt_id: str,
    body: c.RetryIn,
    user: Annotated[m.User, Depends(current_user_or_apikey)],
    db: Annotated[Session, Depends(m.get_session)],
    request: Request,
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .event_query import capability

    project, actor, permissions, _ = authorize(db, user, project_id, request)
    if not permissions["configure"]:
        fail("event_configure_required", "Project configure permission required", 403)
    if not body.reason.strip():
        fail("event_reason_required", "A reviewed recovery reason is required", 422)
    original = inbox(db, project, receipt_id)
    from .task_submission_event_access import require_submission_event_access

    require_submission_event_access(db, project, actor, original, db.get(m.EventProcessing, receipt_id),
        getattr(request.app.state, "hermes_store", None))
    key = digest(json.dumps([project.tenant_id, project.id, actor.id, receipt_id, body.idempotency_key]))
    fingerprint = digest(body.model_dump_json())
    saved = db.scalar(select(m.EventProcessingAttempt).where(m.EventProcessingAttempt.retry_key == key))
    if saved:
        if saved.request_hash != fingerprint:
            fail("event_idempotency_conflict", "Retry key already used with different input")
        return {**saved.ack, "replayed": True}
    require_project_operation(db, project.tenant_id, project.id)
    project, actor, permissions, _ = authorize(db, actor, project.id, request)
    require_submission_event_access(db, project, actor, original, db.get(m.EventProcessing, receipt_id, populate_existing=True),
        getattr(request.app.state, "hermes_store", None))
    saved = db.scalar(select(m.EventProcessingAttempt).where(m.EventProcessingAttempt.retry_key == key))
    if saved:
        if saved.request_hash != fingerprint:
            fail("event_idempotency_conflict", "Retry key already used with different input")
        return {**saved.ack, "replayed": True}
    row = db.get(m.EventProcessing, receipt_id, populate_existing=True)
    if not capability(db, project, actor, permissions, original, row)["retry"]:
        fail("event_retry_denied", "This original operation cannot be retried", 403)
    process(
        db,
        project,
        actor,
        receipt_id,
        request,
        retry={"key": key, "fingerprint": fingerprint, "revision": body.expected_revision},
    )
    saved = db.scalar(select(m.EventProcessingAttempt).where(m.EventProcessingAttempt.retry_key == key))
    require_submission_event_access(db, project, actor, original, db.get(m.EventProcessing, receipt_id, populate_existing=True),
        getattr(request.app.state, "hermes_store", None))
    return saved.ack
