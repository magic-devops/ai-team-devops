from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from sop_manager.routers.productization_contract import summarize_items, unified_payload

router = APIRouter(prefix="/api/v1/plugins", tags=["plugins-governance"])


def _loaded_plugins() -> list[dict[str, Any]]:
    from sop_manager.routers import plugin_loader

    rows: list[dict[str, Any]] = []
    for plugin in plugin_loader.list_plugins():
        instance = plugin.instance
        tool_count = 0
        router_count = 0
        command_count = 0
        try:
            router_count = len(instance.routers() or []) if hasattr(instance, "routers") else 0
        except Exception as exc:
            plugin.errors.append(f"routers.inspect: {exc}")
        try:
            command_count = len(instance.cli_commands() or []) if hasattr(instance, "cli_commands") else 0
        except Exception as exc:
            plugin.errors.append(f"cli.inspect: {exc}")
        tool_count = router_count + command_count
        rows.append(
            {
                "id": plugin.name,
                "name": plugin.name,
                "version": plugin.version,
                "entry_point": plugin.entry_point,
                "routers": router_count,
                "cli_commands": command_count,
                "tools": tool_count,
                "status": "risk" if plugin.errors else "ready",
                "ok": not plugin.errors,
                "errors": plugin.errors,
                "policy": {
                    "visibility": "tenant-scoped",
                    "tool_whitelist_required": True,
                    "sensitive_action_approval": True,
                    "audit_required": True,
                    "retry_policy": "bounded",
                },
            }
        )
    return rows


@router.get("/governance")
def plugins_governance(q: str = "") -> dict[str, Any]:
    rows = _loaded_plugins()
    keyword = (q or "").strip().lower()
    if keyword:
        rows = [
            row
            for row in rows
            if keyword in str(row.get("id") or "").lower()
            or keyword in str(row.get("entry_point") or "").lower()
        ]
    summary = summarize_items(rows)
    return unified_payload(
        summary={
            "ok": True,
            **summary,
            "plugins": len(rows),
            "policy_mode": "capability + ABAC + action policy + audit",
        },
        items=rows,
        actions=[
            {"id": "read", "label": "查看插件治理", "method": "GET", "path": "/api/v1/plugins/governance", "risk": "low"},
            {"id": "approve", "label": "敏感动作审批", "method": "GET", "path": "/api/v1/system/pages/actions/approvals", "risk": "medium"},
            {"id": "audit", "label": "查看审计链", "method": "GET", "path": "/api/v1/audit", "risk": "low"},
        ],
        cli=[
            {"id": "read", "command": f"sop plugins governance --q {q} --json"},
            {"id": "doctor", "command": "sop system readiness --full --json"},
            {"id": "policy", "command": "sop pages capabilities --json"},
        ],
        permissions=[
            {"capability": "ecosystem.plugins", "actions": ["read", "execute", "approve", "configure", "export"]},
            {"capability": "governance.system-map.actions", "actions": ["read", "approve"]},
        ],
        audit={"event": "plugins_governance", "filters": {"q": q}},
        agent_consumption={
            "purpose": "Expose plugin and MCP governance for tool whitelist, sensitive action approval, retry, audit and uninstall impact analysis.",
            "failure_recovery": ["inspect plugin.errors", "disable unsafe tools through policy", "retry bounded actions", "taskize uninstall impact"],
            "policy_contract": ["visibility", "tool_whitelist_required", "sensitive_action_approval", "audit_required", "retry_policy"],
        },
    )
