"""技能管理：注册、查询、自定义技能"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from pathlib import Path
import json, os
from sop_manager.path_config import resolved_ai_memory_root

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])


def _skills_dir() -> Path:
    d = resolved_ai_memory_root() / "skills"
    d.mkdir(parents=True, exist_ok=True)
    return d

class SkillDef(BaseModel):
    skill_id: str; name: str; description: str; agent_role: str = "All"
    trigger: Optional[str] = ""; execution: Optional[str] = ""
    a2a_exposed: bool = False; mcp_tool: bool = False
    lancedb_context: bool = False; context_budget: int = 10000

@router.get("")
def list_skills():
    # 内置技能 + 自定义技能
    builtin = [
        {"skill_id":"SKILL-001","name":"需求拆解","agent_role":"Planner","a2a_exposed":True,"builtin":True},
        {"skill_id":"SKILL-002","name":"代码实现","agent_role":"Coder","a2a_exposed":True,"builtin":True},
        {"skill_id":"SKILL-003","name":"代码审查","agent_role":"Reviewer","a2a_exposed":True,"builtin":True},
        {"skill_id":"SKILL-004","name":"问题诊断","agent_role":"Debugger","a2a_exposed":True,"builtin":True},
        {"skill_id":"SKILL-009","name":"并行工具调用","agent_role":"Worker","builtin":True},
        {"skill_id":"SKILL-010","name":"CoT 决策","agent_role":"Planner","builtin":True},
        {"skill_id":"SKILL-011","name":"自修复循环","agent_role":"Worker","builtin":True},
        {"skill_id":"SKILL-012","name":"置信度自评","agent_role":"Worker","builtin":True},
        {"skill_id":"SKILL-013","name":"语义搜索","agent_role":"All","mcp_tool":True,"builtin":True},
        {"skill_id":"SKILL-014","name":"知识库查询","agent_role":"All","mcp_tool":True,"builtin":True},
        {"skill_id":"SKILL-015","name":"规则提取","agent_role":"All","builtin":True},
    ]
    custom = []
    for f in sorted(_skills_dir().glob("*.json")):
        try: custom.append({**json.loads(f.read_text()), "builtin": False})
        except Exception: pass
    return builtin + custom

@router.post("")
def create_skill(body: SkillDef):
    f = _skills_dir() / f"{body.skill_id}.json"
    f.write_text(json.dumps(body.dict(), ensure_ascii=False, indent=2))
    return {"ok": True, "skill_id": body.skill_id}

@router.delete("/{skill_id}")
def delete_skill(skill_id: str):
    f = _skills_dir() / f"{skill_id}.json"
    if f.exists(): f.unlink()
    return {"ok": True}
