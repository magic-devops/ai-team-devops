"""issues CRUD — 使用 SQLAlchemy，支持租户/项目隔离、分页"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .sql_models import get_session, Issue
from .auth_sql import current_user, User, check_project_access
from sop_manager.path_config import resolved_project_id as _resolved_project_id
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
    q: Optional[str] = Query(None, description="标题/描述/ID 关键词"),
    page: int = 1, size: int = 50,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    eff_pid = (project_id or "").strip() or _resolved_project_id().strip()
    query = db.query(Issue).filter(Issue.tenant_id == user.tenant_id)
    if eff_pid:
        check_project_access(user, eff_pid, db)
        query = query.filter(Issue.project_id == eff_pid)
    if status:
        query = query.filter(Issue.status == status)
    if severity:
        query = query.filter(Issue.severity == severity)
    needle = (q or "").strip().lower()
    if needle:
        like = f"%{needle}%"
        query = query.filter(
            (Issue.title.ilike(like))
            | (Issue.description.ilike(like))
            | (Issue.id.ilike(like))
        )
    total = query.count()
    items = query.order_by(Issue.severity, Issue.created_at.desc()).offset((page - 1) * size).limit(size).all()
    return {"total": total, "page": page, "size": size, "items": [_row(i) for i in items]}


def _issues_query(
    user: User,
    db: Session,
    project_id: Optional[str] = None,
):
    eff_pid = (project_id or "").strip() or _resolved_project_id().strip()
    query = db.query(Issue).filter(Issue.tenant_id == user.tenant_id)
    if eff_pid:
        check_project_access(user, eff_pid, db)
        query = query.filter(Issue.project_id == eff_pid)
    return query


def _pie_items(counter: dict[str, int]) -> list[dict[str, Any]]:
    return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]


@router.get("/summary")
def issues_summary(
    project_id: Optional[str] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    items = _issues_query(user, db, project_id).all()
    by_status: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    by_type: dict[str, int] = {}
    open_count = 0
    critical_open = 0
    for i in items:
        st = str(i.status or "open")
        sev = str(i.severity or "P3")
        typ = str(i.type or "bug")
        by_status[st] = by_status.get(st, 0) + 1
        by_severity[sev] = by_severity.get(sev, 0) + 1
        by_type[typ] = by_type.get(typ, 0) + 1
        if st.lower() in ("open", "reopened", "new"):
            open_count += 1
            if sev.upper() in ("P0", "P1", "CRITICAL", "BLOCKER"):
                critical_open += 1
    resolved = by_status.get("resolved", 0)
    total = len(items)
    return {
        "ok": True,
        "summary": {
            "total": total,
            "open": open_count,
            "resolved": resolved,
            "critical_open": critical_open,
            "resolution_rate": round(resolved / total * 100, 1) if total else 0,
            "by_status": by_status,
            "by_severity": by_severity,
            "by_type": by_type,
        },
    }


@router.get("/charts")
def issues_charts(
    project_id: Optional[str] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    payload = issues_summary(project_id=project_id, user=user, db=db)
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    return {
        "ok": True,
        "by_status": _pie_items(summary.get("by_status") or {}),
        "by_severity": _pie_items(summary.get("by_severity") or {}),
        "by_type": _pie_items(summary.get("by_type") or {}),
    }


@router.get("/hub")
def issues_hub(
    project_id: Optional[str] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    payload = issues_summary(project_id=project_id, user=user, db=db)
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    charts = issues_charts(project_id=project_id, user=user, db=db)
    return {
        "ok": True,
        "summary": summary,
        "charts": {
            "by_status": charts.get("by_status") or [],
            "by_severity": charts.get("by_severity") or [],
        },
        "domains": [
            {"id": "tracker", "path": "#/issues/tracker", "capability": "delivery.issues.tracker"},
            {"id": "tasks", "path": "#/tasks", "capability": "delivery.tasks"},
            {"id": "dev-flow", "path": "#/dev-flow/workbench", "capability": "delivery.dev-flow.workbench"},
            {"id": "requirements", "path": "#/requirements", "capability": "product.requirements"},
        ],
    }


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
    project_id = (body.project_id or "").strip() or _resolved_project_id().strip()
    if project_id:
        check_project_access(user, project_id, db, "analyst")
    i = Issue(
        id=f"ISSUE-{uuid.uuid4().hex[:10]}", tenant_id=user.tenant_id,
        project_id=project_id, sprint_id=body.sprint_id, task_id=body.task_id,
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
