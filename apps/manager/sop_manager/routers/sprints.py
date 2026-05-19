"""Sprint CRUD — SQLAlchemy，支持租户/项目隔离"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .sql_models import get_session, Sprint, Task, Issue
from .auth_sql import current_user, User, check_project_access
from sop_manager.path_config import (
    resolved_business_code,
    resolved_project_code,
    resolved_project_id as _resolved_project_id,
    resolved_tenant_code,
)
from .webhook import notify_webhook

router = APIRouter(prefix="/api/v1/sprints", tags=["sprints"])


def _row(s: Sprint) -> dict:
    return {"id": s.id, "tenant_id": s.tenant_id, "project_id": s.project_id,
            "goal": s.goal, "status": s.status, "planned_points": s.planned_points,
            "velocity": s.velocity, "completion_rate": s.completion_rate,
            "retrospective": s.retrospective,
            "started_at": s.started_at.isoformat() + "Z",
            "ends_at": s.ends_at.isoformat() + "Z" if s.ends_at else None}


def _parse_dt(val: Any) -> Optional[datetime]:
    if not val:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        return None


def _task_stats(tasks: List[Task]) -> Dict[str, Any]:
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == "completed")
    confs = [float(t.confidence) for t in tasks if t.confidence is not None]
    return {
        "total_tasks": total,
        "completed": done,
        "in_progress": sum(1 for t in tasks if t.status == "in_progress"),
        "pending": sum(1 for t in tasks if t.status == "pending"),
        "blocked": [
            {"id": t.id, "title": t.title, "assigned_to": t.assigned_to or ""}
            for t in tasks
            if t.status == "blocked"
        ],
        "completion_rate": round(done / max(1, total) * 100, 1),
        "avg_confidence": round(sum(confs) / max(1, len(confs)), 2) if confs else 0,
        "remaining": max(0, total - done),
    }


def _burndown_payload(sprint: Sprint, tasks: List[Task]) -> Dict[str, Any]:
    stats = _task_stats(tasks)
    total = int(stats["total_tasks"])
    remaining = int(stats["remaining"])
    done = int(stats["completed"])
    started = _parse_dt(sprint.started_at)
    ends = _parse_dt(sprint.ends_at)
    now = datetime.now(timezone.utc)
    if started and ends and ends > started:
        span_days = max(1, (ends - started).days)
        elapsed_days = min(span_days, max(0, (now - started).days))
    else:
        span_days = 14
        elapsed_days = min(span_days, max(0, int(done / max(1, total) * span_days)))
    ideal: List[Dict[str, Any]] = []
    actual: List[Dict[str, Any]] = []
    for d in range(span_days + 1):
        ideal.append({"day": d, "remaining": round(total * (1 - d / span_days), 1) if span_days else 0})
    actual.append({"day": 0, "remaining": float(total)})
    actual.append({"day": elapsed_days, "remaining": float(remaining)})
    if done >= total and total > 0:
        actual.append({"day": span_days, "remaining": 0.0})
    return {
        "ok": True,
        "sprint": _row(sprint),
        "stats": stats,
        "span_days": span_days,
        "elapsed_days": elapsed_days,
        "ideal": ideal,
        "actual": actual,
    }


class SprintOpsTasksIn(BaseModel):
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = Field("SprintOps Agent", max_length=120)
    sprint_id: str = ""
    categories: List[str] = Field(default_factory=list, max_length=20)
    limit: int = Field(20, ge=1, le=100)


def _active_sprint(items: List[Sprint]) -> Optional[Sprint]:
    return next((s for s in items if str(s.status or "").lower() == "active"), None)


def _sprint_ops_payload(sprints: List[Sprint], tasks: List[Task], issues: List[Issue], sprint: Optional[Sprint]) -> Dict[str, Any]:
    active = sprint or _active_sprint(sprints)
    sprint_tasks = [t for t in tasks if active and t.sprint_id == active.id]
    sprint_issues = [i for i in issues if active and i.sprint_id == active.id]
    stats = _task_stats(sprint_tasks) if active else {"total_tasks": 0, "completed": 0, "in_progress": 0, "pending": 0, "blocked": [], "completion_rate": 0, "avg_confidence": 0, "remaining": 0}
    open_issues = [i for i in sprint_issues if str(i.status or "open").lower() in ("open", "reopened", "new")]
    critical_issues = [i for i in open_issues if str(i.severity or "").upper() in ("P0", "P1", "CRITICAL", "BLOCKER")]
    now_dt = datetime.now(timezone.utc)
    ends = _parse_dt(active.ends_at) if active else None
    days_left = None
    if ends:
        days_left = int((ends - now_dt).total_seconds() // 86400)
    risks: List[Dict[str, Any]] = []
    if not active:
        risks.append({
            "id": "no-active-sprint",
            "severity": "P1",
            "category": "planning",
            "title": "当前项目没有活跃迭代",
            "description": "没有活跃 Sprint 时，需求、任务、问题缺少交付节奏载体，AI Agent 难以判断本周期优先级。",
            "command": "sop sprint create \"启动当前交付迭代\" --points 0",
            "count": 0,
        })
    if active and not sprint_tasks:
        risks.append({
            "id": "empty-sprint-scope",
            "severity": "P1",
            "category": "scope",
            "title": "活跃迭代没有关联任务",
            "description": "迭代没有任务范围，无法进行燃尽、容量评估、DAG 调度和质量卡点治理。",
            "command": f"sop task list --sprint {active.id}",
            "count": 0,
        })
    blocked = stats.get("blocked") or []
    if blocked:
        risks.append({
            "id": "blocked-sprint-tasks",
            "severity": "P1",
            "category": "blocking",
            "title": f"{len(blocked)} 个迭代任务处于阻塞",
            "description": "阻塞任务会拉低迭代完成率，需要优先执行依赖调度、问题治理或重新分配。",
            "command": "sop task schedule-runbook --categories dependency_blocked --apply",
            "count": len(blocked),
            "task_ids": [x.get("id") for x in blocked[:10]],
        })
    if critical_issues:
        risks.append({
            "id": "critical-sprint-issues",
            "severity": "P0" if any(str(i.severity).upper() == "P0" for i in critical_issues) else "P1",
            "category": "quality",
            "title": f"{len(critical_issues)} 个高优问题影响当前迭代",
            "description": "高优问题应进入当前迭代治理队列，并绑定修复任务、验证证据和关闭条件。",
            "command": "sop issue ops-tasks --categories severity --apply",
            "count": len(critical_issues),
            "issue_ids": [i.id for i in critical_issues[:10]],
        })
    if active and days_left is not None and days_left <= 2 and float(stats.get("completion_rate") or 0) < 80:
        risks.append({
            "id": "sprint-end-risk",
            "severity": "P1",
            "category": "delivery",
            "title": f"迭代剩余 {max(days_left, 0)} 天但完成率不足 80%",
            "description": "迭代临近结束且完成率偏低，需要收缩范围、重排优先级或增加 Agent 并发。",
            "command": "sop sprint ops-tasks --categories delivery --apply",
            "count": int(stats.get("remaining") or 0),
        })
    if active and not (active.retrospective or "").strip() and str(active.status or "").lower() == "completed":
        risks.append({
            "id": "missing-retrospective",
            "severity": "P2",
            "category": "retrospective",
            "title": "已完成迭代缺少回顾总结",
            "description": "迭代回顾是后续估算、质量策略和 Agent 提示词优化的重要输入。",
            "command": f"sop sprint complete {active.id} --retro \"补充回顾\"",
            "count": 1,
        })

    score = 100
    score -= 35 if not active else 0
    score -= min(25, len(blocked) * 8)
    score -= min(25, len(critical_issues) * 12)
    if active and days_left is not None and days_left <= 2 and float(stats.get("completion_rate") or 0) < 80:
        score -= 20
    if active and not sprint_tasks:
        score -= 20
    score = max(0, score)
    grade = "healthy" if score >= 85 else "watch" if score >= 65 else "risk"
    candidates: List[Dict[str, Any]] = []
    for risk in risks:
        candidates.append({
            "title": f"[迭代治理] {risk['title']}",
            "description": "\n".join([
                str(risk.get("description") or ""),
                "",
                f"风险分类: {risk.get('category')}",
                f"Sprint: {(active.id if active else '')}",
                f"建议命令: {risk.get('command')}",
            ]),
            "priority": "P0" if risk.get("severity") == "P0" else "P1" if risk.get("severity") == "P1" else "P2",
            "estimate": "M",
            "assigned_to": "SprintOps Agent",
            "dev_tool": "codex-cli",
            "source": "sprint_ops",
            "source_report_id": str(risk.get("id") or ""),
            "source_report_title": str(risk.get("title") or ""),
            "category": str(risk.get("category") or ""),
            "sprint_id": active.id if active else "",
            "debug_notes": f"tenant_code={resolved_tenant_code()} business_code={resolved_business_code()} project_id={_resolved_project_id()} project_code={resolved_project_code()}",
        })
    return {
        "ok": True,
        "health": {"score": score, "grade": grade},
        "sprint": _row(active) if active else None,
        "summary": {
            "total_sprints": len(sprints),
            "active": 1 if active else 0,
            "tasks": stats,
            "open_issues": len(open_issues),
            "critical_issues": len(critical_issues),
            "days_left": days_left,
        },
        "risks": risks,
        "task_candidates": candidates,
        "commands": [
            {"label": "查看迭代治理计划", "command": "sop sprint ops-plan --json"},
            {"label": "预览迭代治理任务", "command": "sop sprint ops-tasks --limit 20 --json"},
            {"label": "生成迭代治理任务", "command": "sop sprint ops-tasks --apply --assigned-to \"SprintOps Agent\""},
        ],
        "agent_packet": {
            "purpose": "SprintOps: keep iteration scope executable, unblock delivery, and preserve retrospective knowledge for future planning.",
            "read_api": "/api/v1/sprints/ops-plan",
            "task_api": "/api/v1/sprints/ops-tasks",
            "recommended_cli": "sop sprint ops-plan --json",
            "quality_gates": ["active sprint exists", "blocked tasks triaged", "critical issues linked", "retrospective captured"],
        },
        "scope": {
            "tenant_code": resolved_tenant_code(),
            "business_code": resolved_business_code(),
            "project_id": _resolved_project_id(),
            "project_code": resolved_project_code(),
        },
    }


@router.get("/ops-plan")
def sprints_ops_plan(
    project_id: Optional[str] = None,
    sprint_id: str = "",
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> Dict[str, Any]:
    eff_pid = (project_id or "").strip() or _resolved_project_id().strip()
    q = db.query(Sprint).filter(Sprint.tenant_id == user.tenant_id)
    if eff_pid:
        check_project_access(user, eff_pid, db)
        q = q.filter(Sprint.project_id == eff_pid)
    sprints = q.order_by(Sprint.started_at.desc()).limit(100).all()
    selected = None
    if sprint_id:
        selected = next((s for s in sprints if s.id == sprint_id), None)
        if selected is None:
            raise HTTPException(404, "Sprint 不存在")
    tasks = db.query(Task).filter(Task.tenant_id == user.tenant_id)
    issues = db.query(Issue).filter(Issue.tenant_id == user.tenant_id)
    if eff_pid:
        tasks = tasks.filter(Task.project_id == eff_pid)
        issues = issues.filter(Issue.project_id == eff_pid)
    return _sprint_ops_payload(sprints, tasks.all(), issues.all(), selected)


@router.post("/ops-tasks")
def sprints_ops_tasks(
    body: SprintOpsTasksIn,
    project_id: Optional[str] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> Dict[str, Any]:
    plan = sprints_ops_plan(project_id=project_id, sprint_id=body.sprint_id, user=user, db=db)
    categories = {x.strip() for x in body.categories if x.strip()}
    candidates = [
        item for item in (plan.get("task_candidates") or [])
        if not categories
        or str(item.get("category") or "") in categories
        or str(item.get("source_report_id") or "") in categories
        or str(item.get("source_report_title") or "") in categories
    ][: body.limit]
    items: List[Dict[str, Any]] = []
    created: List[str] = []
    if not body.dry_run:
        from .tasks import TaskCreate, create_task

        for item in candidates:
            payload = dict(item)
            payload["priority"] = body.priority or payload.get("priority") or "P1"
            payload["assigned_to"] = body.assigned_to or payload.get("assigned_to") or "SprintOps Agent"
            out = create_task(TaskCreate(**payload))
            task_id = str(out.get("id") or "")
            created.append(task_id)
            payload["task_id"] = task_id
            items.append(payload)
    else:
        for item in candidates:
            payload = dict(item)
            payload["priority"] = body.priority or payload.get("priority") or "P1"
            payload["assigned_to"] = body.assigned_to or payload.get("assigned_to") or "SprintOps Agent"
            items.append(payload)
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "items": items,
        "created_task_ids": created,
        "summary": {
            "planned": len(candidates),
            "created": len(created),
            "health_score": (plan.get("health") or {}).get("score", 0),
            "grade": (plan.get("health") or {}).get("grade", ""),
        },
    }


@router.get("/summary")
def sprints_summary(
    project_id: Optional[str] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> Dict[str, Any]:
    eff_pid = (project_id or "").strip() or _resolved_project_id().strip()
    q = db.query(Sprint).filter(Sprint.tenant_id == user.tenant_id)
    if eff_pid:
        check_project_access(user, eff_pid, db)
        q = q.filter(Sprint.project_id == eff_pid)
    items = q.order_by(Sprint.started_at.desc()).limit(100).all()
    by_status: Dict[str, int] = {}
    for s in items:
        st = s.status or "unknown"
        by_status[st] = by_status.get(st, 0) + 1
    active = next((s for s in items if s.status == "active"), None)
    active_progress = None
    if active:
        tasks = db.query(Task).filter_by(sprint_id=active.id, tenant_id=user.tenant_id).all()
        active_progress = _task_stats(tasks)
    return {
        "ok": True,
        "total": len(items),
        "by_status": by_status,
        "active_sprint": _row(active) if active else None,
        "active_progress": active_progress,
    }


@router.get("")
def list_sprints(project_id: Optional[str] = None, page: int = 1, size: int = 20,
                 user: User = Depends(current_user), db: Session = Depends(get_session)):
    eff_pid = (project_id or "").strip() or _resolved_project_id().strip()
    q = db.query(Sprint).filter(Sprint.tenant_id == user.tenant_id)
    if eff_pid:
        check_project_access(user, eff_pid, db)
        q = q.filter(Sprint.project_id == eff_pid)
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
    project_id = (body.project_id or "").strip() or _resolved_project_id().strip()
    if project_id:
        # analyst 及以下可参与迭代规划；viewer(40) 不可写
        check_project_access(user, project_id, db, "analyst")
    prev = db.query(Sprint).filter_by(
        tenant_id=user.tenant_id, project_id=project_id, status="active"
    ).all()
    # 关闭当前活跃 Sprint
    db.query(Sprint).filter_by(
        tenant_id=user.tenant_id, project_id=project_id, status="active"
    ).update({"status": "completed"})
    for old in prev:
        notify_webhook(
            "sprint.completed",
            {"sprint_id": old.id, "goal": old.goal or ""},
            tenant_id=user.tenant_id,
            project_id=project_id,
        )
    s = Sprint(
        id=f"SPRINT-{uuid.uuid4().hex[:8]}", tenant_id=user.tenant_id,
        project_id=project_id, goal=body.goal, status="active",
        planned_points=body.planned_points,
        ends_at=datetime.fromisoformat(body.ends_at) if body.ends_at else None,
    )
    db.add(s); db.commit()
    notify_webhook(
        "sprint.started",
        {"sprint_id": s.id, "goal": body.goal, "planned_points": body.planned_points},
        tenant_id=user.tenant_id,
        project_id=project_id,
    )
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
    patch = body.dict(exclude_none=True)
    if not patch:
        return {"ok": True}
    old_status = s.status
    for k, v in patch.items():
        if k == "ends_at":
            setattr(s, k, datetime.fromisoformat(v) if v else None)
        else:
            setattr(s, k, v)
    db.commit()
    completed_now = body.status is not None and body.status != old_status and body.status == "completed"
    if completed_now:
        notify_webhook(
            "sprint.completed",
            {"sprint_id": sprint_id, "goal": s.goal or ""},
            tenant_id=user.tenant_id,
            project_id=s.project_id or "",
        )
    else:
        notify_webhook(
            "sprint.updated",
            {"sprint_id": sprint_id, "fields": list(patch.keys())},
            tenant_id=user.tenant_id,
            project_id=s.project_id or "",
        )
    return {"ok": True}


@router.get("/{sprint_id}/progress")
def sprint_progress(sprint_id: str, user: User = Depends(current_user),
                    db: Session = Depends(get_session)):
    s = db.query(Sprint).filter_by(id=sprint_id, tenant_id=user.tenant_id).first()
    if not s: raise HTTPException(404, "Sprint 不存在")
    tasks = db.query(Task).filter_by(sprint_id=sprint_id, tenant_id=user.tenant_id).all()
    issues = db.query(Issue).filter_by(sprint_id=sprint_id, tenant_id=user.tenant_id).all()
    stats = _task_stats(tasks)
    return {
        "sprint": _row(s),
        **stats,
        "open_issues": [{"id": i.id, "title": i.title, "severity": i.severity}
                        for i in issues if i.status == "open"],
    }


@router.get("/{sprint_id}/burndown")
def sprint_burndown(
    sprint_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> Dict[str, Any]:
    s = db.query(Sprint).filter_by(id=sprint_id, tenant_id=user.tenant_id).first()
    if not s:
        raise HTTPException(404, "Sprint 不存在")
    tasks = db.query(Task).filter_by(sprint_id=sprint_id, tenant_id=user.tenant_id).all()
    return _burndown_payload(s, tasks)


@router.delete("/{sprint_id}")
def delete_sprint(sprint_id: str, user: User = Depends(current_user),
                  db: Session = Depends(get_session)):
    s = db.query(Sprint).filter_by(id=sprint_id, tenant_id=user.tenant_id).first()
    if not s: raise HTTPException(404, "Sprint 不存在")
    pid = s.project_id or ""
    db.delete(s); db.commit()
    notify_webhook(
        "sprint.deleted",
        {"sprint_id": sprint_id},
        tenant_id=user.tenant_id,
        project_id=pid,
    )
    return {"ok": True}
