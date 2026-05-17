"""MCP Server 管理：注册、配置、模板、摘要和 Agent/CLI 接入导出。"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any, Optional, List, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_project_id, resolved_project_path, resolved_tenant_id

try:
    from .webhook import notify_webhook
except Exception:  # pragma: no cover
    notify_webhook = None

router = APIRouter(prefix="/api/v1/mcp", tags=["mcp"])

_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$")


def _settings_file() -> Path:
    return resolved_project_path() / ".claude" / "settings.json"


def _safe_name(value: str) -> str:
    name = (value or "").strip()
    if not _NAME_RE.match(name):
        raise HTTPException(400, f"非法 MCP Server 名称: {value}")
    return name


def _load_cfg(create: bool = True) -> dict[str, Any]:
    p = _settings_file()
    if not p.exists():
        if not create:
            return {"mcpServers": {}}
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"mcpServers": {}}, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raw = {}
    except Exception:
        raw = {}
    raw.setdefault("mcpServers", {})
    if not isinstance(raw["mcpServers"], dict):
        raw["mcpServers"] = {}
    return raw


def _save_cfg(cfg: dict[str, Any]) -> None:
    p = _settings_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def _mask_env(env: dict[str, str] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in (env or {}).items():
        if any(s in k.upper() for s in ("KEY", "TOKEN", "SECRET", "PASSWORD")) and v and not str(v).startswith("${"):
            out[k] = "***"
        else:
            out[k] = str(v)
    return out


def _emit(event: str, payload: dict[str, Any]) -> None:
    if notify_webhook is None:
        return
    try:
        notify_webhook(event, payload, tenant_id=resolved_tenant_id(), project_id=resolved_project_id())
    except Exception:
        pass


class McpServer(BaseModel):
    name: str = Field(..., min_length=2, max_length=64)
    command: str = Field(..., min_length=1, max_length=240)
    args: List[str] = Field(default_factory=list)
    description: str = Field("", max_length=1000)
    env: Optional[Dict[str, str]] = Field(default_factory=dict)
    enabled: bool = True
    tags: List[str] = Field(default_factory=list)


def _builtin_items() -> list[dict[str, Any]]:
    return [
        {"name":"tasks","command":"python3","args":["ai-sop-ops/integrations/mcp/tasks_server.py"],"description":"需求、任务、迭代、问题统一读写","tags":["delivery","sop"]},
        {"name":"knowledge","command":"python3","args":["ai-sop-ops/integrations/mcp/knowledge_server.py"],"description":"知识库、RAG、规约与规则检索","tags":["knowledge","rag"]},
        {"name":"audit","command":"python3","args":["ai-sop-ops/integrations/mcp/audit_server.py"],"description":"审计链、事件、合规证据查询","tags":["audit","governance"]},
        {"name":"lancedb","command":"python3","args":["ai-sop-ops/integrations/mcp/lancedb_server.py"],"description":"LanceDB 语义搜索","tags":["vector","memory"]},
        {"name":"filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."],"description":"文件系统操作","tags":["files"]},
        {"name":"git","command":"npx","args":["-y","@modelcontextprotocol/server-git","--repository","."],"description":"Git 操作","tags":["dev"]},
        {"name":"github","command":"npx","args":["-y","@modelcontextprotocol/server-github"],"description":"GitHub API","env":{"GITHUB_TOKEN":"${GITHUB_TOKEN}"},"tags":["devops","remote"]},
        {"name":"brave-search","command":"npx","args":["-y","@modelcontextprotocol/server-brave-search"],"description":"网络搜索","env":{"BRAVE_API_KEY":"${BRAVE_API_KEY}"},"tags":["search"]},
    ]


def _row(name: str, item: dict[str, Any]) -> dict[str, Any]:
    command = str(item.get("command") or "")
    args = item.get("args") if isinstance(item.get("args"), list) else []
    return {
        "name": name,
        "command": command,
        "args": [str(x) for x in args],
        "description": str(item.get("description") or ""),
        "env": _mask_env(item.get("env") or {}),
        "enabled": bool(item.get("enabled", True)),
        "tags": item.get("tags") if isinstance(item.get("tags"), list) else [],
        "command_available": bool(shutil.which(command)) if command else False,
        "runtime": "node" if command in ("npx", "node") else ("python" if command.startswith("python") else "binary"),
    }

@router.get("")
def list_mcp():
    cfg = _load_cfg(create=True)
    servers = cfg.get("mcpServers", {})
    return [_row(k, v) for k, v in sorted(servers.items())]


@router.get("/summary")
def mcp_summary():
    items = list_mcp()
    return {
        "ok": True,
        "total": len(items),
        "enabled": sum(1 for x in items if x.get("enabled")),
        "available": sum(1 for x in items if x.get("command_available")),
        "with_env": sum(1 for x in items if x.get("env")),
        "settings_file": str(_settings_file()),
    }

@router.post("")
def add_mcp(body: McpServer):
    name = _safe_name(body.name)
    cfg = _load_cfg(create=True)
    item: dict[str, Any] = {
        "command": body.command.strip(),
        "args": [str(x) for x in (body.args or [])],
        "description": body.description or "",
        "enabled": body.enabled,
        "tags": body.tags or [],
    }
    if body.env:
        item["env"] = {str(k): str(v) for k, v in body.env.items()}
    cfg.setdefault("mcpServers", {})[name] = item
    _save_cfg(cfg)
    _emit("mcp.upserted", {"name": name, "command": item["command"], "enabled": item["enabled"]})
    return {"ok": True, "name": name}


@router.post("/install-builtin/{name}")
def install_builtin(name: str):
    name = _safe_name(name)
    item = next((x for x in _builtin_items() if x.get("name") == name), None)
    if not item:
        raise HTTPException(404, "未知内置 MCP Server")
    cfg = _load_cfg(create=True)
    cfg.setdefault("mcpServers", {})[name] = {k: v for k, v in item.items() if k != "name"}
    _save_cfg(cfg)
    _emit("mcp.builtin_installed", {"name": name})
    return {"ok": True, "name": name}


@router.post("/install-builtin")
def install_all_builtin():
    cfg = _load_cfg(create=True)
    created: list[str] = []
    skipped: list[str] = []
    servers = cfg.setdefault("mcpServers", {})
    for item in _builtin_items():
        name = str(item["name"])
        if name in servers:
            skipped.append(name)
            continue
        servers[name] = {k: v for k, v in item.items() if k != "name"}
        created.append(name)
    _save_cfg(cfg)
    _emit("mcp.builtin_installed_all", {"created": created, "skipped": skipped})
    return {"ok": True, "created": created, "skipped": skipped}

@router.delete("/{name}")
def remove_mcp(name: str):
    name = _safe_name(name)
    cfg = _load_cfg(create=False)
    removed = cfg.get("mcpServers", {}).pop(name, None) is not None
    _save_cfg(cfg)
    if removed:
        _emit("mcp.deleted", {"name": name})
    return {"ok": True, "removed": removed}

@router.get("/builtin")
def builtin_mcp():
    return [_row(str(x["name"]), {k: v for k, v in x.items() if k != "name"}) for x in _builtin_items()]


@router.get("/profile")
def mcp_profile():
    cfg = _load_cfg(create=True)
    enabled = {
        name: item
        for name, item in cfg.get("mcpServers", {}).items()
        if bool(item.get("enabled", True))
    }
    return {
        "ok": True,
        "schema": "sop.mcp-profile.v1",
        "tenant_id": resolved_tenant_id(),
        "project_id": resolved_project_id(),
        "settings_file": str(_settings_file()),
        "mcpServers": enabled,
        "client_hints": {
            "claude": ".claude/settings.json",
            "codex": ".sop-runtime/mcp.json",
            "cursor": ".cursor/mcp.json",
        },
        "commands": {
            "prepare_context": "sop context prepare --flush",
            "install_builtin": "sop mcp install-builtin",
        },
    }
