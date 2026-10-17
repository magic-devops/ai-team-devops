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
from sqlalchemy.orm import DeclarativeBase, Session, relationship, sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

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
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

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
    status      = Column(String(32), default="pending")
    priority    = Column(String(8), default="P1")
    estimate    = Column(String(8), default="M")
    assigned_to = Column(String(64), default="")
    actual_hours= Column(Float, default=0.0)
    confidence  = Column(Float, default=0.0)
    human_notes = Column(Text, default="")
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project", back_populates="tasks")
    __table_args__ = (Index("ix_task_project_status", "project_id", "status"),)


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


def create_all():
    Base.metadata.create_all(engine)


# Install once for every Manager Session, including the compatibility/CLI writers.
# Imports are late because hook handlers lazily use the complete model registry.
from .delivery_progress_hooks import install_progress_hooks

install_progress_hooks()
