"""Private, durable Manager controls and launch assignments.

Only the Manager's committed control worker may call this module. Public resource
APIs cannot create tickets or mutate their activation marker. Receipt replay and
probe are observations; they never grant permission for a fresh effect or claim.
"""
from __future__ import annotations

import json
import re
import uuid
from contextlib import contextmanager
from dataclasses import replace

from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from .agents import AgentDispatch
from .managed_handoff import ManagedHandoff, _request as handoff_request
from .models import CoreError, Decision, Principal, RunAction, TaskDispatch
from .run_controls import apply_run_action_in_transaction, decide_approval_in_transaction
from .transactional import digest, now

MAX_CONTROL_BYTES = 4 * 1024 * 1024
_ACTIONS = {"execution.start", "execution.retry", "execution.cancel", "execution.approval", "execution.control.close"}
_FIELDS = {"schema", "tenant", "business", "workspace", "actor", "control_id", "project_id", "execution_id", "task_id",
           "action", "original", "accepted_version", "runtime_task_id", "definition_hash", "prior_requests", "handoff_request", "target_request"}


def _invalid(message):
    raise CoreError("invalid_control", message, 422)


def _identity(value, name, limit=64, *, empty=False):
    if (not isinstance(value, str) or len(value) > limit or (not value and not empty)
            or any(char.isspace() or ord(char) < 32 or 127 <= ord(char) < 160 for char in value)):
        _invalid("Invalid " + name)


def _hash(value, *, optional=False):
    if value is None and optional:
        return
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        _invalid("An exact SHA-256 request/definition binding is required")


def control_definition_hash(run):
    """Only immutable plan/source fields; runtime progress and heartbeats are excluded."""
    return digest({key: run["data"].get(key) for key in (
        "nodes", "workspace_root", "workspace_version", "isolation", "base_commit", "agent_bindings", "agent_source",
        "target_snapshot", "target_device_id", "task_source")})


