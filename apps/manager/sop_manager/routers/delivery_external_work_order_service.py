"""Canonical external ownership and reported delivery on the existing Task."""
from copy import deepcopy
from datetime import datetime, timezone
import json

from fastapi import HTTPException
from hermes_core.transactional import digest
from sqlalchemy import LargeBinary, Text, cast, func, select
from sqlalchemy.orm import load_only

from .delivery_external_work_order_contract import Executor, MAX_PACKET_BYTES, WorkOrderCreate, work_order_text
from .delivery_external_work_order_model import DeliveryExternalWorkOrder as Order
from .delivery_query_index import scope
from .delivery_task_contract import semantic_snapshot

ACTIVE_ORDER_REASON = {"code": "external_work_order_active", "message": "Close or report the active external work order before another delivery can take ownership."}


def fail(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def date(value):
    return value.isoformat() + "Z" if value is not None else None


def byte_size(db, column):
    return func.length(cast(column, LargeBinary)) if db.bind.dialect.name == "sqlite" else func.octet_length(cast(column, Text))


def active_task_ids(db, project, task_ids):
    return set(db.scalars(select(Order.active_task_id).where(*scope(project, Order), Order.active_task_id.in_(set(task_ids)))))


def project_has_active_work_orders(db, project):
    return db.scalar(select(Order.id).where(*scope(project, Order), Order.active_task_id.is_not(None)).limit(1)) is not None


def require_no_active_work_order(db, project, task_id, *, action="execution"):
    if active_task_ids(db, project, [task_id]):
        raise HTTPException(409, ACTIVE_ORDER_REASON)


def active_order(db, project, task_id):
    columns = [getattr(Order, column.key) for column in Order.__table__.c if column.key != "original"]
    return db.scalar(select(Order).options(load_only(*columns)).where(*scope(project, Order), Order.active_task_id == task_id).execution_options(populate_existing=True))


def access(db, project, user, *, write=False):
    from .delivery_task_submission_service import _actor

    return _actor(db, project, user, permission="write" if write else None)


def source_list(db, project, key):
    from .sql_models import DeliveryWorkspace

    value = DeliveryWorkspace.data[(key,)]
    predicate = scope(project, DeliveryWorkspace)
    size = db.scalar(select(byte_size(db, value)).where(*predicate)) or 0
    if size > 1024 * 1024:
        fail("work_order_source_budget", "The complete project resource source exceeds its read budget.", 413)
    rows = db.scalar(select(value).where(*predicate)) or []
    if not isinstance(rows, list) or len(rows) > 1000:
        fail("work_order_source_budget", "The complete project resource catalogue is unavailable or exceeds its budget.", 413)
    return rows


def executors(db, project):
    rows = source_list(db, project, "members")
    ids = [row.get("id") for row in rows if isinstance(row, dict)]
    result = []
    for row in rows:
        reasons = []
        try:
            if not isinstance(row, dict) or row.get("kind") not in ("agent", "tool"):
                raise ValueError("Invalid formal team resource")
            if ids.count(row.get("id")) != 1:
                reasons.append({"code": "work_order_executor_ambiguous", "message": "The formal team resource identity is ambiguous."})
            if row.get("active") is not True:
                reasons.append({"code": "work_order_executor_inactive", "message": "Enable this formal team resource before assigning external work."})
            resource = Executor.model_validate({"id": row["id"], "name": row["name"], "kind": row["kind"],
                "tool": row.get("tool", ""), "active": row.get("active", False), "available": not reasons, "reasons": reasons})
        except (KeyError, TypeError, ValueError, HTTPException):
            fail("work_order_source_invalid", "Repair the formal team or repository resource data before dispatching external work.")
        result.append(resource.model_dump(mode="json"))
    return result


def executor_basis(value):
    return digest({key: value[key] for key in ("id", "kind", "tool", "active", "available")})


def _repositories(db, project):
    from .delivery_contract import ResourceSave

    result = []
    for value in source_list(db, project, "resources"):
        if not isinstance(value, dict):
            fail("work_order_source_invalid", "Repair the formal team or repository resource data before dispatching external work.")
        if value.get("kind") != "repository":
            continue
        try:
            original = {key: value[key] for key in ResourceSave.model_fields if key in value}
            parsed = ResourceSave.model_validate(original)
            if not isinstance(value.get("id"), str) or not parsed.id or any(getattr(parsed, key) != field for key, field in original.items()):
                raise ValueError("Invalid stored repository source")
            for field in (parsed.id, parsed.title, parsed.url, parsed.ref, parsed.description):
                work_order_text(field)
        except (KeyError, TypeError, ValueError, HTTPException):
            fail("work_order_source_invalid", "Repair the formal team or repository resource data before dispatching external work.")
        if parsed.archived:
            continue
        result.append({"id": parsed.id, "title": parsed.title, "url": parsed.url, "ref": parsed.ref,
            "description": parsed.description, "source": "registered_unverified"})
    return sorted(result, key=lambda row: row["id"])


def current_sources(db, project, user, task_id, *, store=None, execution=None):
    from .delivery_task_submission_query import _context
    from .delivery_task_submission_service import native_boundary, submission_definition, submission_reasons

    actor, permissions = access(db, project, user)
    context = _context(db, project, task_id)
    fixed = submission_definition(context, task_id)
    boundary = native_boundary(db, project, actor, context.data, task_id, store, execution)
    reasons = submission_reasons(context, task_id, can_write=permissions["write"], project_status=project.status) + boundary["reasons"]
    if project.status != "active":
        reasons.append({"code": "project_not_active", "message": "Activate the project before dispatching or claiming new external work."})
    selected = active_order(db, project, task_id)
    if selected:
        reasons.append(ACTIVE_ORDER_REASON)
    candidate = context.latest_submissions.get(task_id)
    if candidate and not candidate["invalidated"] and not candidate["decision_id"]:
        reasons.append({"code": "work_order_submission_pending", "message": "Review or invalidate the current external submission before creating another work order."})
    return actor, permissions, context, fixed, boundary, reasons, selected


def prepare(db, project, user, task_id, body, *, store=None, execution=None):
    actor, permissions, context, fixed, boundary, reasons, selected = current_sources(db, project, user, task_id, store=store, execution=execution)
    if body.task_basis != fixed["task_basis"]:
        fail("work_order_task_changed", "Review the current task definition before dispatching.")
    executor = next((row for row in executors(db, project) if row["id"] == body.executor_member_id), None)
    if executor is None or not executor["available"]:
        reasons.append({"code": "work_order_executor_unavailable", "message": "Choose one active formal team agent or tool."})
    if reasons:
        fail(reasons[0]["code"], reasons[0]["message"])
    from .delivery_execution_design_context import execution_design_context

    packet = {"schema": "manager.external-work-order.v1", "project_id": project.id, "task_id": task_id,
        "definition": fixed["definition"], "definition_digest": fixed["definition_digest"], "native_boundary_digest": boundary["digest"],
        "executor": executor, "instructions": body.instructions, "design_context": execution_design_context(db, project, fixed["definition"]),
        "repositories": _repositories(db, project)}
    if len(json.dumps(packet, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")) > MAX_PACKET_BYTES:
        fail("work_order_packet_budget", "The complete fixed external packet exceeds 512 KiB; no content was truncated.", 413)
    packet_digest = digest(packet)
    preview_basis = digest({"task_basis": fixed["task_basis"], "packet_digest": packet_digest, "executor_basis": executor_basis(executor)})
    return {"actor": actor, "context": context, "fixed": fixed, "boundary": boundary, "executor": executor,
        "packet": packet, "packet_digest": packet_digest, "preview_basis": preview_basis}


def load_order(db, project, identity):
    predicate = (*scope(project, Order), Order.id == identity)
    size = db.scalar(select(byte_size(db, Order.original)).where(*predicate))
    if size is None:
        fail("work_order_missing", "Work order is unavailable in this project.", 404)
    if size > 4 * 1024 * 1024:
        fail("work_order_original_budget", "The fixed external work original exceeds its bounded read budget.", 413)
    row = db.scalar(select(Order).where(*predicate).execution_options(populate_existing=True))
    original = row.original
    try:
        packet = original["packet"]
        request = WorkOrderCreate.model_validate(original["request"]).model_dump(mode="json")
        valid = (original["schema"] == "manager.external-work-order-original.v1" and digest(original) == row.request_digest
            and all(original[key] == getattr(row, key) for key in ("id", "tenant_id", "project_id", "task_id", "requested_by"))
            and original["request"]["task_basis"] == row.task_basis
            and original["created_at"] == date(row.created_at) and digest(packet) == row.packet_digest
            and packet["task_id"] == row.task_id and packet["project_id"] == project.id
            and packet["definition"]["task_id"] == row.task_id and packet["definition"]["title"] == row.task_title
            and digest(semantic_snapshot(packet["definition"])) == row.definition_digest == packet["definition_digest"]
            and digest(original["native_boundary"]) == row.native_boundary_digest == packet["native_boundary_digest"]
            and digest(original["native_boundary"]["identities"]) == row.native_identity_digest
            and original["runtime_scopes"] == row.runtime_scopes
            and packet["executor"] == row.executor and executor_basis(row.executor) == row.executor_basis
            and Executor.model_validate(row.executor).model_dump(mode="json") == row.executor
            and request == original["request"] and request["task_id"] == row.task_id
            and request["definition_digest"] == row.definition_digest and request["native_boundary_digest"] == row.native_boundary_digest
            and request["executor_member_id"] == row.executor["id"] and request["instructions"] == packet["instructions"]
            and request["preview_basis"] == digest({"task_basis": row.task_basis, "packet_digest": row.packet_digest, "executor_basis": row.executor_basis})
            and type(original["accepted_version"]) is int and original["accepted_version"] >= 1
            and packet["schema"] == "manager.external-work-order.v1"
            and len(json.dumps(packet, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")) <= MAX_PACKET_BYTES)
    except (KeyError, TypeError, ValueError, AttributeError, HTTPException):
        valid = False
    if not valid:
        fail("work_order_original_invalid", "The complete fixed work order original cannot be verified.")
    return row


def assert_order_access(db, project, user, row, *, store=None):
    from .delivery_issue_evidence import assert_evidence_access

    assert_evidence_access(store, user, project, row.runtime_scopes)


def _fresh(db, project, user, row, store, execution):
    from .delivery_task_submission_query import _context
    from .delivery_task_submission_service import native_boundary, submission_definition, submission_reasons

    context = _context(db, project, row.task_id)
    fixed = submission_definition(context, row.task_id)
    boundary = native_boundary(db, project, user, context.data, row.task_id, store, execution)
    reasons = submission_reasons(context, row.task_id, project_status=project.status) + boundary["reasons"]
    resource = next((item for item in executors(db, project) if item["id"] == row.executor["id"]), None)
    if (row.invalidated or fixed["task_basis"] != row.task_basis or fixed["definition_digest"] != row.definition_digest or boundary["digest"] != row.native_boundary_digest
            or not resource or executor_basis(resource) != row.executor_basis):
        fail("work_order_invalidated", "The fixed external scope or formal executor changed; release this original before new work.")
    if reasons:
        fail(reasons[0]["code"], reasons[0]["message"])
    return context


def _claimant(row, user):
    if not row.claimed_by or row.claimed_by["id"] != user.id:
        fail("work_order_claimant_required", "Only the account that claimed this fixed work order may report progress, release or link delivery.", 403)


def submission_intake_reasons(db, project, user, task_id, definition_digest, native_boundary_digest, *, task_basis):
    row = active_order(db, project, task_id)
    if row is None:
        return []
    if (row.state != "claimed" or row.invalidated or not row.claimed_by or row.claimed_by["id"] != user.id
            or row.task_basis != task_basis or row.definition_digest != definition_digest or row.native_boundary_digest != native_boundary_digest):
        return [ACTIVE_ORDER_REASON]
    return []


def apply_work_order(db, project, user, data, action, body, *, command_key, store=None, execution=None):
    from sop_manager.project_write_guard import work_order_write_scope, require_project_operation
    from .delivery_service import identifier
    from .sql_models import DeliveryWorkspace

    require_project_operation(db, project.tenant_id, project.id)
    actor, _permissions = access(db, project, user, write=True)
    instant = now()
    if action == "work_order.create":
        prepared = prepare(db, project, actor, body.task_id, body, store=store, execution=execution)
        if (body.preview_basis != prepared["preview_basis"] or body.definition_digest != prepared["fixed"]["definition_digest"]
                or body.native_boundary_digest != prepared["boundary"]["digest"]):
            fail("work_order_preview_changed", "The exact packet or complete native closure changed. Review a new preview.")
        identity = identifier("work-order")
        original = {"schema": "manager.external-work-order-original.v1", "id": identity, "tenant_id": project.tenant_id,
            "project_id": project.id, "task_id": body.task_id, "requested_by": {"id": actor.id, "name": actor.username},
            "created_at": date(instant), "command_key": command_key, "request": body.model_dump(mode="json"),
            "accepted_version": db.connection().scalar(select(DeliveryWorkspace.version).where(*scope(project, DeliveryWorkspace))),
            "packet": prepared["packet"], "native_boundary": prepared["boundary"]["boundary"], "runtime_scopes": prepared["boundary"]["runtime_scopes"]}
        row = Order(id=identity, tenant_id=project.tenant_id, project_id=project.id, task_id=body.task_id, active_task_id=body.task_id,
            task_title=prepared["fixed"]["definition"]["title"], task_basis=body.task_basis,
            original=original, request_digest=digest(original), packet_digest=prepared["packet_digest"],
            definition_digest=body.definition_digest, native_boundary_digest=body.native_boundary_digest,
            native_identity_digest=digest(prepared["boundary"]["boundary"]["identities"]),
            runtime_scopes=prepared["boundary"]["runtime_scopes"], executor=prepared["executor"],
            executor_basis=executor_basis(prepared["executor"]), requested_by=original["requested_by"], created_at=instant, updated_at=instant,
            state="queued", revision=1, claimed_by=None, claimed_at=None, progress=None, submission_id=None, submission_digest=None,
            closure=None, invalidated=False, invalidated_reason=None)
    else:
        row = load_order(db, project, body.id)
        assert_order_access(db, project, actor, row, store=store)
        if row.revision != body.order_revision:
            fail("work_order_revision_changed", "The work order changed; read its current revision before a new action.")
        if action == "work_order.claim":
            if row.state != "queued":
                fail("work_order_not_queued", "Only an unclaimed queued order can be claimed.")
            if project.status != "active":
                fail("project_not_active", "Activate the project before claiming new external work.")
            _fresh(db, project, actor, row, store, execution)
            row.claimed_by, row.claimed_at, row.state = {"id": actor.id, "name": actor.username}, instant, "claimed"
        elif action == "work_order.cancel":
            if row.state not in {"queued", "claimed"}:
                fail("work_order_cancel_unavailable", "Only queued or claimed work can request cancellation.")
            if row.state == "queued":
                row.state, row.active_task_id = "closed", None
                row.closure = {"kind": "never_claimed", "actor": {"id": actor.id, "name": actor.username}, "comment": body.comment, "at": date(instant)}
            else:
                row.state = "cancel_requested"
        elif action in {"work_order.progress", "work_order.release", "work_order.report"}:
            _claimant(row, actor)
            if row.state not in {"claimed", "cancel_requested"}:
                fail("work_order_not_claimed", "The original account no longer holds this external work order.")
            if action == "work_order.progress":
                _fresh(db, project, actor, row, store, execution)
                if row.state == "cancel_requested" and body.status != "blocked":
                    fail("work_order_cancel_pending", "A cancellation request may only receive a blocked progress report or explicit stopped release.")
                row.progress = {"percent": body.percent, "status": body.status, "message": body.message,
                    "reported_at": date(instant), "source": "external_reported"}
            elif action == "work_order.release":
                row.state, row.active_task_id = "closed", None
                row.closure = {"kind": "external_reported_stop", "actor": {"id": actor.id, "name": actor.username}, "comment": body.comment, "at": date(instant)}
            else:
                _fresh(db, project, actor, row, store, execution)
                from .delivery_task_submission_model import DeliveryTaskSubmission as Submission, DeliveryTaskSubmissionDecision as Decision
                from .delivery_task_submission_service import _assert_original, submission_current_valid
                from .delivery_task_submission_query import _context

                predicate = (*scope(project, Submission), Submission.id == body.submission_id)
                sizes = db.execute(select(*(byte_size(db, field) for field in (
                    Submission.payload, Submission.original, Submission.definition, Submission.native_boundary))).where(*predicate)).first()
                if sizes is None:
                    fail("work_order_submission_missing", "Choose the actual fixed external submission for this work order.", 404)
                if any((size or 0) > 1024 * 1024 for size in sizes):
                    fail("work_order_submission_budget", "The fixed external submission exceeds its bounded source budget.", 413)
                report = db.scalar(select(Submission).where(*predicate))
                _assert_original(report)
                latest = db.scalar(select(func.max(Submission.seq)).where(*scope(project, Submission), Submission.task_id == row.task_id))
                if (report.task_id != row.task_id or report.submitted_by != actor.id or report.task_basis != row.task_basis
                        or report.submission_digest != body.submission_digest
                        or report.definition_digest != row.definition_digest or report.native_boundary_digest != row.native_boundary_digest
                        or report.seq != latest or report.invalidated or not submission_current_valid(_context(db, project, row.task_id), row.task_id,
                            {"invalidated": report.invalidated, "definition_digest": report.definition_digest, "native_boundary": report.native_boundary})
                        or db.scalar(select(Decision.id).where(*scope(project, Decision), Decision.submission_id == report.id))):
                    fail("work_order_submission_mismatch", "The submission is not this claimant's current unreviewed delivery for the exact original scope.")
                row.submission_id, row.submission_digest, row.state, row.active_task_id = report.id, report.submission_digest, "reported", None
                row.closure = {"kind": "external_reported_stop", "actor": {"id": actor.id, "name": actor.username},
                    "comment": "The claimant reported that external work stopped and linked this fixed delivery.", "at": date(instant)}
        else:
            fail("work_order_action_unknown", "Unsupported external work order action.", 422)
        row.revision += 1
        row.updated_at = instant
    with work_order_write_scope(db, project.tenant_id, project.id):
        db.add(row)
        db.flush()
    return row.id, None, {"work_order_id": row.id, "task_ids": [row.task_id], "request_digest": row.request_digest,
        "packet_digest": row.packet_digest, "order_revision": row.revision, "state": row.state, "submission_id": row.submission_id}


def invalidate_work_orders(db, project, context):
    from sop_manager.project_write_guard import work_order_invalidation_scope
    from .delivery_task_submission_service import native_identity

    from .delivery_input_budget import CanonicalInputBudget

    # Only unresolved ownership needs permanent source invalidation. A reported
    # delivery derives its enduring validity from its fixed Submission/Review.
    predicate = (*scope(project, Order), Order.invalidated.is_(False), Order.active_task_id.is_not(None))
    total = db.scalar(select(func.count()).select_from(Order).where(*predicate))
    if total > 10000:
        fail("work_order_invalidation_budget", "The complete external work-order impact exceeds its record budget.", 413)
    columns = [column for column in Order.__table__.c if column.key != "original"]
    query = select(Order).where(*predicate)
    CanonicalInputBudget({"bytes_used": 0}, code="work_order_invalidation_budget").rows(db, query, columns)
    rows = db.scalars(query.options(load_only(*(getattr(Order, column.key) for column in columns)))).all()
    if not rows:
        return
    try:
        resources = {item["id"]: item for item in executors(db, project)}
    except HTTPException as exc:
        if not isinstance(exc.detail, dict) or exc.detail.get("code") != "work_order_source_invalid":
            raise
        # An unverified catalogue invalidates held originals, but cannot prevent
        # their claimant from explicitly stopping and releasing ownership.
        resources = {}
    for row in rows:
        definition = context.definition(row.task_id) if row.task_id in context.tasks else None
        resource = resources.get(row.executor["id"])
        invalid = (not definition or digest(semantic_snapshot(definition["snapshot"])) != row.definition_digest
            or not resource or executor_basis(resource) != row.executor_basis)
        if row.active_task_id and row.task_id in context.tasks and context.basis(row.task_id) != row.task_basis:
            invalid = True
        if not invalid:
            invalid = digest(native_identity([entry for entry in context.data.get("executions", []) if entry["task_id"] == row.task_id])) != row.native_identity_digest
        if invalid:
            with work_order_invalidation_scope(db, project.tenant_id, project.id):
                row.invalidated, row.invalidated_reason = True, "work_order_source_changed"
                row.revision += 1
                row.updated_at = now()
                db.flush()
