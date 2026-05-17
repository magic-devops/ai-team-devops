"""
研发全流程可视化聚合：单接口汇总需求/任务/问题/迭代/方案/环境线索，
供「研发流」页面低 Token 展示与跳转，避免多轮拉数。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from sop_manager.path_config import resolved_ai_memory_root, resolved_project_path
from .db_sql_compat import rows

router = APIRouter(prefix="/api/v1/dev-flow", tags=["dev-flow"])


def _design_docs_count() -> int:
    p = resolved_ai_memory_root() / "tech_design" / "index.json"
    if not p.exists():
        return 0
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return len(data.get("documents") or [])
    except Exception:
        return 0


def _count_agents() -> int:
    d = resolved_ai_memory_root() / "agents"
    if not d.is_dir():
        return 0
    return len(list(d.glob("agent_*.json")))


def _count_groups() -> int:
    d = resolved_ai_memory_root() / "agents"
    if not d.is_dir():
        return 0
    return len(list(d.glob("group_*.json")))


def _sprint_task_stats(sprint_id: str, tasks: List[dict]) -> Dict[str, Any]:
    sprint_tasks = [t for t in tasks if t.get("sprint_id") == sprint_id]
    total = len(sprint_tasks)
    done = sum(1 for t in sprint_tasks if t.get("status") == "completed")
    blocked = [
        {"id": t.get("id"), "title": t.get("title"), "assigned_to": t.get("assigned_to") or ""}
        for t in sprint_tasks
        if t.get("status") == "blocked"
    ]
    confs = [float(t["confidence"]) for t in sprint_tasks if t.get("confidence") is not None]
    return {
        "total_tasks": total,
        "completed": done,
        "in_progress": sum(1 for t in sprint_tasks if t.get("status") == "in_progress"),
        "pending": sum(1 for t in sprint_tasks if t.get("status") == "pending"),
        "blocked": blocked,
        "completion_rate": round(done / max(1, total) * 100, 1),
        "avg_confidence": round(sum(confs) / max(1, len(confs)), 2) if confs else 0,
        "remaining": max(0, total - done),
    }


def _parse_dt(val: Any) -> Optional[datetime]:
    if not val:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    try:
        s = str(val).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


@router.get("/summary")
def dev_flow_summary() -> Dict[str, Any]:
    reqs: List[dict] = rows("requirements", 500)
    tasks: List[dict] = rows("tasks", 500)
    issues: List[dict] = rows("issues", 400)
    sprints: List[dict] = rows("sprints", 50)

    active = next((s for s in sprints if s.get("status") == "active"), None)
    sid = (active or {}).get("id")
    sprint_tasks = [t for t in tasks if sid and t.get("sprint_id") == sid] if sid else tasks

    req_by_status: Dict[str, int] = {}
    for r in reqs:
        st = r.get("status") or "unknown"
        req_by_status[st] = req_by_status.get(st, 0) + 1

    task_by_status: Dict[str, int] = {}
    for t in sprint_tasks:
        st = t.get("status") or "unknown"
        task_by_status[st] = task_by_status.get(st, 0) + 1

    linked_tasks = sum(1 for t in tasks if t.get("requirement_id") or t.get("req_id"))
    open_issues = [i for i in issues if (i.get("status") or "").lower() in ("open", "reopened", "new")]
    sprint_open_issues = (
        [
            {"id": i.get("id"), "title": i.get("title"), "severity": i.get("severity")}
            for i in open_issues
            if sid and i.get("sprint_id") == sid
        ]
        if sid
        else []
    )
    sprint_progress = _sprint_task_stats(sid, tasks) if sid else None
    if sprint_progress is not None:
        sprint_progress["open_issues"] = sprint_open_issues

    return {
        "project_path": str(resolved_project_path().resolve()),
        "requirements": {
            "total": len(reqs),
            "by_status": req_by_status,
            "p0": sum(1 for r in reqs if r.get("priority") == "P0"),
        },
        "tasks": {
            "total_all": len(tasks),
            "sprint_scope": len(sprint_tasks),
            "linked_to_requirement": linked_tasks,
            "by_status": task_by_status,
            "done_sprint": sum(1 for t in sprint_tasks if t.get("status") == "completed"),
        },
        "issues": {
            "total": len(issues),
            "open": len(open_issues),
            "critical_open": sum(
                1
                for i in open_issues
                if (i.get("severity") or "").upper() in ("P0", "P1", "CRITICAL", "BLOCKER")
            ),
        },
        "sprint": active,
        "sprint_progress": sprint_progress,
        "design_docs": {"count": _design_docs_count()},
        "agents": {"definitions": _count_agents(), "groups": _count_groups()},
        "repo_hints": {
            "dockerfile": (resolved_project_path() / "Dockerfile").exists(),
            "compose": (resolved_project_path() / "docker-compose.yml").exists()
            or (resolved_project_path() / "compose.yaml").exists(),
            "specs_dir": (resolved_project_path() / "specs").is_dir(),
        },
    }


@router.get("/charts")
def dev_flow_charts() -> Dict[str, Any]:
    """ECharts 友好分布数据：需求/任务状态饼图、问题严重度。"""
    summary = dev_flow_summary()
    reqs = summary.get("requirements") or {}
    tasks = summary.get("tasks") or {}
    issues_block = summary.get("issues") or {}

    issues_rows: List[dict] = rows("issues", 400)
    by_severity: Dict[str, int] = {}
    for i in issues_rows:
        if (i.get("status") or "").lower() not in ("open", "reopened", "new"):
            continue
        sev = str(i.get("severity") or "unknown").upper()
        by_severity[sev] = by_severity.get(sev, 0) + 1

    return {
        "ok": True,
        "requirement_status": [{"name": k, "value": v} for k, v in sorted((reqs.get("by_status") or {}).items())],
        "task_status": [{"name": k, "value": v} for k, v in sorted((tasks.get("by_status") or {}).items())],
        "issue_severity": [{"name": k, "value": v} for k, v in sorted(by_severity.items())],
        "issues_open": int(issues_block.get("open") or 0),
        "issues_critical": int(issues_block.get("critical_open") or 0),
    }


@router.get("/hub")
def dev_flow_hub() -> Dict[str, Any]:
    summary = dev_flow_summary()
    charts = dev_flow_charts()
    reqs = summary.get("requirements") if isinstance(summary.get("requirements"), dict) else {}
    tasks = summary.get("tasks") if isinstance(summary.get("tasks"), dict) else {}
    issues_block = summary.get("issues") if isinstance(summary.get("issues"), dict) else {}
    return {
        "ok": True,
        "summary": {
            "requirements_total": reqs.get("total", 0),
            "tasks_total": tasks.get("total_all", 0),
            "tasks_sprint": tasks.get("sprint_scope", 0),
            "issues_open": issues_block.get("open", 0),
            "issues_critical": issues_block.get("critical_open", 0),
            "design_docs": (summary.get("design_docs") or {}).get("count", 0),
            "sprint_active": bool(summary.get("sprint")),
        },
        "charts": {
            "requirement_status": charts.get("requirement_status") or [],
            "task_status": charts.get("task_status") or [],
            "issue_severity": charts.get("issue_severity") or [],
        },
        "domains": [
            {"id": "workbench", "path": "#/dev-flow/workbench", "capability": "delivery.dev-flow.workbench"},
            {"id": "requirements", "path": "#/requirements", "capability": "product.requirements"},
            {"id": "tasks", "path": "#/tasks", "capability": "delivery.tasks"},
            {"id": "issues", "path": "#/issues/tracker", "capability": "delivery.issues.tracker"},
            {"id": "sprints", "path": "#/tasks/sprints", "capability": "delivery.tasks.sprints"},
            {"id": "design-docs", "path": "#/intelligence/design-docs", "capability": "ai.intelligence.design-docs"},
            {"id": "workflows", "path": "#/workflows", "capability": "delivery.workflows"},
        ],
    }


@router.get("/burndown")
def sprint_burndown(sprint_id: str = Query("", description="迭代 ID，空则取当前 active")) -> Dict[str, Any]:
    sprints: List[dict] = rows("sprints", 50)
    tasks: List[dict] = rows("tasks", 500)
    active = next((s for s in sprints if s.get("status") == "active"), None)
    sid = (sprint_id or "").strip() or (active or {}).get("id") or ""
    if not sid:
        raise HTTPException(404, "无可用迭代")
    sprint = next((s for s in sprints if s.get("id") == sid), None)
    if not sprint:
        raise HTTPException(404, "迭代不存在")
    stats = _sprint_task_stats(sid, tasks)
    total = int(stats["total_tasks"])
    remaining = int(stats["remaining"])
    done = int(stats["completed"])

    started = _parse_dt(sprint.get("started_at"))
    ends = _parse_dt(sprint.get("ends_at"))
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
        ideal_remaining = round(total * (1 - d / span_days), 1) if span_days else 0
        ideal.append({"day": d, "remaining": ideal_remaining})
    actual.append({"day": 0, "remaining": float(total)})
    actual.append({"day": elapsed_days, "remaining": float(remaining)})
    if done >= total and total > 0:
        actual.append({"day": span_days, "remaining": 0.0})

    return {
        "ok": True,
        "sprint": sprint,
        "stats": stats,
        "span_days": span_days,
        "elapsed_days": elapsed_days,
        "ideal": ideal,
        "actual": actual,
    }


_FLOW_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "feature-delivery",
        "name": "功能交付",
        "description": "需求澄清 → 拆任务 → 迭代执行 → 问题收敛 → 工作流收尾",
        "links": [
            {"label": "需求工作台", "hash": "#/requirements"},
            {"label": "任务中心", "hash": "#/tasks"},
            {"label": "问题中心", "hash": "#/issues"},
        ],
        "workflow_type": "sprint_lifecycle",
        "workflow_args_hint": {"sprint_id": "当前活跃 Sprint ID", "tasks": []},
    },
    {
        "id": "code-review",
        "name": "代码评审",
        "description": "AI 预审 + 人工 approve 信号（对接 /api/v1/workflows）",
        "links": [{"label": "工作流", "hash": "#/workflows"}],
        "workflow_type": "code_review",
        "workflow_args_hint": {"pr_id": "PR-001", "diff": "git diff 摘要"},
    },
    {
        "id": "bug-triage",
        "name": "缺陷分诊",
        "description": "自动分级与责任人指派，适合问题中心新建后触发",
        "links": [{"label": "问题中心", "hash": "#/issues"}],
        "workflow_type": "bug_triage",
        "workflow_args_hint": {"issue_id": "ISSUE-xxx", "text": "问题描述"},
    },
]


@router.get("/templates")
def dev_flow_templates() -> Dict[str, Any]:
    return {"ok": True, "items": _FLOW_TEMPLATES}
