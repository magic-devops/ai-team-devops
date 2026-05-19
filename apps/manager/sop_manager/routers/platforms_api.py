"""
@module: routers.platforms_api
@purpose: 统一 AI Agent / CLI / IDE 平台注册表与探活
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from sop_manager.path_config import resolved_project_id, resolved_project_path
from sop_manager.platform_registry import load_platform_registry, platform_rows
from .auth_sql import User, current_user
from .sql_models import Task, get_session

router = APIRouter(prefix="/api/v1/platforms", tags=["platforms"])


class PlatformOpsTasksBody(BaseModel):
    dry_run: bool = True
    priority: str = "P1"
    assigned_to: str = "DevOps"
    categories: list[str] = []


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
    runs = agents.agent_runs_summary()
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
            "agent_active_claims": (runs.get("summary") or {}).get("active_claims", 0),
            "agent_success_rate": (runs.get("summary") or {}).get("success_rate", 0),
            "models_custom": len(custom_models),
            "providers": len(providers),
        },
        "domains": [
            {"id": "tools", "path": "#/platforms/tools", "capability": "ecosystem.platforms.tools"},
            {"id": "mcp", "path": "#/platforms/mcp", "capability": "ecosystem.platforms.mcp"},
            {"id": "agents", "path": "#/platforms/agents", "capability": "ecosystem.platforms.agents"},
            {"id": "agent-runs", "path": "#/platforms/agent-runs", "capability": "ecosystem.platforms.agent-runs"},
            {"id": "models", "path": "#/platforms/models", "capability": "ecosystem.platforms.models"},
            {"id": "cli", "path": "#/platforms/cli", "capability": "ecosystem.platforms.cli"},
            {"id": "ops", "path": "#/platforms/ops", "capability": "ecosystem.platforms.ops"},
        ],
    }


def _platform_ops_task_specs(*, priority: str, assigned_to: str, categories: list[str] | None = None) -> list[dict[str, Any]]:
    rows = platform_rows(project_root=resolved_project_path())
    wanted = set(categories or [])
    include_all = not wanted
    specs: list[dict[str, Any]] = []

    def add(category: str, item: dict[str, Any]) -> None:
        if include_all or category in wanted:
            specs.append({**item, "category": category, "priority": priority, "assigned_to": assigned_to, "status": "pending"})

    missing_cli = [r for r in rows if not r.get("cli_available")]
    missing_shim = [r for r in rows if str(r.get("integration")) == "hooks" and not r.get("hook_shim_present")]
    not_ready = [r for r in rows if not r.get("ready")]
    if missing_cli:
        add("toolchain", {
            "id": "missing_cli",
            "title": "补齐 Agent/CLI 工具链可执行文件",
            "description": "安装或配置缺失的 CLI/IDE/Agent 命令，确保 Codex、Claude、Cursor、WorkBuddy、Hermes Agent 可被统一控制平面探活。",
            "estimate": "M",
        })
    if missing_shim:
        add("hooks", {
            "id": "missing_hook_shims",
            "title": "生成缺失的平台 Hook Shim",
            "description": "执行 sop platforms init all 或 install-shims，为 hooks 集成平台写入 sop_hook.py，保证事件、审计和任务上下文可回传。",
            "estimate": "S",
        })
    if not_ready:
        add("readiness", {
            "id": "platform_readiness",
            "title": "修复 Agent 工具链接入就绪度",
            "description": "按平台接入清单补齐入口文件、配置文件、Hook Shim 和 CLI 可用性，让 AI Agent 能稳定读取项目上下文并执行任务。",
            "estimate": "M",
        })
    add("governance", {
        "id": "platform_manifest",
        "title": "刷新 Agent 与工具链接入 Manifest",
        "description": "生成 .sop-runtime/platforms/onboarding.json 和项目上下文包，供 AI CLI/Agent 自动选择能力模块、工具和 MCP 服务。",
        "estimate": "S",
    })
    return specs


@router.get("/ops-plan")
def platforms_ops_plan() -> dict[str, Any]:
    """Agent 与工具链运行治理操作包：给 UI/CLI/Agent 消费的机器可读修复计划。"""
    rows = platform_rows(project_root=resolved_project_path())
    summary = platforms_summary()
    try:
        from sop_manager.routers import agents, mcp_mgr, models as models_router

        mcp = mcp_mgr.mcp_summary()
        ag = agents.agents_summary()
        models = models_router.list_models()
    except Exception:
        mcp, ag, models = {}, {}, {}
    risks = []
    for row in rows:
        if not row.get("ready"):
            risks.append({"level": "high" if row.get("integration") == "hooks" else "medium", "platform_id": row.get("id"), "message": f"{row.get('name') or row.get('id')} 未完全就绪"})
        if row.get("integration") == "hooks" and not row.get("hook_shim_present"):
            risks.append({"level": "medium", "platform_id": row.get("id"), "message": "缺少 Hook Shim，Agent 事件和上下文回传能力不完整"})
    commands = [
        {"id": "doctor", "title": "本地工具链自检", "command": "sop platforms doctor", "category": "diagnose"},
        {"id": "init", "title": "生成全部平台接入配置", "command": "sop platforms init all", "category": "bootstrap"},
        {"id": "context", "title": "刷新 Agent 上下文", "command": "sop context prepare --flush", "category": "context"},
        {"id": "mcp", "title": "安装内置 MCP 服务", "command": "sop mcp install-builtin", "category": "mcp"},
    ]
    return {
        "ok": True,
        "health": {
            "score": round((summary.get("ready", 0) / max(1, summary.get("platforms_total", 0))) * 100, 1),
            "summary": summary,
            "risks": risks,
        },
        "inventory": {
            "platforms": rows,
            "mcp": mcp,
            "agents": ag,
            "models": {
                "default": models.get("default") if isinstance(models, dict) else "",
                "custom": len(models.get("custom_models") or []) if isinstance(models, dict) else 0,
                "providers": len(models.get("providers") or {}) if isinstance(models, dict) else 0,
            },
        },
        "commands": commands,
        "task_candidates": _platform_ops_task_specs(priority="P1", assigned_to="DevOps"),
        "ai_packet": {
            "intent": "agent_toolchain_ops",
            "recommended_pages": ["#/platforms/tools", "#/platforms/mcp", "#/platforms/agents", "#/platforms/models", "#/platforms/ops"],
            "required_context": [".sop-runtime/platforms/onboarding.json", ".sop-runtime/agent_context.json", ".sop-runtime/mcp.json"],
            "next_cli": [cmd["command"] for cmd in commands],
        },
    }


@router.post("/ops-tasks")
def platforms_ops_tasks(body: PlatformOpsTasksBody,
                        user: User = Depends(current_user),
                        db: Session = Depends(get_session)) -> dict[str, Any]:
    """把 Agent 与工具链治理候选项预览或落成任务。"""
    specs = _platform_ops_task_specs(priority=body.priority, assigned_to=body.assigned_to, categories=body.categories)
    existing = {
        t.human_notes
        for t in db.query(Task).filter_by(tenant_id=user.tenant_id).all()
        if (t.human_notes or "").startswith("source=platform_ops;")
    }
    planned, created, skipped = [], [], []
    for spec in specs:
        marker = f"source=platform_ops;item={spec['id']}"
        row = {k: v for k, v in spec.items() if k != "id"}
        row["human_notes"] = marker
        if marker in existing:
            skipped.append({"id": spec["id"], "reason": "task_exists", "title": spec["title"]})
            continue
        planned.append(row)
        if not body.dry_run:
            task = Task(
                id=f"T-{uuid4().hex[:12]}",
                tenant_id=user.tenant_id,
                project_id=resolved_project_id(),
                title=row["title"],
                description=row["description"],
                status="pending",
                priority=row["priority"],
                estimate=row["estimate"],
                assigned_to=row["assigned_to"],
                human_notes=marker,
            )
            db.add(task)
            created.append({"id": task.id, "title": task.title})
    if not body.dry_run:
        db.commit()
    return {"ok": True, "dry_run": body.dry_run, "planned": planned, "created": created, "skipped": skipped, "summary": {"planned": len(planned), "created": len(created), "skipped": len(skipped)}}


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
