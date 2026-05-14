"""
研发全流程可视化聚合：单接口汇总需求/任务/问题/迭代/方案/环境线索，
供「研发流」页面低 Token 展示与跳转，避免多轮拉数。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter

from path_config import resolved_ai_memory_root, resolved_project_path
from .db_sql_compat import rows

router = APIRouter(prefix="/api/dev-flow", tags=["dev-flow"])


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
        "design_docs": {"count": _design_docs_count()},
        "agents": {"definitions": _count_agents(), "groups": _count_groups()},
        "repo_hints": {
            "dockerfile": (resolved_project_path() / "Dockerfile").exists(),
            "compose": (resolved_project_path() / "docker-compose.yml").exists()
            or (resolved_project_path() / "compose.yaml").exists(),
            "specs_dir": (resolved_project_path() / "specs").is_dir(),
        },
    }
