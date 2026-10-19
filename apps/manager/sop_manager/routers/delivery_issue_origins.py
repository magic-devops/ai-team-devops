"""Append-only reverse links from verified successful tool commands to Issues."""

import json

from fastapi import HTTPException
from hermes_core.transactional import digest as semantic_digest
from sqlalchemy import func, literal, select

from . import sql_models as m
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_issue_origin_contract import IssueOrigin, IssueOriginDetail, IssueOrigins
from .delivery_service import stamp
from .event_common import CloudEvent, authorize, date, digest, scope


def _fail(code, message, status=404):
    raise HTTPException(status, {"code": code, "message": message})


def _query(project, issue_id):
    return select(m.IssueEventOrigin).where(
        *scope(project, m.IssueEventOrigin), m.IssueEventOrigin.issue_id == issue_id
    )


def _available(db, project, issue_id):
    return db.scalar(select(m.Issue.id).where(*scope(project, m.Issue), m.Issue.id == issue_id)) is not None


def _command(db, project, original):
    """Resolve the actual typed command and its recorded before-state, never subject guesses."""
    from .event_processing import command_for

    if digest(original.event_json) != original.digest:
        raise ValueError("Original bytes changed")
    event = CloudEvent.model_validate(json.loads(original.event_json))
    if (event.id != original.event_id or event.type != original.event_type
            or event.source != original.source or event.subject != original.subject):
        raise ValueError("Original envelope metadata changed")
    for field, expected in (("tenant_id", project.tenant_id), ("project_id", project.id)):
        if field in event.data and event.data[field] != expected:
            raise ValueError("Original scope changed")
    if event.type not in {"sop.issue.opened", "sop.sync.push"}:
        raise ValueError("No Issue command")
    body, payload = command_for(event)
    if body.action == "sync.record.apply" and payload.module != "issues":
        raise ValueError("Not an Issue command")
    key = digest(json.dumps([project.tenant_id, project.id, original.producer_id, "event-" + original.id]))
    receipt = db.execute(select(m.DeliveryReceipt.version, m.DeliveryReceipt.request_hash).where(
        *scope(project, m.DeliveryReceipt), m.DeliveryReceipt.id == key
    )).first()
    if receipt is None:
        raise ValueError("Original command receipt missing")
    body.idempotency_key = "event-" + original.id
    if receipt.request_hash != digest(body.model_dump_json(exclude_none=True)):
        raise ValueError("Original command receipt differs")
    dialect = db.bind.dialect.name
    if dialect == "sqlite":
        before_type = func.json_type(m.DeliveryEvent.data, '$."before"')
    elif dialect == "postgresql":
        before_type = func.json_typeof(m.DeliveryEvent.data["before"])
    elif dialect in {"mysql", "mariadb"}:
        before_type = func.json_type(m.DeliveryEvent.data["before"])
    else:
        before_type = literal(None)
    command = db.execute(select(m.DeliveryEvent.action, m.DeliveryEvent.resource_id,
        m.DeliveryEvent.data["before"].label("before"), before_type.label("before_type")).where(
            *scope(project, m.DeliveryEvent), m.DeliveryEvent.version == receipt.version
        )).one_or_none()
    if command is None or command.action != body.action:
        raise ValueError("Original command result missing")
    # A missing key and explicit JSON null both decode to Python None. Inspect
    # exact SQL shape, then require the recorded before identity when present.
    shape = str(command.before_type).lower()
    if shape not in {"null", "object"} or shape == "object" and not isinstance(command.before, dict):
        raise ValueError("Original operation before-state cannot be established")
    if shape == "object" and any(command.before.get(key) != value for key, value in (
        ("id", command.resource_id), ("tenant_id", project.tenant_id), ("project_id", project.id),
    )):
        raise ValueError("Original operation before-state target differs")
    if body.action == "issue.create":
        if shape != "null":
            raise ValueError("Issue creation did not record an absent target")
        return "create", "issue_created", command.resource_id
    if payload.record.get("id") != command.resource_id:
        raise ValueError("Original target differs")
    operation = payload.action
    if operation == "upsert":
        operation = "update" if shape == "object" else "create"
    if operation == "create" and shape != "null" or operation == "update" and shape != "object":
        raise ValueError("Original operation differs from its before-state")
    if operation == "delete" and shape != "object":
        raise ValueError("Deletion had no actual Issue")
    return operation, "record_deleted" if operation == "delete" else "record_upserted", command.resource_id


def append_origin(db, project, original, attempt, *, strict=True):
    """Called inside successful event business transaction, after immutable attempt flush."""
    result = attempt.result
    if attempt.to_state != "processed" or attempt.error or not isinstance(result, dict):
        return False
    if result.get("target_kind") != "issue":
        return False
    if db.scalar(select(m.IssueEventOrigin.id).where(m.IssueEventOrigin.receipt_id == original.id)):
        return False
    try:
        operation, kind, issue_id = _command(db, project, original)
    except (ValueError, TypeError, KeyError, HTTPException) as exc:
        if strict and str(exc) != "Deletion had no actual Issue":
            raise
        return False
    if result != {"kind": kind, "target_kind": "issue", "target_id": issue_id}:
        if strict:
            raise ValueError("Successful Issue effect differs from the recorded command")
        return False
    db.add(m.IssueEventOrigin(
        id=semantic_digest(["issue-event-origin", project.tenant_id, project.id, original.id]),
        tenant_id=project.tenant_id, project_id=project.id, issue_id=issue_id,
        receipt_id=original.id, attempt_id=attempt.id, operation=operation,
        effect_kind=kind, digest=original.digest, processed_at=attempt.created_at,
    ))
    db.flush()
    return True


