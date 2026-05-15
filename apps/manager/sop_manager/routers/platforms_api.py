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
