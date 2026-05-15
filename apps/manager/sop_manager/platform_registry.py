"""
@module: sop_manager.platform_registry
@purpose: 加载 ai-sop-ops/platforms/registry.json，供 API / CLI 统一列举 Agent 平台
"""
from __future__ import annotations

import json
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


@lru_cache(maxsize=1)
def load_platform_registry() -> dict[str, Any]:
    path = _repo_root() / "ai-sop-ops" / "platforms" / "registry.json"
    if not path.is_file():
        return {"version": "0", "platforms": []}
    return json.loads(path.read_text(encoding="utf-8"))


def platform_rows(*, project_root: Path | None = None) -> list[dict[str, Any]]:
    """合并注册表 + 本地配置文件存在性 + CLI 是否在 PATH。"""
    reg = load_platform_registry()
    root = (project_root or _repo_root()).resolve()
    rows: list[dict[str, Any]] = []
    for p in reg.get("platforms") or []:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "")
        cmd = str(p.get("cli_cmd") or "").strip()
        configs = [str(x) for x in (p.get("config_paths") or [])]
        entries = [str(x) for x in (p.get("entry_files") or [])]
        shim = str(p.get("hook_shim") or "")
        rows.append(
            {
                **p,
                "cli_available": bool(cmd) and bool(shutil.which(cmd.split()[0])),
                "config_present": [c for c in configs if (root / c).exists()],
                "entry_present": [e for e in entries if (root / e).exists()],
                "hook_shim_present": bool(shim) and (root / shim).is_file(),
                "ready": any((root / e).exists() for e in entries),
            }
        )
    return rows
