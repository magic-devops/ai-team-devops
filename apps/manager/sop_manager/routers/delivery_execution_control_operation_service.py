"""SQL admission precedes effects; private Core terminal receipts reconcile at current V."""
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta
import logging
from uuid import uuid4

from fastapi import HTTPException
from hermes_core.managed_controls import ManagedControls, control_definition_hash, managed_control_digest
from hermes_core.models import CoreError, Principal
from hermes_core.transactional import digest
from sqlalchemy import and_, case, or_, select

from sop_manager.project_write_guard import execution_control_projection_scope, execution_control_write_scope, lock_project_scopes
from .delivery_execution_control_operation_model import ACTIVE, PRE_EFFECT, DeliveryExecutionControlOperation
from .delivery_execution_handoff import _now, _stamp, _text
from .sql_models import DeliveryWorkspace, Project, SessionLocal, User

logger = logging.getLogger(__name__)
LEASE_SECONDS = 30
MAX_SCAN = 100


def control_view(row):
    """Works with a public-column namespace: original/effect never enter public reads."""
    launch = deepcopy(row.launch)
    if launch and launch.get("claimed_at") is not None:
        launch["claimed_at"] = _stamp(datetime.fromisoformat(launch["claimed_at"]))
    return {"id": row.id, "execution_id": row.execution_id, "task_id": row.task_id,
            "workspace_id": row.workspace_id, "action": row.action, "request_digest": row.request_digest,
            "state": row.state, "revision": row.revision, "attempt": row.attempt,
            "accepted_at": _stamp(row.accepted_at), "updated_at": _stamp(row.updated_at),
            "next_attempt_at": _stamp(row.next_attempt_at),
            "error": {"code": _text(row.error.get("code"), 100), "message": _text(row.error.get("message"), 1000)} if row.error else None,
            "run_id": row.run_id, "run_attempt": row.run_attempt, "outcome": row.outcome,
            "launch": launch, "target_operation_id": row.target_operation_id}


def active_controls(db, project, execution_id, *, ignore=()):
    return list(db.scalars(select(DeliveryExecutionControlOperation).where(
        DeliveryExecutionControlOperation.tenant_id == project.tenant_id,
        DeliveryExecutionControlOperation.project_id == project.id,
        DeliveryExecutionControlOperation.execution_id == execution_id,
        DeliveryExecutionControlOperation.state.in_(ACTIVE),
        DeliveryExecutionControlOperation.id.not_in(tuple(ignore)),
    ).order_by(DeliveryExecutionControlOperation.accepted_version, DeliveryExecutionControlOperation.id).limit(10)))


def pending_cancel(db, project, execution_id, *, ignore=()):
    """Caller holds Project lock; accepted cancel linearizes before fresh H/launch."""
    return any(row.action == "execution.cancel" for row in active_controls(db, project, execution_id, ignore=ignore))


def _principal(row):
    return Principal(row.requested_by, tenant=row.tenant_id, business=row.business_key,
                     permissions=frozenset({"read"}), workspace_ids=frozenset({row.workspace_id}))


