"""Accepted SQL originals, fenced background handoff and narrow Core fact projection."""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import re
from uuid import uuid4

from fastapi import HTTPException
from hermes_core.managed_handoff import ManagedHandoff, managed_handoff_digest
from hermes_core.models import CoreError, Principal
from sqlalchemy import and_, case, or_, select

from sop_manager.project_write_guard import (
    execution_handoff_projection_scope, execution_handoff_write_scope, lock_project_scopes,
)
from .delivery_execution_handoff_model import DeliveryExecutionHandoff
from .sql_models import DeliveryWorkspace, Project, SessionLocal, User

LEASE_SECONDS = 30
MAX_SCAN = 100
logger = logging.getLogger(__name__)


def _now(value=None):
    value = value or datetime.now(timezone.utc)
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


def _stamp(value):
    return _now(value).isoformat() + "Z" if value is not None else None


def _text(value, maximum):
    from .delivery_execution_runtime_safety import safe_text

    return re.sub(r"[\x00-\x1f\x7f]", " ", safe_text(value, maximum)[0])[:maximum]


def handoff_view(row):
    """Accepts an ORM row or a public-column-only namespace, never reads original."""
    return {"id": row.id, "execution_id": row.execution_id, "task_id": row.task_id, "workspace_id": row.workspace_id,
            "state": row.state, "revision": row.revision, "attempt": row.attempt,
            "accepted_at": _stamp(row.accepted_at), "updated_at": _stamp(row.updated_at),
            "next_attempt_at": _stamp(row.next_attempt_at),
            "error": {"code": _text(row.error.get("code"), 100), "message": _text(row.error.get("message"), 1000)} if row.error else None,
            "run_id": row.run_id or None, "runtime_task_id": row.runtime_task_id or None}


def handoff_summary(db, project, execution_id):
    """Internal already-authorized scope; public endpoints perform their own access checks."""
    row = db.scalar(select(DeliveryExecutionHandoff).where(DeliveryExecutionHandoff.tenant_id == project.tenant_id,
        DeliveryExecutionHandoff.project_id == project.id,
        DeliveryExecutionHandoff.execution_id == execution_id))
    return handoff_view(row) if row else None


def _principal(row):
    # Internal fact recovery is confined to this accepted immutable namespace.
    return Principal(row.requested_by, tenant=row.tenant_id, business=row.business_key,
                     permissions=frozenset({"read"}), workspace_ids=frozenset({row.workspace_id}))


def _request(row):
    from .delivery_execution import _dispatch_body, _envelope_data

    return {"operation_id": row.id, "project_id": row.project_id, "execution_id": row.execution_id,
            "envelope": _envelope_data(row.original), "body": _dispatch_body(row.original),
            "plan_basis": row.original["plan_basis"]}


