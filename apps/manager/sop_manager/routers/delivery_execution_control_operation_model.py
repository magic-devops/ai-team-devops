"""Immutable control admission and service-owned, fenced technical processing."""
from datetime import datetime
import re

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String

_MODEL = None
IMMUTABLE = {"id", "tenant_id", "project_id", "execution_id", "task_id", "workspace_id", "requested_by",
             "business_key", "action", "target_operation_id", "original", "request_digest", "accepted_version", "accepted_at"}
MUTABLE = {"state", "revision", "fence", "attempt", "lease_owner", "lease_expires_at", "next_attempt_at",
           "error", "run_id", "run_attempt", "outcome", "launch", "effect", "updated_at"}
ACTIVE = {"accepted", "applying", "retry_wait", "blocked", "awaiting_executor"}
PRE_EFFECT = {"accepted", "applying", "retry_wait", "blocked"}
STATES = ACTIVE | {"applied", "closed"}
ACTIONS = {"execution.start", "execution.retry", "execution.cancel", "execution.approval", "execution.control.close"}
PROJECTION_FIELDS = {"run_id", "runtime_task_id", "run_version", "attempt", "status", "cancelled_at",
                     "stop_pending", "stop_snapshot"}


def register_control_operation_model(Base):
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    class DeliveryExecutionControlOperation(Base):
        __tablename__ = "delivery_execution_control_operations"
        id = Column(String(64), primary_key=True)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
        execution_id = Column(String(64), nullable=False)
        task_id = Column(String(64), nullable=False)
        workspace_id = Column(String(64), nullable=False)
        requested_by = Column(String(64), nullable=False)
        business_key = Column(String(64), nullable=False)
        action = Column(String(40), nullable=False)
        original = Column(JSON, nullable=False)
        request_digest = Column(String(64), nullable=False)
        accepted_version = Column(Integer, nullable=False)
        target_operation_id = Column(String(64), nullable=True)
        state = Column(String(24), nullable=False)
        revision = Column(Integer, nullable=False)
        fence = Column(Integer, nullable=False)
        attempt = Column(Integer, nullable=False)
        lease_owner = Column(String(64), nullable=False)
        lease_expires_at = Column(DateTime, nullable=True)
        next_attempt_at = Column(DateTime, nullable=True)
        error = Column(JSON, nullable=True)
        run_id = Column(String(64), nullable=True)
        run_attempt = Column(Integer, nullable=True)
        outcome = Column(String(24), nullable=True)
        launch = Column(JSON, nullable=True)
        effect = Column(JSON, nullable=True)
        accepted_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        __table_args__ = (
            Index("ix_delivery_control_due", "state", "next_attempt_at", "lease_expires_at", "id"),
            Index("ix_delivery_control_execution", "tenant_id", "project_id", "execution_id", "accepted_at", "id"),
            Index("ix_delivery_control_target", "tenant_id", "project_id", "target_operation_id", "state"),
        )

    _MODEL = DeliveryExecutionControlOperation
    return _MODEL


def _identity(value):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= 64 and not re.search(r"[\x00-\x1f\x7f]", value)


