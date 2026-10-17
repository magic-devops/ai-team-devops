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
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root, resolved_business_code, resolved_project_id, resolved_project_path, resolved_tenant_id
from sop_manager.routers.productization_contract import summarize_items, unified_payload
from .db_sql_compat import rows

router = APIRouter(prefix="/api/v1/dev-flow", tags=["dev-flow"])


class DevFlowOpsTasksIn(BaseModel):
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = Field("FlowOps Agent", max_length=120)
    categories: List[str] = Field(default_factory=list, max_length=20)
    limit: int = Field(20, ge=1, le=100)


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


def _severity_score(level: str) -> int:
    return {"high": 18, "medium": 10, "low": 4}.get(level, 0)


def _dev_flow_ops_plan() -> Dict[str, Any]:
    summary = dev_flow_summary()
    reqs = rows("requirements", 500)
    tasks = rows("tasks", 800)
    issues = rows("issues", 500)
    sprints = rows("sprints", 80)
    active_sprint = summary.get("sprint") or {}
    repo = summary.get("repo_hints") or {}
    sprint_progress = summary.get("sprint_progress") or {}

    linked_tasks = int((summary.get("tasks") or {}).get("linked_to_requirement") or 0)
    total_tasks = int((summary.get("tasks") or {}).get("total_all") or 0)
    open_issues = [i for i in issues if (i.get("status") or "").lower() in ("open", "reopened", "new")]
    critical_issues = [
        i for i in open_issues
        if str(i.get("severity") or "").upper() in {"P0", "P1", "CRITICAL", "BLOCKER"}
    ]
    blocked_tasks = [t for t in tasks if str(t.get("status") or "") == "blocked"]
    stale_reqs = [
        r for r in reqs
        if str(r.get("status") or "").lower() in {"draft", "new", "reviewing", "pending"} and str(r.get("priority") or "").upper() in {"P0", "P1"}
    ]

    risks: List[Dict[str, Any]] = []

    def add_risk(rid: str, category: str, severity: str, title: str, detail: str, command: str, action: str) -> None:
        risks.append({
            "id": rid,
            "category": category,
            "severity": severity,
            "title": title,
            "detail": detail,
            "command": command,
            "action": action,
        })

    if not active_sprint:
        add_risk(
            "no-active-sprint",
            "sprint",
            "high",
            "缺少活跃迭代",
            "研发流无法形成稳定交付节奏，建议创建或激活 Sprint 并将 P0/P1 任务纳入迭代。",
            "sop sprint list --json",
            "创建/激活 Sprint 并回收未纳入迭代任务",
        )
    if critical_issues:
        add_risk(
            "critical-issues-open",
            "issues",
            "high",
            f"{len(critical_issues)} 个高优问题未关闭",
            "高优问题会阻断发布、调度和 Agent 自主执行，建议先分诊并任务化。",
            "sop issue list --status open --json",
            "分诊高优问题并建立修复任务",
        )
    if blocked_tasks:
        add_risk(
            "blocked-tasks",
            "tasks",
            "medium" if len(blocked_tasks) < 5 else "high",
            f"{len(blocked_tasks)} 个任务处于阻塞",
            "阻塞任务需要明确依赖、质量卡点或负责人，否则调度器会持续跳过。",
            "sop task deps --json",
            "检查任务依赖和阻塞原因",
        )
    if total_tasks and linked_tasks / max(1, total_tasks) < 0.55:
        add_risk(
            "low-requirement-linkage",
            "requirements",
            "medium",
            "任务与需求追溯不足",
            f"当前仅 {linked_tasks}/{total_tasks} 个任务关联需求，影响验收、审计和 Agent 理解业务目标。",
            "sop work export --json",
            "补齐 req_id/source_report_id 与验收标准",
        )
    if stale_reqs:
        add_risk(
            "priority-requirements-not-ready",
            "requirements",
            "medium",
            f"{len(stale_reqs)} 个高优需求仍未进入交付",
            "高优需求停留在需求池会让任务调度缺少输入，建议智能评审后拆解任务。",
            "sop requirement list --priority P0 --json",
            "评审高优需求并生成任务",
        )
    if not (summary.get("design_docs") or {}).get("count"):
        add_risk(
            "missing-design-docs",
            "design",
            "medium",
            "缺少技术方案资产",
            "没有技术方案会降低 AI CLI 自主开发时的上下文质量，建议补齐架构、接口和数据设计。",
            "sop pages manifest --write",
            "生成或补齐技术方案文档",
        )
    missing_repo = [name for name, ok in {"Dockerfile": repo.get("dockerfile"), "Compose": repo.get("compose"), "specs/": repo.get("specs_dir")}.items() if not ok]
    if missing_repo:
        add_risk(
            "repo-delivery-hints-missing",
            "repo",
            "low",
            "仓库交付线索不完整",
            f"缺少 {', '.join(missing_repo)}，会影响部署、环境运维和 Agent 执行前检查。",
            "sop doctor --json",
            "补齐部署与规约入口",
        )

    score = max(0, 100 - sum(_severity_score(str(r.get("severity") or "")) for r in risks))
    commands = [
        {"id": "flow-summary", "category": "inspect", "command": "sop dev-flow ops-plan --json"},
        {"id": "work-export", "category": "context", "command": "sop work export --json"},
        {"id": "task-schedule", "category": "dispatch", "command": "sop task schedule-insights --include-blocked --json"},
        {"id": "dependency-governance", "category": "dispatch", "command": "sop task dep-tasks --json"},
        {"id": "doctor", "category": "ops", "command": "sop doctor --json"},
    ]
    stages = [
        {"id": "intake", "name": "需求接入", "count": len(reqs), "status": "watch" if stale_reqs else "healthy"},
        {"id": "planning", "name": "迭代计划", "count": len(sprints), "status": "healthy" if active_sprint else "risk"},
        {"id": "execution", "name": "任务执行", "count": total_tasks, "status": "risk" if blocked_tasks else "healthy"},
        {"id": "quality", "name": "质量收敛", "count": len(open_issues), "status": "risk" if critical_issues else "watch" if open_issues else "healthy"},
        {"id": "release", "name": "部署运维", "count": 3 - len(missing_repo), "status": "watch" if missing_repo else "healthy"},
    ]
    return {
        "ok": True,
        "scope": {
            "tenant_code": resolved_tenant_id(),
            "business_code": resolved_business_code(),
            "project_id": resolved_project_id(),
        },
        "health": {
            "score": score,
            "grade": "excellent" if score >= 90 else "good" if score >= 75 else "watch" if score >= 60 else "risk",
        },
        "summary": {
            "requirements": len(reqs),
            "tasks": total_tasks,
            "linked_tasks": linked_tasks,
            "open_issues": len(open_issues),
            "critical_issues": len(critical_issues),
            "blocked_tasks": len(blocked_tasks),
            "active_sprint": bool(active_sprint),
            "sprint_completion": sprint_progress.get("completion_rate", 0),
        },
        "stages": stages,
        "risks": risks,
        "commands": commands,
        "task_candidates": [
            {
                "id": r["id"],
                "category": r["category"],
                "severity": r["severity"],
                "title": f"研发流程治理：{r['title']}",
                "summary": r["detail"],
                "action": r["action"],
                "command": r["command"],
            }
            for r in risks
        ],
        "agent_packet": {
            "goal": "保障需求-任务-质量-发布研发主链路健康，给 AI CLI/Agent 提供下一步治理入口。",
            "read_apis": ["/api/v1/dev-flow/summary", "/api/v1/dev-flow/ops-plan"],
            "write_apis": ["/api/v1/dev-flow/ops-tasks"],
            "cli": ["sop dev-flow ops-plan --json", "sop dev-flow ops-tasks --json"],
        },
    }


