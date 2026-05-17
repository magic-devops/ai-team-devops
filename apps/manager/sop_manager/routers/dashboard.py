"""全局工作台摘要：面向 React 首页、AI 助手和运营入口的聚合控制面。"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .auth_sql import User, current_user
from .sql_models import Project, Requirement, Task, get_session

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


def _visible_projects(user: User, db: Session):
    q = db.query(Project).filter_by(tenant_id=user.tenant_id)
    if user.role not in ("super_admin", "tenant_admin"):
        member_pids = [m.project_id for m in user.memberships]
        q = q.filter(Project.id.in_(member_pids))
    return q.all()


def _count_by(items: list[dict[str, Any]], key: str, default: str = "unknown") -> dict[str, int]:
    return dict(Counter(str(item.get(key) or default) for item in items))


def _model_dict(item: Any) -> dict[str, Any]:
    return {key: value for key, value in vars(item).items() if not key.startswith("_")}


def _risk_items(
    *,
    projects: list[Project],
    requirements: list[dict[str, Any]],
    tasks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    risks: list[dict[str, Any]] = []
    if any(not p.project_path for p in projects):
        risks.append({
            "id": "project_path_missing",
            "level": "medium",
            "title": "项目路径未配置",
            "description": "部分项目缺少 project_path，CLI/IDE/Agent 本地接入能力会受限。",
            "target": "#/projects",
        })
    blocked_tasks = [t for t in tasks if str(t.get("status") or "") == "blocked"]
    if blocked_tasks:
        risks.append({
            "id": "blocked_tasks",
            "level": "high",
            "title": "存在阻塞任务",
            "description": f"{len(blocked_tasks)} 个任务处于 blocked，需要优先处理依赖或资源问题。",
            "target": "#/tasks",
        })
    weak_requirements = [r for r in requirements if not r.get("acceptance_criteria")]
    if weak_requirements:
        risks.append({
            "id": "weak_requirements",
            "level": "medium",
            "title": "需求验收标准不足",
            "description": f"{len(weak_requirements)} 条需求缺少验收标准，影响 AI 拆解和交付验收。",
            "target": "#/requirements",
        })
    return risks[:8]


def _to_date(val: Any) -> date | None:
    if not val:
        return None
    if isinstance(val, datetime):
        return val.date()
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00")).date()
    except Exception:
        return None


def _pie_items(counter: dict[str, int]) -> list[dict[str, Any]]:
    return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]


@router.get("/charts")
def dashboard_charts(user: User = Depends(current_user), db: Session = Depends(get_session)) -> dict[str, Any]:
    """ECharts 友好图表数据：分布 + 近 7 日创建趋势。"""
    projects = _visible_projects(user, db)
    project_ids = [p.id for p in projects]
    requirements = [
        _model_dict(r)
        for r in db.query(Requirement)
        .filter(Requirement.tenant_id == user.tenant_id, Requirement.project_id.in_(project_ids))
        .all()
    ] if project_ids else []
    tasks = [
        _model_dict(t)
        for t in db.query(Task)
        .filter(Task.tenant_id == user.tenant_id, Task.project_id.in_(project_ids))
        .all()
    ] if project_ids else []

    task_status = _count_by(tasks, "status", "pending")
    req_status = _count_by(requirements, "status", "pending")
    risks = _risk_items(projects=projects, requirements=requirements, tasks=tasks)
    risk_levels = dict(Counter(str(r.get("level") or "unknown") for r in risks))

    now = datetime.now(timezone.utc)
    days: list[str] = []
    task_trend: list[int] = []
    req_trend: list[int] = []
    for offset in range(6, -1, -1):
        d = (now - timedelta(days=offset)).date()
        days.append(d.isoformat())
        task_trend.append(sum(1 for t in tasks if _to_date(t.get("created_at")) == d))
        req_trend.append(sum(1 for r in requirements if _to_date(r.get("created_at")) == d))

    return {
        "ok": True,
        "requirement_status": _pie_items(req_status),
        "task_status": _pie_items(task_status),
        "task_priority": _pie_items(_count_by(tasks, "priority", "P3")),
        "requirement_priority": _pie_items(_count_by(requirements, "priority", "P3")),
        "risk_levels": _pie_items(risk_levels),
        "activity_trend": {
            "days": days,
            "series": [
                {"name": "tasks", "data": task_trend},
                {"name": "requirements", "data": req_trend},
            ],
        },
    }


@router.get("/summary")
def dashboard_summary(user: User = Depends(current_user), db: Session = Depends(get_session)) -> dict[str, Any]:
    projects = _visible_projects(user, db)
    project_ids = [p.id for p in projects]
    requirements = [
        _model_dict(r)
        for r in db.query(Requirement)
        .filter(Requirement.tenant_id == user.tenant_id, Requirement.project_id.in_(project_ids))
        .all()
    ] if project_ids else []
    tasks = [
        _model_dict(t)
        for t in db.query(Task)
        .filter(Task.tenant_id == user.tenant_id, Task.project_id.in_(project_ids))
        .all()
    ] if project_ids else []

    task_status = _count_by(tasks, "status", "pending")
    req_status = _count_by(requirements, "status", "pending")
    completed_tasks = task_status.get("completed", 0)
    completed_reqs = req_status.get("completed", 0)
    delivery_total = len(tasks) + len(requirements)
    delivery_done = completed_tasks + completed_reqs
    delivery_rate = round(delivery_done / max(1, delivery_total) * 100, 1)

    risks = _risk_items(projects=projects, requirements=requirements, tasks=tasks)
    next_actions = [
        {"id": "review_requirements", "title": "智能评审需求", "target": "#/requirements", "priority": "P1"},
        {"id": "resolve_blockers", "title": "处理阻塞任务", "target": "#/tasks", "priority": "P0" if task_status.get("blocked", 0) else "P2"},
        {"id": "project_onboarding", "title": "完善项目 AI 接入包", "target": "#/projects", "priority": "P1"},
    ]
    return {
        "ok": True,
        "user": {"id": user.id, "username": user.username, "role": user.role, "tenant_id": user.tenant_id},
        "metrics": {
            "projects": len(projects),
            "active_projects": sum(1 for p in projects if p.status == "active"),
            "requirements": len(requirements),
            "tasks": len(tasks),
            "blocked_tasks": task_status.get("blocked", 0),
            "delivery_rate": delivery_rate,
        },
        "projects": {
            "by_status": dict(Counter(str(p.status or "unknown") for p in projects)),
            "templates": sum(1 for p in projects if p.is_template),
        },
        "requirements": {"by_status": req_status, "by_priority": _count_by(requirements, "priority", "P3")},
        "tasks": {"by_status": task_status, "by_priority": _count_by(tasks, "priority", "P3"), "by_source": _count_by(tasks, "source", "manual")},
        "risks": risks,
        "next_actions": next_actions,
    }


@router.get("/hub")
def dashboard_hub(user: User = Depends(current_user), db: Session = Depends(get_session)) -> dict[str, Any]:
    summary = dashboard_summary(user=user, db=db)
    charts = dashboard_charts(user=user, db=db)
    metrics = summary.get("metrics") if isinstance(summary.get("metrics"), dict) else {}
    return {
        "ok": True,
        "summary": metrics,
        "charts": {
            "task_status": charts.get("task_status") or [],
            "requirement_status": charts.get("requirement_status") or [],
            "risk_levels": charts.get("risk_levels") or [],
        },
        "risks": summary.get("risks") or [],
        "next_actions": summary.get("next_actions") or [],
        "domains": [
            {"id": "cockpit", "path": "#/dashboard/cockpit", "capability": "overview.dashboard.cockpit"},
            {"id": "projects", "path": "#/projects", "capability": "portfolio.projects"},
            {"id": "requirements", "path": "#/requirements", "capability": "product.requirements"},
            {"id": "tasks", "path": "#/tasks", "capability": "delivery.tasks"},
            {"id": "dev-flow", "path": "#/dev-flow/workbench", "capability": "delivery.dev-flow"},
            {"id": "analytics", "path": "#/analytics", "capability": "data.analytics.overview"},
            {"id": "copilot", "path": "#/copilot/chat", "capability": "ai.copilot.chat"},
        ],
    }
