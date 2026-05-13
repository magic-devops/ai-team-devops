"""Sprint CRUD — SQLAlchemy，支持租户/项目隔离"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .sql_models import get_session, Sprint, Task, Issue
from .auth_sql import current_user, User, check_project_access

router = APIRouter(prefix="/api/sprints", tags=["sprints"])


def _row(s: Sprint) -> dict:
    return {"id": s.id, "tenant_id": s.tenant_id, "project_id": s.project_id,
            "goal": s.goal, "status": s.status, "planned_points": s.planned_points,
            "velocity": s.velocity, "completion_rate": s.completion_rate,
            "retrospective": s.retrospective,
            "started_at": s.started_at.isoformat() + "Z",
            "ends_at": s.ends_at.isoformat() + "Z" if s.ends_at else None}


@router.get("")
def list_sprints(project_id: Optional[str] = None, page: int = 1, size: int = 20,
                 user: User = Depends(current_user), db: Session = Depends(get_session)):
    q = db.query(Sprint).filter(Sprint.tenant_id == user.tenant_id)
    if project_id:
        check_project_access(user, project_id, db)
        q = q.filter(Sprint.project_id == project_id)
    total = q.count()
    items = q.order_by(Sprint.started_at.desc()).offset((page-1)*size).limit(size).all()
    return {"total": total, "page": page, "size": size, "items": [_row(s) for s in items]}


class SprintCreate(BaseModel):
    goal: str
    planned_points: int = 0
    ends_at: Optional[str] = None
    project_id: str = ""


@router.post("")
def create_sprint(body: SprintCreate, user: User = Depends(current_user),
                  db: Session = Depends(get_session)):
    if body.project_id:
        # analyst 及以下可参与迭代规划；viewer(40) 不可写
        check_project_access(user, body.project_id, db, "analyst")
    # 关闭当前活跃 Sprint
    db.query(Sprint).filter_by(
        tenant_id=user.tenant_id, project_id=body.project_id, status="active"
    ).update({"status": "completed"})
    s = Sprint(
        id=f"SPRINT-{uuid.uuid4().hex[:8]}", tenant_id=user.tenant_id,
        project_id=body.project_id, goal=body.goal, status="active",
        planned_points=body.planned_points,
        ends_at=datetime.fromisoformat(body.ends_at) if body.ends_at else None,
    )
    db.add(s); db.commit()
    return {"ok": True, "id": s.id}


class SprintUpdate(BaseModel):
    goal: Optional[str] = None
    status: Optional[str] = None
    planned_points: Optional[int] = None
    velocity: Optional[float] = None
    completion_rate: Optional[float] = None
    retrospective: Optional[str] = None
    ends_at: Optional[str] = None


@router.patch("/{sprint_id}")
def update_sprint(sprint_id: str, body: SprintUpdate, user: User = Depends(current_user),
                  db: Session = Depends(get_session)):
    s = db.query(Sprint).filter_by(id=sprint_id, tenant_id=user.tenant_id).first()
    if not s: raise HTTPException(404, "Sprint 不存在")
    for k, v in body.dict(exclude_none=True).items():
        if k == "ends_at":
            setattr(s, k, datetime.fromisoformat(v) if v else None)
        else:
            setattr(s, k, v)
    db.commit()
    return {"ok": True}


@router.get("/{sprint_id}/progress")
def sprint_progress(sprint_id: str, user: User = Depends(current_user),
                    db: Session = Depends(get_session)):
    s = db.query(Sprint).filter_by(id=sprint_id, tenant_id=user.tenant_id).first()
    if not s: raise HTTPException(404, "Sprint 不存在")
    tasks = db.query(Task).filter_by(sprint_id=sprint_id, tenant_id=user.tenant_id).all()
    issues = db.query(Issue).filter_by(sprint_id=sprint_id, tenant_id=user.tenant_id).all()
    total = len(tasks); done = sum(1 for t in tasks if t.status == "completed")
    confs = [t.confidence for t in tasks if t.confidence]
    return {
        "sprint": _row(s),
        "total_tasks": total, "completed": done,
        "in_progress": sum(1 for t in tasks if t.status == "in_progress"),
        "blocked": [{"id": t.id, "title": t.title} for t in tasks if t.status == "blocked"],
        "pending": sum(1 for t in tasks if t.status == "pending"),
        "completion_rate": round(done / max(1, total) * 100, 1),
        "avg_confidence": round(sum(confs) / max(1, len(confs)), 2) if confs else 0,
        "open_issues": [{"id": i.id, "title": i.title, "severity": i.severity}
                        for i in issues if i.status == "open"],
    }


@router.delete("/{sprint_id}")
def delete_sprint(sprint_id: str, user: User = Depends(current_user),
                  db: Session = Depends(get_session)):
    s = db.query(Sprint).filter_by(id=sprint_id, tenant_id=user.tenant_id).first()
    if not s: raise HTTPException(404, "Sprint 不存在")
    db.delete(s); db.commit()
    return {"ok": True}