def _validate(request, principal, workspace, *, nested=False, allow_prior=False):  # noqa: C901
    if not isinstance(request, dict) or set(request) != _FIELDS:
        _invalid("Use the complete, exact managed control request")
    if request["schema"] != "manager.execution-control.v1" or request["action"] not in _ACTIONS:
        _invalid("Unsupported managed control schema or action")
    for name in ("tenant", "business", "actor"):
        _identity(request[name], name, 128)
    for name in ("workspace", "control_id", "project_id", "execution_id", "task_id"):
        _identity(request[name], name)
    if (request["tenant"], request["business"], request["workspace"]) != (principal.tenant, principal.business, workspace):
        raise CoreError("control_scope", "Control belongs to another scope", 409)
    original = request["original"]
    if not isinstance(original, dict) or set(original) != {"payload", "version", "key"}:
        _invalid("Fix the complete original payload, project version and key")
    _identity(original["key"], "original key", 160)
    if type(original["version"]) is not int or original["version"] < 0 or type(request["accepted_version"]) is not int or request["accepted_version"] != original["version"] + 1:
        _invalid("Accepted version must follow the original project version")
    payload = original["payload"]
    if not isinstance(payload, dict) or payload.get("id") != request["execution_id"]:
        _invalid("Control must fix this exact execution")
    reason = payload.get("reason")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000 or any(ord(c) < 32 and c not in "\n\t" for c in reason):
        _invalid("An explicit control reason is required")
    _identity(request["runtime_task_id"], "runtime task", empty=True)
    _hash(request["definition_hash"], optional=True)
    if request["action"] == "execution.control.close":
        if set(payload) != {"id", "control_operation_id", "request_digest", "reason"}:
            _invalid("Close must fix the exact target and digest")
        _identity(payload["control_operation_id"], "target control")
        _hash(payload["request_digest"])
        target = request["target_request"]
        if nested or not isinstance(target, dict) or target.get("action") == "execution.control.close":
            _invalid("Close cannot target another close or contain recursive controls")
        # A target cancel may itself carry its bounded, nonrecursive earlier
        # controls. Closing that complete original must not discard its binding.
        _validate(target, principal, workspace, nested=True, allow_prior=True)
        if (target["control_id"] != payload["control_operation_id"] or digest(target) != payload["request_digest"]
                or target["control_id"] == request["control_id"]):
            _invalid("Close target does not match its complete original request")
        if any(target[name] != request[name] for name in ("project_id", "execution_id", "task_id")):
            _invalid("Close target belongs to another execution")
        if target["accepted_version"] >= request["accepted_version"]:
            _invalid("Close must follow the target's accepted version")
    else:
        required = {"id", "run_id", "run_version", "attempt", "control_basis", "reason"}
        if not required.issubset(payload) or set(payload) - required - {"approval_id", "approval_version", "decision"}:
            _invalid("Invalid original runtime control payload")
        _identity(payload["run_id"], "run", empty=True)
        if (type(payload["run_version"]) is not int or payload["run_version"] < 0
                or bool(payload["run_id"]) != bool(payload["run_version"])
                or type(payload["attempt"]) is not int or payload["attempt"] < 1):
            _invalid("Fix the run, observed version and attempt together")
        _hash(payload["control_basis"])
        if request["target_request"] is not None:
            _invalid("Only close may include a target request")
        if request["action"] == "execution.approval":
            _identity(payload.get("approval_id"), "approval")
            if type(payload.get("approval_version")) is not int or payload["approval_version"] < 1 or payload.get("decision") not in {"approve", "reject"}:
                _invalid("Fix the approval, version and decision together")
        elif any(payload.get(key) is not None for key in ("approval_id", "approval_version", "decision")):
            _invalid("Approval fields require an approval action")
        if bool(payload["run_id"]) != bool(request["runtime_task_id"]) or bool(payload["run_id"]) != bool(request["definition_hash"]):
            _invalid("Run controls require the original task and definition")
        if not payload["run_id"] and request["action"] != "execution.cancel":
            _invalid("Only a pending handoff cancellation may omit a run")
    prior = request["prior_requests"]
    if not isinstance(prior, list) or len(prior) > 8 or (nested and prior and not allow_prior):
        _invalid("Prior control bindings must be bounded and nonrecursive")
    if prior and request["action"] != "execution.cancel":
        _invalid("Only an explicit cancel may preempt earlier controls")
    seen = {request["control_id"]}
    for item in prior:
        if not isinstance(item, dict) or item.get("action") not in {"execution.start", "execution.retry", "execution.approval"}:
            _invalid("Invalid preempted control")
        _validate(item, principal, workspace, nested=True)
        if item["action"] == "execution.approval" and item["original"]["payload"]["decision"] != "approve":
            _invalid("Cancel may preempt an approval resume, not a rejection")
        if (item["control_id"] in seen or item["accepted_version"] >= request["accepted_version"]
                or any(item[name] != request[name] for name in ("project_id", "execution_id", "task_id"))):
            _invalid("Prior controls must precede this exact execution cancellation")
        seen.add(item["control_id"])
    h = request["handoff_request"]
    if h is not None:
        if request["action"] != "execution.cancel" or payload.get("run_id"):
            _invalid("A handoff binding is only valid for a pending cancellation")
        _handoff(principal, workspace, request)
    elif request["action"] == "execution.cancel" and not payload["run_id"]:
        _invalid("Pending cancellation requires its complete original handoff")


