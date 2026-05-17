"""Agent 管理：定义、专家组、A2A 配置与标准接入 Profile。"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root, resolved_project_id, resolved_tenant_id

try:
    from .webhook import notify_webhook
except Exception:  # pragma: no cover - legacy import fallback
    notify_webhook = None

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$")


def _agents_dir() -> Path:
    d = resolved_ai_memory_root() / "agents"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_id(value: str, label: str = "ID") -> str:
    v = (value or "").strip()
    if not _ID_RE.match(v):
        raise HTTPException(400, f"非法 {label}: {value}")
    return v


def _agent_path(agent_id: str) -> Path:
    return _agents_dir() / f"agent_{_safe_id(agent_id, 'Agent ID')}.json"


def _group_path(group_id: str) -> Path:
    return _agents_dir() / f"group_{_safe_id(group_id, 'Group ID')}.json"


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else None
    except Exception:
        return None


def _dump_model(body: BaseModel) -> dict[str, Any]:
    try:
        return body.model_dump()
    except AttributeError:
        return body.dict()


def _emit(event: str, payload: dict[str, Any]) -> None:
    if notify_webhook is None:
        return
    try:
        notify_webhook(event, payload, tenant_id=resolved_tenant_id(), project_id=resolved_project_id())
    except Exception:
        pass


class AgentDef(BaseModel):
    id: str = Field(..., min_length=2, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    role: str = Field(..., min_length=1, max_length=80)
    description: str = Field("", max_length=2000)
    model: str = "claude-opus-4-7"; port: Optional[int] = None
    skills: List[str] = Field(default_factory=list)
    specs_to_load: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=lambda: ["sop-cli"])
    mcp_servers: List[str] = Field(default_factory=list)
    system_prompt: Optional[str] = Field("", max_length=12000)
    a2a_enabled: bool = False
    enabled: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)

class AgentGroup(BaseModel):
    id: str = Field(..., min_length=2, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field("", max_length=2000)
    agents: List[str] = Field(default_factory=list)
    mode: str = Field("sequential", pattern="^(sequential|parallel|review-gate|swarm)$")
    entry_agent: Optional[str] = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


def _builtin_agent_defs() -> list[dict[str, Any]]:
    return [
        {"id":"orchestrator","name":"Orchestrator","role":"编排者","description":"任务分配、进度追踪、用户沟通","model":"claude-opus-4-7","skills":["SKILL-001"],"tools":["sop-cli","manager-api"],"mcp_servers":["tasks","knowledge"],"a2a_enabled":True,"port":8000},
        {"id":"planner","name":"Planner","role":"规划者","description":"需求分析、任务拆解、方案设计","model":"claude-opus-4-7","skills":["SKILL-001","SKILL-010"],"tools":["sop-cli"],"mcp_servers":["requirements","tasks","knowledge"],"a2a_enabled":True,"port":8001},
        {"id":"coder-backend","name":"Coder-Backend","role":"后端编码者","description":"服务端 API、数据模型、权限、同步与可靠性实现","model":"claude-opus-4-7","skills":["SKILL-002","SKILL-011"],"specs_to_load":["specs/backend/JAVA_SPEC.md"],"tools":["sop-cli","pytest","go-test"],"mcp_servers":["tasks","files","knowledge"],"a2a_enabled":True,"port":8002},
        {"id":"coder-frontend","name":"Coder-Frontend","role":"前端编码者","description":"React/Vue 管理端、组件化交互与可视化实现","model":"claude-opus-4-7","skills":["SKILL-002","SKILL-011"],"specs_to_load":["specs/frontend/FRONTEND_SPEC.md"],"tools":["sop-cli","pnpm","playwright"],"mcp_servers":["tasks","files","knowledge"],"a2a_enabled":True,"port":8003},
        {"id":"reviewer","name":"Reviewer","role":"审查者","description":"代码质量、安全、性能、可维护性和测试覆盖把关","model":"claude-opus-4-7","skills":["SKILL-003"],"tools":["sop-cli"],"mcp_servers":["audit","knowledge"],"a2a_enabled":True,"port":8004},
        {"id":"tester","name":"Tester","role":"测试者","description":"测试设计、自动化用例、回归验证与验收报告","model":"claude-opus-4-7","skills":["SKILL-004"],"tools":["sop-cli","pytest","playwright"],"mcp_servers":["tasks","files"],"a2a_enabled":True,"port":8005},
        {"id":"debugger","name":"Debugger","role":"调试者","description":"问题诊断、日志分析、补丁建议与修复验证","model":"claude-opus-4-7","skills":["SKILL-004","SKILL-010"],"tools":["sop-cli","logs"],"mcp_servers":["audit","files","knowledge"],"a2a_enabled":True,"port":8006},
    ]


def _list_agent_rows() -> list[dict[str, Any]]:
    agents = []
    for f in sorted(_agents_dir().glob("agent_*.json")):
        item = _read_json(f)
        if item:
            agents.append(item)
    return agents


def _list_group_rows() -> list[dict[str, Any]]:
    groups = []
    for f in sorted(_agents_dir().glob("group_*.json")):
        item = _read_json(f)
        if item:
            groups.append(item)
    return groups

@router.get("")
def list_agents():
    return _list_agent_rows()


@router.get("/summary")
def agents_summary():
    agents = _list_agent_rows()
    groups = _list_group_rows()
    models = sorted({str(a.get("model") or "") for a in agents if a.get("model")})
    skills = sorted({str(s) for a in agents for s in (a.get("skills") or []) if str(s)})
    tools = sorted({str(s) for a in agents for s in (a.get("tools") or []) if str(s)})
    mcp = sorted({str(s) for a in agents for s in (a.get("mcp_servers") or []) if str(s)})
    return {
        "ok": True,
        "agents": len(agents),
        "enabled": sum(1 for a in agents if a.get("enabled", True)),
        "a2a_enabled": sum(1 for a in agents if a.get("a2a_enabled")),
        "groups": len(groups),
        "models": models,
        "skills": skills,
        "tools": tools,
        "mcp_servers": mcp,
    }

@router.post("")
def create_agent(body: AgentDef):
    body.id = _safe_id(body.id, "Agent ID")
    f = _agent_path(body.id)
    f.write_text(json.dumps(_dump_model(body), ensure_ascii=False, indent=2), encoding="utf-8")
    _emit("agent.upserted", {"agent_id": body.id, "role": body.role})
    return {"ok": True, "id": body.id}

@router.put("/{agent_id}")
def update_agent(agent_id: str, body: AgentDef):
    agent_id = _safe_id(agent_id, "Agent ID")
    body.id = agent_id
    f = _agent_path(agent_id)
    f.write_text(json.dumps(_dump_model(body), ensure_ascii=False, indent=2), encoding="utf-8")
    _emit("agent.upserted", {"agent_id": agent_id, "role": body.role})
    return {"ok": True}

@router.delete("/{agent_id}")
def delete_agent(agent_id: str):
    agent_id = _safe_id(agent_id, "Agent ID")
    f = _agent_path(agent_id)
    if f.exists():
        f.unlink()
    _emit("agent.deleted", {"agent_id": agent_id})
    return {"ok": True}

@router.get("/groups")
def list_groups():
    return _list_group_rows()

@router.post("/groups")
def create_group(body: AgentGroup):
    body.id = _safe_id(body.id, "Group ID")
    body.agents = [_safe_id(a, "Agent ID") for a in body.agents]
    f = _group_path(body.id)
    f.write_text(json.dumps(_dump_model(body), ensure_ascii=False, indent=2), encoding="utf-8")
    _emit("agent.group_upserted", {"group_id": body.id, "agents": body.agents, "mode": body.mode})
    return {"ok": True, "id": body.id}


@router.delete("/groups/{group_id}")
def delete_group(group_id: str):
    group_id = _safe_id(group_id, "Group ID")
    f = _group_path(group_id)
    if f.exists():
        f.unlink()
    _emit("agent.group_deleted", {"group_id": group_id})
    return {"ok": True}

@router.get("/builtin")
def builtin_agents():
    """内置 Agent 角色定义"""
    return _builtin_agent_defs()


@router.post("/bootstrap-builtin")
def bootstrap_builtin(overwrite: bool = False):
    created: list[str] = []
    skipped: list[str] = []
    for item in _builtin_agent_defs():
        path = _agent_path(item["id"])
        if path.exists() and not overwrite:
            skipped.append(item["id"])
            continue
        path.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
        created.append(item["id"])
    group = AgentGroup(
        id="delivery-squad",
        name="Delivery Squad",
        description="需求、开发、测试、审查闭环专家组，适用于日常迭代交付。",
        agents=["orchestrator", "planner", "coder-backend", "coder-frontend", "tester", "reviewer"],
        mode="review-gate",
        entry_agent="orchestrator",
    )
    gpath = _group_path(group.id)
    if overwrite or not gpath.exists():
        gpath.write_text(json.dumps(_dump_model(group), ensure_ascii=False, indent=2), encoding="utf-8")
    _emit("agent.bootstrap_builtin", {"created": created, "skipped": skipped, "overwrite": overwrite})
    return {"ok": True, "created": created, "skipped": skipped, "group": group.id}


@router.get("/{agent_id}/profile")
def agent_profile(agent_id: str):
    agent_id = _safe_id(agent_id, "Agent ID")
    item = _read_json(_agent_path(agent_id))
    if not item:
        raise HTTPException(404, "Agent 不存在")
    env = {
        "SOP_TENANT_ID": resolved_tenant_id(),
        "SOP_PROJECT_ID": resolved_project_id(),
        "SOP_AGENT_ID": agent_id,
        "SOP_AGENT_ROLE": str(item.get("role") or ""),
    }
    profile = {
        "schema": "sop.agent-profile.v1",
        "agent": item,
        "env": env,
        "commands": {
            "prepare_context": "sop context prepare --flush",
            "work_next": "sop work next --json",
            "sync_flush": "sop sync flush",
            "emit_event": f"sop event emit agent.{agent_id}.heartbeat --source agent/{agent_id}",
        },
        "mcp": {
            "servers": item.get("mcp_servers") or [],
            "hint": "Agent 启动时按 mcp_servers 装配工具；缺失服务从 Marketplace / MCP Hub 安装。",
        },
        "a2a": {
            "enabled": bool(item.get("a2a_enabled")),
            "endpoint": f"http://127.0.0.1:{item.get('port')}/a2a" if item.get("port") else "",
            "protocol": "json-rpc-over-http",
        },
        "guardrails": [
            "先读取 .sop-runtime/agent_context.json 与项目规则，再执行开发任务。",
            "写入需求、任务、问题、记忆、知识和事件时优先使用 sop CLI，离线时进入 outbox。",
            "不得输出或持久化明文密钥；Provider/API Key 仅使用 SecretRef 或本地环境变量。",
        ],
    }
    return {"ok": True, "profile": profile}
