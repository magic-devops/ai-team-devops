"""
@module: routers.platforms_api
@purpose: 统一 AI Agent / CLI / IDE 平台注册表与探活
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from sop_manager.path_config import resolved_project_path
from sop_manager.platform_registry import load_platform_registry, platform_rows

router = APIRouter(prefix="/api/v1/platforms", tags=["platforms"])


@router.get("/health")
def platforms_health() -> dict[str, Any]:
    reg = load_platform_registry()
    return {"ok": True, "service": "platforms", "count": len(reg.get("platforms") or [])}


@router.get("")
def list_platforms() -> dict[str, Any]:
    root = resolved_project_path()
    rows = platform_rows(project_root=root)
    return {"ok": True, "project_root": str(root), "platforms": rows}


@router.get("/summary")
def platforms_summary() -> dict[str, Any]:
    rows = platform_rows(project_root=resolved_project_path())
    return {
        "ok": True,
        "platforms_total": len(rows),
        "cli_available": sum(1 for r in rows if r.get("cli_available")),
        "ready": sum(1 for r in rows if r.get("ready")),
        "hook_shim_present": sum(1 for r in rows if r.get("hook_shim_present")),
        "config_present": sum(1 for r in rows if r.get("config_present")),
    }


@router.get("/charts")
def platforms_charts() -> dict[str, Any]:
    rows = platform_rows(project_root=resolved_project_path())
    ready = sum(1 for r in rows if r.get("ready"))
    cli_ok = sum(1 for r in rows if r.get("cli_available"))
    shim_ok = sum(1 for r in rows if r.get("hook_shim_present"))
    total = len(rows) or 1
    return {
        "ok": True,
        "readiness": [
            {"name": "ready", "value": ready},
            {"name": "not_ready", "value": max(0, len(rows) - ready)},
        ],
        "cli": [
            {"name": "cli_available", "value": cli_ok},
            {"name": "cli_missing", "value": max(0, len(rows) - cli_ok)},
        ],
        "hooks": [
            {"name": "shim_present", "value": shim_ok},
            {"name": "shim_missing", "value": max(0, len(rows) - shim_ok)},
        ],
        "platforms": [
            {
                "id": str(r.get("id") or ""),
                "label": str(r.get("name") or r.get("id") or ""),
                "ready": bool(r.get("ready")),
                "cli_available": bool(r.get("cli_available")),
                "score": round(
                    (int(bool(r.get("ready"))) + int(bool(r.get("cli_available"))) + int(bool(r.get("hook_shim_present"))))
                    / 3
                    * 100,
                    1,
                ),
            }
            for r in rows
        ],
    }


@router.get("/hub")
def platforms_hub() -> dict[str, Any]:
    """Agent 平台治理中心：CLI 探活、MCP、Agent、模型一站式入口。"""
    plat = platforms_summary()
    from sop_manager.routers import agents, mcp_mgr, models as models_router

    mcp = mcp_mgr.mcp_summary()
    ag = agents.agents_summary()
    model_cfg = models_router.list_models()
    custom_models = model_cfg.get("custom_models") if isinstance(model_cfg.get("custom_models"), list) else []
    providers = model_cfg.get("providers") if isinstance(model_cfg.get("providers"), dict) else {}
    return {
        "ok": True,
        "summary": {
            **{k: v for k, v in plat.items() if k != "ok"},
            "mcp_total": mcp.get("total", 0),
            "mcp_enabled": mcp.get("enabled", 0),
            "agents": ag.get("agents", 0),
            "agent_groups": ag.get("groups", 0),
            "models_custom": len(custom_models),
            "providers": len(providers),
        },
        "domains": [
            {"id": "tools", "path": "#/platforms/tools", "capability": "ecosystem.platforms.tools"},
            {"id": "mcp", "path": "#/platforms/mcp", "capability": "ecosystem.platforms.mcp"},
            {"id": "agents", "path": "#/platforms/agents", "capability": "ecosystem.platforms.agents"},
            {"id": "models", "path": "#/platforms/models", "capability": "ecosystem.platforms.models"},
            {"id": "cli", "path": "#/platforms/cli", "capability": "ecosystem.platforms.cli"},
        ],
    }


@router.get("/registry")
def raw_registry() -> dict[str, Any]:
    return load_platform_registry()


@router.post("/install-shims/{platform_id}")
def install_shims(platform_id: str) -> dict[str, Any]:
    """写入缺失的 hook shim（不覆盖已有 hooks.json）。"""
    reg = load_platform_registry()
    plat = next((p for p in (reg.get("platforms") or []) if p.get("id") == platform_id), None)
    if not plat:
        raise HTTPException(404, f"未知平台: {platform_id}")
    shim_rel = str(plat.get("hook_shim") or "")
    if not shim_rel:
        raise HTTPException(400, "该平台无 hook_shim 定义")
    root = resolved_project_path()
    gen = root / "ai-sop-ops" / "platforms" / "sop_hook_shim.py"
    if not gen.is_file():
        raise HTTPException(503, "缺少 ai-sop-ops/platforms/sop_hook_shim.py")
    dest_dir = (root / shim_rel).parent
    r = subprocess.run(
        ["python3", str(gen), platform_id, str(dest_dir)],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if r.returncode != 0:
        raise HTTPException(500, r.stderr or r.stdout or "shim 生成失败")
    return {"ok": True, "platform_id": platform_id, "shim": shim_rel, "output": r.stdout.strip()}
