"""Agent 编排：工作流定义、工具选择、版本管理、开发工具自定义与受控安装"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/orchestration", tags=["orchestration"])
REPO_ROOT = Path(os.getenv("PROJECT_PATH", ".")).resolve()
ORCH_DIR = REPO_ROOT / ".ai-memory" / "orchestration"
ORCH_DIR.mkdir(parents=True, exist_ok=True)
DEV_TOOLS_STATE = ORCH_DIR / "dev_tools_state.json"

DEV_TOOLS: List[Dict[str, str]] = [
    {"id": "claude", "name": "Claude Code", "cmd": "claude", "description": "Anthropic CLI，支持 hooks/commands"},
    {"id": "opencode", "name": "opencode", "cmd": "opencode", "description": "SST 多模型 TUI"},
    {"id": "cursor", "name": "Cursor", "cmd": "cursor", "description": "IDE，读取 .cursorrules"},
    {"id": "trae", "name": "Trae", "cmd": "trae", "description": "字节跳动 AI IDE"},
    {"id": "qcoder", "name": "Qoder", "cmd": "qcoder", "description": "读取 .qoder/context.md"},
    {"id": "windsurf", "name": "Windsurf", "cmd": "windsurf", "description": "Codeium IDE"},
    {"id": "aider", "name": "Aider", "cmd": "aider", "description": "终端 AI 编码助手"},
]

# 受控一键安装：仅允许下列固定 argv（npm / pip 官方包名）
GUARD_INSTALL_RECIPES: Dict[str, List[str]] = {
    "npm_opencode": ["npm", "install", "-g", "opencode@latest"],
    "npm_claude_code": ["npm", "install", "-g", "@anthropic-ai/claude-code@latest"],
    "pip_aider": ["python3", "-m", "pip", "install", "--user", "aider-chat"],
}

TOOL_TO_RECIPE: Dict[str, str] = {
    "opencode": "npm_opencode",
    "claude": "npm_claude_code",
    "aider": "pip_aider",
}


def _default_state() -> Dict[str, Any]:
    return {"custom": [], "hidden": [], "overrides": {}}


def _load_dev_tools_state() -> Dict[str, Any]:
    if not DEV_TOOLS_STATE.exists():
        return _default_state()
    try:
        d = json.loads(DEV_TOOLS_STATE.read_text(encoding="utf-8"))
        if not isinstance(d, dict):
            return _default_state()
        d.setdefault("custom", [])
        d.setdefault("hidden", [])
        d.setdefault("overrides", {})
        if not isinstance(d["custom"], list):
            d["custom"] = []
        if not isinstance(d["hidden"], list):
            d["hidden"] = []
        if not isinstance(d["overrides"], dict):
            d["overrides"] = {}
        return d
    except Exception:
        return _default_state()


def _save_dev_tools_state(d: Dict[str, Any]) -> None:
    DEV_TOOLS_STATE.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def _builtin_ids() -> set:
    return {t["id"] for t in DEV_TOOLS}


def _merged_tools() -> List[Dict[str, Any]]:
    st = _load_dev_tools_state()
    hidden = {str(x) for x in st.get("hidden", []) if isinstance(x, str)}
    ov = st.get("overrides") or {}
    out: List[Dict[str, Any]] = []
    for t in DEV_TOOLS:
        tid = t["id"]
        if tid in hidden:
            continue
        row = {**t, "source": "builtin"}
        if isinstance(ov.get(tid), dict):
            for k in ("name", "cmd", "description"):
                if ov[tid].get(k) is not None:
                    row[k] = str(ov[tid][k])
        if tid in TOOL_TO_RECIPE:
            row["guard_install_recipe"] = TOOL_TO_RECIPE[tid]
        out.append(row)
    for c in st.get("custom", []) or []:
        if not isinstance(c, dict) or not c.get("id"):
            continue
        cid = str(c["id"])
        if cid in hidden or cid in _builtin_ids():
            continue
        row = {
            "id": cid,
            "name": str(c.get("name") or cid),
            "cmd": str(c.get("cmd") or ""),
            "description": str(c.get("description") or ""),
            "source": "custom",
        }
        if cid in TOOL_TO_RECIPE:
            row["guard_install_recipe"] = TOOL_TO_RECIPE.get(cid)
        out.append(row)
    return out


def _merged_tool_ids() -> List[str]:
    return [t["id"] for t in _merged_tools()]


def _fix_config_default_tool() -> None:
    f = ORCH_DIR / "config.json"
    cfg = json.loads(f.read_text()) if f.exists() else {}
    ids = set(_merged_tool_ids())
    dt = str(cfg.get("default_tool") or "claude")
    if dt not in ids:
        if "claude" in ids:
            cfg["default_tool"] = "claude"
        elif ids:
            cfg["default_tool"] = sorted(ids)[0]
        else:
            cfg["default_tool"] = "claude"
    f.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def _run_cmd(cmd: List[str], timeout: int = 600, cwd: Optional[str] = None) -> Dict[str, Any]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd or str(REPO_ROOT))
        return {
            "ok": r.returncode == 0,
            "returncode": r.returncode,
            "stdout": (r.stdout or "")[-4000:],
            "stderr": (r.stderr or "")[-2000:],
        }
    except FileNotFoundError:
        return {"ok": False, "returncode": -1, "stdout": "", "stderr": f"命令未找到: {cmd[0]}"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "returncode": -1, "stdout": "", "stderr": "执行超时"}


def _orch_llm(user: str, max_tokens: int = 4096) -> str:
    try:
        import anthropic
    except ImportError:
        raise HTTPException(503, "请安装 anthropic: pip install anthropic")
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(503, "未配置 ANTHROPIC_API_KEY")
    client = anthropic.Anthropic(api_key=key)
    system = """你是开发环境工程师。根据用户要安装/管理的「开发工具」信息，输出 Markdown：
