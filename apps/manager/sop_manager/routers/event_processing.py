"""Original-version business attempts after durable intake, never fake completion."""

import json
from contextlib import nullcontext

from fastapi import HTTPException
from pydantic import ValidationError

from sop_manager.project_write_guard import event_write_scope, require_project_operation

from . import sql_models as m
from .event_common import authorize, digest, fail, identifier, inbox, now, processing


def handler(event):
    known = {
        "sop.task.status_changed": "task.status",
        "sop.task.delivery_submitted": "task.delivery.submit",
        "sop.issue.opened": "issue.create",
        "sop.agent.heartbeat": "heartbeat.record",
    }
    if event.type == "sop.sync.push":
        module = event.data.get("module")
        return (
            "sync.asset"
            if isinstance(module, str) and module in {"rules", "specs", "templates"}
            else "sync.record"
        )
    return known.get(event.type)


def original_version(data):
    value = data.get("expected_version")
    if type(value) is not int or value < 0:
        fail("version_required", "The original expected_version is required", 422)
    return value


def command_for(event):
    from .delivery_contract import PAYLOADS, Command

    data = dict(event.data)
    expected = original_version(data)
    data.pop("expected_version")
    for key in ("tenant_id", "project_id"):
        data.pop(key, None)
    if event.type == "sop.task.delivery_submitted":
        if set(data) != {"report"} or not isinstance(data["report"], dict) or data["report"].get("task_id") != event.subject:
            fail("event_business_input_invalid", "The complete external report must fix the event's task", 422)
        action = "task.delivery.submit"
        payload = data["report"]
    elif event.type == "sop.task.status_changed":
        if set(data) - {"status", "notes", "confidence"}:
            fail("event_business_input_invalid", "Unsupported Task status fields", 422)
        if "notes" in data and (not isinstance(data["notes"], str) or len(data["notes"]) > 2000):
            fail("event_business_input_invalid", "Invalid audit notes", 422)
        if "confidence" in data and (
            type(data["confidence"]) not in {int, float} or not 0 <= data["confidence"] <= 1
        ):
            fail("event_business_input_invalid", "Invalid audit confidence", 422)
        action = "task.update"
        payload = {"id": event.subject, "status": data.get("status")}
        if payload["status"] is None:
            fail("event_business_input_invalid", "Task status is required", 422)
    elif event.type == "sop.issue.opened":
        action = "issue.create"
        payload = data
    else:
        action = "sync.record.apply"
        payload = data
    model = PAYLOADS[action].model_validate(payload)
    return Command(
        action=action, expected_version=expected, idempotency_key="event-placeholder", payload=payload
    ), model


def _effect(body, ack):
    if body.action == "task.delivery.submit":
        return {"kind": "task_delivery_submitted", "target_kind": "task_submission", "target_id": ack["resource"]["id"]}
    if body.action == "task.update":
        return {"kind": "task_updated", "target_kind": "task", "target_id": ack["resource"]["id"]}
    if body.action == "issue.create":
        return {"kind": "issue_created", "target_kind": "issue", "target_id": ack["resource"]["id"]}
    module = body.payload["module"]
    return {
        "kind": "record_deleted" if body.payload["action"] == "delete" else "record_upserted",
        "target_kind": {
            "tasks": "task",
            "requirements": "requirement",
            "issues": "issue",
            "sprints": "sprint",
        }[module],
        "target_id": ack["resource"]["id"],
    }


def _attempt(db, project, row, actor, action, result, error, retry=None):
    old = row.state
    row.state = "failed" if error else "processed"
    row.revision += 1
    row.attempts += 1
    row.updated_at = now()
    row.processed_at = None if error else now()
    row.reason_code = error["code"] if error else None
    row.retryable = error["retryable"] if error else False
    row.result = result
    entry = m.EventProcessingAttempt(
        id=identifier(),
        tenant_id=project.tenant_id,
        project_id=project.id,
        receipt_id=row.id,
        actor_id=actor.id,
        action=action,
        from_state=old,
        to_state=row.state,
        error=error,
        result=result,
    )
    if retry:
        entry.retry_key = retry["key"]
        entry.request_hash = retry["fingerprint"]
        original = inbox(db, project, row.id)
        entry.ack = {
            "project_id": project.id,
            "receipt_id": row.id,
            "event_id": original.event_id,
            "digest": original.digest,
            "processing": processing(row),
            "attempt_id": entry.id,
            "replayed": False,
        }
    db.add(entry)
    db.flush()
    return entry


