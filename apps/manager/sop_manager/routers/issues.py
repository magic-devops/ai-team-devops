"""issues CRUD — 使用 SQLAlchemy，支持租户/项目隔离、分页"""
from __future__ import annotations
import uuid
from sop_manager.task_owner import TaskOwnerId, TaskOwnerInput

from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .sql_models import get_session, Issue
from .auth_sql import current_user_or_apikey, User, check_project_access
from .business_access import business_project_id, require_business_access, validate_business_references
from sop_manager.path_config import (
    resolved_business_code,
    resolved_project_code,
    resolved_project_id as _resolved_project_id,
    resolved_tenant_id as _resolved_tenant_id,
    resolved_tenant_code,
)
from .webhook import notify_webhook

router = APIRouter(prefix="/api/v1/issues", tags=["issues"],
                   dependencies=[Depends(require_business_access)])


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
    user: User = Depends(current_user_or_apikey),
    db: Session = Depends(get_session),
):
    eff_pid = business_project_id(project_id)
    query = db.query(Issue).filter(Issue.tenant_id == _resolved_tenant_id())
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
    eff_pid = business_project_id(project_id)
    query = db.query(Issue).filter(Issue.tenant_id == _resolved_tenant_id())
    if eff_pid:
        check_project_access(user, eff_pid, db)
        query = query.filter(Issue.project_id == eff_pid)
    return query


def _pie_items(counter: dict[str, int]) -> list[dict[str, Any]]:
    return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]


