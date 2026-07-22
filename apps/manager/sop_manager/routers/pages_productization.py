from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from sop_manager.routers.productization_contract import summarize_items, unified_payload
from sop_manager.routers.tasks import TaskCreate, create_task, list_tasks

router = APIRouter(prefix="/api/v1/pages", tags=["pages-productization"])


class InteractionTaskIn(BaseModel):
    ids: list[str] = Field(default_factory=list)
    domain: str = "all"
    status: str = Field("watch", pattern="^(all|ready|watch|risk)$")
    q: str = ""
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Designer"
    max_items: int = Field(12, ge=1, le=100)
    include_ready: bool = False


PRODUCTIZATION_SURFACES = [
    ("metric_summary", "指标摘要", "每页首屏给出规模、健康、风险和最近执行结果"),
    ("search_filter", "筛选搜索", "按领域、状态、负责人、关键字或实体上下文过滤"),
    ("main_workspace", "主工作区", "表格、表单、图谱或编辑区承接主要操作"),
    ("side_action_panel", "右侧操作台", "生成任务、调度、导出、审批、回滚和上下文跳转"),
    ("ai_assistant", "AI 助手", "读取当前实体、筛选、证据和权限后给出可执行建议"),
    ("cli_mapping", "CLI 映射", "read、dry-run、apply、export、doctor 五类命令可复制"),
    ("audit_evidence", "审计证据", "trace、scope、action policy、运行记录和证据链可查"),
]

INTERACTION_STANDARDS = [
    ("summary_metrics", "指标摘要", "首屏提供健康、风险、运行结果或规模摘要，支持快速判断页面状态", 8),
    ("focused_route", "聚焦路由", "页面入口直接进入专业工作台，子能力不依赖多次跳转才能操作", 10),
    ("query_filter", "筛选搜索", "支持按模块、实体、状态、负责人或关键词快速过滤", 8),
    ("primary_workspace", "主工作区", "主要操作落在表格、表单、图谱、编辑器或运行面板中完成", 10),
    ("action_closure", "操作闭环", "右侧或就近操作区可预览、执行、生成任务、调度、导出或回滚", 12),
    ("ai_context", "AI 上下文", "页面上下文可被 Copilot、Agent plan、memory/kb 或 Graph Loop 消费", 10),
    ("cli_command", "CLI 映射", "页面当前筛选条件能映射为 sop CLI read/dry-run/apply/export/doctor 命令", 10),
    ("audit_trace", "审计证据", "关键动作保留 scope、trace、权限策略和运行证据", 10),
    ("permission_feedback", "权限反馈", "读、写、执行、审批、导出、配置分权，并在 UI 中隐藏或禁用动作", 8),
    ("responsive_density", "响应式密度", "桌面端数据密集、移动端自然堆叠，稳定尺寸避免内容跳动", 7),
    ("keyboard_feedback", "键盘与反馈", "提供可达焦点、加载/空/错误状态和操作反馈", 7),
]


def _navigation_registry() -> list[dict[str, Any]]:
    from sop_manager.routers.system_pages import REACT_PAGES

    rows: list[dict[str, Any]] = []
    for page in REACT_PAGES:
        capabilities = [str(page.get("capability") or "")]
        for sub in page.get("submodules") or []:
            if isinstance(sub, dict) and sub.get("capability"):
                capabilities.append(str(sub["capability"]))
        rows.append(
            {
                "id": page.get("id"),
                "label": page.get("name") or page.get("id"),
                "domain": page.get("domain") or "unknown",
                "path": page.get("path"),
                "capability": page.get("capability"),
                "submodules": len(page.get("submodules") or []),
                "status": page.get("status") or "active",
                "ok": bool(page.get("path") and page.get("capability")),
                "surfaces": [surface[0] for surface in PRODUCTIZATION_SURFACES],
                "cli": f"sop pages productize --module {page.get('id')} --dry-run --json",
                "permissions": capabilities,
            }
        )
    return rows


