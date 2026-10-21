"""One SQL design source: CAS heads, immutable revisions and adoption originals."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint

_MODELS = None


def register_design_models(Base):
    global _MODELS
    if _MODELS is not None:
        return _MODELS

    class ProjectDesignDocument(Base):
        __tablename__ = "project_design_documents"
        id = Column(String(64), primary_key=True)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
        document_version = Column(Integer, nullable=False)
        head_revision_id = Column(String(64), nullable=False)
        head_revision_digest = Column(String(64), nullable=False)
        revision_number = Column(Integer, nullable=False)
        title = Column(String(200), nullable=False)
        category = Column(String(32), nullable=False)
        tags = Column(JSON, nullable=False)
        archived = Column(Boolean, nullable=False, default=False)
        created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        __table_args__ = (Index("ix_project_design_documents", "tenant_id", "project_id", "id"),)

    class ProjectDesignRevision(Base):
        __tablename__ = "project_design_revisions"
        seq = Column(Integer, primary_key=True, autoincrement=True)
        id = Column(String(64), unique=True, nullable=False)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
        document_id = Column(String(64), ForeignKey("project_design_documents.id"), nullable=False)
        number = Column(Integer, nullable=False)
        digest = Column(String(64), nullable=False)
        content_sha256 = Column(String(64), nullable=False)
        content_bytes = Column(Integer, nullable=False)
        title = Column(String(200), nullable=False)
        category = Column(String(32), nullable=False)
        tags = Column(JSON, nullable=False)
        content = Column(Text, nullable=False)
        note = Column(String(300), nullable=False)
        author_id = Column(String(64), nullable=False)
        author_name = Column(String(128), nullable=False)
        restored_from = Column(String(64), nullable=True)
        preview_id = Column(String(64), nullable=True)
        original = Column(JSON, nullable=False)
        created_at = Column(DateTime, nullable=False)
        __table_args__ = (
            UniqueConstraint("tenant_id", "project_id", "document_id", "number", name="uq_project_design_revision"),
            Index("ix_project_design_revision", "tenant_id", "project_id", "document_id", "seq"),)

    class ProjectDesignAdoption(Base):
        __tablename__ = "project_design_adoptions"
        seq = Column(Integer, primary_key=True, autoincrement=True)
        id = Column(String(64), unique=True, nullable=False)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
        target_kind = Column(String(16), nullable=False)
        target_id = Column(String(64), nullable=False)
        slot = Column(String(24), nullable=False)
        operation = Column(String(16), nullable=False)
        revision_id = Column(String(64), ForeignKey("project_design_revisions.id"), nullable=True)
        reference = Column(JSON, nullable=True)
        target_basis = Column(String(64), nullable=False)
        design_basis = Column(String(64), nullable=False)
        preview_basis = Column(String(64), nullable=False)
        digest = Column(String(64), nullable=False)
        original = Column(JSON, nullable=False)
        comment = Column(Text, nullable=False)
        actor_id = Column(String(64), nullable=False)
        actor_name = Column(String(128), nullable=False)
        accepted_version = Column(Integer, nullable=False)
        created_at = Column(DateTime, nullable=False)
        __table_args__ = (Index("ix_project_design_adoption", "tenant_id", "project_id", "target_kind", "target_id", "slot", "seq"),)

    _MODELS = ProjectDesignDocument, ProjectDesignRevision, ProjectDesignAdoption
    return _MODELS


from .sql_models import Base  # noqa: E402

ProjectDesignDocument, ProjectDesignRevision, ProjectDesignAdoption = register_design_models(Base)