def rebuild_origins(db, project):
    """Explicit configure-only caller; no replay, business writes, or implicit GET repair."""
    from sop_manager.project_write_guard import issue_origin_rebuild_scope

    added = skipped = existing = 0
    after = 0
    with issue_origin_rebuild_scope(db, project.tenant_id, project.id):
        while True:
            attempts = db.scalars(select(m.EventProcessingAttempt).where(
                *scope(project, m.EventProcessingAttempt), m.EventProcessingAttempt.to_state == "processed",
                m.EventProcessingAttempt.seq > after,
            ).order_by(m.EventProcessingAttempt.seq).limit(100)).all()
            if not attempts:
                break
            for attempt in attempts:
                after = attempt.seq
                result = attempt.result
                if not isinstance(result, dict) or result.get("target_kind") != "issue":
                    continue
                if db.scalar(select(m.IssueEventOrigin.id).where(m.IssueEventOrigin.receipt_id == attempt.receipt_id)):
                    existing += 1
                    continue
                original = db.scalar(select(m.EventInbox).where(
                    *scope(project, m.EventInbox), m.EventInbox.id == attempt.receipt_id
                ))
                if original and append_origin(db, project, original, attempt, strict=False):
                    added += 1
                else:
                    skipped += 1
    return {"added": added, "existing": existing, "skipped": skipped}


def origin_summary(db, project, issue_id):
    from .delivery_query_index import SCHEMA_VERSION

    schema = db.scalar(select(m.DeliveryQueryState.schema_version).where(*scope(project, m.DeliveryQueryState)))
    total = db.scalar(select(func.count()).select_from(m.IssueEventOrigin).where(
        *scope(project, m.IssueEventOrigin), m.IssueEventOrigin.issue_id == issue_id
    ))
    # An automatic query refresh cannot certify pre-feature historical attempts.
    # This narrow SQL existence probe reports gaps until explicit verified rebuild.
    gap = db.scalar(select(m.EventProcessingAttempt.id).outerjoin(m.IssueEventOrigin,
        m.IssueEventOrigin.receipt_id == m.EventProcessingAttempt.receipt_id).where(
            *scope(project, m.EventProcessingAttempt), m.EventProcessingAttempt.to_state == "processed",
            m.EventProcessingAttempt.result["target_kind"].as_string() == "issue",
            m.EventProcessingAttempt.result["target_id"].as_string() == issue_id,
            m.IssueEventOrigin.id.is_(None),
        ).limit(1))
    return {"total": total, "projection": "current" if schema == SCHEMA_VERSION and not gap else "rebuild_required"}


def _view(db, project, row):
    from .delivery_issue_evidence import _clean

    original = db.execute(select(m.EventInbox.id, m.EventInbox.producer_id, m.EventInbox.event_id,
        m.EventInbox.digest, m.EventInbox.event_type, m.EventInbox.source, m.EventInbox.subject,
        m.EventInbox.event_json).where(*scope(project, m.EventInbox), m.EventInbox.id == row.receipt_id)).first()
    attempt = db.execute(select(m.EventProcessingAttempt.to_state, m.EventProcessingAttempt.error,
        m.EventProcessingAttempt.result, m.EventProcessingAttempt.created_at).where(
            *scope(project, m.EventProcessingAttempt), m.EventProcessingAttempt.id == row.attempt_id,
            m.EventProcessingAttempt.receipt_id == row.receipt_id)).first()
    reason = None
    expected = {"kind": row.effect_kind, "target_kind": "issue", "target_id": row.issue_id}
    if original is None:
        reason = "event_origin_original_missing"
    elif original.digest != row.digest or digest(original.event_json) != row.digest:
        reason = "event_origin_original_changed"
    elif attempt is None:
        reason = "event_origin_attempt_missing"
    elif (attempt.to_state != "processed" or attempt.error or attempt.result != expected
            or attempt.created_at != row.processed_at):
        reason = "event_origin_effect_mismatch"
    else:
        try:
            if _command(db, project, original) != (row.operation, row.effect_kind, row.issue_id):
                reason = "event_origin_effect_mismatch"
        except (ValueError, TypeError, KeyError, HTTPException):
            reason = "event_origin_effect_mismatch"
    producer = db.execute(select(m.User.id, m.User.username).where(
        m.User.id == original.producer_id, m.User.tenant_id == project.tenant_id
    )).first() if original else None
    if producer is None and reason is None:
        reason = "event_origin_producer_missing"
    def safe(value, limit=1000):
        return _clean(value, limit)[0]
    semantic = {"id": row.id, "issue_id": row.issue_id, "receipt_id": row.receipt_id,
        "attempt_id": row.attempt_id, "operation": row.operation, "effect_kind": row.effect_kind,
        "digest": row.digest, "processed_at": date(row.processed_at),
        "producer_id": original.producer_id if original else None}
    basis = semantic_digest(semantic)
    event_id = safe(original.event_id, 128) if original and reason is None else None
    event_type = safe(original.event_type, 160) if original and reason is None else None
    source = safe(original.source, 512) if original and reason is None else None
    evidence = {"id": "event:" + row.id, "kind": "event", "label": event_id or row.id,
        "status": "processed" if reason is None else "unavailable", "summary": "event_business_effect",
        "facts": [{"label": key, "value": str(value)} for key, value in {
            "operation": row.operation, "effect_kind": row.effect_kind, "receipt_id": row.receipt_id,
            "attempt_id": row.attempt_id, "digest": row.digest, "processed_at": date(row.processed_at),
            "producer_id": original.producer_id if original and reason is None else "unknown",
        }.items()], "missing": reason is not None,
        "target": {"project_id": project.id, "view": "events", "detail": "details", "issue_id": row.issue_id,
            "receipt_id": row.receipt_id, "origin_id": row.id}}
    return IssueOrigin.model_validate({**{key: semantic[key] for key in semantic if key != "producer_id"},
        "basis": basis, "event_id": event_id, "event_type": event_type, "source": source,
        "producer": {"id": producer.id, "name": safe(producer.username, 128)} if producer and reason is None else None,
        "available": reason is None, "unavailable_reason": reason, "evidence": evidence}).model_dump(mode="json")