def _filter_navigation_rows(rows: list[dict[str, Any]], *, domain: str = "all", q: str = "") -> list[dict[str, Any]]:
    keyword = (q or "").strip().lower()
    if domain and domain != "all":
        rows = [row for row in rows if row.get("domain") == domain]
    if keyword:
        rows = [
            row
            for row in rows
            if keyword in str(row.get("id") or "").lower()
            or keyword in str(row.get("label") or "").lower()
            or keyword in str(row.get("capability") or "").lower()
        ]
    return rows


def _interaction_checklist(row: dict[str, Any]) -> list[dict[str, Any]]:
    surfaces = set(row.get("surfaces") or [])
    path = str(row.get("path") or "")
    submodules = int(row.get("submodules") or 0)
    permissions = [item for item in row.get("permissions") or [] if item]
    has_focused_path = path.startswith("#/") and (submodules > 0 or path.count("/") >= 2)
    checks: dict[str, tuple[str, str]] = {
        "summary_metrics": ("ready" if "metric_summary" in surfaces else "risk", "productization_surface.metric_summary"),
        "focused_route": ("ready" if has_focused_path else "watch" if path else "risk", f"path={path}, submodules={submodules}"),
        "query_filter": ("ready" if "search_filter" in surfaces else "risk", "productization_surface.search_filter"),
        "primary_workspace": ("ready" if "main_workspace" in surfaces else "risk", "productization_surface.main_workspace"),
        "action_closure": ("ready" if "side_action_panel" in surfaces and submodules > 0 else "watch", f"side_action_panel + submodules={submodules}"),
        "ai_context": ("ready" if "ai_assistant" in surfaces else "risk", "productization_surface.ai_assistant"),
        "cli_command": ("ready" if "cli_mapping" in surfaces and str(row.get("cli") or "").startswith("sop ") else "risk", str(row.get("cli") or "")),
        "audit_trace": ("ready" if "audit_evidence" in surfaces else "risk", "productization_surface.audit_evidence"),
        "permission_feedback": ("ready" if permissions else "risk", ",".join(permissions[:4])),
        "responsive_density": ("watch", "requires frontend build and viewport smoke evidence"),
        "keyboard_feedback": ("watch", "requires keyboard/loading/empty/error smoke evidence"),
    }
    results: list[dict[str, Any]] = []
    for sid, label, requirement, weight in INTERACTION_STANDARDS:
        status, evidence = checks.get(sid, ("risk", "missing interaction signal"))
        results.append(
            {
                "id": sid,
                "label": label,
                "status": status,
                "ok": status == "ready",
                "weight": weight,
                "requirement": requirement,
                "evidence": evidence,
            }
        )
    return results


def _interaction_status(score: float) -> str:
    if score >= 85:
        return "ready"
    if score >= 70:
        return "watch"
    return "risk"


def _interaction_rows(domain: str = "all", q: str = "", status: str = "all") -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in _filter_navigation_rows(_navigation_registry(), domain=domain, q=q):
        checks = _interaction_checklist(row)
        max_score = sum(int(item.get("weight") or 0) for item in checks) or 1
        earned = 0.0
        for item in checks:
            weight = int(item.get("weight") or 0)
            earned += weight if item.get("status") == "ready" else weight * 0.5 if item.get("status") == "watch" else 0
        score = round(earned / max_score * 100, 1)
        interaction_status = _interaction_status(score)
        gaps = [
            {
                "id": item["id"],
                "label": item["label"],
                "status": item["status"],
                "recommendation": item["requirement"],
            }
            for item in checks
            if item.get("status") != "ready"
        ]
        rows.append(
            {
                **row,
                "status": interaction_status,
                "interaction_score": score,
                "interaction_checks": checks,
                "gaps": gaps,
                "primary_gap": gaps[0]["label"] if gaps else "",
                "quick_actions": [
                    f"sop pages productize --module {row.get('id')} --dry-run --json",
                    f"sop pages interaction-analysis --q {row.get('id')} --json",
                    f"sop pages readiness --q {row.get('id')} --json",
                ],
                "analysis_basis": {
                    "mode": "static_registry_contract",
                    "registry": "system_pages.REACT_PAGES",
                    "requires_visual_smoke": any(item.get("status") == "watch" for item in checks),
                },
            }
        )
    if status and status != "all":
        rows = [row for row in rows if row.get("status") == status]
    return rows