def valid_mutation(operation, old, values):
    if operation == "insert":
        new = values
        original = new.get("original")
        if (not all(_identity(new.get(key)) for key in ("id", "tenant_id", "project_id", "execution_id", "task_id", "workspace_id", "requested_by", "business_key"))
                or new.get("action") not in ACTIONS or not isinstance(original, dict)
                or any(original.get(key) != new.get(column) for key, column in (
                    ("control_id", "id"), ("tenant", "tenant_id"), ("business", "business_key"), ("workspace", "workspace_id"),
                    ("actor", "requested_by"), ("project_id", "project_id"), ("execution_id", "execution_id"),
                    ("task_id", "task_id"), ("action", "action"), ("accepted_version", "accepted_version")))
                or not isinstance(new.get("request_digest"), str) or not re.fullmatch(r"[0-9a-f]{64}", new["request_digest"])
                or type(new.get("accepted_version")) is not int or new["accepted_version"] < 1
                or (new["action"] == "execution.control.close") != _identity(new.get("target_operation_id"))
                or new.get("state") != "accepted" or new.get("revision") != 1 or new.get("fence") != 0 or new.get("attempt") != 0
                or new.get("effect") is not None or new.get("launch") is not None or new.get("outcome") is not None):
            return False
    elif operation == "update" and not set(values) - MUTABLE:
        new = {**old, **values}
        allowed = {"accepted": {"applying"}, "applying": {"applying", "retry_wait", "blocked", "awaiting_executor", "applied", "closed"},
                   "retry_wait": {"applying"}, "blocked": {"applying"}, "awaiting_executor": {"applying"}}
        if (new["state"] not in allowed.get(old["state"], set()) or type(new["revision"]) is not int
                or new["revision"] != old["revision"] + 1):
            return False
        claimed = new["state"] == "applying"
        if (new.get("fence") != old["fence"] + int(claimed) or new.get("attempt") != old["attempt"] + int(claimed)
                or old.get("effect") is not None and new.get("effect") != old["effect"]):
            return False
    else:
        return False
    if (new.get("state") not in STATES or not isinstance(new.get("accepted_at"), datetime)
            or not isinstance(new.get("updated_at"), datetime)
            or any(type(new.get(key)) is not int or new[key] < 0 for key in ("revision", "fence", "attempt"))):
        return False
    if new["state"] == "applying":
        if not _identity(new.get("lease_owner")) or not isinstance(new.get("lease_expires_at"), datetime) or new.get("next_attempt_at") is not None:
            return False
    elif new.get("lease_owner") != "" or new.get("lease_expires_at") is not None:
        return False
    if new["state"] in {"accepted", "retry_wait", "blocked", "awaiting_executor"}:
        if not isinstance(new.get("next_attempt_at"), datetime):
            return False
    elif new.get("next_attempt_at") is not None:
        return False
    error = new.get("error")
    if error is not None and (not isinstance(error, dict) or set(error) != {"code", "message"}
            or any(not isinstance(error.get(key), str) or not error[key] or len(error[key]) > size
                   or re.search(r"[\x00-\x1f\x7f]", error[key]) for key, size in (("code", 100), ("message", 1000)))):
        return False
    launch = new.get("launch")
    if launch is not None and (not isinstance(launch, dict) or set(launch) != {"id", "state", "claimed_at"}
            or not _identity(launch.get("id")) or launch.get("state") not in {"ready", "claimed", "revoked"}
            or launch.get("claimed_at") is not None and not isinstance(launch["claimed_at"], str)):
        return False
    if new.get("run_id") is not None and not _identity(new["run_id"]):
        return False
    if new.get("run_attempt") is not None and (type(new["run_attempt"]) is not int or new["run_attempt"] < 1):
        return False
    return new.get("outcome") in {None, "applied", "closed", "needs_review"}


def valid_projection(db, scope, control_id, old, values):
    """Existing Core facts may update one E's technical columns at current SQL V."""
    if set(values) - {"data", "version"} or type(values.get("version")) is not int or values["version"] != old["version"] + 1:
        return False
    row = db.get(DeliveryExecutionControlOperation, control_id)
    if not row or (row.tenant_id, row.project_id) != scope or row.effect is None:
        return False
    if row.effect.get("state") == "closed" or row.action == "execution.control.close":
        return False  # these facts never change E's runtime or acceptance
    before, after = old["data"], values.get("data")
    if (not isinstance(before, dict) or not isinstance(after, dict)
            or {k: v for k, v in before.items() if k != "executions"} != {k: v for k, v in after.items() if k != "executions"}):
        return False
    aa, bb = before.get("executions", []), after.get("executions", [])
    if not isinstance(aa, list) or not isinstance(bb, list) or len(aa) != len(bb):
        return False
    found = False
    for a, b in zip(aa, bb, strict=True):
        if not isinstance(a, dict) or not isinstance(b, dict):
            return False
        if a.get("id") != row.execution_id:
            if a != b:
                return False
            continue
        if found or a.get("task_id") != row.task_id or a.get("workspace_id") != row.workspace_id:
            return False
        found = True
        if ({k: v for k, v in a.items() if k not in PROJECTION_FIELDS} != {k: v for k, v in b.items() if k not in PROJECTION_FIELDS}
                or b.get("run_version", 0) < a.get("run_version", 0)
                or a.get("run_id") and b.get("run_id") != a["run_id"]):
            return False
        if a.get("status") in {"accepted", "rejected", "cancelled"}:
            if b.get("status") != a["status"]:
                return False
        elif b.get("status") not in {"pending_dispatch", "planned", "queued", "running", "retrying", "interrupted", "failed", "cancelled", "awaiting_review"}:
            return False
        if b.get("run_id") and b["run_id"] != row.run_id:
            return False
    return found


from .sql_models import Base  # noqa: E402

DeliveryExecutionControlOperation = register_control_operation_model(Base)
