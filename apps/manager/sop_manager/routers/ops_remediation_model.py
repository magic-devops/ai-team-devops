"""Append-only fixed sources, independently indexed from the project workspace."""
from datetime import datetime
from sqlalchemy import Column, DateTime, Index, JSON, String, UniqueConstraint


def register_ops_source_model(Base):
    class OpsIssueSource(Base):
        __tablename__ = "ops_issue_sources"
        id = Column(String(64), primary_key=True)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), nullable=False)
        source_id = Column(String(128), nullable=False)
        source_digest = Column(String(64), nullable=False)
        issue_id = Column(String(64), nullable=False)
        snapshot = Column(JSON, nullable=False)
        created_by = Column(String(64), nullable=False)
        created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        __table_args__ = (
            UniqueConstraint("tenant_id", "project_id", "source_id", name="uq_ops_issue_source_scope"),
            Index("ix_ops_issue_source_issue", "tenant_id", "project_id", "issue_id"),
        )
    return OpsIssueSource