def _frozen(principal, workspace, request):
    try:
        encoded = json.dumps(request, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(encoded.encode("utf-8")) > MAX_CONTROL_BYTES:
            raise CoreError("payload_too_large", "The complete managed control must not exceed 4 MiB", 422)
        frozen = json.loads(encoded)
        if frozen != request:
            _invalid("Control must be canonical JSON")
        _validate(frozen, principal, workspace)
        return frozen
    except (TypeError, ValueError, RecursionError, UnicodeError) as exc:
        raise CoreError("invalid_control", "Control must be bounded canonical JSON", 422) from exc


def managed_control_digest(principal, workspace, *, request):
    return digest(_frozen(principal, workspace, request))


def _handoff(principal, workspace, request):
    h = request["handoff_request"]
    if not isinstance(h, dict) or set(h) != {"actor", "operation_id", "project_id", "execution_id", "envelope", "dispatch_kind", "body", "plan_basis"}:
        _invalid("Use the complete handoff, not an opaque handoff digest")
    if h["project_id"] != request["project_id"] or h["execution_id"] != request["execution_id"] or h["dispatch_kind"] not in {"command", "agent"}:
        _invalid("Handoff belongs to a different execution")
    try:
        body = (AgentDispatch if h["dispatch_kind"] == "agent" else TaskDispatch).model_validate(h["body"])
        actor = replace(principal, actor=h["actor"])
        full, body = handoff_request(actor, workspace, operation_id=h["operation_id"], project_id=h["project_id"],
            execution_id=h["execution_id"], envelope=h["envelope"], body=body, plan_basis=h["plan_basis"])
        return actor, full, body
    except (TypeError, ValueError) as exc:
        raise CoreError("invalid_control", "Invalid complete handoff", 422) from exc


def _receipt_id(control_id):
    # Global C identity deliberately excludes actor/tenant/workspace. A rebinding
    # attempt collides with and fails against the original full request hash.
    return digest(["manager.control", control_id])


def _summary(result):
    return {key: result.get(key) for key in ("control_id", "request_hash", "receipt_id", "state", "outcome", "run_id", "run_version", "attempt")}


class ManagedControls:
    def __init__(self, store, execution):
        self.store, self.execution = store, execution

    def _lock_requests(self, conn, request):
        controls = [request, *request["prior_requests"]]
        if request["target_request"] is not None:
            controls.append(request["target_request"])
        if self.store.engine.dialect.name == "postgresql":
            for receipt in sorted({_receipt_id(item["control_id"]) for item in controls}):
                conn.exec_driver_sql("SELECT pg_advisory_xact_lock(%s)", (int.from_bytes(bytes.fromhex(receipt[:16]), "big", signed=True),))

    def _read(self, conn, request, *, lock=False):
        query = select(self.store.receipts).where(self.store.receipts.c.id == _receipt_id(request["control_id"]))
        row = conn.execute(query.with_for_update() if lock else query).mappings().first()
        if row is None:
            return None
        if row["request_hash"] != digest(request):
            raise CoreError("control_conflict", "Control identity is bound to a different complete original request", 409)
        return {**row["result"], "replayed": True}

    def _save(self, conn, request, result):
        self.store_receipt(conn, request, result)
        return result

    def store_receipt(self, conn, request, result):
        conn.execute(insert(self.store.receipts).values(id=_receipt_id(request["control_id"]), request_hash=digest(request), result=result, created_at=now()))

    def _result(self, request, *, state="applied", outcome="effect_applied", run=None, approval=None, resume=None,
                launch=None, handoff=None, target=None, prior_results=None):
        return dict(control_id=request["control_id"], project_id=request["project_id"], execution_id=request["execution_id"],
            request_hash=digest(request), receipt_id=_receipt_id(request["control_id"]), state=state, outcome=outcome,
            runtime_task_id=request["runtime_task_id"] or None, run_id=run["id"] if run else None,
            run_version=run["version"] if run else 0, attempt=run["data"].get("attempt", 1) if run else None,
            run=run, approval=approval, resume=resume, launch=launch, handoff=handoff, target=target,
            prior_results=prior_results or [], replayed=False)

    def probe(self, principal, workspace, *, request):
        request = _frozen(principal, workspace, request)
        with self.store.engine.connect() as conn:
            return self._read(conn, request)

    def _close(self, conn, request):
        existing = self._read(conn, request, lock=True)
        if existing is not None:
            return existing
        return self._save(conn, request, self._result(request, state="closed", outcome="closed_no_effect"))

    def close(self, principal, workspace, *, request):
        request = _frozen(principal, workspace, request)
        if request["action"] == "execution.control.close":
            _invalid("A close control cannot itself be closed")
        return self._transaction(request, lambda conn: self._close(conn, request))

    def _transaction(self, request, apply):
        for attempt in range(2):
            try:
                with self.store.transaction() as conn:
                    self._lock_requests(conn, request)
                    return apply(conn)
            except IntegrityError as exc:
                if attempt:
                    raise CoreError("control_conflict", "Concurrent control receipt or launch identity conflict", 409) from exc

    def _authorize(self, principal, workspace, request):
        if principal.actor != request["actor"]:
            raise CoreError("forbidden", "A fresh control requires its current original actor", 403)
        # This is a private worker entry. Manager separately checks current
        # Project write + requester/project-approver rights for K acceptance and
        # processing. Those business rights are not Hermes runtime grants.
        needed = {"read"} if request["action"] == "execution.control.close" else {"execute"}
        if request["action"] == "execution.approval":
            needed.add("approve")
            if request["original"]["payload"]["decision"] == "reject":
                needed.discard("execute")
        if not needed.issubset(principal.permissions) or principal.workspace_ids is not None and workspace not in principal.workspace_ids:
            raise CoreError("forbidden", "Current managed control permission required", 403)

    def _require_run(self, conn, principal, workspace, request, run):
        payload = request["original"]["payload"]
        if run["data"].get("attempt", 1) != payload["attempt"]:
            raise CoreError("stale_attempt", "Control belongs to a previous attempt; review a new preview", 409)
        if control_definition_hash(run) != request["definition_hash"]:
            raise CoreError("definition_changed", "Control belongs to a different run definition", 409)
        source = run["data"].get("task_source") or {}
        if source.get("task_id") != request["runtime_task_id"]:
            raise CoreError("control_source", "Run belongs to another original task", 409)
        task = self.store._get(conn, principal, workspace, "tasks", request["runtime_task_id"])
        original_source = task["data"].get("source") or {}
        if original_source.get("kind") != "manager.delivery" or original_source.get("execution_id") != request["execution_id"]:
            raise CoreError("control_source", "Run does not belong to this managed execution", 409)
        snapshot = original_source.get("snapshot") or {}
        if snapshot.get("task_id") != request["task_id"]:
            raise CoreError("control_source", "Run belongs to another project task", 409)

    def _revoke_ready(self, conn, *, control_id=None, run_id=None):
        table = self.store.managed_launches
        condition = table.c.control_id == control_id if control_id else table.c.run_id == run_id
        conn.execute(update(table).where(condition, table.c.state == "ready").values(state="revoked", updated_at=now()))

    def _launch(self, conn, principal, workspace, request, run, resume):
        self._revoke_ready(conn, run_id=run["id"])
        launch_id = uuid.uuid4().hex
        run = self.store._mutate(conn, principal, workspace, "runs", run["id"], operation="manager.activation", key=request["control_id"],
            request=request, trace=request["control_id"], expected=run["version"],
            transform=lambda item: {"data": {**item["data"], "managed_activation_id": launch_id}})
        ticket = dict(id=launch_id, control_id=request["control_id"], tenant=principal.tenant, business=principal.business,
            workspace=workspace, actor=request["actor"], project_id=request["project_id"], execution_id=request["execution_id"],
            runtime_task_id=request["runtime_task_id"], run_id=run["id"], attempt=run["data"].get("attempt", 1),
            definition_hash=control_definition_hash(run), request_hash=digest(request), request=request, resume=resume,
            state="ready", claims=[], claimed_at=None, created_at=now(), updated_at=now())
        conn.execute(insert(self.store.managed_launches).values(**ticket))
        return run, _launch_view(ticket)

    def apply(self, principal, workspace, *, request):  # noqa: C901
        request = _frozen(principal, workspace, request)

        def apply(conn):
            cached = self._read(conn, request, lock=True)
            if cached is not None:
                return cached
            self._authorize(principal, workspace, request)
            payload, action = request["original"]["payload"], request["action"]
            if action == "execution.control.close":
                target = self._close(conn, request["target_request"])
                return self._save(conn, request, self._result(request,
                    outcome="target_closed" if target["state"] == "closed" else "target_applied", target=_summary(target)))
            prior = []
            for original in request["prior_requests"]:
                previous = self._close(conn, original)
                self._revoke_ready(conn, control_id=original["control_id"])
                prior.append(_summary(previous))
            if not payload["run_id"]:
                actor, h, body = _handoff(principal, workspace, request)
                handoff = ManagedHandoff(self.store, self.execution).close_in_transaction(conn, actor, workspace, request=h, body=body)
                return self._save(conn, request, self._result(request,
                    outcome="handoff_planned" if handoff.get("run_id") else "effect_applied", handoff=handoff, prior_results=prior))
            # Take workspace before run/task/profile locks for every fresh effect.
            self.store._get(conn, principal, "", "workspaces", workspace)
            run = self.store._get(conn, principal, workspace, "runs", payload["run_id"])
            self._require_run(conn, principal, workspace, request, run)
            if action != "execution.cancel" and run["version"] != payload["run_version"]:
                raise CoreError("version_conflict", "Run changed after this fixed preview", 409)
            standard = {"project_id": request["project_id"], "action": action, "payload": payload}
            key = request["original"]["key"]
            terminal_cancel = action == "execution.cancel" and run["status"] in {"completed", "failed", "cancelled"}
            approval = resume = launch = None
            if action == "execution.approval":
                decided = decide_approval_in_transaction(self.store, conn, self.execution, principal, workspace, payload["approval_id"],
                    Decision(expected_version=payload["approval_version"], idempotency_key=key, decision=payload["decision"], dry_run=False),
                    managed=True, receipt_request=standard)
                run, approval, resume = decided["run"], decided["approval"], decided["resume"]
            else:
                verb = action.removeprefix("execution.")
                if verb == "cancel":
                    self._revoke_ready(conn, run_id=run["id"])
                run = apply_run_action_in_transaction(self.store, conn, self.execution, principal, workspace, run["id"], verb,
                    RunAction(expected_version=payload["run_version"], idempotency_key=key, dry_run=False), managed=True, receipt_request=standard,
                    semantic_cancel=(lambda c, item: self._require_run(c, principal, workspace, request, item)) if verb == "cancel" else None)
            if action in {"execution.start", "execution.retry"} or resume is not None:
                run, launch = self._launch(conn, principal, workspace, request, run, resume)
            return self._save(conn, request, self._result(request,
                outcome="run_terminal" if terminal_cancel else "effect_applied",
                run=run, approval=approval, resume=resume, launch=launch, prior_results=prior))

        return self._transaction(request, apply)

    def launch_view(self, principal, workspace, *, request):
        request = _frozen(principal, workspace, request)
        with self.store.engine.connect() as conn:
            # Detect global C rebinding even when there is no launch.
            receipt = self._read(conn, request)
            row = conn.execute(select(self.store.managed_launches).where(self.store.managed_launches.c.control_id == request["control_id"])).mappings().first()
            if row is None:
                return None
            _ticket_binding(row, request)
            _effect_launch_binding(receipt, row)
            return _launch_view(row)

    def dispatch_ready(self, principal, workspace, *, request):
        request = _frozen(principal, workspace, request)
        with self.store.engine.connect() as conn:
            receipt = self._read(conn, request)
            row = conn.execute(select(self.store.managed_launches).where(self.store.managed_launches.c.control_id == request["control_id"])).mappings().first()
            if row is None:
                return None
            _ticket_binding(row, request)
            _effect_launch_binding(receipt, row)
            run = _pure_run(self.store, conn, principal, workspace, row["run_id"])
            if row["state"] != "ready" or run["data"].get("target_device_id") or run["data"].get("managed_activation_id") != row["id"] or run["data"].get("attempt", 1) != row["attempt"]:
                return None
            return dict(run_id=row["run_id"], expected_attempt=row["attempt"], resume=row["resume"], launch_id=row["id"])


def _launch_view(row):
    return {"id": row["id"], "state": row["state"], "claimed_at": row["claimed_at"]}


def _ticket_binding(row, request):
    if row["request_hash"] != digest(request) or row["request"] != request:
        raise CoreError("control_conflict", "Launch belongs to a different complete control", 409)


def _effect_launch_binding(receipt, ticket):
    launch = receipt.get("launch") if isinstance(receipt, dict) else None
    if (not isinstance(launch, dict) or receipt.get("state") != "applied" or receipt.get("outcome") != "effect_applied"
            or launch.get("id") != ticket["id"] or receipt.get("control_id") != ticket["control_id"]
            or receipt.get("run_id") != ticket["run_id"] or receipt.get("attempt") != ticket["attempt"]
            or receipt.get("request_hash") != ticket["request_hash"]):
        raise CoreError("launch_receipt_missing", "Launch lacks its exact committed control effect receipt", 409)


def _pure_run(store, conn, principal, workspace, run_id):
    row = conn.execute(select(store.entities).where(store._scope(store.entities, principal, workspace),
        store.entities.c.kind == "runs", store.entities.c.id == run_id)).mappings().first()
    if row is None:
        raise CoreError("not_found", "Run not found in this workspace", 404)
    return dict(row)


def read_run_for_launch(store, principal, workspace, run_id):
    with store.engine.connect() as conn:
        return _pure_run(store, conn, principal, workspace, run_id)


@contextmanager
def launch_authority(store, execution, principal, workspace, run, *, launch_id=None):
    """Read first, then enter SQL authority BEFORE taking any Core lock/transaction."""
    activation = run["data"].get("managed_activation_id")
    with store.engine.connect() as conn:
        source_task = (run["data"].get("task_source") or {}).get("task_id")
        task = conn.execute(select(store.entities.c.data).where(store._scope(store.entities, principal, workspace),
            store.entities.c.kind == "tasks", store.entities.c.id == source_task)).scalar_one_or_none() if source_task else None
        managed = bool(activation or isinstance(task, dict) and (task.get("source") or {}).get("kind") == "manager.delivery")
        if not managed:
            ticket = None
        else:
            if not activation or launch_id is not None and activation != launch_id:
                raise CoreError("managed_launch_required", "Managed execution requires its current durable launch ticket", 409)
            row = conn.execute(select(store.managed_launches).where(store.managed_launches.c.id == activation)).mappings().first()
            if row is None:
                raise CoreError("managed_launch_required", "Managed launch ticket is unavailable", 409)
            ticket = dict(row)
            if (ticket["tenant"], ticket["business"], ticket["workspace"], ticket["run_id"]) != (principal.tenant, principal.business, workspace, run["id"]):
                raise CoreError("control_scope", "Launch belongs to a different execution scope", 409)
    if ticket is None:
        yield principal, None
        return
    callback = getattr(execution, "managed_launch_authority", None)
    if callback is None:
        raise CoreError("managed_launch_authority", "Current managed launch authorization is unavailable", 403)
    with callback(request=ticket["request"], ticket=ticket) as current:
        if not isinstance(current, Principal) or current.actor != ticket["actor"] or current.tenant != principal.tenant or current.business != principal.business:
            raise CoreError("managed_launch_authority", "Launch authorization returned a different original actor or scope", 403)
        if "execute" not in current.permissions or current.workspace_ids is not None and workspace not in current.workspace_ids:
            raise CoreError("forbidden", "Current launch execution permission required", 403)
        yield current, ticket


def claim_launch_in_transaction(store, conn, principal, workspace, run, ticket, *, owner, node_id=None, resume=None):
    """Called with run lock held; ticket and run.claimed share the caller's commit."""
    if ticket is None:
        return
    table = store.managed_launches
    row = conn.execute(select(table).where(table.c.id == ticket["id"]).with_for_update()).mappings().first()
    if row is None or row["state"] == "revoked":
        raise CoreError("launch_revoked", "Launch is no longer claimable", 409)
    if (principal.actor != row["actor"] or (principal.tenant, principal.business, workspace) != (row["tenant"], row["business"], row["workspace"])
            or "execute" not in principal.permissions or principal.workspace_ids is not None and workspace not in principal.workspace_ids):
        raise CoreError("forbidden", "Launch claim requires its current original execution actor and scope", 403)
    _ticket_binding(row, ticket["request"])
    receipt = ManagedControls(store, None)._read(conn, ticket["request"])
    _effect_launch_binding(receipt, row)
    if (run["data"].get("managed_activation_id") != row["id"] or run["data"].get("attempt", 1) != row["attempt"]
            or control_definition_hash(run) != row["definition_hash"] or row["resume"] != resume):
        raise CoreError("stale_launch", "Launch no longer matches the current activation, attempt or resume gate", 409)
    if run["status"] not in {"queued", "retrying", "interrupted"} or run["data"].get("execution_owner"):
        raise CoreError("already_claimed", "Execution already has an owner", 409)
    workspace_row = store._get(conn, principal, "", "workspaces", workspace)
    if workspace_row["status"] != "active" or workspace_row["version"] != run["data"].get("workspace_version"):
        raise CoreError("workspace_changed", "Workspace changed before launch", 409)
    task = store._get(conn, principal, workspace, "tasks", row["runtime_task_id"])
    source, link = task["data"].get("source") or {}, task["data"].get("delivery") or {}
    if (source.get("kind") != "manager.delivery" or source.get("execution_id") != row["execution_id"]
            or link.get("run_id") != run["id"] or link.get("phase") != "executing"):
        raise CoreError("delivery_closed", "Managed task no longer authorizes this run", 409)
    if resume is not None:
        approval = store._get(conn, principal, workspace, "approvals", resume["approval_id"])
        if (approval["version"] != resume["approval_version"] or approval["status"] != "approved"
                or approval["data"].get("run_id") != run["id"] or approval["data"].get("node_id") != run["data"].get("active_node")
                or approval["data"].get("attempt", 1) != row["attempt"]):
            raise CoreError("stale_resume", "Launch approval is no longer the current approved gate", 409)
    claims = list(row["claims"])
    assignment_node = node_id or "*"
    if row["state"] == "claimed" and (node_id is None or any(item["node_id"] in {"*", node_id} for item in claims)):
        raise CoreError("already_claimed", "Launch assignment was already claimed", 409)
    if node_id is not None:
        nodes = [node for node in run["data"].get("nodes", []) if not run["data"].get("node_results", {}).get(node["id"], {}).get("succeeded")]
        if not nodes or nodes[0]["id"] != node_id:
            raise CoreError("stale_launch", "Remote assignment does not match the next node", 409)
    claims.append(dict(node_id=assignment_node, owner=owner, claimed_at=now()))
    conn.execute(update(table).where(table.c.id == row["id"]).values(state="claimed", claims=claims,
        claimed_at=row["claimed_at"] or now(), updated_at=now()))
