"""issues CRUD — 使用 SQLAlchemy，支持租户/项目隔离、分页"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .sql_models import get_session, Issue
from .auth_sql import current_user, User, check_project_access
from path_config import resolved_project_id as _resolved_project_id
from .webhook import notify_webhook

router = APIRouter(prefix="/api/v1/issues", tags=["issues"])


def _row(i: Issue) -> dict:
    return {"id": i.id, "tenant_id": i.tenant_id, "project_id": i.project_id,
            "sprint_id": i.sprint_id, "task_id": i.task_id, "title": i.title,
            "description": i.description, "type": i.type, "severity": i.severity,
            "status": i.status, "reported_by": i.reported_by, "resolved_by": i.resolved_by,
            "resolution": i.resolution,
            "created_at": i.created_at.isoformat() + "Z",
            "resolved_at": i.resolved_at.isoformat() + "Z" if i.resolved_at else None}


@router.get("")
def list_issues(
    project_id: Optional[str] = None,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    page: int = 1, size: int = 50,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    eff_pid = (project_id or "").strip() or _resolved_project_id().strip()
    q = db.query(Issue).filter(Issue.tenant_id == user.tenant_id)
    if eff_pid:
        check_project_access(user, eff_pid, db)
        q = q.filter(Issue.project_id == eff_pid)
    if status: q = q.filter(Issue.status == status)
    if severity: q = q.filter(Issue.severity == severity)
    total = q.count()
    items = q.order_by(Issue.severity, Issue.created_at.desc()).offset((page-1)*size).limit(size).all()
    return {"total": total, "page": page, "size": size, "items": [_row(i) for i in items]}


class IssueCreate(BaseModel):
    title: str
    description: str = ""
    type: str = "bug"
    severity: str = "P2"
    task_id: str = ""
    project_id: str = ""
    sprint_id: str = ""


@router.post("")
def create_issue(body: IssueCreate, user: User = Depends(current_user),
                 db: Session = Depends(get_session)):
    if body.project_id:
        check_project_access(user, body.project_id, db, "analyst")
    i = Issue(
        id=f"ISSUE-{uuid.uuid4().hex[:10]}", tenant_id=user.tenant_id,
        project_id=body.project_id, sprint_id=body.sprint_id, task_id=body.task_id,
        title=body.title, description=body.description, type=body.type,
        severity=body.severity, status="open", reported_by=user.username,
    )
    db.add(i); db.commit()
    notify_webhook(
        "issue.opened",
        {"issue_id": i.id, "title": i.title, "severity": i.severity, "type": i.type},
        tenant_id=user.tenant_id,
        project_id=i.project_id or "",
    )
    return {"ok": True, "id": i.id}


class IssueUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    sprint_id: Optional[str] = None


@router.patch("/{issue_id}")
def update_issue(issue_id: str, body: IssueUpdate, user: User = Depends(current_user),
                 db: Session = Depends(get_session)):
    i = db.query(Issue).filter_by(id=issue_id, tenant_id=user.tenant_id).first()
    if not i: raise HTTPException(404, "问题不存在")
    patch = body.dict(exclude_none=True)
    if not patch:
        return {"ok": True}
    for k, v in patch.items():
        setattr(i, k, v)
    db.commit()
    notify_webhook(
        "issue.updated",
        {"issue_id": issue_id, "fields": list(patch.keys())},
        tenant_id=user.tenant_id,
        project_id=i.project_id or "",
    )
    return {"ok": True}


class IssueResolveBody(BaseModel):
    resolution: str = ""


@router.patch("/{issue_id}/resolve")
def resolve_issue(
    issue_id: str,
    body: IssueResolveBody,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    i = db.query(Issue).filter_by(id=issue_id, tenant_id=user.tenant_id).first()
    if not i:
        raise HTTPException(404, "问题不存在")
    i.status = "resolved"
    i.resolution = body.resolution or ""
    i.resolved_by = user.username
    i.resolved_at = datetime.utcnow()
    db.commit()
    notify_webhook(
        "issue.resolved",
        {"issue_id": issue_id, "resolution": body.resolution or "", "resolved_by": user.username},
        tenant_id=user.tenant_id,
        project_id=i.project_id or "",
    )
    return {"ok": True}


@router.delete("/{issue_id}")
def delete_issue(issue_id: str, user: User = Depends(current_user),
                 db: Session = Depends(get_session)):
    i = db.query(Issue).filter_by(id=issue_id, tenant_id=user.tenant_id).first()
    if not i: raise HTTPException(404, "问题不存在")
    pid = i.project_id or ""
    db.delete(i); db.commit()
    notify_webhook(
        "issue.deleted",
        {"issue_id": issue_id},
        tenant_id=user.tenant_id,
        project_id=pid,
    )
    return {"ok": True}
