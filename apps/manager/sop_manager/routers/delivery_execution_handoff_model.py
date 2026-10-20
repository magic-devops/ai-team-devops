"""Canonical durable handoff originals; mutable fields are service-only technical facts."""
from datetime import datetime
import re

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint

_HANDOFF_MODEL = None


def register_handoff_model(Base):
    global _HANDOFF_MODEL
    if _HANDOFF_MODEL is not None:
        return _HANDOFF_MODEL
    class DeliveryExecutionHandoff(Base):
        __tablename__ = "delivery_execution_handoffs"
        id = Column(String(64), primary_key=True)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
        execution_id = Column(String(64), nullable=False)
        task_id = Column(String(64), nullable=False)
        workspace_id = Column(String(64), nullable=False)
        requested_by = Column(String(64), nullable=False)
        business_key = Column(String(64), nullable=False)
        original = Column(JSON, nullable=False)
        request_digest = Column(String(64), nullable=False)
        accepted_version = Column(Integer, nullable=False)
        state = Column(String(24), nullable=False)
        revision = Column(Integer, nullable=False)
        fence = Column(Integer, nullable=False)
        attempt = Column(Integer, nullable=False)
        lease_owner = Column(String(64), nullable=False)
        lease_expires_at = Column(DateTime, nullable=True)
        next_attempt_at = Column(DateTime, nullable=True)
        error = Column(JSON, nullable=True)
        run_id = Column(String(64), nullable=False)
        runtime_task_id = Column(String(64), nullable=False)
        accepted_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        __table_args__ = (
            UniqueConstraint("tenant_id", "project_id", "execution_id", name="uq_delivery_handoff_execution"),
            Index("ix_delivery_handoff_due", "state", "next_attempt_at", "lease_expires_at", "id"),
            Index("ix_delivery_handoff_task", "tenant_id", "project_id", "task_id", "accepted_at", "id"),
        )
    _HANDOFF_MODEL = DeliveryExecutionHandoff
    return DeliveryExecutionHandoff


IMMUTABLE = {"id", "tenant_id", "project_id", "execution_id", "task_id", "workspace_id", "requested_by",
             "business_key", "original", "request_digest", "accepted_version", "accepted_at"}
MUTABLE = {"state", "revision", "fence", "attempt", "lease_owner", "lease_expires_at", "next_attempt_at",
           "error", "run_id", "runtime_task_id", "updated_at"}
STATES = {"accepted", "dispatching", "retry_wait", "blocked", "planned", "cancelled"}


def valid_mutation(operation, old, values):
    def identity(value):
        return isinstance(value, str) and bool(value.strip()) and len(value) <= 64 and not re.search(r"[\x00-\x1f\x7f]", value)

    if operation == "insert":
        original = values.get("original")
        if (not all(identity(values.get(key)) for key in ("id", "tenant_id", "project_id", "execution_id", "task_id", "workspace_id", "requested_by", "business_key"))
                or not isinstance(original, dict)
                or any(original.get(key) != values.get(column) for key, column in (("id", "execution_id"), ("project_id", "project_id"), ("handoff_id", "id"), ("task_id", "task_id"), ("workspace_id", "workspace_id"), ("requested_by", "requested_by")))
                or not isinstance(values.get("request_digest"), str) or not re.fullmatch(r"[0-9a-f]{64}", values["request_digest"])
                or type(values.get("accepted_version")) is not int or values["accepted_version"] < 1
                or values.get("state") != "accepted" or values.get("revision") != 1
                or values.get("fence") != 0 or values.get("attempt") != 0):
            return False
        new = values
    elif operation != "update" or set(values) - MUTABLE:
        return False
    else:
        new = {**old, **values}
        transitions = {"accepted": {"dispatching", "cancelled"}, "retry_wait": {"dispatching", "cancelled"},
                       "blocked": {"dispatching", "cancelled"}, "dispatching": {"dispatching", "retry_wait", "blocked", "planned", "cancelled"}}
        if (new["state"] not in transitions.get(old["state"], set())
                or type(new["revision"]) is not int or new["revision"] != old["revision"] + 1
                or type(new["fence"]) is not int or type(new["attempt"]) is not int):
            return False
        if new["state"] == "dispatching":
            if new["fence"] != old["fence"] + 1 or new["attempt"] != old["attempt"] + 1:
                return False
        elif (new["attempt"] != old["attempt"] or new["fence"] not in
              ({old["fence"], old["fence"] + 1} if new["state"] == "cancelled" else {old["fence"]})):
            return False
    if (new["state"] not in STATES or any(type(new.get(key)) is not int or new[key] < 0 for key in ("revision", "fence", "attempt"))
            or not isinstance(new.get("accepted_at"), datetime) or not isinstance(new.get("updated_at"), datetime)):
        return False
    error = new.get("error")
    if error is not None and (not isinstance(error, dict) or set(error) != {"code", "message"}
            or any(not isinstance(error[key], str) or not error[key] or len(error[key]) > maximum
                   or re.search(r"[\x00-\x1f\x7f]", error[key]) for key, maximum in (("code", 100), ("message", 1000)))):
        return False
    if (new["state"] in {"blocked", "retry_wait"}) != (error is not None) and new["state"] != "dispatching":
        return False
    if new["state"] == "dispatching":
        if not identity(new.get("lease_owner")) or not isinstance(new.get("lease_expires_at"), datetime) or new.get("next_attempt_at") is not None:
            return False
    elif new.get("lease_owner") != "" or new.get("lease_expires_at") is not None:
        return False
    if new["state"] in {"accepted", "retry_wait", "blocked"}:
        if not isinstance(new.get("next_attempt_at"), datetime):
            return False
    elif new.get("next_attempt_at") is not None:
        return False
    return (all(identity(new.get(key)) for key in ("run_id", "runtime_task_id")) if new["state"] == "planned"
            else new.get("run_id") == "" and new.get("runtime_task_id") == "")


def valid_projection(db, scope, handoff_id, old, values):
    """Only proven Core references/closure of one original E may change here."""
    if set(values) - {"data", "version"} or type(values.get("version")) is not int or values["version"] != old["version"] + 1:
        return False
    row = db.get(DeliveryExecutionHandoff, handoff_id)
    if not row or (row.tenant_id, row.project_id) != scope or row.state not in {"planned", "cancelled"}:
        return False
    before, after = old["data"], values.get("data")
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    if {k: v for k, v in before.items() if k != "executions"} != {k: v for k, v in after.items() if k != "executions"}:
        return False
    aa, bb = before.get("executions", []), after.get("executions", [])
    if (not isinstance(aa, list) or not isinstance(bb, list) or len(aa) != len(bb)
            or any(not isinstance(item, dict) for item in aa + bb)):
        return False
    found = False
    for a, b in zip(aa, bb, strict=True):
        if a.get("id") != row.execution_id:
            if a != b:
                return False
            continue
        if found or a.get("run_id"):
            return False
        found = True
        allowed = {"run_id", "runtime_task_id", "run_version", "status"}
        if a.get("handoff_id") != row.id or b.get("handoff_id") != row.id or {k: v for k, v in a.items() if k not in allowed} != {k: v for k, v in b.items() if k not in allowed}:
            return False
        if (b.get("run_id", "") != row.run_id or b.get("runtime_task_id", "") != row.runtime_task_id
                or type(b.get("run_version")) is not int
                or (b["run_version"] < 1 if row.state == "planned" else b["run_version"] != 0)
                or b.get("status") != ("planned" if row.state == "planned" else "cancelled")):
            return False
    return found


from .sql_models import Base  # noqa: E402

DeliveryExecutionHandoff = register_handoff_model(Base)