def issue_origins(db, project, user, issue_id, *, limit=20, cursor=""):
    project, user, _, _ = authorize(db, user, project.id)
    if type(limit) is not int or not 1 <= limit <= 100:
        _fail("event_origin_limit_invalid", "Limit must be between 1 and 100", 422)
    filters = ["issue-origins", project.tenant_id, project.id, user.id, issue_id, limit]
    query = _query(project, issue_id)
    if cursor:
        upper, after = decode_cursor(cursor, filters)
        if (len(upper) != 2 or type(upper[0]) is not int or upper[0] < 0
                or not isinstance(upper[1], str) or len(after) != 1 or type(after[0]) is not int
                or not 0 < after[0] <= upper[0]):
            _fail("event_origin_cursor_invalid", "Invalid origin window", 422)
    else:
        upper = [db.scalar(select(func.max(m.IssueEventOrigin.seq)).where(
            *scope(project, m.IssueEventOrigin), m.IssueEventOrigin.issue_id == issue_id)) or 0, stamp()]
        after = [upper[0] + 1]
    count = db.scalar(select(func.count()).select_from(m.IssueEventOrigin).where(
        *scope(project, m.IssueEventOrigin), m.IssueEventOrigin.issue_id == issue_id,
        m.IssueEventOrigin.seq <= upper[0]))
    available = _available(db, project, issue_id)
    if not available and not count:
        _fail("event_origin_issue_missing", "Issue and its origins were not found")
    rows = db.scalars(query.where(m.IssueEventOrigin.seq <= upper[0], m.IssueEventOrigin.seq < after[0])
        .order_by(m.IssueEventOrigin.seq.desc()).limit(limit + 1)).all()
    return IssueOrigins.model_validate({"project_id": project.id, "issue_id": issue_id,
        "issue_available": available, "as_of": upper[1], "items": [_view(db, project, row) for row in rows[:limit]],
        "total": count, "limit": limit,
        "next_cursor": encode_cursor(filters, upper, [rows[limit - 1].seq]) if len(rows) > limit else None,
    }).model_dump(mode="json")


def issue_origin_detail(db, project, user, issue_id, origin_id):
    project, _, _, _ = authorize(db, user, project.id)
    row = db.scalar(_query(project, issue_id).where(m.IssueEventOrigin.id == origin_id))
    if row is None:
        _fail("event_origin_missing", "Origin was not found in this project and issue")
    return IssueOriginDetail.model_validate({"project_id": project.id, "issue_id": issue_id,
        "issue_available": _available(db, project, issue_id), "as_of": stamp(), "origin": _view(db, project, row),
    }).model_dump(mode="json")


def selected_origins(db, project, user, issue_id, ids):
    """Resolve exact selected origin IDs, independently of every catalogue window."""
    wanted = [value.removeprefix("event:") for value in ids if value.startswith("event:")]
    if len(wanted) > 32:
        _fail("issue_diagnosis_evidence_limit", "At most 32 evidence items may be selected", 422)
    if not wanted:
        return [], {}
    project, _, _, _ = authorize(db, user, project.id)
    rows = db.scalars(_query(project, issue_id).where(m.IssueEventOrigin.id.in_(wanted))).all()
    origins = [_view(db, project, row) for row in rows]
    return [row["evidence"] for row in origins], {
        row["evidence"]["id"]: row["basis"] for row in origins if row["available"]
    }