@router.get("/ops-plan")
def dev_flow_ops_plan() -> Dict[str, Any]:
    return _dev_flow_ops_plan()


@router.get("/lifecycle")
def dev_flow_lifecycle() -> Dict[str, Any]:
    plan = _dev_flow_ops_plan()
    summary = plan.get("summary") or {}
    stage_defs = [
        {
            "id": "requirement_decomposition",
            "label": "需求拆解",
            "status": "ready" if summary.get("requirements", 0) else "watch",
            "inputs": ["requirement pool", "business context", "acceptance criteria"],
            "outputs": ["task candidates", "scope packet", "review checklist"],
            "cli": "sop requirement list --json",
        },
        {
            "id": "tdd_first",
            "label": "TDD 测试先行",
            "status": "ready",
            "inputs": ["acceptance criteria", "risk areas"],
            "outputs": ["red tests", "test command", "quality bar"],
            "cli": "sop dev-flow lifecycle --json",
        },
        {
            "id": "agent_claim",
            "label": "Agent 领取与执行包",
            "status": "watch" if summary.get("blocked_tasks", 0) else "ready",
            "inputs": ["task queue", "skills runtime", "tools", "permissions"],
            "outputs": ["claim", "heartbeat", "evidence packet"],
            "cli": "sop task schedule-insights --include-blocked --json",
        },
        {
            "id": "graph_loop_dispatch",
            "label": "Graph Loop 调度",
            "status": "ready",
            "inputs": ["DAG nodes", "human interrupt", "events"],
            "outputs": ["graph run", "resume signal", "rollback plan"],
            "cli": "sop graph-loop summary --json",
        },
        {
            "id": "quality_evaluation",
            "label": "质量评估",
            "status": "risk" if summary.get("critical_issues", 0) else "ready",
            "inputs": ["pytest", "vitest", "typecheck", "scope scan"],
            "outputs": ["quality report", "release decision"],
            "cli": "sop system readiness --full --json",
        },
        {
            "id": "retrospective_distill",
            "label": "复盘蒸馏",
            "status": "ready",
            "inputs": ["audit", "trace", "agent evidence", "operator notes"],
            "outputs": ["memory facts", "kb snippets", "runbook"],
            "cli": "sop memory recent --json",
        },
    ]
    item_summary = summarize_items(stage_defs)
    return unified_payload(
        summary={
            "ok": item_summary["risk"] == 0,
            **item_summary,
            "requirements": summary.get("requirements", 0),
            "tasks": summary.get("tasks", 0),
            "open_issues": summary.get("open_issues", 0),
            "blocked_tasks": summary.get("blocked_tasks", 0),
            "lifecycle": "requirement -> TDD -> agent claim -> graph loop -> quality -> memory",
        },
        items=stage_defs,
        actions=[
            {"id": "ops-plan", "label": "读取研发治理计划", "method": "GET", "path": "/api/v1/dev-flow/ops-plan", "risk": "low"},
            {"id": "ops-tasks", "label": "治理风险任务化", "method": "POST", "path": "/api/v1/dev-flow/ops-tasks", "risk": "medium"},
            {"id": "graph-loop", "label": "创建 Graph Loop", "method": "POST", "path": "/api/v1/graph-loop/runs", "risk": "medium"},
        ],
        cli=[
            {"id": "read", "command": "sop dev-flow lifecycle --json"},
            {"id": "dry-run", "command": "sop dev-flow ops-tasks --json"},
            {"id": "apply", "command": "sop dev-flow ops-tasks --apply --json"},
            {"id": "graph-loop", "command": "sop graph-loop plan --json"},
            {"id": "doctor", "command": "sop system readiness --full --json"},
        ],
        permissions=[
            {"capability": "delivery.dev-flow", "actions": ["read", "write", "execute", "export"]},
            {"capability": "delivery.tasks", "actions": ["read", "write", "execute"]},
            {"capability": "governance.graph-loop", "actions": ["read", "execute", "approve"]},
        ],
        audit={"event": "dev_flow_lifecycle"},
        agent_consumption={
            "purpose": "Full development lifecycle packet for requirement decomposition, TDD, agent claim, graph-loop dispatch, quality evaluation and retrospective memory.",
            "ops_plan": plan,
            "task_api": "/api/v1/dev-flow/ops-tasks",
            "graph_api": "/api/v1/graph-loop/runs",
        },
    )


