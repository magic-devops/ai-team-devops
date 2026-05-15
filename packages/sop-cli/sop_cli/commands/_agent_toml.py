"""写入 .sop-runtime/agent.toml 的 manager / auth 字段。"""
from __future__ import annotations

import json
import re
from pathlib import Path


def _patch_key(text: str, key: str, val: str) -> str:
    if not val:
        return text
    pat = rf'^({re.escape(key)}\s*=\s*).*$'
    if re.search(pat, text, flags=re.MULTILINE):
        return re.sub(pat, rf'\1"{val}"', text, count=1, flags=re.MULTILINE)
    return text


def project_id_from_memory(project_path: Path) -> str:
    state = project_path / "memory" / "current_state.json"
    if not state.is_file():
        return ""
    try:
        return str(json.loads(state.read_text(encoding="utf-8")).get("project_id") or "").strip()
    except (OSError, json.JSONDecodeError):
        return ""


def update_agent_toml_manager(
    project_path: Path,
    *,
    project_id: str | None = None,
    tenant_id: str | None = None,
    manager_url: str | None = None,
    auth_method: str | None = None,
) -> bool:
    f = project_path / ".sop-runtime" / "agent.toml"
    if not f.is_file():
        return False
    text = f.read_text(encoding="utf-8")
    if project_id is not None:
        text = _patch_key(text, "project_id", project_id)
    if tenant_id is not None:
        text = _patch_key(text, "tenant_id", tenant_id)
    if manager_url is not None:
        text = _patch_key(text, "url", manager_url.rstrip("/"))
    if auth_method is not None:
        text = _patch_key(text, "method", auth_method)
    f.write_text(text, encoding="utf-8")
    return True
