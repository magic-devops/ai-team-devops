"""Agent 管理：定义、专家组、A2A 配置"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from pathlib import Path
import json, os
from path_config import ai_memory_root

router = APIRouter(prefix="/api/agents", tags=["agents"])

AGENTS_DIR = ai_memory_root() / "agents"
AGENTS_DIR.mkdir(parents=True, exist_ok=True)

class AgentDef(BaseModel):
    id: str; name: str; role: str; description: str
    model: str = "claude-opus-4-7"; port: Optional[int] = None
    skills: List[str] = []; specs_to_load: List[str] = []
    system_prompt: Optional[str] = ""; a2a_enabled: bool = False

class AgentGroup(BaseModel):
    id: str; name: str; description: str; agents: List[str] = []

@router.get("")
def list_agents():
    agents = []
    for f in sorted(AGENTS_DIR.glob("agent_*.json")):
        try: agents.append(json.loads(f.read_text()))
        except Exception: pass
    return agents

@router.post("")
def create_agent(body: AgentDef):
    f = AGENTS_DIR / f"agent_{body.id}.json"
    f.write_text(json.dumps(body.dict(), ensure_ascii=False, indent=2))
    return {"ok": True, "id": body.id}

@router.put("/{agent_id}")
def update_agent(agent_id: str, body: AgentDef):
    f = AGENTS_DIR / f"agent_{agent_id}.json"
    f.write_text(json.dumps(body.dict(), ensure_ascii=False, indent=2))
    return {"ok": True}

@router.delete("/{agent_id}")
def delete_agent(agent_id: str):
    f = AGENTS_DIR / f"agent_{agent_id}.json"
    if f.exists(): f.unlink()
    return {"ok": True}

@router.get("/groups")
def list_groups():
    groups = []
    for f in sorted(AGENTS_DIR.glob("group_*.json")):
        try: groups.append(json.loads(f.read_text()))
        except Exception: pass
    return groups

@router.post("/groups")
def create_group(body: AgentGroup):
    f = AGENTS_DIR / f"group_{body.id}.json"
    f.write_text(json.dumps(body.dict(), ensure_ascii=False, indent=2))
    return {"ok": True, "id": body.id}

@router.get("/builtin")
def builtin_agents():
    """内置 Agent 角色定义"""
    return [
        {"id":"orchestrator","name":"Orchestrator","role":"编排者","description":"任务分配、进度追踪、用户沟通","model":"claude-opus-4-7","skills":["SKILL-001"]},
        {"id":"planner","name":"Planner","role":"规划者","description":"需求分析、任务拆解","model":"claude-opus-4-7","skills":["SKILL-001","SKILL-010"]},
        {"id":"coder-backend","name":"Coder-Backend","role":"后端编码者","description":"Java/Spring Boot 实现","model":"claude-opus-4-7","skills":["SKILL-002","SKILL-011"],"specs_to_load":["specs/backend/JAVA_SPEC.md"],"a2a_enabled":True,"port":8001},
        {"id":"coder-frontend","name":"Coder-Frontend","role":"前端编码者","description":"Vue3/React 实现","model":"claude-opus-4-7","skills":["SKILL-002","SKILL-011"],"specs_to_load":["specs/frontend/FRONTEND_SPEC.md"],"a2a_enabled":True,"port":8002},
        {"id":"reviewer","name":"Reviewer","role":"审查者","description":"代码质量把关","model":"claude-opus-4-7","skills":["SKILL-003"],"a2a_enabled":True,"port":8003},
        {"id":"tester","name":"Tester","role":"测试者","description":"测试编写与执行","model":"claude-opus-4-7","skills":["SKILL-004"],"a2a_enabled":True,"port":8004},
        {"id":"debugger","name":"Debugger","role":"调试者","description":"问题诊断与修复","model":"claude-opus-4-7","skills":["SKILL-004","SKILL-010"],"a2a_enabled":True,"port":8005},
    ]
