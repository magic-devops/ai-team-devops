"""SQLAlchemy ORM 模型 — 支持 SQLite / MySQL 8 / OceanBase MySQL 模式"""
from __future__ import annotations

import os
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, relationship, sessionmaker, validates
from sqlalchemy.pool import NullPool, StaticPool

from sop_manager.project_write_guard import ManagerSession, install_project_write_guard
from sop_manager.task_acceptance import normalize_task_acceptance
from sop_manager.task_owner import normalize_task_owner_id
from sop_manager.task_owner_sql import install_task_owner_guard
from sop_manager.task_sql_guard import TaskAcceptanceJSON, install_task_sql_guard

_DB_TYPE = os.getenv("DB_TYPE", "sqlite")
_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sop.db")

# SQLite 需要开启 WAL + foreign_keys
def _configure_sqlite(dbapi_conn, _):
    dbapi_conn.execute("PRAGMA journal_mode=WAL")
    dbapi_conn.execute("PRAGMA foreign_keys=ON")

def make_engine():
    if _DB_TYPE == "sqlite":
        url = make_url(_DATABASE_URL)
        in_memory = url.database in {None, "", ":memory:"} or url.query.get("mode") == "memory"
        engine = create_engine(
            _DATABASE_URL,
            connect_args={"check_same_thread": False},
            # Memory needs one shared connection. File requests use independent
            # connections without blocking synchronous scope checks on a pool queue.
            poolclass=StaticPool if in_memory else NullPool,
        )
        event.listen(engine, "connect", _configure_sqlite)
    else:
        # mysql / oceanbase：OceanBase MySQL 模式使用同一套连接池参数
        engine = create_engine(_DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
    return engine

engine = make_engine()
SessionLocal = sessionmaker(bind=engine, class_=ManagerSession, autocommit=False, autoflush=False)

def get_session() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class Base(DeclarativeBase):
    pass


# ── 租户 ──────────────────────────────────────────────────────────
class Tenant(Base):
    __tablename__ = "tenants"
    id          = Column(String(64), primary_key=True)
    name        = Column(String(128), nullable=False)
    slug        = Column(String(64), nullable=False, unique=True)
    plan        = Column(String(32), default="free")   # free | pro | enterprise
    status      = Column(String(16), default="active") # active | suspended
    config      = Column(JSON, default=dict)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    users       = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    businesses  = relationship("Business", back_populates="tenant", cascade="all, delete-orphan")


# ── 用户 ──────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    id           = Column(String(64), primary_key=True)
    tenant_id    = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    username     = Column(String(64), nullable=False)
    email        = Column(String(128), default="")
    password_hash= Column(String(128), nullable=False)
    role         = Column(String(32), default="developer")  # super_admin|tenant_admin|project_admin|developer|devops|product_manager|analyst|viewer
    status       = Column(String(16), default="active")
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant       = relationship("Tenant", back_populates="users")
    memberships  = relationship("ProjectMember", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("tenant_id", "username", name="uq_tenant_username"),)


# ── 业务线 ────────────────────────────────────────────────────────
class Business(Base):
    __tablename__ = "businesses"
    id          = Column(String(64), primary_key=True)
    tenant_id   = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name        = Column(String(128), nullable=False)
    description = Column(Text, default="")
    created_at  = Column(DateTime, default=datetime.utcnow)

    tenant      = relationship("Tenant", back_populates="businesses")
    projects    = relationship("Project", back_populates="business", cascade="all, delete-orphan")


# ── 项目 ──────────────────────────────────────────────────────────
class Project(Base):
    __tablename__ = "projects"
    id           = Column(String(64), primary_key=True)
    tenant_id    = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    business_id  = Column(String(64), ForeignKey("businesses.id", ondelete="SET NULL"), nullable=True)
    name         = Column(String(128), nullable=False)
    description  = Column(Text, default="")
    project_path = Column(String(512), default="")  # 本地路径（单项目模式）
    vector_db    = Column(String(32), default="lance")  # lance | milvus | qdrant | oceanbase
    vector_db_config = Column(JSON, default=dict)
    is_template  = Column(Boolean, default=False)        # 是否作为模板
    template_id  = Column(String(64), default="")        # 从哪个模板克隆
    status       = Column(String(16), default="active")
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    business     = relationship("Business", back_populates="projects")
    members      = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")
    requirements = relationship("Requirement", back_populates="project", cascade="all, delete-orphan")
    tasks        = relationship("Task", back_populates="project", cascade="all, delete-orphan")
    issues       = relationship("Issue", back_populates="project", cascade="all, delete-orphan")
    sprints      = relationship("Sprint", back_populates="project", cascade="all, delete-orphan")


# ── 项目成员 ──────────────────────────────────────────────────────
class ProjectMember(Base):
    __tablename__ = "project_members"
    project_id  = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    user_id     = Column(String(64), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role        = Column(String(32), default="developer")  # project_admin|developer|devops|product_manager|analyst|viewer

    project     = relationship("Project", back_populates="members")
    user        = relationship("User", back_populates="memberships")


# ── 需求 ──────────────────────────────────────────────────────────
class Requirement(Base):
    __tablename__ = "requirements"
    id                   = Column(String(64), primary_key=True)
    tenant_id            = Column(String(64), nullable=False, index=True)
    project_id           = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    title                = Column(String(256), nullable=False)
    description          = Column(Text, default="")
    status               = Column(String(32), default="pending")
    priority             = Column(String(8), default="P1")
    sprint_id            = Column(String(64), default="")
    story_points         = Column(Integer, default=0)
    acceptance_criteria  = Column(JSON, default=list)
    tags                 = Column(JSON, default=list)
    human_notes          = Column(Text, default="")
    confidence           = Column(Float, default=0.0)
    created_at           = Column(DateTime, default=datetime.utcnow)
    updated_at           = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project", back_populates="requirements")
    __table_args__ = (Index("ix_req_project_status", "project_id", "status"),)


# ── 任务 ──────────────────────────────────────────────────────────
class Task(Base):
    __tablename__ = "tasks"
    id          = Column(String(64), primary_key=True)
    tenant_id   = Column(String(64), nullable=False, index=True)
    project_id  = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    req_id      = Column(String(64), default="")
    sprint_id   = Column(String(64), default="")
    title       = Column(String(256), nullable=False)
    description = Column(Text, default="")
    acceptance_criteria = Column(TaskAcceptanceJSON(), default=list, nullable=False)
    status      = Column(String(32), default="pending")
    priority    = Column(String(8), default="P1")
    estimate    = Column(String(8), default="M")
    owner_id    = Column(String(100), default="", nullable=False)
    actual_hours= Column(Float, default=0.0)
    confidence  = Column(Float, default=0.0)
    human_notes = Column(Text, default="")
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project", back_populates="tasks")
    __table_args__ = (Index("ix_task_project_status", "project_id", "status"),)

    @validates("acceptance_criteria")
    def validate_acceptance_criteria(self, _key, value):
        return normalize_task_acceptance(value)

    @validates("owner_id")
    def validate_owner_id(self, _key, value):
        return normalize_task_owner_id(value)


# ── 问题 ──────────────────────────────────────────────────────────
class Issue(Base):
    __tablename__ = "issues"
    id          = Column(String(64), primary_key=True)
    tenant_id   = Column(String(64), nullable=False, index=True)
    project_id  = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    sprint_id   = Column(String(64), default="")
    task_id     = Column(String(64), default="")
    title       = Column(String(256), nullable=False)
    description = Column(Text, default="")
    type        = Column(String(32), default="bug")
    severity    = Column(String(8), default="P2")
    status      = Column(String(16), default="open")
    reported_by = Column(String(64), default="")
    resolved_by = Column(String(64), default="")
    resolution  = Column(Text, default="")
    created_at  = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    project = relationship("Project", back_populates="issues")


# ── Sprint ────────────────────────────────────────────────────────
class Sprint(Base):
    __tablename__ = "sprints"
    id              = Column(String(64), primary_key=True)
    tenant_id       = Column(String(64), nullable=False, index=True)
    project_id      = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    goal            = Column(Text, default="")
    status          = Column(String(16), default="active")
    planned_points  = Column(Integer, default=0)
    velocity        = Column(Float, default=0.0)
    completion_rate = Column(Float, default=0.0)
    retrospective   = Column(Text, default="")
    started_at      = Column(DateTime, default=datetime.utcnow)
    ends_at         = Column(DateTime, nullable=True)

    project = relationship("Project", back_populates="sprints")


# ── 审计日志 ──────────────────────────────────────────────────────
class DeliveryWorkspace(Base):
    """Additive project delivery metadata; business requirements/tasks remain canonical."""
    __tablename__ = "delivery_workspaces"
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    version = Column(Integer, nullable=False, default=0)
    data = Column(JSON, nullable=False, default=dict)


class DeliveryEvent(Base):
    __tablename__ = "delivery_events"
    id = Column(String(64), primary_key=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    actor = Column(String(128), nullable=False)
    action = Column(String(64), nullable=False)
    resource_id = Column(String(64), default="")
    data = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class DeliveryReceipt(Base):
    __tablename__ = "delivery_receipts"
    id = Column(String(64), primary_key=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(String(64), nullable=False)
    request_hash = Column(String(64), nullable=False)
    version = Column(Integer, nullable=False)



class EventInbox(Base):
    __tablename__ = "event_inbox"
    seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    scope_key = Column(String(64), nullable=False, unique=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    producer_id = Column(String(64), nullable=False)
    credential_id = Column(String(64), nullable=True)
    event_id = Column(String(128), nullable=False)
    event_json = Column(Text, nullable=False)
    digest = Column(String(64), nullable=False)
    event_type = Column(String(160), nullable=False)
    subject = Column(String(256), nullable=False)
    source = Column(String(512), nullable=False)
    event_time = Column(String(64), nullable=False)
    stored_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    __table_args__ = (Index("ix_event_inbox_project_seq", "tenant_id", "project_id", "seq"),Index("ix_event_inbox_type_seq", "tenant_id", "project_id", "event_type", "seq"),Index("ix_event_inbox_producer_seq", "tenant_id", "project_id", "producer_id", "seq"))


class EventProcessing(Base):
    __tablename__ = "event_processing"
    id = Column(String(64), ForeignKey("event_inbox.id", ondelete="CASCADE"), primary_key=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    state = Column(String(16), default="pending", nullable=False)
    revision = Column(Integer, default=1, nullable=False)
    handler = Column(String(64), nullable=True)
    operation_id = Column(String(64), nullable=True)
    plan = Column(JSON, nullable=True)
    attempts = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    processed_at = Column(DateTime, nullable=True)
    reason_code = Column(String(64), nullable=True)
    retryable = Column(Boolean, default=False, nullable=False)
    result = Column(JSON, nullable=True)
    __table_args__ = (Index("ix_event_processing_project_state", "tenant_id", "project_id", "state"),)


class EventProcessingAttempt(Base):
    __tablename__ = "event_processing_attempts"
    seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    receipt_id = Column(String(64), ForeignKey("event_inbox.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(String(64), nullable=False)
    action = Column(String(16), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    from_state = Column(String(16), nullable=False)
    to_state = Column(String(16), nullable=False)
    error = Column(JSON, nullable=True)
    result = Column(JSON, nullable=True)
    retry_key = Column(String(64), nullable=True, unique=True)
    request_hash = Column(String(64), nullable=True)
    ack = Column(JSON, nullable=True)
    __table_args__ = (Index("ix_event_attempt_project_seq", "tenant_id", "project_id", "seq"),Index("ix_event_attempt_receipt_seq", "receipt_id", "seq"))

class IssueEventOrigin(Base):
    """Append-only projection; deliberately no Issue FK so deletion keeps history."""
    __tablename__ = "issue_event_origins"
    seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    issue_id = Column(String(64), nullable=False)
    receipt_id = Column(String(64), nullable=False, unique=True)
    attempt_id = Column(String(64), nullable=False)
    operation = Column(String(16), nullable=False)
    effect_kind = Column(String(32), nullable=False)
    digest = Column(String(64), nullable=False)
    processed_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (Index("ix_issue_origin_scope_seq", "tenant_id", "project_id", "issue_id", "seq"),)


class DeliveryDiscussionThread(Base):
    __tablename__ = "delivery_discussion_threads"
    created_seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    subject_kind = Column(String(24), nullable=False)
    subject_id = Column(String(64), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    state = Column(String(16), nullable=False, default="open")
    title = Column(String(160), nullable=False)
    created_by_id = Column(String(64), nullable=False)
    created_by_name = Column(String(128), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_activity_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    current_resolution_event_id = Column(String(64), nullable=True)
    __table_args__ = (Index("ix_discussion_subject", "tenant_id", "project_id", "subject_kind", "subject_id", "state", "created_seq", "id"),)


class DeliveryDiscussionMessage(Base):
    __tablename__ = "delivery_discussion_messages"
    created_seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    thread_id = Column(String(64), ForeignKey("delivery_discussion_threads.id"), nullable=False)
    parent_message_id = Column(String(64), ForeignKey("delivery_discussion_messages.id"), nullable=True)
    author_id = Column(String(64), nullable=False)
    author_name = Column(String(128), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    current_revision = Column(Integer, nullable=False, default=1)
    __table_args__ = (Index("ix_discussion_messages", "tenant_id", "project_id", "thread_id", "created_seq", "id"),)


class DeliveryDiscussionMessageVersion(Base):
    __tablename__ = "delivery_discussion_message_versions"
    message_id = Column(String(64), ForeignKey("delivery_discussion_messages.id"), primary_key=True)
    revision = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    thread_id = Column(String(64), ForeignKey("delivery_discussion_threads.id"), nullable=False)
    body = Column(Text, nullable=True)
    state = Column(String(16), nullable=False, default="active")
    reason = Column(Text, nullable=True)
    refs = Column(JSON, nullable=False, default=list)
    editor_id = Column(String(64), nullable=False)
    editor_name = Column(String(128), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class DeliveryDiscussionEvent(Base):
    __tablename__ = "delivery_discussion_events"
    seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    thread_id = Column(String(64), ForeignKey("delivery_discussion_threads.id"), nullable=False)
    thread_version = Column(Integer, nullable=False)
    subject_kind = Column(String(24), nullable=False)
    subject_id = Column(String(64), nullable=False)
    action = Column(String(40), nullable=False)
    actor_id = Column(String(64), nullable=False)
    actor_name = Column(String(128), nullable=False)
    data = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("thread_id", "thread_version", name="uq_discussion_event_version"), Index("ix_discussion_events_scope", "tenant_id", "project_id", "subject_kind", "subject_id", "seq"))


class DeliveryDiscussionReceipt(Base):
    __tablename__ = "delivery_discussion_receipts"
    id = Column(String(64), primary_key=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    request_hash = Column(String(64), nullable=False)
    event_id = Column(String(64), ForeignKey("delivery_discussion_events.id"), nullable=False)
    original_ack = Column(JSON, nullable=False)
    runtime_scopes = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class DeliverySourceLink(Base):
    __tablename__ = "delivery_source_links"
    seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    source_kind = Column(String(40), nullable=False)
    source_id = Column(String(64), nullable=False)
    thread_id = Column(String(64), ForeignKey("delivery_discussion_threads.id"), nullable=False)
    thread_version = Column(Integer, nullable=False)
    source_snapshot = Column(JSON, nullable=False)
    source_digest = Column(String(64), nullable=False)
    runtime_scopes = Column(JSON, nullable=False, default=list)
    target_kind = Column(String(24), nullable=False)
    target_id = Column(String(64), nullable=False)
    business_event_id = Column(String(64), nullable=True)
    applied_fields = Column(JSON, nullable=False, default=list)
    applied_by_id = Column(String(64), nullable=False)
    applied_by_name = Column(String(128), nullable=False)
    relation = Column(String(16), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (Index("ix_discussion_source_target", "tenant_id", "project_id", "target_kind", "target_id", "seq"), Index("ix_discussion_source_thread", "tenant_id", "project_id", "thread_id", "seq"))


class DeliveryQueryState(Base):
    """Current derived query generation; never an independent business entity."""
    __tablename__ = "delivery_query_states"
    tenant_id = Column(String(64), primary_key=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    schema_version = Column(Integer, nullable=False)
    generation = Column(Integer, nullable=False)
    source_version = Column(Integer, nullable=False)
    computed_at = Column(DateTime, nullable=False)
    summary = Column(JSON, nullable=False)
    metrics = Column(JSON, nullable=False)
    planning_basis = Column(String(64), nullable=False)


class DeliveryQueryFact(Base):
    """Disposable proof/search metadata, joined to canonical rows for business text."""
    __tablename__ = "delivery_query_facts"
    tenant_id = Column(String(64), primary_key=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    kind = Column(String(24), primary_key=True)
    entity_id = Column(String(100), primary_key=True)
    parent_id = Column(String(64), nullable=False, default="")
    owner_id = Column(String(100), nullable=False, default="")
    milestone_id = Column(String(64), nullable=False, default="")
    status = Column(String(32), nullable=False, default="")
    due_on = Column(String(10), nullable=True)
    label = Column(String(256), nullable=False, default="")
    data = Column(JSON, nullable=False)
    __table_args__ = (
        Index("ix_delivery_query_status", "tenant_id", "project_id", "kind", "status", "entity_id"),
        Index("ix_delivery_query_parent", "tenant_id", "project_id", "kind", "parent_id", "entity_id"),
        Index("ix_delivery_query_owner", "tenant_id", "project_id", "kind", "owner_id", "entity_id"),
    )


class DeliveryActivityLink(Base):
    """Immutable requirement association recorded in the event's own transaction."""
    __tablename__ = "delivery_activity_links"
    event_id = Column(String(64), ForeignKey("delivery_events.id", ondelete="CASCADE"), primary_key=True)
    requirement_id = Column(String(64), primary_key=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), nullable=False)
    __table_args__ = (Index("ix_delivery_activity_requirement", "tenant_id", "project_id", "requirement_id", "event_id"),)


class DeliveryRequirementVersion(Base):
    """Observed canonical definitions, never a second Requirement or guessed past revision."""
    __tablename__ = "delivery_requirement_versions"
    seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), nullable=False)
    requirement_id = Column(String(64), nullable=False)
    number = Column(Integer, nullable=False)
    basis = Column(String(64), nullable=False)
    definition = Column(JSON, nullable=False)
    actor_id = Column(String(64), nullable=True)
    actor_name = Column(String(128), nullable=False, default="")
    source = Column(String(32), nullable=False)
    flow_revision = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "project_id", "requirement_id", "number", name="uq_requirement_observed_version"),
        Index("ix_requirement_version_scope", "tenant_id", "project_id", "requirement_id", "seq"),
    )


class DeliveryProgressObservation(Base):
    """Append-only facts, independent of the bounded delivery activity feed."""
    __tablename__ = "delivery_progress_observations"
    seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(String(64), nullable=False)
    observed_day = Column(String(10), nullable=False)
    observed_at = Column(DateTime, nullable=False)
    source = Column(String(32), nullable=False)
    actor = Column(String(128), nullable=False, default="")
    source_version = Column(Integer, nullable=True)
    fingerprint = Column(String(64), nullable=False)
    data = Column(JSON, nullable=False)
    __table_args__ = (Index("ix_progress_project_day", "tenant_id", "project_id", "observed_day", "seq"),)


class DeliveryProgressCheckpoint(Base):
    """One successful daily scan per actual tenant, project and UTC date."""
    __tablename__ = "delivery_progress_checkpoints"
    tenant_id = Column(String(64), primary_key=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    observed_day = Column(String(10), primary_key=True)


class DeliveryProgressBaseline(Base):
    """Immutable approved scope; replanning always appends a new baseline."""
    __tablename__ = "delivery_progress_baselines"
    id = Column(String(64), primary_key=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(String(64), nullable=False)
    title = Column(String(200), nullable=False)
    scope_kind = Column(String(16), nullable=False)
    scope_id = Column(String(64), nullable=False, default="")
    basis = Column(String(64), nullable=False)
    starts_on = Column(String(10), nullable=True)
    ends_on = Column(String(10), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(String(128), nullable=False)
    source_version = Column(Integer, nullable=False)
    data = Column(JSON, nullable=False)
    note = Column(Text, nullable=False, default="")
    __table_args__ = (Index("ix_baseline_project_scope", "tenant_id", "project_id", "scope_kind", "scope_id"),)


class DeliveryPlanPreview(Base):
    """Committed generation intent; provider retries never happen implicitly."""
    __tablename__ = "delivery_plan_previews"
    id = Column(String(64), primary_key=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(String(64), nullable=False, index=True)
    user_id = Column(String(64), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False)
    data = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class DeliveryTaskReview(Base):
    """Append-only human decisions; invalidation preserves the original evidence."""
    __tablename__ = "delivery_task_reviews"
    seq = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String(64), nullable=False, unique=True)
    tenant_id = Column(String(64), nullable=False)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    reviewer_id = Column(String(64), nullable=False)
    reviewer_name = Column(String(128), nullable=False)
    decision = Column(String(32), nullable=False)
    task_basis = Column(String(64), nullable=False)
    snapshot = Column(JSON, nullable=False)
    comment = Column(Text, nullable=False)
    evidence_content = Column(Text, nullable=False, default="")
    evidence_url = Column(String(2000), nullable=False, default="")
    invalidated = Column(Boolean, nullable=False, default=False)
    invalidated_at = Column(DateTime, nullable=True)
    invalidated_reason = Column(String(64), nullable=False, default="")
    __table_args__ = (Index("ix_task_review_scope", "tenant_id", "project_id", "task_id", "seq"),)


class RequirementAssistance(Base):
    """Durable generation or adoption intent scoped to one project and actor."""
    __tablename__ = "requirement_assistance"
    id = Column(String(64), primary_key=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(64), nullable=False)
    action = Column(String(32), nullable=False)
    requirement_id = Column(String(64), nullable=False, default="", index=True)
    request_hash = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False)
    data = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class IssueDiagnosis(Base):
    """Durable fixed-evidence suggestion, not a second business Issue."""
    __tablename__ = "issue_diagnoses"
    id = Column(String(64), primary_key=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    issue_id = Column(String(64), nullable=False, index=True)
    user_id = Column(String(64), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False)
    data = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id            = Column(String(64), primary_key=True)
    tenant_id     = Column(String(64), nullable=False, index=True)
    project_id    = Column(String(64), default="", index=True)
    user_id       = Column(String(64), default="")
    username      = Column(String(64), default="")
    action        = Column(String(64), nullable=False)   # create|update|delete|login|...
    resource_type = Column(String(64), default="")       # requirement|task|issue|...
    resource_id   = Column(String(64), default="")
    method        = Column(String(8), default="")
    path          = Column(String(512), default="")
    status_code   = Column(Integer, default=0)
    ip            = Column(String(64), default="")
    extra         = Column(JSON, default=dict)            # 额外上下文
    created_at    = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (Index("ix_audit_tenant_created", "tenant_id", "created_at"),)


# ── Webhook 配置 ──────────────────────────────────────────────────
class WebhookConfig(Base):
    __tablename__ = "webhook_configs"
    id         = Column(String(64), primary_key=True)
    tenant_id  = Column(String(64), nullable=False, index=True)
    project_id = Column(String(64), default="")
    name       = Column(String(128), nullable=False)
    url        = Column(String(1024), nullable=False)
    secret     = Column(String(256), default="")         # HMAC 签名密钥
    events     = Column(JSON, default=list)              # ["task.created", ...]
    active     = Column(Boolean, default=True)
    fail_count = Column(Integer, default=0)
    last_fired_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ── API Key ───────────────────────────────────────────────────────
class ApiKey(Base):
    __tablename__ = "api_keys"
    id           = Column(String(64), primary_key=True)
    tenant_id    = Column(String(64), nullable=False, index=True)
    user_id      = Column(String(64), nullable=False)
    name         = Column(String(128), nullable=False)
    key_hash     = Column(String(128), nullable=False, unique=True)
    key_prefix   = Column(String(12), default="")        # 显示用前缀 sop_xxxx
    status       = Column(String(16), default="active")  # active | revoked
    last_used_at = Column(DateTime, nullable=True)
    expires_at   = Column(DateTime, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)


# T-durable-execution-handoff: register only this phase's new canonical model.
from .delivery_execution_handoff_model import register_handoff_model  # noqa: E402

DeliveryExecutionHandoff = register_handoff_model(Base)

# T-durable-execution-controls: private immutable admission and technical facts.
from .delivery_execution_control_operation_model import register_control_operation_model  # noqa: E402

DeliveryExecutionControlOperation = register_control_operation_model(Base)

from .delivery_task_submission_model import register_submission_models  # noqa: E402

DeliveryTaskSubmission, DeliveryTaskSubmissionDecision = register_submission_models(Base)



from .design_model import register_design_models  # noqa: E402

ProjectDesignDocument, ProjectDesignRevision, ProjectDesignAdoption = register_design_models(Base)

from .design_generation_model import register_design_generation_model  # noqa: E402

ProjectDesignGeneration = register_design_generation_model(Base)

from .delivery_external_work_order_model import register_work_order_model  # noqa: E402

DeliveryExternalWorkOrder = register_work_order_model(Base)


def create_all():
    from sop_manager.schema_upgrade import require_current_schema

    require_current_schema(engine)
    Base.metadata.create_all(engine)


# Install once for every Manager Session, including the compatibility/CLI writers.
# Imports are late because hook handlers lazily use the complete model registry.
from .delivery_progress_hooks import install_progress_hooks  # noqa: E402

install_project_write_guard()
install_task_sql_guard()
install_task_owner_guard()
install_progress_hooks()
