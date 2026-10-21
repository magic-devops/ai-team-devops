"""One real Task's external dispatch original and controlled current ownership."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint

_MODEL = None
ACTIVE_STATES = {"queued", "claimed", "cancel_requested"}


def register_work_order_model(Base):
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    class DeliveryExternalWorkOrder(Base):
        __tablename__ = "delivery_external_work_orders"
        id = Column(String(64), primary_key=True)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
        task_id = Column(String(64), nullable=False)
        active_task_id = Column(String(64), nullable=True)
        task_title = Column(String(256), nullable=False)
        task_basis = Column(String(64), nullable=False)
        original = Column(JSON, nullable=False)
        request_digest = Column(String(64), nullable=False)
        packet_digest = Column(String(64), nullable=False)
        definition_digest = Column(String(64), nullable=False)
        native_boundary_digest = Column(String(64), nullable=False)
        native_identity_digest = Column(String(64), nullable=False)
        runtime_scopes = Column(JSON, nullable=False)
        executor = Column(JSON, nullable=False)
        executor_basis = Column(String(64), nullable=False)
        requested_by = Column(JSON, nullable=False)
        created_at = Column(DateTime, nullable=False)
        updated_at = Column(DateTime, nullable=False)
        state = Column(String(24), nullable=False)
        revision = Column(Integer, nullable=False)
        claimed_by = Column(JSON, nullable=True)
        claimed_at = Column(DateTime, nullable=True)
        progress = Column(JSON, nullable=True)
        submission_id = Column(String(64), nullable=True, unique=True)
        submission_digest = Column(String(64), nullable=True)
        closure = Column(JSON, nullable=True)
        invalidated = Column(Boolean, nullable=False, default=False)
        invalidated_reason = Column(String(100), nullable=True)
        __table_args__ = (
            UniqueConstraint("tenant_id", "project_id", "active_task_id", name="uq_external_active_task"),
            Index("ix_external_order_page", "tenant_id", "project_id", "created_at", "id"),)

    _MODEL = DeliveryExternalWorkOrder
    return _MODEL


MUTABLE = {"active_task_id", "state", "revision", "updated_at", "claimed_by", "claimed_at", "progress",
    "submission_id", "submission_digest", "closure", "invalidated", "invalidated_reason"}


def valid_mutation(operation, old, values):
    if operation == "insert":
        return (values.get("state") == "queued" and values.get("revision") == 1
            and values.get("active_task_id") == values.get("task_id") and isinstance(values.get("original"), dict)
            and values.get("invalidated") is False and values.get("claimed_by") is None and values.get("submission_id") is None)
    if operation != "update" or set(values) - MUTABLE:
        return False
    new = {**old, **values}
    if (type(new["revision"]) is not int or new["revision"] != old["revision"] + 1
            or not isinstance(new["updated_at"], datetime) or old["invalidated"] and not new["invalidated"]
            or new["state"] not in {"queued", "claimed", "cancel_requested", "reported", "closed"}
            or new["active_task_id"] != (old["task_id"] if new["state"] in ACTIVE_STATES else None)):
        return False
    if old.get("claimed_by") and new.get("claimed_by") != old["claimed_by"]:
        return False
    if old.get("claimed_at") and new.get("claimed_at") != old["claimed_at"]:
        return False
    if old.get("submission_id") and any(new.get(key) != old.get(key) for key in ("submission_id", "submission_digest")):
        return False
    if old.get("closure") and new.get("closure") != old["closure"]:
        return False
    transitions = {"queued": {"queued", "claimed", "closed"}, "claimed": {"claimed", "cancel_requested", "reported", "closed"},
        "cancel_requested": {"cancel_requested", "reported", "closed"}, "reported": {"reported"}, "closed": {"closed"}}
    return new["state"] in transitions[old["state"]]


from .sql_models import Base  # noqa: E402

DeliveryExternalWorkOrder = register_work_order_model(Base)
