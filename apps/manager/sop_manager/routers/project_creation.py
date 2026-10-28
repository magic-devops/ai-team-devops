"""Atomic project creation and exact original-request recovery; no new storage."""
from __future__ import annotations

import hashlib
import json
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth_sql import check_project_access, role_weight
from .project_lifecycle_contract import WorkingProjectStatus
from .sql_models import Business, DeliveryReceipt, Project, ProjectMember, User


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    idempotency_key: str = Field(strict=True, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    name: str = Field(strict=True, min_length=1, max_length=128)
    description: str = Field(default="", strict=True, max_length=20000)
    business_id: str | None = Field(default=None, strict=True, max_length=64)
    project_path: str = Field(default="", strict=True, max_length=512)
    vector_db: Literal["lance", "milvus", "qdrant", "oceanbase"] = "lance"
    vector_db_config: dict = Field(default_factory=dict)
    status: WorkingProjectStatus = "planning"


class ProjectCreateAck(BaseModel):
    ok: Literal[True] = True
    action: Literal["project.create"] = "project.create"
    id: str
    tenant_id: str
    creator_id: str
    idempotency_key: str
    replayed: bool


def create_project_record(db: Session, actor: User, body: ProjectCreate) -> ProjectCreateAck:
    tenant_id, actor_id = actor.tenant_id, actor.id
    def authorized_actor() -> User:
        active = db.get(User, actor_id, populate_existing=True)
        if not active or active.tenant_id != tenant_id or active.status != "active" or role_weight(active.role) > role_weight("project_admin"):
            raise HTTPException(403, "Active project creation permission required")
        return active
    authorized_actor()
    # Namespace is disjoint from delivery command receipts. The full digest is
    # the receipt identity; the deterministic project PK also fences races.
    key = hashlib.sha256(json.dumps({"operation": "project.create", "tenant_id": tenant_id,
                                    "actor_id": actor_id, "key": body.idempotency_key}, sort_keys=True).encode()).hexdigest()
    fingerprint = hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    project_id = "proj-" + key[:59]

    def replay() -> ProjectCreateAck | None:
        active = authorized_actor()
        receipt = db.get(DeliveryReceipt, key, populate_existing=True)
        if receipt is None:
            return None
        if receipt.tenant_id != tenant_id or receipt.project_id != project_id or receipt.version != 0 or receipt.request_hash != fingerprint:
            raise HTTPException(409, "Idempotency key already used with different project input")
        project = db.get(Project, project_id, populate_existing=True)
        if project is None or project.tenant_id != tenant_id:
            raise HTTPException(409, "Original project creation receipt is unavailable")
        check_project_access(active, project_id, db, min_role="viewer")
        return ProjectCreateAck(id=project_id, tenant_id=tenant_id, creator_id=actor_id,
                                idempotency_key=body.idempotency_key, replayed=True)

    original = replay()
    if original is not None:
        return original
    if body.business_id is not None:
        business = db.get(Business, body.business_id)
        if business is None or business.tenant_id != tenant_id:
            raise HTTPException(404, "Business does not exist in this tenant")
    project = Project(id=project_id, tenant_id=tenant_id, **body.model_dump(exclude={"idempotency_key"}))
    try:
        db.add(project)
        db.flush()
        # The creator, project and receipt commit together, including when the
        # process stops after commit but before returning the HTTP response.
        db.add(ProjectMember(project_id=project_id, user_id=actor_id, role="project_admin"))
        db.add(DeliveryReceipt(id=key, project_id=project_id, tenant_id=tenant_id, request_hash=fingerprint, version=0))
        db.commit()
    except IntegrityError:
        db.rollback()
        original = replay()
        if original is not None:
            return original
        raise HTTPException(409, "Project creation conflicted; retry the same original request") from None
    return ProjectCreateAck(id=project_id, tenant_id=tenant_id, creator_id=actor_id,
                            idempotency_key=body.idempotency_key, replayed=False)