@router.post("/ops-tasks")
def dev_flow_ops_tasks(body: DevFlowOpsTasksIn) -> Dict[str, Any]:
    plan = _dev_flow_ops_plan()
    categories = {str(x).strip() for x in body.categories if str(x).strip()}
    candidates = [
        item for item in plan.get("task_candidates") or []
        if not categories or str(item.get("category") or "") in categories
    ][: body.limit]
    planned: List[Dict[str, Any]] = []
    created: List[Dict[str, Any]] = []
    for item in candidates:
        task = {
            "title": item.get("title") or "研发流程治理任务",
            "description": "\n".join([
                str(item.get("summary") or ""),
                "",
                f"Category: {item.get('category')}",
                f"Severity: {item.get('severity')}",
                f"Action: {item.get('action')}",
                "",
                "Suggested command:",
                f"- {item.get('command')}",
            ]),
            "priority": "P0" if item.get("severity") == "high" else body.priority,
            "estimate": "S",
            "assigned_to": body.assigned_to,
            "dev_tool": "sop-cli",
            "source": "dev_flow_ops",
            "source_report_id": str(item.get("id") or ""),
            "source_report_title": str(item.get("title") or ""),
            "debug_notes": f"dev_flow_ops category={item.get('category')} severity={item.get('severity')}",
        }
        planned.append(task)
        if not body.dry_run:
            from .tasks import TaskCreate, create_task

            created.append(create_task(TaskCreate(**task)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "summary": {
            "planned": len(planned),
            "created": len(created),
            "health_score": (plan.get("health") or {}).get("score", 0),
            "risks": len(plan.get("risks") or []),
        },
        "items": planned,
        "created": created,
        "plan_summary": plan.get("summary") or {},
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
    started = _parse_dt(sprint.get("started_at"))
    ends = _parse_dt(sprint.get("ends_at"))
    from .delivery_progress import burndown_observation

    return {
        "ok": True,
        "sprint": sprint,
        "stats": stats,
        **burndown_observation(total, remaining, started, ends),
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