def _existing_interaction_task_ids() -> set[str]:
    try:
        existing = list_tasks(source="system_page_interaction")
    except Exception:
        return set()
    return {str(item.get("source_report_id") or "") for item in existing if item.get("source_report_id")}


def _interaction_task_payload(item: dict[str, Any], *, priority: str, assigned_to: str) -> dict[str, Any]:
    module_id = str(item.get("id") or "")
    gaps = [gap for gap in item.get("gaps") or [] if isinstance(gap, dict)]
    checks = [check for check in item.get("interaction_checks") or [] if isinstance(check, dict)]
    analysis_basis = item.get("analysis_basis") or {}
    return {
        "title": f"优化页面交互闭环：{item.get('label') or module_id}",
        "description": "\n".join(
            [
                f"module_id: {module_id}",
                f"path: {item.get('path') or ''}",
                f"domain: {item.get('domain') or ''}",
                f"interaction_status: {item.get('status')}",
                f"interaction_score: {item.get('interaction_score')}",
                "",
                "interaction_gaps:",
                *[
                    f"- {gap.get('id')}: status={gap.get('status')} recommendation={gap.get('recommendation')}"
                    for gap in gaps[:10]
                ],
                "",
                "interaction_checks:",
                *[
                    f"- {check.get('id')}: status={check.get('status')} evidence={check.get('evidence')}"
                    for check in checks[:12]
                ],
                "",
                "required_closure:",
                "- 保持指标摘要、筛选搜索、主工作区、操作台、AI/CLI、权限、审计证据同屏闭环。",
                "- 补足键盘可达、响应式、加载、空状态和错误态 smoke 证据。",
                "",
                "analysis_basis:",
                str(analysis_basis),
            ]
        ).strip(),
        "priority": priority,
        "estimate": "M" if str(item.get("status")) == "risk" else "S",
        "assigned_to": assigned_to or "Designer",
        "dev_tool": "codex",
        "source": "system_page_interaction",
        "source_report_id": f"interaction:{module_id}",
        "source_report_title": str(item.get("label") or module_id),
        "debug_notes": f"Generated from pages interaction analysis: {module_id}",
    }


@router.get("/productization")
def pages_productization(domain: str = "all", q: str = "") -> dict[str, Any]:
    rows = _filter_navigation_rows(_navigation_registry(), domain=domain, q=q)
    summary = summarize_items(rows)
    return unified_payload(
        summary={
            "ok": True,
            **summary,
            "surfaces": len(PRODUCTIZATION_SURFACES),
            "productization_standard": "metrics + filter + workspace + actions + AI + CLI + audit",
        },
        items=rows,
        actions=[
            {"id": "read", "label": "读取页面产品化矩阵", "method": "GET", "path": "/api/v1/pages/productization", "risk": "low"},
            {"id": "interaction-analysis", "label": "页面交互分析", "method": "GET", "path": "/api/v1/pages/interaction-analysis", "risk": "low"},
            {"id": "taskize", "label": "缺口任务化", "method": "POST", "path": "/api/v1/system/pages/readiness/tasks", "risk": "medium"},
            {"id": "action-policy", "label": "模块动作策略", "method": "GET", "path": "/api/v1/system/pages/actions/policy", "risk": "low"},
        ],
        cli=[
            {"id": "read", "command": f"sop pages productize --domain {domain} --q {q} --json"},
            {"id": "analyze", "command": f"sop pages interaction-analysis --domain {domain} --q {q} --json"},
            {"id": "dry-run", "command": "sop pages readiness --status risk --json"},
            {"id": "apply", "command": "sop pages readiness --status risk --json"},
            {"id": "export", "command": "sop pages manifest --write"},
            {"id": "doctor", "command": "sop pages health --json"},
        ],
        permissions=[
            {"capability": "governance.system-map", "actions": ["read", "write", "execute", "export"]},
            {"capability": "system.pages", "actions": ["read", "write", "admin"]},
        ],
        audit={"event": "pages_productization", "filters": {"domain": domain, "q": q}},
        agent_consumption={
            "purpose": "Give Copilot, CLI and Agent plan a module-level productization matrix with page, capability, CLI and audit surfaces.",
            "required_surfaces": [{"id": sid, "label": label, "contract": contract} for sid, label, contract in PRODUCTIZATION_SURFACES],
            "task_api": "/api/v1/system/pages/readiness/tasks",
        },
    )


