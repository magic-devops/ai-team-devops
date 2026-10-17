"""技能管理：注册、查询、自定义技能"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Optional, List
from pathlib import Path
import json, os
from sop_manager.path_config import resolved_ai_memory_root
from sop_manager.routers.productization_contract import summarize_items, unified_payload

from sop_manager.project_write_guard import project_file_write_scope

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])


def _skills_dir() -> Path:
    d = resolved_ai_memory_root() / "skills"
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

@router.get("/hub")
def skills_hub() -> dict[str, Any]:
    from sop_manager.routers import skill_repo

    skills = list_skills()
    repos = skill_repo.list_repos()
    installed = skill_repo.list_installed()
    installed_count = len(installed) if isinstance(installed, list) else len(installed or {})
    return {
        "ok": True,
        "summary": {
            "skills": len(skills),
            "builtin": sum(1 for s in skills if s.get("builtin")),
            "custom": sum(1 for s in skills if not s.get("builtin")),
            "repos": len(repos) if isinstance(repos, list) else 0,
            "installed": installed_count,
        },
        "domains": [
            {"id": "skills", "path": "#/skills-hub/skills", "capability": "ecosystem.skills-hub.skills"},
            {"id": "repos", "path": "#/skills-hub/repos", "capability": "ecosystem.skills-hub.repos"},
            {"id": "installed", "path": "#/skills-hub/installed", "capability": "ecosystem.skills-hub.installed"},
        ],
    }


@router.get("/runtime")
def skills_runtime() -> dict[str, Any]:
    skills = list_skills()
    rows = []
    for skill in skills:
        sid = str(skill.get("skill_id") or skill.get("id") or skill.get("name") or "")
        permissions = ["read"]
        if skill.get("mcp_tool") or skill.get("a2a_exposed"):
            permissions.append("execute")
        rows.append(
            {
                "id": sid,
                "name": skill.get("name") or sid,
                "version": skill.get("version") or "builtin" if skill.get("builtin") else "custom",
                "agent_role": skill.get("agent_role") or "All",
                "builtin": bool(skill.get("builtin")),
                "a2a_exposed": bool(skill.get("a2a_exposed")),
                "mcp_tool": bool(skill.get("mcp_tool")),
                "input": skill.get("trigger") or "current page context, memory/kb context, task packet",
                "output": skill.get("execution") or "task plan, execution evidence, diagnostic report",
                "permissions": permissions,
                "status": "ready",
                "ok": True,
                "cli": f"sop skills runtime --skill {sid} --json",
            }
        )
    summary = summarize_items(rows)
    return unified_payload(
        summary={
            "ok": True,
            **summary,
            "skills": len(rows),
            "builtin": sum(1 for row in rows if row.get("builtin")),
            "custom": sum(1 for row in rows if not row.get("builtin")),
            "executable": sum(1 for row in rows if "execute" in row.get("permissions", [])),
        },
        items=rows,
        actions=[
            {"id": "read", "label": "读取技能运行目录", "method": "GET", "path": "/api/v1/skills/runtime", "risk": "low"},
            {"id": "install", "label": "安装或同步技能", "method": "POST", "path": "/api/v1/skill-repo/install", "risk": "medium"},
            {"id": "taskize", "label": "失败诊断任务化", "method": "POST", "path": "/api/v1/tasks", "risk": "medium"},
        ],
        cli=[
            {"id": "read", "command": "sop skills runtime --json"},
            {"id": "catalog", "command": "sop pages capabilities --json"},
            {"id": "doctor", "command": "sop system readiness --full --json"},
        ],
        permissions=[
            {"capability": "ecosystem.skills-hub", "actions": ["read", "write", "execute", "export"]},
            {"capability": "ai.agent-runtime", "actions": ["read", "execute", "approve"]},
        ],
        audit={"event": "skills_runtime"},
        agent_consumption={
            "purpose": "Executable skill catalog with role, input, output, permissions, CLI mapping and failure-diagnosis entry.",
            "selection_fields": ["agent_role", "a2a_exposed", "mcp_tool", "permissions", "input", "output"],
        },
    )


@router.post("")
def create_skill(body: SkillDef):
    with project_file_write_scope():
        _skills_dir().mkdir(parents=True, exist_ok=True)
        f = _skills_dir() / f"{body.skill_id}.json"
        f.write_text(json.dumps(body.dict(), ensure_ascii=False, indent=2))
        return {"ok": True, "skill_id": body.skill_id}

@router.delete("/{skill_id}")
def delete_skill(skill_id: str):
    with project_file_write_scope():
        f = _skills_dir() / f"{skill_id}.json"
        if f.exists(): f.unlink()
        return {"ok": True}