def _validate_original(row):
    try:
        verified = managed_control_digest(_principal(row), row.workspace_id, request=row.original) == row.request_digest
    except (CoreError, KeyError, ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(409, {"code": "control_original_invalid", "message": "The accepted control original cannot be verified."}) from exc
    expected = {"control_id": row.id, "tenant": row.tenant_id, "business": row.business_key, "workspace": row.workspace_id,
                "actor": row.requested_by, "project_id": row.project_id, "execution_id": row.execution_id,
                "task_id": row.task_id, "action": row.action, "accepted_version": row.accepted_version}
    if not verified or any(row.original.get(key) != value for key, value in expected.items()):
        raise HTTPException(409, {"code": "control_original_invalid", "message": "The accepted control original cannot be verified."})
    return deepcopy(row.original)


def _target(db, project, entry, body):
    row = db.get(DeliveryExecutionControlOperation, body.control_operation_id, populate_existing=True)
    if (row is None or row.tenant_id != project.tenant_id or row.project_id != project.id
            or row.execution_id != entry["id"] or row.workspace_id != entry["workspace_id"]
            or row.action == "execution.control.close" or row.request_digest != body.request_digest):
        raise HTTPException(404, "The exact control original is unavailable in this execution")
    return row


def _close_authority(db, project, user, principal, target):
    from .delivery import _role_permissions

    permissions = _role_permissions(db, user, project)
    if (project.status == "archived" or not permissions["write"] or "read" not in principal.permissions
            or user.id != target.requested_by and not permissions["approve"]):
        raise HTTPException(403, {"code": "control_close_permission_required", "message": "Current project write and runtime read permission, plus original ownership or project approval, are required."})
    if target.state not in PRE_EFFECT or target.effect is not None:
        raise HTTPException(409, {"code": "control_already_processed", "message": "The control has a known effect. Review the actual run and explicitly cancel it if needed."})


def accept_control(db, project, user, state, action, body, store, execution, *, command_key):
    """Called within the existing strict Project CAS transaction; no Core write."""
    from .delivery_execution_runtime import _controls, _read, _require_managed_source, _selected_capability
    from .delivery_execution_runtime_controls import _authority, _validate_fixed_preview
    from .delivery_service import identifier

    original_entry = next((item for item in state.get("executions", []) if item.get("id") == body.id), None)
    if original_entry is None:
        raise HTTPException(404, "Execution not found in project")
    before = deepcopy(original_entry)
    entry, principal, workspace, run = _read(db, project, user, state, original_entry, store)
    pending = active_controls(db, project, entry["id"])
    target = None
    if action == "execution.control.close":
        target = _target(db, project, entry, body)
        _close_authority(db, project, user, principal, target)
        if any(row.target_operation_id == target.id for row in pending):
            raise HTTPException(409, {"code": "control_close_pending", "message": "This original already has an accepted close request."})
    else:
        if (action == "execution.approval") != (body.approval_id is not None):
            raise HTTPException(422, "The approval identity must match the selected action")
        if body.run_id != (run["id"] if run else ""):
            raise HTTPException(409, {"code": "execution_identity_changed", "message": "The fixed run identity changed; review a new preview."})
        _require_managed_source(store, principal, entry, run)
        permissions = _authority(db, project, user, action, principal, run)
        _, approval, controls = _controls(db, project, user, state, entry, store, execution, principal, workspace, run, permissions)
        _validate_fixed_preview(db, project, state, entry, workspace, run, approval, controls, body, action,
                                _selected_capability(controls, action, body.decision))
        if pending and (action != "execution.cancel" or any(row.action in {"execution.cancel", "execution.control.close"} for row in pending)):
            raise HTTPException(409, {"code": "execution_control_pending", "message": "An accepted control is still being processed. Read that original before another action."})
        if len(pending) > 8:
            raise HTTPException(409, "Too many earlier controls require explicit review")
    version = db.connection().scalar(select(DeliveryWorkspace.version).where(
        DeliveryWorkspace.project_id == project.id, DeliveryWorkspace.tenant_id == project.tenant_id))
    if type(version) is not int or version < 1:
        raise HTTPException(409, "A control must belong to a reserved acceptance version")
    request = {"schema": "manager.execution-control.v1", "tenant": principal.tenant,
        "business": principal.business, "workspace": entry["workspace_id"], "actor": user.id,
        "control_id": identifier("control"), "project_id": project.id, "execution_id": entry["id"], "task_id": entry["task_id"],
        "action": action, "original": {"payload": body.model_dump(mode="json", exclude_none=True), "version": version - 1, "key": command_key},
        "accepted_version": version, "runtime_task_id": entry.get("runtime_task_id") or "",
        "definition_hash": control_definition_hash(run) if run else None,
        "prior_requests": [_validate_original(row) for row in pending] if action == "execution.cancel" else [],
        "handoff_request": None, "target_request": _validate_original(target) if target else None}
    if action == "execution.cancel" and run is None:
        from .delivery_execution import _dispatch_body, _envelope_data
        from .delivery_execution_handoff import _validate_original as validate_handoff
        from .delivery_execution_handoff_model import DeliveryExecutionHandoff

        handoff = db.get(DeliveryExecutionHandoff, entry.get("handoff_id"))
        if not handoff or (handoff.tenant_id, handoff.project_id, handoff.execution_id) != (project.tenant_id, project.id, entry["id"]):
            raise HTTPException(409, "The canonical handoff original is unavailable; cancellation is not confirmed")
        validate_handoff(handoff)
        request["handoff_request"] = {"actor": handoff.requested_by, "operation_id": handoff.id, "project_id": project.id,
            "execution_id": entry["id"], "envelope": _envelope_data(handoff.original),
            "dispatch_kind": "agent" if handoff.original.get("agent_id") else "command",
            "body": _dispatch_body(handoff.original).model_dump(mode="json"), "plan_basis": handoff.original["plan_basis"]}
    instant = _now()
    row = DeliveryExecutionControlOperation(id=request["control_id"], tenant_id=project.tenant_id, project_id=project.id,
        execution_id=entry["id"], task_id=entry["task_id"], workspace_id=entry["workspace_id"], requested_by=user.id,
        business_key=principal.business, action=action, original=request,
        request_digest=managed_control_digest(principal, entry["workspace_id"], request=request), accepted_version=version,
        target_operation_id=target.id if target else None, state="accepted", revision=1, fence=0, attempt=0,
        lease_owner="", lease_expires_at=None, next_attempt_at=instant, error=None, run_id=None, run_attempt=None,
        outcome=None, launch=None, effect=None, accepted_at=instant, updated_at=instant)
    with execution_control_write_scope(db, row.tenant_id, row.project_id, row.id):
        db.add(row)
        db.flush()
    return entry["id"], before, {"control_operation_id": row.id, "request_digest": row.request_digest}


@dataclass(frozen=True)
class ControlClaim:
    id: str
    revision: int
    fence: int
    owner: str


def _change(db, row, **values):
    with execution_control_write_scope(db, row.tenant_id, row.project_id, row.id):
        for key, value in {**values, "revision": row.revision + 1}.items():
            setattr(row, key, value)
        db.flush()


def _claimed(row, claim):
    return bool(row and row.state == "applying" and (row.revision, row.fence, row.lease_owner) == (claim.revision, claim.fence, claim.owner))


def claim_control(db, control_id, *, now=None, lease_seconds=LEASE_SECONDS):
    row = db.get(DeliveryExecutionControlOperation, control_id)
    if row is None:
        return None
    lock_project_scopes(db, [(row.tenant_id, row.project_id)])
    db.refresh(row)
    instant = _now(now)
    due = row.state in {"accepted", "retry_wait", "blocked", "awaiting_executor"} and row.next_attempt_at <= instant
    due = due or row.state == "applying" and row.lease_expires_at is not None and row.lease_expires_at <= instant
    if not due:
        return None
    owner = uuid4().hex
    _change(db, row, state="applying", fence=row.fence + 1, attempt=row.attempt + 1, lease_owner=owner,
            lease_expires_at=instant + timedelta(seconds=lease_seconds), next_attempt_at=None, updated_at=instant)
    return ControlClaim(row.id, row.revision, row.fence, owner)


def _require_original_handoff_plan(db, project, row, entry, run, store, execution):
    """Permit only observation/closure of the original H if its plan won first."""
    from hermes_core.managed_handoff import ManagedHandoff
    from .delivery_execution import _dispatch_body, _envelope_data
    from .delivery_execution_handoff import _principal as handoff_principal, _request as handoff_request, _validate_original as validate_handoff
    from .delivery_execution_handoff_model import DeliveryExecutionHandoff

    fixed = row.original.get("handoff_request")
    handoff = db.get(DeliveryExecutionHandoff, fixed.get("operation_id")) if isinstance(fixed, dict) else None
    if (handoff is None or (handoff.tenant_id, handoff.project_id, handoff.execution_id, handoff.task_id, handoff.workspace_id)
            != (row.tenant_id, project.id, row.execution_id, row.task_id, row.workspace_id)
            or entry.get("handoff_id") != handoff.id or handoff.business_key != row.business_key):
        raise HTTPException(409, "The fixed pending handoff changed; explicitly review a new preview")
    validate_handoff(handoff)
    expected = {"actor": handoff.requested_by, "operation_id": handoff.id, "project_id": project.id,
        "execution_id": row.execution_id, "envelope": _envelope_data(handoff.original),
        "dispatch_kind": "agent" if handoff.original.get("agent_id") else "command",
        "body": _dispatch_body(handoff.original).model_dump(mode="json"), "plan_basis": handoff.original["plan_basis"]}
    if fixed != expected:
        raise HTTPException(409, "The complete pending handoff no longer matches its accepted original")
    fact = ManagedHandoff(store, execution).probe(handoff_principal(handoff), row.workspace_id, **handoff_request(handoff))
    if (not isinstance(fact, dict) or fact.get("state") != "planned"
            or any(fact.get(key) != value for key, value in (
                ("operation_id", handoff.id), ("project_id", project.id), ("execution_id", row.execution_id),
                ("request_hash", handoff.request_digest), ("run_id", run["id"]),
                ("runtime_task_id", entry.get("runtime_task_id"))))):
        raise HTTPException(409, "The actual run is not the verified plan of this original pending handoff")


def _fresh_authority(db, project, row, state, store, execution, *, launch=False, effect_run_id=None, effect_attempt=None):
    from .auth_sql import check_project_access
    from .delivery import _role_permissions
    from .delivery_execution_runtime import _controls, _read, _require_managed_source, _selected_capability, _validate_configuration
    from .delivery_execution_runtime_contract import ExecutionRuntimeControl
    from .delivery_execution_runtime_controls import _authority, _validate_fixed_preview
    from .delivery_issue_evidence import _access
    from .delivery_verification import VerificationContext

    actor = db.get(User, row.requested_by, populate_existing=True)
    if not actor or actor.status != "active" or actor.tenant_id != row.tenant_id:
        raise HTTPException(403, "The original control requester is no longer active")
    check_project_access(actor, project.id, db)
    entry = next((item for item in state.get("executions", []) if item.get("id") == row.execution_id), None)
    if not entry or (entry.get("task_id"), entry.get("workspace_id")) != (row.task_id, row.workspace_id):
        raise HTTPException(409, "The accepted execution identity changed")
    principal, _workspace = _access(store, actor, project, row.workspace_id)
    if principal.business != row.business_key:
        raise HTTPException(403, "The original runtime business scope changed")
    if row.action == "execution.control.close":
        target = db.get(DeliveryExecutionControlOperation, row.target_operation_id, populate_existing=True)
        # A processed target may win after K admission. Core must return that real fact.
        permissions = _role_permissions(db, actor, project)
        if (project.status == "archived" or not permissions["write"] or "read" not in principal.permissions
                or target is None or actor.id != target.requested_by and not permissions["approve"]):
            raise HTTPException(403, "Current authority to end this original is unavailable")
        return principal
    entry, principal, workspace, run = _read(db, project, actor, state, entry, store)
    permissions = _authority(db, project, actor, row.action, principal, run)
    payload = ExecutionRuntimeControl.model_validate(row.original["original"]["payload"])
    _require_managed_source(store, principal, entry, run)
    if not launch and row.action == "execution.cancel" and not payload.run_id and run:
        _require_original_handoff_plan(db, project, row, entry, run, store, execution)
        # Preserve the empty-run original. Core closes only that exact H and
        # records handoff_planned/needs_review; this path never stops this Run.
        return principal
    if not launch and payload.run_id != (run["id"] if run else ""):
        raise HTTPException(409, "The fixed run changed; explicitly review a new preview")
    if launch:
        from hermes_core.run_controls import pending_stop
        from .delivery_task_submission_service import require_native_not_taken_over
        from .delivery_external_work_order_service import require_no_active_work_order

        require_no_active_work_order(db, project, row.task_id, action="execution.launch")
        require_native_not_taken_over(VerificationContext(db, project, state), entry)
        if project.status != "active" or not run or not VerificationContext(db, project, state).execution_snapshot_current(entry):
            raise HTTPException(409, "The accepted launch context changed")
        if (run["id"] != (effect_run_id or row.run_id)
                or run["data"].get("attempt", 1) != (effect_attempt if effect_attempt is not None else row.run_attempt)
                or control_definition_hash(run) != row.original["definition_hash"]):
            raise HTTPException(409, "The fixed launch definition changed")
        if run["status"] not in {"queued", "retrying", "interrupted"} or pending_stop(run):
            raise HTTPException(409, "The accepted launch no longer has a claimable runtime state")
        _validate_configuration(db, project, actor, state, entry, store, execution, principal, run)
    elif row.action == "execution.cancel":
        if run and (run["data"].get("attempt", 1) != payload.attempt or control_definition_hash(run) != row.original["definition_hash"]):
            raise HTTPException(409, "The fixed cancellation attempt or definition changed")
    else:
        _, approval, controls = _controls(db, project, actor, state, entry, store, execution, principal, workspace, run,
                                          permissions, ignore_control_ids=(row.id,))
        _validate_fixed_preview(db, project, state, entry, workspace, run, approval, controls, payload, row.action,
                                _selected_capability(controls, row.action, payload.decision))
    return principal


def _fact(row, value):
    if (not isinstance(value, dict) or any(value.get(key) != expected for key, expected in (
            ("control_id", row.id), ("project_id", row.project_id), ("execution_id", row.execution_id), ("request_hash", row.request_digest)))
            or value.get("state") not in {"applied", "closed"}
            or value.get("receipt_id") != digest(["manager.control", row.id])):
        raise HTTPException(503, {"code": "control_receipt_invalid", "message": "The Core control receipt could not be verified."})
    run = value.get("run")
    if run is not None and (not isinstance(run, dict) or run.get("id") != value.get("run_id")
            or run.get("version") != value.get("run_version") or type(run.get("version")) is not int
            or run["version"] < 1 or type(value.get("attempt")) is not int or value["attempt"] < 1
            or (run.get("tenant"), run.get("business"), run.get("workspace")) != (row.tenant_id, row.business_key, row.workspace_id)
            or run.get("kind") != "runs"):
        raise HTTPException(503, "The control receipt has invalid runtime references")
    return value


def _project_entry(data, row, fact, run):
    from .delivery_execution_runtime import record_stop

    entry = next((item for item in data.get("executions", []) if item.get("id") == row.execution_id), None)
    if entry is None or (entry.get("task_id"), entry.get("workspace_id")) != (row.task_id, row.workspace_id):
        raise HTTPException(409, "The accepted execution identity changed")
    if run:
        if entry.get("run_id") and entry["run_id"] != run["id"]:
            raise HTTPException(409, "The actual run changed; receipt recovery cannot rebind it")
        if entry.get("run_version", 0) > run["version"]:
            return
        entry.update(run_id=run["id"], runtime_task_id=fact.get("runtime_task_id") or row.original["runtime_task_id"],
                     run_version=run["version"], attempt=run["data"].get("attempt", 1))
        # Respect completed human review; this scope only records technical facts.
        if entry.get("status") not in {"accepted", "rejected", "cancelled"}:
            entry["status"] = "awaiting_review" if run["status"] == "completed" else run["status"]
        record_stop(entry, run)
        if row.action == "execution.cancel" and run["status"] == "cancelled":
            entry["status"] = "cancelled"
            entry.setdefault("cancelled_at", _stamp(_now()))
    elif row.action == "execution.cancel" and (fact.get("handoff") or {}).get("state") == "closed":
        entry.update(status="cancelled", run_id="", runtime_task_id="", run_version=0, stop_pending=False,
                     cancelled_at=_stamp(_now()), stop_snapshot={"id": "", "state": "not_started",
                         "reason": "The Core handoff gate is durably closed with no runtime plan.", "node_id": None,
                         "attempt": 1, "requested_at": _stamp(_now()), "confirmed_at": None,
                         "evidence": "No runtime plan can be created for this closed handoff."})


def project_control(db, project, row, claim, fact, store, service, *, now=None):
    if not _claimed(row, claim):
        return False
    fact = _fact(row, fact)
    launch = service.launch_view(_principal(row), row.workspace_id, request=row.original)
    if launch is not None:
        launch = {key: launch.get(key) for key in ("id", "state", "claimed_at")}
    state = "closed" if fact["state"] == "closed" else "awaiting_executor" if launch and launch["state"] == "ready" else "applied"
    outcome = "closed" if state == "closed" else "needs_review" if fact.get("outcome") in {"target_applied", "handoff_planned", "run_terminal"} else "applied"
    if fact.get("outcome") == "target_closed":
        outcome = "closed"
    instant = _now(now)
    with execution_control_projection_scope(db, project.tenant_id, project.id, row.id):
        workspace = db.get(DeliveryWorkspace, project.id, populate_existing=True)
        if workspace is None or workspace.tenant_id != project.tenant_id:
            raise HTTPException(409, "The execution workspace is unavailable")
        before = workspace.data
        data = deepcopy(before)
        # A newer actual read is safe; the immutable C effect remains its original snapshot.
        run = store.get(_principal(row), row.workspace_id, "runs", fact["run_id"]) if fact.get("run_id") else None
        launch_error = None
        if state == "awaiting_executor":
            try:
                if pending_cancel(db, project, row.execution_id, ignore=(row.id,)):
                    raise HTTPException(409, "An accepted cancellation prevents a new executor claim")
                _fresh_authority(db, project, row, data, store, service.execution, launch=True,
                                 effect_run_id=fact.get("run_id"), effect_attempt=fact.get("attempt"))
            except (HTTPException, CoreError) as exc:
                state = "blocked"
                detail = exc.detail if isinstance(exc, HTTPException) else {}
                code = detail.get("code") if isinstance(detail, dict) else None
                launch_error = {"code": _text(code or "control_launch_blocked", 100),
                    "message": "The control effect is recorded, but current authority or configuration prevents executor pickup. Review the actual run."}
        _change(db, row, state=state, effect=deepcopy(fact) if row.effect is None else row.effect,
                launch=launch, run_id=fact.get("run_id"), run_attempt=fact.get("attempt"), outcome=outcome,
                lease_owner="", lease_expires_at=None, error=launch_error,
                next_attempt_at=instant + timedelta(seconds=5 if state == "awaiting_executor" else 60) if state in {"awaiting_executor", "blocked"} else None,
                updated_at=instant)
        _project_entry(data, row, fact, run)
        if data != before:
            workspace.data = data
            workspace.version += 1
        db.flush()
        db.commit()  # derived-only hook runs while the narrow technical capability is held
    return True


def _failure(db, row, failure, *, now=None):
    instant = _now(now)
    status = failure.status_code if isinstance(failure, HTTPException) else failure.status if isinstance(failure, CoreError) else 503
    detail = failure.detail if isinstance(failure, HTTPException) else {}
    code = detail.get("code") if isinstance(detail, dict) else None
    code = code or (failure.code if isinstance(failure, CoreError) else "control_blocked" if status < 500 else "control_unavailable")
    message = detail.get("message") if isinstance(detail, dict) else detail if isinstance(detail, str) else None
    message = message or ("The accepted original is blocked. Review it or explicitly end it." if status < 500 else "Control temporarily unavailable; the same original will be recovered.")
    retry = status >= 500 or status in {408, 429}
    _change(db, row, state="retry_wait" if retry else "blocked", lease_owner="", lease_expires_at=None,
            next_attempt_at=instant + timedelta(seconds=min(300, 2 ** min(row.attempt, 8))) if retry else instant + timedelta(seconds=60),
            error={"code": _text(code, 100), "message": _text(message, 1000)}, updated_at=instant)


def process_control(app, sessions, claim, *, now=None):
    store, execution = getattr(app.state, "hermes_store", None), getattr(app.state, "hermes_execution", None)
    launch_work = None
    try:
        with sessions() as db:
            row = db.get(DeliveryExecutionControlOperation, claim.id)
            if row is None:
                return False
            lock_project_scopes(db, [(row.tenant_id, row.project_id)])
            db.refresh(row)
            if not _claimed(row, claim):
                return False
            project = db.get(Project, row.project_id, populate_existing=True)
            if project is None or project.tenant_id != row.tenant_id or store is None:
                raise HTTPException(503, "The accepted control runtime is unavailable")
            request = _validate_original(row)
            service = ManagedControls(store, execution)
            # Probe before current authority: recording an existing fact does not execute.
            fact = service.probe(_principal(row), row.workspace_id, request=request)
            if fact is None:
                workspace = db.get(DeliveryWorkspace, row.project_id, populate_existing=True)
                if workspace is None:
                    raise HTTPException(409, "The accepted execution workspace is unavailable")
                principal = _fresh_authority(db, project, row, deepcopy(workspace.data), store, execution)
                fact = service.apply(principal, row.workspace_id, request=request)
            projected = project_control(db, project, row, claim, fact, store, service, now=now)
            if projected and row.state == "awaiting_executor" and execution is not None:
                launch_work = service.dispatch_ready(_principal(row), row.workspace_id, request=request)
                if launch_work:
                    launch_work = (deepcopy(request), row.workspace_id, launch_work)
        if launch_work:
            request, workspace_id, arguments = launch_work
            # Execute owns the final current-authority context and ticket claim. This
            # is a bounded submit; long node work must not hold the SQL transaction.
            from .delivery_execution_schedule import submit_control_launch
            submit_control_launch(app, request, workspace_id, arguments)
        return projected
    except Exception as failure:
        with sessions() as db:
            row = db.get(DeliveryExecutionControlOperation, claim.id)
            if row is None:
                return False
            lock_project_scopes(db, [(row.tenant_id, row.project_id)])
            db.refresh(row)
            if _claimed(row, claim):
                _failure(db, row, failure, now=now)
                db.commit()
        return False


def control_once(app, sessions=SessionLocal, *, limit=20, now=None):
    if type(limit) is not int or not 1 <= limit <= MAX_SCAN:
        raise ValueError("Control scan requires a bounded limit")
    instant = _now(now)
    due_at = case((DeliveryExecutionControlOperation.state == "applying", DeliveryExecutionControlOperation.lease_expires_at),
                  else_=DeliveryExecutionControlOperation.next_attempt_at)
    with sessions() as db:
        ids = db.scalars(select(DeliveryExecutionControlOperation.id).where(or_(
            and_(DeliveryExecutionControlOperation.state.in_(["accepted", "retry_wait", "blocked", "awaiting_executor"]), DeliveryExecutionControlOperation.next_attempt_at <= instant),
            and_(DeliveryExecutionControlOperation.state == "applying", DeliveryExecutionControlOperation.lease_expires_at <= instant),
        )).order_by(due_at, DeliveryExecutionControlOperation.accepted_at, DeliveryExecutionControlOperation.id).limit(limit)).all()
    count = 0
    for control_id in ids:
        try:
            with sessions() as db:
                claim = claim_control(db, control_id, now=instant)
                db.commit()
            if claim and process_control(app, sessions, claim, now=instant):
                count += 1
        except Exception:
            logger.warning("Control scan deferred for %s", control_id)
    return count


def launch_authority(sessions, store, execution):
    @contextmanager
    def authority(*, request, ticket):
        # Invoked before any Core lock by both local and remote claim paths.
        with sessions() as db:
            row = db.get(DeliveryExecutionControlOperation, request.get("control_id"))
            if row is None:
                raise HTTPException(403, "The accepted launch original is unavailable")
            lock_project_scopes(db, [(row.tenant_id, row.project_id)])
            db.refresh(row)
            fixed = _validate_original(row)
            if fixed != request or ticket.get("control_id") != row.id or ticket.get("request_hash") != row.request_digest:
                raise HTTPException(409, "The exact launch original changed")
            if (row.effect is None or row.run_id != ticket.get("run_id") or row.run_attempt != ticket.get("attempt")
                    or row.state not in {"awaiting_executor", "applying", "applied"}):
                raise HTTPException(409, "The accepted launch has no matching actual effect")
            project = db.get(Project, row.project_id, populate_existing=True)
            workspace = db.get(DeliveryWorkspace, row.project_id, populate_existing=True)
            if project is None or workspace is None or project.tenant_id != row.tenant_id:
                raise HTTPException(403, "The launch project is unavailable")
            if pending_cancel(db, project, row.execution_id, ignore=(row.id,)):
                raise HTTPException(409, "An accepted cancellation prevents a new executor claim")
            principal = _fresh_authority(db, project, row, deepcopy(workspace.data), store, execution, launch=True)
            try:
                yield principal
            finally:
                db.rollback()  # read/lock capability only; never retain locks across node execution
    return authority
