from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from sop_manager.routers.productization_contract import summarize_items, unified_payload

router = APIRouter(prefix="/api/v1/pages", tags=["pages-productization"])


PRODUCTIZATION_SURFACES = [
    ("metric_summary", "指标摘要", "每页首屏给出规模、健康、风险和最近执行结果"),
    ("search_filter", "筛选搜索", "按领域、状态、负责人、关键字或实体上下文过滤"),
    ("main_workspace", "主工作区", "表格、表单、图谱或编辑区承接主要操作"),
    ("side_action_panel", "右侧操作台", "生成任务、调度、导出、审批、回滚和上下文跳转"),
    ("ai_assistant", "AI 助手", "读取当前实体、筛选、证据和权限后给出可执行建议"),
    ("cli_mapping", "CLI 映射", "read、dry-run、apply、export、doctor 五类命令可复制"),
    ("audit_evidence", "审计证据", "trace、scope、action policy、运行记录和证据链可查"),
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


@router.get("/productization")
def pages_productization(domain: str = "all", q: str = "") -> dict[str, Any]:
    rows = _navigation_registry()
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
            {"id": "taskize", "label": "缺口任务化", "method": "POST", "path": "/api/v1/system/pages/readiness/tasks", "risk": "medium"},
            {"id": "action-policy", "label": "模块动作策略", "method": "GET", "path": "/api/v1/system/pages/actions/policy", "risk": "low"},
        ],
        cli=[
            {"id": "read", "command": f"sop pages productize --domain {domain} --q {q} --json"},
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
