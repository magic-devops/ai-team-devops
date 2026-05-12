"""Agent 编排：工作流定义、工具选择、版本管理"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict
from pathlib import Path
import json, os, subprocess, shutil

router = APIRouter(prefix="/api/orchestration", tags=["orchestration"])
ORCH_DIR = Path(os.getenv("PROJECT_PATH", ".")) / ".ai-memory" / "orchestration"
ORCH_DIR.mkdir(parents=True, exist_ok=True)

DEV_TOOLS = [
    {"id":"claude","name":"Claude Code","cmd":"claude","description":"Anthropic CLI，支持 hooks/commands"},
    {"id":"opencode","name":"opencode","cmd":"opencode","description":"SST 多模型 TUI"},
    {"id":"cursor","name":"Cursor","cmd":"cursor","description":"IDE，读取 .cursorrules"},
    {"id":"trae","name":"Trae","cmd":"trae","description":"字节跳动 AI IDE"},
    {"id":"qcoder","name":"Qoder","cmd":"qcoder","description":"读取 .qoder/context.md"},
    {"id":"windsurf","name":"Windsurf","cmd":"windsurf","description":"Codeium IDE"},
    {"id":"aider","name":"Aider","cmd":"aider","description":"终端 AI 编码助手"},
]

class WorkflowDef(BaseModel):
    id: str; name: str; description: str = ""
    steps: List[Dict] = []  # [{agent, tool, skill, prompt_template}]
    dev_tool: str = "claude"  # 默认开发工具

class VersionTag(BaseModel):
    tag: str; message: str = ""

@router.get("/tools")
def list_tools():
    """列出所有支持的开发工具及其可用状态"""
    result = []
    for t in DEV_TOOLS:
        available = shutil.which(t["cmd"]) is not None
        result.append({**t, "available": available})
    return result

@router.get("/workflows")
def list_workflows():
    return [json.loads(f.read_text()) for f in sorted(ORCH_DIR.glob("wf_*.json"))]

@router.post("/workflows")
def create_workflow(body: WorkflowDef):
    f = ORCH_DIR / f"wf_{body.id}.json"
    f.write_text(json.dumps(body.dict(), ensure_ascii=False, indent=2))
    return {"ok": True, "id": body.id}

@router.delete("/workflows/{wf_id}")
def delete_workflow(wf_id: str):
    f = ORCH_DIR / f"wf_{wf_id}.json"
    if f.exists(): f.unlink()
    return {"ok": True}

@router.get("/config")
def get_config():
    f = ORCH_DIR / "config.json"
    return json.loads(f.read_text()) if f.exists() else {"default_tool": "claude", "quality_config": {}, "version": "1.0.0"}

@router.put("/config")
def update_config(body: dict):
    f = ORCH_DIR / "config.json"
    cfg = json.loads(f.read_text()) if f.exists() else {}
    cfg.update(body)
    f.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    return {"ok": True}

@router.get("/versions")
def list_versions():
    """列出 git tags 作为版本"""
    try:
        result = subprocess.run(["git", "tag", "-l", "--sort=-version:refname"],
                                capture_output=True, text=True, cwd=os.getenv("PROJECT_PATH","."))
        tags = [t.strip() for t in result.stdout.strip().split("\n") if t.strip()]
        return tags[:20]
    except Exception: return []

@router.post("/versions")
def create_version(body: VersionTag):
    try:
        subprocess.run(["git", "tag", "-a", body.tag, "-m", body.message or body.tag],
                       check=True, cwd=os.getenv("PROJECT_PATH","."))
        return {"ok": True, "tag": body.tag}
    except Exception as e: raise HTTPException(500, str(e))