1) 适用系统（macOS / Linux / Windows）的注意点
2) 推荐安装方式（官方文档链接用文字描述即可，不要编造 URL）
3) 分步 shell 命令（优先 npm / pip / brew 等常见方式）
4) 安装后如何验证（--version 等）
5) 权限与 PATH 常见问题
不要执行任何命令；只输出可复制的说明。"""
    msg = client.messages.create(
        model=os.getenv("ORCH_AI_MODEL", "claude-3-5-sonnet-20241022"),
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if not msg.content:
        return ""
    return getattr(msg.content[0], "text", "") or ""


class WorkflowDef(BaseModel):
    id: str
    name: str
    description: str = ""
    steps: List[Dict] = []
    dev_tool: str = "claude"


class VersionTag(BaseModel):
    tag: str
    message: str = ""


class DevToolCreate(BaseModel):
    id: str = Field(..., min_length=2, max_length=40)
    name: str = Field(..., min_length=1, max_length=120)
    cmd: str = Field(..., min_length=1, max_length=80)
    description: str = Field("", max_length=500)


class DevToolUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    cmd: Optional[str] = Field(None, min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=500)


class DevToolHideBody(BaseModel):
    id: str


class AiToolInstallPlanBody(BaseModel):
    tool_id: Optional[str] = None
    goal: Optional[str] = Field(None, max_length=2000)


class GuardInstallBody(BaseModel):
    recipe_id: str


@router.get("/tools/meta")
def dev_tools_meta():
    """内置隐藏列表等（管理 UI 用）"""
    st = _load_dev_tools_state()
    return {"hidden": list(st.get("hidden") or []), "custom": st.get("custom") or [], "overrides": st.get("overrides") or {}}


@router.get("/tools")
def list_tools():
    """合并内置 + 自定义 + 覆盖；返回 available 与可选 guard_install_recipe"""
    _fix_config_default_tool()
    result = []
    for t in _merged_tools():
        cmd = t.get("cmd") or ""
        available = bool(cmd) and shutil.which(cmd.split()[0]) is not None
        row = {**t, "available": available}
        result.append(row)
    return result


@router.post("/tools")
def create_dev_tool(body: DevToolCreate):
    tid = body.id.strip().lower()
    if not re.match(r"^[a-z][a-z0-9_-]{1,38}$", tid):
        raise HTTPException(400, "工具 id 须为小写字母开头，仅含 a-z0-9_-")
    if tid in _builtin_ids():
        raise HTTPException(400, "与内置工具 id 冲突，请换 id")
    st = _load_dev_tools_state()
    if any(str(x.get("id")) == tid for x in st.get("custom", [])):
        raise HTTPException(400, "该 id 已存在")
    st.setdefault("custom", []).append(
        {"id": tid, "name": body.name.strip(), "cmd": body.cmd.strip(), "description": (body.description or "").strip()}
    )
    _save_dev_tools_state(st)
    return {"ok": True, "id": tid}


@router.put("/tools/{tool_id}")
def update_dev_tool(tool_id: str, body: DevToolUpdate):
    tid = (tool_id or "").strip()
    if not tid:
        raise HTTPException(400, "缺少 tool_id")
    st = _load_dev_tools_state()
    if tid in _builtin_ids():
        ov = st.setdefault("overrides", {})
        cur = dict(ov.get(tid) or {})
        try:
            patch = body.model_dump(exclude_unset=True)
        except AttributeError:
            patch = body.dict(exclude_unset=True)
        for k, v in patch.items():
            if v is not None:
                cur[k] = v
        ov[tid] = cur
        _save_dev_tools_state(st)
        return {"ok": True, "source": "override"}
    found = False
    for i, c in enumerate(st.get("custom", [])):
        if str(c.get("id")) != tid:
            continue
        found = True
        try:
            patch = body.model_dump(exclude_unset=True)
        except AttributeError:
            patch = body.dict(exclude_unset=True)
        for k, v in patch.items():
            if v is not None:
                st["custom"][i][k] = v
        break
    if not found:
        raise HTTPException(404, "仅支持修改内置覆盖或自定义工具")
    _save_dev_tools_state(st)
    return {"ok": True, "source": "custom"}


@router.delete("/tools/{tool_id}")
def delete_dev_tool(tool_id: str):
    tid = (tool_id or "").strip()
    st = _load_dev_tools_state()
    if tid in _builtin_ids():
        raise HTTPException(400, "内置工具请使用 POST /tools/hide 隐藏，勿 DELETE")
    nxt = [x for x in st.get("custom", []) if str(x.get("id")) != tid]
    if len(nxt) == len(st.get("custom", [])):
        raise HTTPException(404, "未找到自定义工具")
    st["custom"] = nxt
    _save_dev_tools_state(st)
    _fix_config_default_tool()
    return {"ok": True}


@router.post("/tools/hide")
def hide_builtin_tool(body: DevToolHideBody):
    tid = (body.id or "").strip()
    if tid not in _builtin_ids():
        raise HTTPException(400, "仅可隐藏内置工具 id")
    st = _load_dev_tools_state()
    h = st.setdefault("hidden", [])
    if tid not in h:
        h.append(tid)
    _save_dev_tools_state(st)
    _fix_config_default_tool()
    return {"ok": True}


@router.post("/tools/unhide")
def unhide_builtin_tool(body: DevToolHideBody):
    tid = (body.id or "").strip()
    st = _load_dev_tools_state()
    st["hidden"] = [x for x in st.get("hidden", []) if x != tid]
    _save_dev_tools_state(st)
    return {"ok": True}


@router.post("/tools/ai-install-plan")
def ai_tool_install_plan(body: AiToolInstallPlanBody):
    lines = []
    if body.tool_id:
        merged = {t["id"]: t for t in _merged_tools()}
        info = merged.get(body.tool_id.strip())
        if info:
            lines.append(f"工具 id: {info['id']}\n名称: {info.get('name')}\n命令: {info.get('cmd')}\n说明: {info.get('description')}")
            lines.append(f"当前 PATH 可执行: {shutil.which((info.get('cmd') or '').split()[0]) or '未找到'}")
    if body.goal:
        lines.append("用户目标:\n" + body.goal.strip())
    if not lines:
        raise HTTPException(400, "请提供 tool_id 或 goal")
    user = "\n\n".join(lines)
    try:
        md = _orch_llm(user)
        if not md.strip():
            raise HTTPException(502, "模型返回为空")
        return {"ok": True, "markdown": md}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI 规划失败: {e}") from e


@router.post("/tools/install-guarded")
def install_tool_guarded(body: GuardInstallBody):
    rid = (body.recipe_id or "").strip()
    if rid not in GUARD_INSTALL_RECIPES:
        raise HTTPException(400, f"未知 recipe_id，允许: {', '.join(GUARD_INSTALL_RECIPES)}")
    argv = GUARD_INSTALL_RECIPES[rid]
    return _run_cmd(list(argv), timeout=900, cwd=str(REPO_ROOT))


@router.get("/workflows")
def list_workflows():
    return [json.loads(f.read_text()) for f in sorted(ORCH_DIR.glob("wf_*.json"))]


@router.post("/workflows")
def create_workflow(body: WorkflowDef):
    f = ORCH_DIR / f"wf_{body.id}.json"
    try:
        payload = body.model_dump()
    except AttributeError:
        payload = body.dict()
    f.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    return {"ok": True, "id": body.id}


@router.delete("/workflows/{wf_id}")
def delete_workflow(wf_id: str):
    f = ORCH_DIR / f"wf_{wf_id}.json"
    if f.exists():
        f.unlink()
    return {"ok": True}


@router.get("/config")
def get_config():
    _fix_config_default_tool()
    f = ORCH_DIR / "config.json"
    return json.loads(f.read_text()) if f.exists() else {"default_tool": "claude", "quality_config": {}, "version": "1.0.0"}


@router.put("/config")
def update_config(body: dict):
    f = ORCH_DIR / "config.json"
    cfg = json.loads(f.read_text()) if f.exists() else {}
    cfg.update(body or {})
    ids = set(_merged_tool_ids())
    dt = str(cfg.get("default_tool") or "")
    if dt and dt not in ids:
        cfg["default_tool"] = "claude" if "claude" in ids else next(iter(ids), "claude")
    f.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    return {"ok": True}


@router.get("/versions")
def list_versions():
    try:
        result = subprocess.run(
            ["git", "tag", "-l", "--sort=-version:refname"],
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
        )
        tags = [t.strip() for t in result.stdout.strip().split("\n") if t.strip()]
        return tags[:20]
    except Exception:
        return []


@router.post("/versions")
def create_version(body: VersionTag):
    try:
        subprocess.run(
            ["git", "tag", "-a", body.tag, "-m", body.message or body.tag],
            check=True,
            cwd=str(REPO_ROOT),
        )
        return {"ok": True, "tag": body.tag}
    except Exception as e:
        raise HTTPException(500, str(e)) from e