@router.get("/summary")
def issues_summary(
    project_id: Optional[str] = None,
    user: User = Depends(current_user_or_apikey),
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
    user: User = Depends(current_user_or_apikey),
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
    user: User = Depends(current_user_or_apikey),
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


class IssueOpsTasksIn(TaskOwnerInput):
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    categories: list[str] = Field(default_factory=list, max_length=20)
    limit: int = Field(20, ge=1, le=100)


def _is_open_issue(issue: Issue) -> bool:
    return str(issue.status or "open").lower() in ("open", "reopened", "new")


def _severity_score(severity: str) -> int:
    order = {"P0": 100, "CRITICAL": 100, "BLOCKER": 95, "P1": 80, "HIGH": 75, "P2": 45, "MEDIUM": 45, "P3": 20, "LOW": 20}
    return order.get(str(severity or "P3").upper(), 30)


def _issue_age_days(issue: Issue) -> int:
    created = issue.created_at
    if not created:
        return 0
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return max(0, int((datetime.now(timezone.utc) - created).total_seconds() // 86400))


def _issue_ops_plan_payload(items: list[Issue]) -> dict[str, Any]:
    open_items = [i for i in items if _is_open_issue(i)]
    critical = [i for i in open_items if _severity_score(i.severity) >= 80]
    stale = [i for i in open_items if _issue_age_days(i) >= 7]
    unlinked = [i for i in open_items if not (i.task_id or "").strip()]
    by_type: dict[str, int] = {}
    by_status: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    for i in items:
        by_type[str(i.type or "bug")] = by_type.get(str(i.type or "bug"), 0) + 1
        by_status[str(i.status or "open")] = by_status.get(str(i.status or "open"), 0) + 1
        by_severity[str(i.severity or "P3")] = by_severity.get(str(i.severity or "P3"), 0) + 1

    risks: list[dict[str, Any]] = []
    if critical:
        risks.append({
            "id": "critical-open",
            "severity": "P0" if any(str(i.severity).upper() == "P0" for i in critical) else "P1",
            "category": "severity",
            "title": f"{len(critical)} 个高优问题仍未解决",
            "description": "高优问题会阻断发布、测试验收或 Agent 自主继续开发，需要优先拆解修复任务并绑定负责人。",
            "command": "sop issue ops-tasks --categories severity --apply",
            "issue_ids": [i.id for i in critical[:10]],
            "count": len(critical),
        })
    if stale:
        risks.append({
            "id": "stale-open",
            "severity": "P1" if len(stale) >= 3 else "P2",
            "category": "aging",
            "title": f"{len(stale)} 个问题超过 7 天未关闭",
            "description": "长期未关闭问题需要确认根因、决策是否转需求/任务，避免问题池变成不可执行的待办堆积。",
            "command": "sop issue ops-tasks --categories aging --apply",
            "issue_ids": [i.id for i in sorted(stale, key=_issue_age_days, reverse=True)[:10]],
            "count": len(stale),
        })
    if unlinked:
        risks.append({
            "id": "unlinked-open",
            "severity": "P2",
            "category": "traceability",
            "title": f"{len(unlinked)} 个未解决问题没有关联任务",
            "description": "问题没有任务载体时，AI CLI/Agent 无法稳定领取、执行、回报和关闭交付证据。",
            "command": "sop issue ops-tasks --categories traceability --apply",
            "issue_ids": [i.id for i in unlinked[:10]],
            "count": len(unlinked),
        })
    if not items:
        risks.append({
            "id": "empty-issue-loop",
            "severity": "P2",
            "category": "intake",
            "title": "问题治理池尚未建立",
            "description": "建议把测试、运维、用户反馈和 Agent 失败报告统一沉淀为问题，形成需求-任务-问题-修复闭环。",
            "command": "sop issue create \"初始化问题治理池\" --type risk --severity P2",
            "issue_ids": [],
            "count": 0,
        })

    score = 100
    score -= min(45, len(critical) * 15)
    score -= min(25, len(stale) * 5)
    score -= min(20, len(unlinked) * 4)
    score = max(0, score)
    grade = "healthy" if score >= 85 else "watch" if score >= 65 else "risk"

    task_candidates: list[dict[str, Any]] = []
    for risk in risks:
        task_candidates.append({
            "title": f"[问题治理] {risk['title']}",
            "description": "\n".join([
                str(risk.get("description") or ""),
                "",
                f"风险分类: {risk.get('category')}",
                f"关联问题: {', '.join(risk.get('issue_ids') or []) or '待梳理'}",
                f"建议命令: {risk.get('command')}",
            ]),
            "priority": "P0" if risk.get("severity") == "P0" else "P1" if risk.get("severity") == "P1" else "P2",
            "estimate": "M",
            "owner_id": "",
            "dev_tool": "codex-cli",
            "source": "issue_ops",
            "source_report_id": str(risk.get("id") or ""),
            "source_report_title": str(risk.get("title") or ""),
            "category": str(risk.get("category") or ""),
            "debug_notes": f"tenant_code={resolved_tenant_code()} business_code={resolved_business_code()} project_id={_resolved_project_id()} project_code={resolved_project_code()}",
        })

    return {
        "ok": True,
        "health": {"score": score, "grade": grade},
        "summary": {
            "total": len(items),
            "open": len(open_items),
            "critical_open": len(critical),
            "stale_open": len(stale),
            "unlinked_open": len(unlinked),
            "by_type": by_type,
            "by_status": by_status,
            "by_severity": by_severity,
        },
        "risks": risks,
        "task_candidates": task_candidates,
        "commands": [
            {"label": "查看问题治理计划", "command": "sop issue ops-plan --json"},
            {"label": "预览治理任务", "command": "sop issue ops-tasks --limit 20 --json"},
            {"label": "生成治理任务", "command": "sop issue ops-tasks --apply"},
        ],
        "agent_packet": {
            "purpose": "IssueOps: prioritize unresolved issues, link them to executable tasks, and close the fix evidence loop.",
            "read_api": "/api/v1/issues/ops-plan",
            "task_api": "/api/v1/issues/ops-tasks",
            "recommended_cli": "sop issue ops-plan --json",
            "quality_gates": ["P0/P1 first", "linked task required", "resolution evidence required"],
        },
        "scope": {
            "tenant_code": resolved_tenant_code(),
            "business_code": resolved_business_code(),
            "project_id": _resolved_project_id(),
            "project_code": resolved_project_code(),
        },
    }


@router.get("/ops-plan")
def issues_ops_plan(
    project_id: Optional[str] = None,
    user: User = Depends(current_user_or_apikey),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    items = _issues_query(user, db, project_id).all()
    return _issue_ops_plan_payload(items)


@router.post("/ops-tasks")
def issues_ops_tasks(
    body: IssueOpsTasksIn,
    project_id: Optional[str] = None,
    user: User = Depends(current_user_or_apikey),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    plan = issues_ops_plan(project_id=project_id, user=user, db=db)
    categories = {x.strip() for x in body.categories if x.strip()}
    candidates = [
        item for item in (plan.get("task_candidates") or [])
        if not categories
        or str(item.get("category") or "") in categories
        or str(item.get("source_report_id") or "") in categories
        or str(item.get("source_report_title") or "") in categories
    ][: body.limit]
    items: list[dict[str, Any]] = []
    created: list[str] = []
    if not body.dry_run:
        from .tasks import TaskCreate, create_task

        for item in candidates:
            payload = dict(item)
            payload["priority"] = body.priority or payload.get("priority") or "P1"
            payload["owner_id"] = body.owner_id
            out = create_task(TaskCreate(**payload))
            task_id = str(out.get("id") or "")
            created.append(task_id)
            payload["task_id"] = task_id
            items.append(payload)
    else:
        for item in candidates:
            payload = dict(item)
            payload["priority"] = body.priority or payload.get("priority") or "P1"
            payload["owner_id"] = body.owner_id
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


class IssueCreate(BaseModel):
    title: str
    description: str = ""
    type: str = "bug"
    severity: str = "P2"
    task_id: str = ""
    project_id: str = ""
    sprint_id: str = ""


@router.post("")
def create_issue(body: IssueCreate, user: User = Depends(current_user_or_apikey),
                 db: Session = Depends(get_session)):
    project_id = business_project_id(body.project_id)
    validate_business_references(db, task_id=body.task_id, sprint_id=body.sprint_id)
    if project_id:
        check_project_access(user, project_id, db, "product_manager")
    i = Issue(
        id=f"ISSUE-{uuid.uuid4().hex[:10]}", tenant_id=_resolved_tenant_id(),
        project_id=project_id, sprint_id=body.sprint_id, task_id=body.task_id,
        title=body.title, description=body.description, type=body.type,
        severity=body.severity, status="open", reported_by=user.username,
    )
    db.add(i); db.commit()
    notify_webhook(
        "issue.opened",
        {"issue_id": i.id, "title": i.title, "severity": i.severity, "type": i.type},
        tenant_id=_resolved_tenant_id(),
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
def update_issue(issue_id: str, body: IssueUpdate, user: User = Depends(current_user_or_apikey),
                 db: Session = Depends(get_session)):
    i = db.query(Issue).filter_by(id=issue_id, tenant_id=_resolved_tenant_id(), project_id=_resolved_project_id()).first()
    if not i: raise HTTPException(404, "问题不存在")
    patch = body.dict(exclude_none=True)
    validate_business_references(db, sprint_id=body.sprint_id)
    if not patch:
        return {"ok": True}
    for k, v in patch.items():
        setattr(i, k, v)
    db.commit()
    notify_webhook(
        "issue.updated",
        {"issue_id": issue_id, "fields": list(patch.keys())},
        tenant_id=_resolved_tenant_id(),
        project_id=i.project_id or "",
    )
    return {"ok": True}


class IssueResolveBody(BaseModel):
    resolution: str = ""


@router.patch("/{issue_id}/resolve")
def resolve_issue(
    issue_id: str,
    body: IssueResolveBody,
    user: User = Depends(current_user_or_apikey),
    db: Session = Depends(get_session),
):
    i = db.query(Issue).filter_by(id=issue_id, tenant_id=_resolved_tenant_id(), project_id=_resolved_project_id()).first()
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
        tenant_id=_resolved_tenant_id(),
        project_id=i.project_id or "",
    )
    return {"ok": True}


@router.delete("/{issue_id}")
def delete_issue(issue_id: str, user: User = Depends(current_user_or_apikey),
                 db: Session = Depends(get_session)):
    i = db.query(Issue).filter_by(id=issue_id, tenant_id=_resolved_tenant_id(), project_id=_resolved_project_id()).first()
    if not i: raise HTTPException(404, "问题不存在")
    pid = i.project_id or ""
    db.delete(i); db.commit()
    notify_webhook(
        "issue.deleted",
        {"issue_id": issue_id},
        tenant_id=_resolved_tenant_id(),
        project_id=pid,
    )
    return {"ok": True}