@router.get("/interaction-analysis")
def pages_interaction_analysis(domain: str = "all", q: str = "", status: str = "all", limit: int = 80) -> dict[str, Any]:
    rows = _interaction_rows(domain=domain, q=q, status=status)
    capped_limit = max(1, min(int(limit or 80), 200))
    total = len(rows)
    ready = sum(1 for row in rows if row.get("status") == "ready")
    watch = sum(1 for row in rows if row.get("status") == "watch")
    risk = sum(1 for row in rows if row.get("status") == "risk")
    avg_score = round(sum(float(row.get("interaction_score") or 0) for row in rows) / max(1, total), 1)
    risk_rows = [row for row in rows if row.get("status") != "ready"]
    return unified_payload(
        summary={
            "ok": risk == 0,
            "total": total,
            "ready": ready,
            "watch": watch,
            "risk": risk,
            "score": avg_score,
            "avg_interaction_score": avg_score,
            "standards": len(INTERACTION_STANDARDS),
            "analysis_mode": "static_registry_contract",
            "visual_smoke_required": sum(1 for row in rows if row.get("analysis_basis", {}).get("requires_visual_smoke")),
        },
        items=rows[:capped_limit],
        actions=[
            {"id": "read", "label": "读取交互分析", "method": "GET", "path": "/api/v1/pages/interaction-analysis", "risk": "low"},
            {"id": "taskize", "label": "将交互缺口任务化", "method": "POST", "path": "/api/v1/pages/interaction-analysis/tasks", "risk": "medium"},
            {"id": "visual-smoke", "label": "运行页面视觉 smoke", "method": "CLI", "path": "sop pages health --json", "risk": "low"},
        ],
        cli=[
            {"id": "read", "command": f"sop pages interaction-analysis --domain {domain} --q {q} --status {status} --json"},
            {"id": "risk", "command": f"sop pages interaction-analysis --domain {domain} --q {q} --status risk --json"},
            {"id": "watch", "command": f"sop pages interaction-analysis --domain {domain} --q {q} --status watch --json"},
            {"id": "taskize", "command": f"sop pages interaction-tasks --domain {domain} --q {q} --status watch --dry-run --json"},
            {"id": "doctor", "command": "sop pages health --json"},
        ],
        permissions=[
            {"capability": "governance.system-map", "actions": ["read", "write", "execute", "export"]},
            {"capability": "system.pages", "actions": ["read", "write", "admin"]},
        ],
        audit={
            "event": "pages_interaction_analysis",
            "filters": {"domain": domain, "q": q, "status": status, "limit": capped_limit},
            "evidence": {"standards": [sid for sid, *_ in INTERACTION_STANDARDS], "risk_rows": len(risk_rows)},
        },
        agent_consumption={
            "purpose": "Give Copilot, CLI and Agent plan a fast page-interaction risk matrix grounded in the module registry, page productization contract, CLI mapping, permissions and audit signals.",
            "api": "/api/v1/pages/interaction-analysis",
            "cli": "sop pages interaction-analysis --json",
            "standards": [{"id": sid, "label": label, "requirement": requirement, "weight": weight} for sid, label, requirement, weight in INTERACTION_STANDARDS],
            "next_task_api": "/api/v1/pages/interaction-analysis/tasks",
            "evidence_boundary": "Static registry analysis; visual, keyboard and loading-state proof still requires targeted browser smoke.",
        },
        extra={
            "standards": [{"id": sid, "label": label, "requirement": requirement, "weight": weight} for sid, label, requirement, weight in INTERACTION_STANDARDS],
        },
    )