def _validate_original(row):
    try:
        request = _request(row)
        verified = (isinstance(row.original, dict) and managed_handoff_digest(_principal(row), row.workspace_id, **request) == row.request_digest)
    except (CoreError, KeyError, TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(409, {"code": "handoff_original_invalid", "message": "The fixed handoff original cannot be verified."}) from exc
    if (not verified or row.original.get("id") != row.execution_id or row.original.get("project_id") != row.project_id or row.original.get("handoff_id") != row.id
            or row.original.get("task_id") != row.task_id or row.original.get("workspace_id") != row.workspace_id
            or row.original.get("requested_by") != row.requested_by):
        raise HTTPException(409, {"code": "handoff_original_invalid", "message": "The fixed handoff original cannot be verified."})
    return request


def accept_handoff(db, project, user, entry, accepted_version=None, *, design_context=None):
    """Append H inside the queue's existing SQL/CAS/receipt transaction; never dispatch."""
    from .delivery_service import identifier
    from .hermes_workspace import runtime_identity

    instant = _now()
    entry["handoff_id"] = identifier("handoff")
    version = accepted_version if accepted_version is not None else db.connection().scalar(
        select(DeliveryWorkspace.version).where(DeliveryWorkspace.project_id == project.id,
                                               DeliveryWorkspace.tenant_id == project.tenant_id))
    if type(version) is not int or version < 1:
        raise HTTPException(409, "A handoff must belong to a reserved acceptance version")
    # Current queue authorization already succeeded; preserve its exact Core scope.
    business = runtime_identity(user, None).business if user.role == "super_admin" else "team"
    original = deepcopy(entry)
    if design_context is not None:
        original["design_context"] = deepcopy(design_context)
    row = DeliveryExecutionHandoff(id=entry["handoff_id"], tenant_id=project.tenant_id, project_id=project.id,
        execution_id=entry["id"], task_id=entry["task_id"], workspace_id=entry["workspace_id"], requested_by=user.id,
        business_key=business, original=original, request_digest="", accepted_version=version,
        state="accepted", revision=1, fence=0, attempt=0, lease_owner="", lease_expires_at=None,
        next_attempt_at=instant, error=None, run_id="", runtime_task_id="", accepted_at=instant, updated_at=instant)
    row.request_digest = managed_handoff_digest(_principal(row), row.workspace_id, **_request(row))
    with execution_handoff_write_scope(db, row.tenant_id, row.project_id, row.id):
        db.add(row); db.flush()
    return row


@dataclass(frozen=True)
class HandoffClaim:
    id: str
    fence: int
    revision: int
    owner: str
    recover_only: bool = False


def _change(db, row, **values):
    with execution_handoff_write_scope(db, row.tenant_id, row.project_id, row.id):
        for key, value in {**values, "revision": row.revision + 1}.items():
            setattr(row, key, value)
        db.flush()


def claim_handoff(db, handoff_id, *, now=None, lease_seconds=LEASE_SECONDS):
    instant = _now(now)
    row = db.get(DeliveryExecutionHandoff, handoff_id)
    if row is None:
        return None
    lock_project_scopes(db, [(row.tenant_id, row.project_id)])
    db.refresh(row)
    ready = row.state in {"accepted", "retry_wait", "blocked"} and (row.next_attempt_at is None or row.next_attempt_at <= instant)
    ready = ready or row.state == "dispatching" and row.lease_expires_at is not None and row.lease_expires_at <= instant
    if not ready:
        return None
    recover_only = row.state == "blocked" or row.state == "dispatching" and row.error is not None
    owner = uuid4().hex
    _change(db, row, state="dispatching", fence=row.fence + 1, attempt=row.attempt + 1,
            lease_owner=owner, lease_expires_at=instant + timedelta(seconds=lease_seconds), next_attempt_at=None,
            error=row.error if recover_only else None, updated_at=instant)
    return HandoffClaim(row.id, row.fence, row.revision, owner, recover_only)


def _claimed(row, claim):
    return bool(row and row.state == "dispatching" and row.fence == claim.fence
                and row.revision == claim.revision and row.lease_owner == claim.owner)


def _fact(row, value):
    if (not isinstance(value, dict) or value.get("operation_id") != row.id or value.get("project_id") != row.project_id
            or value.get("execution_id") != row.execution_id or value.get("request_hash") != row.request_digest
            or type(value.get("fence")) is not int or not 1 <= value["fence"] <= row.fence
            or type(value.get("closed")) is not bool or value.get("state") not in {"planned", "closed"}):
        raise HTTPException(503, {"code": "handoff_receipt_invalid", "message": "The Core handoff receipt could not be verified."})
    if value["state"] == "planned":
        if (any(not isinstance(value.get(key), str) or not value[key] or len(value[key]) > 64
                or _text(value[key], 64) != value[key] for key in ("run_id", "runtime_task_id"))
                or type(value.get("run_version")) is not int or value["run_version"] < 1):
            raise HTTPException(503, "Core planned receipt has no actual references")
    elif not value.get("closed") or value.get("run_id") is not None or value.get("runtime_task_id") is not None:
        raise HTTPException(503, "Core closure has no verified negative conclusion")
    return value


def project_handoff(db, project, row, claim, fact, *, now=None):
    """Project existing Core facts at current SQL version; never edit Task or acceptance."""
    if not _claimed(row, claim):
        return False
    fact = _fact(row, fact)
    target = "planned" if fact["state"] == "planned" else "cancelled"
    with execution_handoff_projection_scope(db, project.tenant_id, project.id, row.id):
        workspace = db.get(DeliveryWorkspace, project.id, populate_existing=True)
        if workspace is None or workspace.tenant_id != project.tenant_id:
            raise HTTPException(409, "The accepted execution workspace is unavailable")
        data = deepcopy(workspace.data)
        entry = next((entry for entry in data.get("executions", []) if entry.get("id") == row.execution_id), None)
        if entry is None or entry.get("handoff_id") != row.id:
            raise HTTPException(409, "The accepted execution identity changed")
        already_observed = bool(entry.get("run_id"))
        if already_observed and (target != "planned" or entry["run_id"] != fact["run_id"]
                or entry.get("runtime_task_id") != fact["runtime_task_id"]):
            raise HTTPException(409, "The actual execution references do not match this handoff")
        _change(db, row, state=target, run_id=fact.get("run_id") or "", runtime_task_id=fact.get("runtime_task_id") or "",
                lease_owner="", lease_expires_at=None, next_attempt_at=None, error=None, updated_at=_now(now))
        if not already_observed:
            entry.update(run_id=row.run_id, runtime_task_id=row.runtime_task_id,
                         run_version=fact.get("run_version", 0), status=target)
            workspace.data = data
            workspace.version += 1
        db.flush()
        # Keep the narrow capability through before_commit's derived-only refresh.
        db.commit()
    return True


def _authorize_new(db, project, row, state, store, execution):
    from .auth_sql import check_project_access
    from .delivery import _role_permissions
    from .delivery_execution import context
    from .delivery_execution_runtime import require_previous_stops
    from .delivery_plan import require_dependencies
    from .delivery_team_runtime import resolve_executor_binding
    from .delivery_verification import VerificationContext
    from .project_lifecycle import require_active
    from hermes_core.execution_targets import validate_execution_target_snapshot

    require_active(project)
    user = db.get(User, row.requested_by, populate_existing=True)
    if not user or user.status != "active" or user.tenant_id != row.tenant_id:
        raise HTTPException(403, "The original dispatcher is no longer active")
    check_project_access(user, project.id, db)
    if not _role_permissions(db, user, project)["write"]:
        raise HTTPException(403, "The original dispatcher no longer has project write permission")
    principal, workspace = context(store, user, row.workspace_id, "execute")
    if principal.business != row.business_key:
        raise HTTPException(403, "The original runtime business scope changed")
    original = row.original
    verification = VerificationContext(db, project, state)
    if not verification.execution_snapshot_current(original) or workspace["version"] != original["workspace_version"]:
        raise HTTPException(409, "The fixed dispatch context changed; cancel and prepare a new plan")
    require_dependencies(db, project, state, row.task_id)
    require_previous_stops(db, project, user, state, row.task_id, store, exclude=row.execution_id)
    current = next((entry for entry in state.get("executions", []) if entry["id"] == row.execution_id), None)
    if current is None or current.get("status") == "cancelled" or verification.pending_executor_binding_invalidated(current):
        raise HTTPException(409, "The original execution member or dispatch was invalidated")
    if original.get("executor_member_id"):
        resolve_executor_binding(db, project, state, user, store, member_id=original["executor_member_id"],
            expected_basis=original["executor_binding_basis"], workspace_id=row.workspace_id,
            agent_id=original["agent_id"], agent_version=original["agent_version"])
    validate_execution_target_snapshot(store, execution, principal, row.workspace_id, original["target_snapshot"],
                                      provider=(original.get("agent_snapshot") or {}).get("provider", ""))
    return principal


def _failure(db, row, failure, *, now=None):
    instant = _now(now)
    status = failure.status_code if isinstance(failure, HTTPException) else failure.status if isinstance(failure, CoreError) else 503
    detail = failure.detail if isinstance(failure, HTTPException) else {}
    code = detail.get("code") if isinstance(detail, dict) else None
    code = code or (failure.code if isinstance(failure, CoreError) else "handoff_blocked" if status < 500 else "handoff_unavailable")
    # Driver exceptions and rejected request bodies must not expose credentials or SQL.
    message = detail.get("message") if isinstance(detail, dict) else detail if isinstance(detail, str) else None
    message = message or ("The fixed handoff is blocked; cancel and prepare a new plan." if status < 500 else "Handoff temporarily unavailable; the same original will be retried.")
    retry = status >= 500 or status in {408, 429}
    _change(db, row, state="retry_wait" if retry else "blocked", lease_owner="", lease_expires_at=None,
            next_attempt_at=instant + timedelta(seconds=min(300, 2 ** min(row.attempt, 8))) if retry else instant + timedelta(seconds=60),
            error={"code": _text(code, 100), "message": _text(message, 1000)}, updated_at=instant)


def process_claim(app, sessions, claim, *, now=None):
    store, execution = getattr(app.state, "hermes_store", None), getattr(app.state, "hermes_execution", None)
    try:
        with sessions() as db:
            row = db.get(DeliveryExecutionHandoff, claim.id)
            if row is None:
                return False
            lock_project_scopes(db, [(row.tenant_id, row.project_id)])
            db.refresh(row)
            if not _claimed(row, claim):
                return False
            project = db.get(Project, row.project_id, populate_existing=True)
            if project is None or project.tenant_id != row.tenant_id:
                return False
            if store is None:
                raise HTTPException(503, "Execution runtime is unavailable")
            request = _validate_original(row)
            service = ManagedHandoff(store, execution)
            fact = service.probe(_principal(row), row.workspace_id, **request)
            if fact is None:
                from .delivery_execution_control_operation_service import pending_cancel

                if pending_cancel(db, project, row.execution_id):
                    raise HTTPException(409, {"code": "execution_cancel_accepted", "message": "An accepted cancellation prevents a new runtime plan."})
                if claim.recover_only:
                    _change(db, row, state="blocked", lease_owner="", lease_expires_at=None,
                            next_attempt_at=_now(now) + timedelta(seconds=60), updated_at=_now(now))
                    db.commit()
                    return False
                workspace = db.get(DeliveryWorkspace, row.project_id, populate_existing=True)
                if workspace is None:
                    raise HTTPException(409, "The accepted execution workspace is unavailable")
                principal = _authorize_new(db, project, row, deepcopy(workspace.data), store, execution)
                fact = service.dispatch(principal, row.workspace_id, fence=row.fence, **request)
            return project_handoff(db, project, row, claim, fact, now=now)
    except Exception as failure:
        # The Core commit may already exist. Preserve the committed claim and recover it next time.
        with sessions() as db:
            row = db.get(DeliveryExecutionHandoff, claim.id)
            if row is None:
                return False
            lock_project_scopes(db, [(row.tenant_id, row.project_id)]); db.refresh(row)
            if _claimed(row, claim):
                if claim.recover_only:
                    # A blocked original never regains dispatch eligibility because
                    # its read-only receipt probe suffered a transient failure.
                    _change(db, row, state="blocked", lease_owner="", lease_expires_at=None,
                            next_attempt_at=_now(now) + timedelta(seconds=60), updated_at=_now(now))
                else:
                    _failure(db, row, failure, now=now)
                db.commit()
        return False


def handoff_once(app, sessions=SessionLocal, *, limit=20, now=None):
    if type(limit) is not int or not 1 <= limit <= MAX_SCAN:
        raise ValueError("Handoff scan requires a bounded limit")
    instant = _now(now)
    due_at = case((DeliveryExecutionHandoff.state == "dispatching", DeliveryExecutionHandoff.lease_expires_at),
                  else_=DeliveryExecutionHandoff.next_attempt_at)
    with sessions() as db:
        ids = db.scalars(select(DeliveryExecutionHandoff.id).where(or_(
            and_(DeliveryExecutionHandoff.state.in_(["accepted", "retry_wait", "blocked"]), or_(DeliveryExecutionHandoff.next_attempt_at.is_(None), DeliveryExecutionHandoff.next_attempt_at <= instant)),
            and_(DeliveryExecutionHandoff.state == "dispatching", DeliveryExecutionHandoff.lease_expires_at <= instant),
        )).order_by(due_at, DeliveryExecutionHandoff.accepted_at, DeliveryExecutionHandoff.id).limit(limit)).all()
    applied = 0
    for handoff_id in ids:
        try:
            with sessions() as db:
                claim = claim_handoff(db, handoff_id, now=instant)
                db.commit()  # A durable acceptance and claim always precede external effects.
            if claim and process_claim(app, sessions, claim, now=instant):
                applied += 1
        except Exception:
            # A failed tenant/driver must not prevent independent due originals
            # from being scanned. The committed lease is recoverable on expiry.
            logger.warning("Handoff scan deferred for %s", handoff_id)
    return applied
