"""One immutable request with a single, bounded technical generation outcome."""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, String

_MODEL = None
ORIGINAL_FIELDS = frozenset({"request_key", "requested_by", "input", "source"})
OUTCOME_FIELDS = frozenset({"model", "provider", "usage", "content", "content_sha256", "error"})


def register_design_generation_model(Base):
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    class ProjectDesignGeneration(Base):
        __tablename__ = "project_design_generations"
        id = Column(String(64), primary_key=True)
        tenant_id = Column(String(64), nullable=False)
        project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
        document_id = Column(String(64), ForeignKey("project_design_documents.id"), nullable=False)
        user_id = Column(String(64), nullable=False)
        request_hash = Column(String(64), nullable=False)
        status = Column(String(16), nullable=False)
        data = Column(JSON, nullable=False)
        created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        __table_args__ = (Index("ix_design_generation_scope", "tenant_id", "project_id", "document_id", "user_id", "id"),)

    _MODEL = ProjectDesignGeneration
    return _MODEL


def valid_transition(old, values):
    """Only the original in-flight request may receive its one terminal outcome."""
    if (old.get("status") != "generating" or set(values) != {"status", "data"}
            or values.get("status") not in {"succeeded", "failed"}):
        return False
    before, after = old.get("data"), values.get("data")
    if not isinstance(before, dict) or not isinstance(after, dict) or set(before) != ORIGINAL_FIELDS:
        return False
    if set(after) != ORIGINAL_FIELDS | OUTCOME_FIELDS or any(after.get(key) != before[key] for key in ORIGINAL_FIELDS):
        return False
    import hashlib
    import json

    try:
        if (not isinstance(after["model"], str) or len(after["model"]) > 200
                or not isinstance(after["provider"], str) or len(after["provider"]) > 128
                or not isinstance(after["usage"], dict)
                or len(json.dumps(after["usage"], allow_nan=False).encode("utf-8")) > 8192):
            return False
        if len(json.dumps(after, ensure_ascii=False, allow_nan=False).encode("utf-8")) > 512 * 1024:
            return False
        if values["status"] == "succeeded":
            content = after["content"]
            return (isinstance(content, str) and bool(content.strip()) and "\x00" not in content
                and len(content.encode("utf-8")) <= 65536 and after["error"] is None
                and after["content_sha256"] == hashlib.sha256(content.encode("utf-8")).hexdigest())
        return (after["content"] is None and after["content_sha256"] is None
            and isinstance(after["error"], dict) and set(after["error"]) == {"code", "message"}
            and after["error"]["code"] in {"design_preview_invalid_output", "design_preview_generation_failed"}
            and isinstance(after["error"]["message"], str) and 1 <= len(after["error"]["message"]) <= 300)
    except (TypeError, ValueError, UnicodeError):
        return False


from .sql_models import Base  # noqa: E402

ProjectDesignGeneration = register_design_generation_model(Base)