@router.post("/interaction-analysis/tasks")
def pages_interaction_tasks(body: InteractionTaskIn) -> dict[str, Any]:
    status = body.status if body.status in {"all", "ready", "watch", "risk"} else "watch"
    rows = _interaction_rows(domain=body.domain, q=body.q, status=status)
    selected = {str(item) for item in body.ids or [] if str(item).strip()}
    if selected:
        rows = [item for item in rows if str(item.get("id") or "") in selected]
    if not body.include_ready:
        rows = [item for item in rows if str(item.get("status") or "") != "ready"]
    rows = rows[: max(1, min(int(body.max_items or 12), 100))]
    existing_ids = _existing_interaction_task_ids()
    planned: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in rows:
        payload_item = _interaction_task_payload(item, priority=body.priority, assigned_to=body.assigned_to)
        report_id = str(payload_item.get("source_report_id") or "")
        if report_id in existing_ids:
            skipped.append({"id": str(item.get("id") or ""), "reason": "task_exists", "title": payload_item["title"]})
            continue
        planned.append(payload_item)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**payload_item)))
            existing_ids.add(report_id)
    return unified_payload(
        summary={
            "ok": True,
            "planned": len(planned),
            "created": len(created),
            "skipped": len(skipped),
            "dry_run": body.dry_run,
        },
        items=planned,
        actions=[
            {"id": "preview", "label": "预览交互治理任务", "method": "POST", "path": "/api/v1/pages/interaction-analysis/tasks", "risk": "low"},
            {"id": "create", "label": "生成交互治理任务", "method": "POST", "path": "/api/v1/pages/interaction-analysis/tasks", "risk": "medium"},
            {"id": "tasks", "label": "查看任务中心", "method": "NAVIGATE", "path": "#/tasks", "risk": "low"},
        ],
        cli=[
            {"id": "preview", "command": f"sop pages interaction-tasks --domain {body.domain} --q {body.q} --status {status} --dry-run --json"},
            {"id": "create", "command": f"sop pages interaction-tasks --domain {body.domain} --q {body.q} --status {status} --create --json"},
        ],
        permissions=[
            {"capability": "governance.system-map", "actions": ["read", "write", "execute"]},
            {"capability": "system.pages", "actions": ["read", "write", "admin"]},
        ],
        audit={
            "event": "pages_interaction_tasks",
            "filters": {
                "ids": sorted(selected),
                "domain": body.domain,
                "q": body.q,
                "status": status,
                "include_ready": body.include_ready,
                "max_items": body.max_items,
            },
            "created": [item.get("id") for item in created],
            "skipped": skipped,
        },
        agent_consumption={
            "purpose": "Turn page interaction analysis gaps into idempotent governance tasks for designers, frontend engineers and AI agents.",
            "source": "system_page_interaction",
            "api": "/api/v1/pages/interaction-analysis/tasks",
            "cli": "sop pages interaction-tasks --dry-run --json",
            "task_center": "#/tasks",
            "fields": ["items.source_report_id", "items.description", "summary.planned", "summary.created", "audit.skipped"],
        },
        extra={"dry_run": body.dry_run, "planned": planned, "created": created, "skipped": skipped},
    )
