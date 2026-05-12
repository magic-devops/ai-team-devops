"""MCP Server 管理：注册、配置、状态"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict
from pathlib import Path
import json, os, subprocess

router = APIRouter(prefix="/api/mcp", tags=["mcp"])
SETTINGS_FILE = Path(os.getenv("PROJECT_PATH", ".")) / ".claude" / "settings.json"

class McpServer(BaseModel):
    name: str; command: str; args: List[str] = []; description: str = ""
    env: Optional[Dict[str, str]] = {}

@router.get("")
def list_mcp():
    if not SETTINGS_FILE.exists(): return []
    try:
        cfg = json.loads(SETTINGS_FILE.read_text())
        servers = cfg.get("mcpServers", {})
        return [{"name": k, **v} for k, v in servers.items()]
    except Exception: return []

@router.post("")
def add_mcp(body: McpServer):
    if not SETTINGS_FILE.exists(): raise HTTPException(404, "settings.json not found")
    cfg = json.loads(SETTINGS_FILE.read_text())
    cfg.setdefault("mcpServers", {})[body.name] = {
        "command": body.command, "args": body.args, "description": body.description
    }
    if body.env: cfg["mcpServers"][body.name]["env"] = body.env
    SETTINGS_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    return {"ok": True}

@router.delete("/{name}")
def remove_mcp(name: str):
    if not SETTINGS_FILE.exists(): raise HTTPException(404, "settings.json not found")
    cfg = json.loads(SETTINGS_FILE.read_text())
    cfg.get("mcpServers", {}).pop(name, None)
    SETTINGS_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    return {"ok": True}

@router.get("/builtin")
def builtin_mcp():
    return [
        {"name":"lancedb","command":"python3","args":["sop/integrations/mcp/lancedb_server.py"],"description":"LanceDB 语义搜索"},
        {"name":"filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."],"description":"文件系统操作"},
        {"name":"git","command":"npx","args":["-y","@modelcontextprotocol/server-git","--repository","."],"description":"Git 操作"},
        {"name":"github","command":"npx","args":["-y","@modelcontextprotocol/server-github"],"description":"GitHub API","env":{"GITHUB_TOKEN":"${GITHUB_TOKEN}"}},
        {"name":"brave-search","command":"npx","args":["-y","@modelcontextprotocol/server-brave-search"],"description":"网络搜索","env":{"BRAVE_API_KEY":"${BRAVE_API_KEY}"}},
    ]
