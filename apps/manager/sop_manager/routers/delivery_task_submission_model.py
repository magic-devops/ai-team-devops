"""Fixed external reports and immutable links to the existing human review fact."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text

_MODELS = None


def register_submission_models(Base):
    global _MODELS
    if _MODELS is not None:
        return _MODELS

    class DeliveryTaskSubmission(Base):
        __tablename__ = "delivery_task_submissions"
        seq = Column(Integer, primary_key=True, autoincrement=True)
        id = Column(String(64), unique=True, nullable=False)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
        task_id = Column(String(64), nullable=False)
        submitted_by = Column(String(64), nullable=False)
        submitted_by_name = Column(String(128), nullable=False)
        accepted_version = Column(Integer, nullable=False)
        task_basis = Column(String(64), nullable=False)
        definition_digest = Column(String(64), nullable=False)
        native_boundary_digest = Column(String(64), nullable=False)
        submission_digest = Column(String(64), nullable=False)
        definition = Column(JSON, nullable=False)
        native_boundary = Column(JSON, nullable=False)
        original = Column(JSON, nullable=False)
        payload = Column(JSON, nullable=False)
        source = Column(JSON, nullable=False)
        summary = Column(String(240), nullable=False)
        counts = Column(JSON, nullable=False)
        issue_id = Column(String(64), nullable=True)
        created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        invalidated = Column(Boolean, nullable=False, default=False)
        invalidated_at = Column(DateTime, nullable=True)
        invalidated_reason = Column(String(64), nullable=False, default="")
        __table_args__ = (Index("ix_task_submission_scope", "tenant_id", "project_id", "task_id", "seq"),)

    class DeliveryTaskSubmissionDecision(Base):
        __tablename__ = "delivery_task_submission_decisions"
        id = Column(String(64), primary_key=True)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
        task_id = Column(String(64), nullable=False)
        submission_id = Column(String(64), ForeignKey("delivery_task_submissions.id"), unique=True, nullable=False)
        submission_digest = Column(String(64), nullable=False)
        review_id = Column(String(64), ForeignKey("delivery_task_reviews.id"), unique=True, nullable=False)
        decision = Column(String(32), nullable=False)
        reviewer_id = Column(String(64), nullable=False)
        reviewer_name = Column(String(128), nullable=False)
        comment = Column(Text, nullable=False)
        issue_id = Column(String(64), nullable=True)
        accepted_version = Column(Integer, nullable=False)
        created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        __table_args__ = (Index("ix_task_submission_review", "tenant_id", "project_id", "task_id", "review_id"),)

    _MODELS = DeliveryTaskSubmission, DeliveryTaskSubmissionDecision
    return _MODELS


def valid_invalidation(old, values):
    return (set(values) <= {"invalidated", "invalidated_at", "invalidated_reason"}
            and not old["invalidated"] and values.get("invalidated") is True
            and isinstance(values.get("invalidated_at"), datetime)
            and values.get("invalidated_reason") in {"submission_task_missing", "submission_definition_changed", "submission_native_boundary_changed", "submission_superseded", "submission_review_invalidated"})


from .sql_models import Base  # noqa: E402

DeliveryTaskSubmission, DeliveryTaskSubmissionDecision = register_submission_models(Base)