def _error(exc):
    if isinstance(exc, HTTPException):
        code = exc.detail.get("code") if isinstance(exc.detail, dict) else "event_business_conflict"
        message = (
            exc.detail.get("message", "Business operation rejected")
            if isinstance(exc.detail, dict)
            else str(exc.detail)
        )
        return {
            "code": code,
            "message": message[:300],
            "retryable": exc.status_code >= 500 or exc.status_code == 403,
        }
    if isinstance(exc, (ValidationError, ValueError, TypeError)):
        return {
            "code": "event_business_input_invalid",
            "message": "The original business input is invalid",
            "retryable": False,
        }
    return {
        "code": "event_processing_failed",
        "message": "Processing failed; retry the original operation",
        "retryable": True,
    }


def process(db, project, user, receipt_id, request=None, *, retry=None):
    from .delivery import stage_delivery_command
    from .delivery_contract import Command
    from .event_assets import apply_asset
    from .event_common import CloudEvent

    require_project_operation(db, project.tenant_id, project.id)
    original = inbox(db, project, receipt_id)
    producer = db.get(m.User, original.producer_id, populate_existing=True)
    row = db.get(m.EventProcessing, receipt_id, populate_existing=True)
    if row.state == "processed" or not row.handler:
        return row
    if retry and row.revision != retry["revision"]:
        fail("event_revision_conflict", "Processing changed; reload before retrying")
    claimed_revision = row.revision
    action = "retry" if retry else "initial"
    try:
        _, producer, permissions, _ = authorize(db, producer, project.id)
        if not permissions["write"]:
            fail("event_producer_denied", "Original producer no longer has write access", 403)
        event = CloudEvent.model_validate(json.loads(original.event_json))
        with event_write_scope(db, project.tenant_id, project.id):
            if row.handler == "heartbeat.record":
                effect = {"kind": "fact_recorded", "target_kind": None, "target_id": None}
                context = nullcontext()
            elif row.handler == "sync.asset":
                original_version(event.data)
                if not row.plan:
                    fail("event_asset_plan_invalid", "No original fixed asset plan is available", 422)
                if "error" in row.plan:
                    fail(row.plan["error"], "Original asset plan was invalid", 422)
                effect = apply_asset(project, receipt_id, row.plan)
                context = nullcontext()
            else:
                body, payload = command_for(event)
                body = Command(**{**body.model_dump(), "idempotency_key": "event-" + receipt_id})
                key = digest(json.dumps([project.tenant_id, project.id, producer.id, body.idempotency_key]))
                fingerprint = digest(body.model_dump_json(exclude_none=True))
                saved = db.get(m.DeliveryReceipt, key)
                if saved:
                    from .delivery_query_commands import replay_ack

                    ack = replay_ack(db, project, saved.version, user=producer,
                        store=getattr(request.app.state, "hermes_store", None) if request else None)
                    effect = _effect(body, ack)
                    context = nullcontext()
                else:
                    context = stage_delivery_command(
                        db, project, producer, body, payload, key, fingerprint, request
                    )
                    effect = None
            with context as staged:
                if effect is None:
                    effect = _effect(body, staged["ack"])
                entry = _attempt(db, project, row, user, action, effect, None, retry)
                from .delivery_issue_origins import append_origin

                append_origin(db, project, original, entry)
                db.commit()
        return db.get(m.EventProcessing, receipt_id, populate_existing=True)
    except Exception as exc:
        db.rollback()
        error = _error(exc)
        return _persist_failure(db, project, user, receipt_id, action, retry, claimed_revision, error)


def _persist_failure(db, project, user, receipt_id, action, retry, claimed_revision, error):
    with event_write_scope(db, project.tenant_id, project.id):
        row = db.get(m.EventProcessing, receipt_id, populate_existing=True)
        if row.revision != claimed_revision:
            if retry:
                current_error = (
                    None
                    if row.state == "processed"
                    else {
                        "code": row.reason_code or "event_processing_changed",
                        "message": "Original operation changed during recovery",
                        "retryable": row.retryable,
                    }
                )
                _attempt(db, project, row, user, action, row.result, current_error, retry)
        else:
            _attempt(db, project, row, user, action, None, error, retry)
        db.commit()
    return db.get(m.EventProcessing, receipt_id, populate_existing=True)
