"""Internal Manager-to-Core handoff, atomically planned or irreversibly closed.

Only Manager's exact-scope recovery/authorized-cancel services may call probe or
close. These are not HTTP actions and confer no permission to start a run. A new
plan requires the original actor's current write/execute and workspace access.
"""

from __future__ import annotations

import json
import re

from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from .agents import AgentDispatch, Agents
from .agent_input import validate_feedback_context
from .delivery import Delivery
from .models import CoreError, Principal, TaskDispatch, TaskEnvelope
from .repository import Repository
from .transactional import Store, digest, now

MAX_MANAGED_HANDOFF_BYTES = 1_048_576


def _within_request_budget(encoded):
    if len(encoded.encode("utf-8")) > MAX_MANAGED_HANDOFF_BYTES:
        raise CoreError("payload_too_large", "The complete managed handoff request must not exceed 1 MiB", 422)


def _identifier(value, name, limit=64):
    if (not isinstance(value, str) or not value.strip() or len(value) > limit
            or any(ord(char) < 32 or ord(char) == 127 for char in value)):
        raise CoreError("invalid_handoff", f"Invalid {name}", 422)
    return value


def _request(principal, workspace, *, operation_id, project_id, execution_id, envelope, body, plan_basis):
    for name, value, limit in (("actor", principal.actor, 128), ("tenant", principal.tenant, 128),
                               ("business", principal.business, 128), ("workspace", workspace, 64),
                               ("operation_id", operation_id, 64), ("project_id", project_id, 64),
                               ("execution_id", execution_id, 64)):
        _identifier(value, name, limit)
    if type(body) not in (TaskDispatch, AgentDispatch):
        raise CoreError("invalid_handoff", "Use an actual TaskDispatch or AgentDispatch request", 422)
    # Detach caller-owned lists/models before any lock or transaction can yield.
    try:
        body_json = body.model_dump_json()
        _within_request_budget(body_json)
        frozen_body = type(body).model_validate_json(body_json)
    except ValueError as exc:
        raise CoreError("invalid_handoff", "Invalid execution request", 422) from exc
    if frozen_body.dry_run or frozen_body.expected_version != 1 or frozen_body.idempotency_key != execution_id:
        raise CoreError("invalid_handoff", "Managed plans require the original execution key and initial task version", 422)
    # Managed Manager plans presently use workspace isolation. The standalone Git
    # path does process-backed base inspection and remains outside this protocol.
    if frozen_body.isolation != "workspace" or frozen_body.base_commit:
        raise CoreError("invalid_handoff", "Managed planning requires workspace isolation without a base commit", 422)
    if not isinstance(plan_basis, str) or not re.fullmatch(r"[0-9a-f]{64}", plan_basis):
        raise CoreError("invalid_handoff", "An immutable plan basis is required", 422)
    if not re.fullmatch(r"[0-9a-f]{64}", frozen_body.target_basis):
        raise CoreError("invalid_handoff", "An immutable execution target basis is required", 422)
    if (not isinstance(envelope, dict)
            or not {"title", "description", "acceptance_criteria", "source"} <= set(envelope)
            or not set(envelope) <= {"title", "description", "acceptance_criteria", "source", "design_context",
                                     "feedback_context", "feedback_context_sha256"}
            or any(not isinstance(envelope.get(key), str) for key in ("title", "description", "acceptance_criteria"))
            or not envelope["title"].strip() or not envelope["acceptance_criteria"].strip()
            or not isinstance(envelope.get("source"), dict)
            or envelope["source"].get("kind") != "manager.delivery"
            or envelope["source"].get("execution_id") != execution_id):
        raise CoreError("invalid_handoff", "Use the complete original managed task envelope", 422)
    try:
        TaskEnvelope.model_validate(envelope)
    except ValueError as exc:
        raise CoreError("invalid_handoff", "Use the complete typed original managed task envelope", 422) from exc
    validate_feedback_context(envelope, project_id=project_id)
    # Absence stays absent for exact saved-original probe/receipt recovery. New
    # Manager requests always carry the explicit plan; no old original is edited.
    if "test_plan" in envelope["source"]:
        from .managed_test_quality import valid_test_plan

        selected = frozen_body.test_nodes if type(frozen_body) is AgentDispatch else frozen_body.nodes
        if not valid_test_plan(envelope["source"]["test_plan"], [node.model_dump() for node in selected]):
            raise CoreError("invalid_test_plan", "Managed test plan does not match its original commands", 422)
    request = {"schema": "manager.execution-handoff.v1", "tenant": principal.tenant,
               "business": principal.business, "workspace": workspace, "actor": principal.actor,
               "operation_id": operation_id, "project_id": project_id, "execution_id": execution_id,
               "envelope": envelope, "dispatch_kind": "agent" if type(body) is AgentDispatch else "command",
               "dispatch": frozen_body.model_dump(), "plan_basis": plan_basis}
    try:
        # No coercion of JSON keys/values, NaN, object references or mutable input.
        encoded = json.dumps(request, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        _within_request_budget(encoded)
        frozen = json.loads(encoded)
        if frozen != request:
            raise ValueError("Noncanonical JSON input")
    except (ValueError, TypeError, RecursionError, UnicodeError) as exc:
        raise CoreError("invalid_handoff", "The complete handoff request must be canonical JSON", 422) from exc
    return frozen, frozen_body


def managed_handoff_digest(principal: Principal, workspace: str, *, operation_id: str, project_id: str,
                           execution_id: str, envelope: dict, body: TaskDispatch | AgentDispatch, plan_basis: str) -> str:
    """Compute the same full immutable binding at Manager and Core; never hashes fence."""
    request, _body = _request(principal, workspace, operation_id=operation_id, project_id=project_id,
                              execution_id=execution_id, envelope=envelope, body=body, plan_basis=plan_basis)
    return digest(request)


def _fence(value):
    if type(value) is not int or not 1 <= value < 2**63:
        raise CoreError("invalid_handoff", "Fence must be a positive signed 64-bit integer", 422)
    return value


def _receipt_id(principal, workspace, operation, key):
    return digest([principal.tenant, principal.business, workspace, principal.actor, operation, key])


class ManagedHandoff:
    def __init__(self, store: Store, execution):
        self.store = store
        self.delivery = Delivery(store, Repository(execution))

    @staticmethod
    def _assert_binding(row, request):
        if row["request_hash"] != digest(request) or row["request"] != request:
            raise CoreError("handoff_conflict", "This handoff is bound to a different immutable request or scope", 409)

    @staticmethod
    def _view(row, *, replayed):
        # The immutable plan receipt remains version 1 even if the run later moves.
        # Runtime observation, stop preview and execution are separate operations.
        result = dict(row["result"] or {
            "operation_id": row["id"], "project_id": row["project_id"], "execution_id": row["execution_id"],
            "request_hash": row["request_hash"], "state": "closed", "runtime_task_id": None,
            "run_id": None, "run_version": 0, "envelope_receipt_id": None,
            "dispatch_receipt_id": None, "plan_receipt_id": None,
        })
        result.update(fence=row["fence"], closed=row["closed"], close_receipt_id=row["close_receipt_id"], replayed=replayed)
        return result

    def probe(self, principal: Principal, workspace: str, *, operation_id: str, project_id: str,
              execution_id: str, envelope: dict, body: TaskDispatch | AgentDispatch, plan_basis: str):
        """Pure SELECT of this exact original request; no provisioning, locks or execute authorization."""
        request, _body = _request(principal, workspace, operation_id=operation_id, project_id=project_id,
                                  execution_id=execution_id, envelope=envelope, body=body, plan_basis=plan_basis)
        with self.store.engine.connect() as conn:
            row = conn.execute(select(self.store.managed_handoffs).where(
                self.store.managed_handoffs.c.id == operation_id)).mappings().first()
            if row is None:
                return None
            self._assert_binding(row, request)
            return self._view(row, replayed=True)

    def _gate(self, conn, principal, workspace, request, fence):
        table = self.store.managed_handoffs
        if self.store.engine.dialect.name == "postgresql":
            # Lock both the global H and E before the initial row exists. Sorted
            # advisory locks also serialize an attempted new H for the same E.
            locks = {digest(["managed-handoff", request["operation_id"]]),
                     digest(["managed-execution", principal.tenant, principal.business, workspace, request["execution_id"]])}
            for key in sorted(locks):
                lock_id = int.from_bytes(bytes.fromhex(key[:16]), "big", signed=True)
                conn.exec_driver_sql("SELECT pg_advisory_xact_lock(%s)", (lock_id,))
        row = conn.execute(select(table).where(table.c.id == request["operation_id"]).with_for_update()).mappings().first()
        if row:
            self._assert_binding(row, request)
            return dict(row)
        other = conn.execute(select(table.c.id).where(
            table.c.tenant == principal.tenant, table.c.business == principal.business,
            table.c.workspace == workspace, table.c.execution_id == request["execution_id"]).with_for_update()).first()
        if other:
            raise CoreError("handoff_conflict", "This execution already has a different handoff", 409)
        # Do not claim a negative no-run fact over a pre-protocol standard request.
        # This protocol neither rewrites nor fabricates evidence for historic work.
        envelope_receipt = _receipt_id(principal, workspace, "create:tasks", request["execution_id"])
        if conn.execute(select(self.store.receipts.c.id).where(self.store.receipts.c.id == envelope_receipt)).first():
            raise CoreError("handoff_conflict", "An existing task receipt requires explicit reconciliation", 409)
        row = dict(id=request["operation_id"], tenant=principal.tenant, business=principal.business,
                   workspace=workspace, actor=principal.actor, project_id=request["project_id"],
                   execution_id=request["execution_id"], request_hash=digest(request), request=request,
                   fence=fence, closed=False, result=None, close_receipt_id=None, created_at=now(), updated_at=now())
        conn.execute(insert(table).values(**row))
        return row

    def _save_gate(self, conn, row):
        row["updated_at"] = now()
        conn.execute(update(self.store.managed_handoffs).where(self.store.managed_handoffs.c.id == row["id"]).values(
            fence=row["fence"], closed=row["closed"], result=row["result"],
            close_receipt_id=row["close_receipt_id"], updated_at=row["updated_at"]))

    def _save_receipt(self, conn, principal, workspace, operation, request, result):
        receipt_id, cached = self.store._receipt(conn, principal, workspace, operation, request["execution_id"], request)
        if cached is not None:
            raise CoreError("handoff_conflict", "A handoff receipt exists without its matching gate transition", 409)
        conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=result, created_at=now()))
        return receipt_id

    def close_in_transaction(self, conn, principal, workspace, *, request, body):
        """Seal the exact H inside a durable control's existing transaction.

        The caller supplies the complete request reconstructed by _request. This
        takes the same H/E locks as dispatch, so a delayed dispatch cannot cross
        an accepted close. An existing planned result remains an actual plan.
        """
        validated, _ = _request(principal, workspace, operation_id=request["operation_id"],
            project_id=request["project_id"], execution_id=request["execution_id"], envelope=request["envelope"],
            body=body, plan_basis=request["plan_basis"])
        if validated != request:
            raise CoreError("handoff_conflict", "Handoff binding changed", 409)
        row = self._gate(conn, principal, workspace, request, 1)
        if row["closed"]:
            return self._view(row, replayed=True)
        # Closed is already terminal at every future fence; do not overflow the
        # signed technical counter while sealing its final representable value.
        row["fence"] = min(row["fence"] + 1, 2**63 - 1)
        row["closed"] = True
        operation = "manager.handoff.close:" + row["id"]
        row["close_receipt_id"] = _receipt_id(principal, workspace, operation, request["execution_id"])
        result = self._view(row, replayed=False)
        self._save_receipt(conn, principal, workspace, operation, request, result)
        self._save_gate(conn, row)
        return result

    def _apply(self, principal, workspace, request, body, fence, *, closing):
        # SQLite's BEGIN IMMEDIATE and PostgreSQL's shared identity locks serialize
        # creators. Other dialects use the unique constraint and retry the entire
        # rolled-back transaction once; no external effects occur inside it.
        for attempt in range(2):
            try:
                with self.store.transaction() as conn:
                    row = self._gate(conn, principal, workspace, request, fence)
                    if row["closed"]:
                        return self._view(row, replayed=True)
                    if fence < row["fence"]:
                        raise CoreError("stale_handoff_fence", "A newer handoff claim already owns this operation", 409)
                    row["fence"] = fence
                    if closing:
                        row["closed"] = True
                        operation = "manager.handoff.close:" + row["id"]
                        row["close_receipt_id"] = _receipt_id(principal, workspace, operation, request["execution_id"])
                        result = self._view(row, replayed=False)
                        self._save_receipt(conn, principal, workspace, operation, request, result)
                    elif row["result"] is not None:
                        self._save_gate(conn, row)
                        return self._view(row, replayed=True)
                    else:
                        self._authorize_new_plan(principal, workspace)
                        envelope = self.store._create(conn, principal, workspace, "tasks", request["envelope"],
                                                      request["execution_id"], request["operation_id"], status="active")
                        if type(body) is AgentDispatch:
                            planned = Agents(self.store).dispatch_in_transaction(
                                conn, principal, workspace, envelope["id"], body, request["operation_id"], self.delivery)
                            dispatch_operation = "task.agent-dispatch:"
                        else:
                            planned = self.delivery.dispatch_in_transaction(
                                conn, principal, workspace, envelope["id"], body, request["operation_id"])
                            dispatch_operation = "task.dispatch:"
                        operation = "manager.handoff.dispatch:" + row["id"]
                        row["result"] = {
                            "operation_id": row["id"], "project_id": row["project_id"], "execution_id": row["execution_id"],
                            "request_hash": row["request_hash"], "state": "planned", "fence": fence, "closed": False,
                            "runtime_task_id": envelope["id"], "run_id": planned["run"]["id"],
                            "run_version": planned["run"]["version"],
                            "envelope_receipt_id": _receipt_id(principal, workspace, "create:tasks", request["execution_id"]),
                            "dispatch_receipt_id": _receipt_id(principal, workspace, dispatch_operation + envelope["id"], request["execution_id"]),
                            "plan_receipt_id": _receipt_id(principal, workspace, operation, request["execution_id"]),
                            "close_receipt_id": None, "replayed": False,
                        }
                        result = self._view(row, replayed=False)
                        self._save_receipt(conn, principal, workspace, operation, request, result)
                    self._save_gate(conn, row)
                    return result
            except IntegrityError as exc:
                if attempt:
                    raise CoreError("handoff_conflict", "Concurrent handoff identity or receipt conflict", 409) from exc
        raise AssertionError("Unreachable handoff transaction retry")

    @staticmethod
    def _authorize_new_plan(principal, workspace):
        if not {"write", "execute"}.issubset(principal.permissions):
            raise CoreError("forbidden", "New managed plans require current write and execute permissions", 403)
        if principal.workspace_ids is not None and workspace not in principal.workspace_ids:
            raise CoreError("forbidden", "Workspace access denied", 403)
        # Shared Delivery/Agents first fix the workspace before Task/profile
        # locks; their required target-basis path also checks active/configuration
        # in the same transaction. Positive receipt replay bypasses this path.

    def dispatch(self, principal: Principal, workspace: str, *, operation_id: str, project_id: str,
                 execution_id: str, fence: int, envelope: dict, body: TaskDispatch | AgentDispatch, plan_basis: str):
        """Atomically create only a planned run, or return an existing/closed fact."""
        _fence(fence)
        request, frozen_body = _request(principal, workspace, operation_id=operation_id, project_id=project_id,
                                        execution_id=execution_id, envelope=envelope, body=body, plan_basis=plan_basis)
        return self._apply(principal, workspace, request, frozen_body, fence, closing=False)

    def close(self, principal: Principal, workspace: str, *, operation_id: str, project_id: str,
              execution_id: str, fence: int, envelope: dict, body: TaskDispatch | AgentDispatch, plan_basis: str):
        """Irreversibly seal; an already planned run needs its own fresh stop preview."""
        _fence(fence)
        request, frozen_body = _request(principal, workspace, operation_id=operation_id, project_id=project_id,
                                        execution_id=execution_id, envelope=envelope, body=body, plan_basis=plan_basis)
        return self._apply(principal, workspace, request, frozen_body, fence, closing=True)
