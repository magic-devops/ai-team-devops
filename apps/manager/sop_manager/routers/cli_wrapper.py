"""CLI 工具封装：内置清单 + 可覆盖 / 自定义条目（持久化 memory/cli_tools_config.json）"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import subprocess, shutil, os, json, re
from pathlib import Path

from sop_manager.path_config import resolved_project_path

router = APIRouter(prefix="/api/v1/cli", tags=["cli"])

CLI_TOOLS: Dict[str, Dict[str, str]] = {
    "codex":        {"cmd": "codex",       "description": "OpenAI Codex CLI"},
    "openclaw":     {"cmd": "openclaw",    "description": "OpenClaw AI 编码工具"},
    "workbuddy":    {"cmd": "workbuddy",   "description": "WorkBuddy AI 助手"},
    "hermes-agent": {"cmd": "hermes",      "description": "Hermes Agent（NousResearch）"},
    "hermes":       {"cmd": "hermes",      "description": "Hermes Agent（别名）"},
    "claude":       {"cmd": "claude",      "description": "Claude Code CLI"},
    "opencode":     {"cmd": "opencode",    "description": "opencode TUI"},
    "aider":        {"cmd": "aider",       "description": "Aider AI 编码"},
    "cursor":       {"cmd": "cursor",      "description": "Cursor IDE"},
    "windsurf":     {"cmd": "windsurf",    "description": "Windsurf IDE（Codeium）"},
    "trae":         {"cmd": "trae",        "description": "Trae AI IDE，读取 .trae/rules.md"},
    "qoder":        {"cmd": "qoder",     "description": "Qoder，读取 .qoder/context.md"},
}

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


class CliRun(BaseModel):
    tool: str
    args: List[str] = []
    stdin_input: Optional[str] = None
    timeout: int = 60


class CliToolUpsert(BaseModel):
    """创建自定义工具，或更新自定义 / 内置覆盖字段。"""
    name: str = Field(..., min_length=1, max_length=120)
    cmd: str = Field(..., min_length=1, max_length=200)
    description: str = Field("", max_length=500)
    install_hint: str = Field("", max_length=2000)


def _state_path() -> Path:
    p = resolved_project_path() / "memory" / "cli_tools_config.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load_state() -> Dict[str, Any]:
    path = _state_path()
    if not path.exists():
        return {"overrides": {}, "custom": {}, "hidden": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {
            "overrides": data.get("overrides") or {},
            "custom": data.get("custom") or {},
            "hidden": list(data.get("hidden") or []),
        }
    except Exception:
        return {"overrides": {}, "custom": {}, "hidden": []}


def _save_state(st: Dict[str, Any]) -> None:
    _state_path().write_text(
        json.dumps(st, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _hint(tool: str) -> str:
    hints = {
        "codex":        "npm install -g @openai/codex  # 或 brew install --cask codex",
        "claude":       "npm install -g @anthropic-ai/claude-code",
        "opencode":     "参考 https://github.com/sst/opencode",
        "aider":        "pip install aider-chat --break-system-packages",
        "openclaw":     "参考 https://github.com/openclaw/openclaw",
        "workbuddy":    "参考 WorkBuddy 官方文档",
        "hermes-agent": "pip install hermes-agent",
        "hermes":       "pip install hermes-agent",
        "windsurf":     "Codeium Windsurf IDE",
        "cursor":       "https://cursor.com",
    }
    return hints.get(tool, f"请参考 {tool} 官方文档安装")


def _merged_defs() -> Dict[str, Dict[str, Any]]:
    """合并内置 + 覆盖 + 自定义 → id → 展示与执行字段。"""
    st = _load_state()
    hidden = set(st.get("hidden") or [])
    overrides: Dict[str, Any] = st.get("overrides") or {}
    custom: Dict[str, Any] = st.get("custom") or {}
    out: Dict[str, Dict[str, Any]] = {}

    for kid, base in CLI_TOOLS.items():
        if kid in hidden:
            continue
        ov = overrides.get(kid) or {}
        cmd = (ov.get("cmd") or base["cmd"]).strip()
        desc = (ov.get("description") or base["description"]).strip()
        name = (ov.get("name") or desc).strip()
        hint = (ov.get("install_hint") or "").strip() or _hint(kid)
        out[kid] = {
            "cmd": cmd,
            "description": desc,
            "name": name,
            "install_hint": hint,
            "is_builtin": True,
        }

    for cid, cdef in custom.items():
        if cid in CLI_TOOLS:
            continue
        cmd = (cdef.get("cmd") or "").strip()
        desc = (cdef.get("description") or "").strip()
        name = (cdef.get("name") or cid).strip()
        hint = (cdef.get("install_hint") or "").strip() or f"请参考 {cid} 官方文档安装"
        out[cid] = {
            "cmd": cmd,
            "description": desc,
            "name": name,
            "install_hint": hint,
            "is_builtin": False,
        }
    return out


def _tool_row(tid: str, rec: Dict[str, Any]) -> Dict[str, Any]:
    cmd = rec["cmd"]
    return {
        "id": tid,
        "name": rec["name"],
        "cmd": cmd,
        "description": rec["description"],
        "install_hint": rec["install_hint"],
        "available": bool(cmd) and shutil.which(cmd.split()[0]) is not None,
        "is_builtin": rec["is_builtin"],
    }


@router.get("/meta")
def cli_meta():
    st = _load_state()
    return {"hidden_builtin": [x for x in (st.get("hidden") or []) if x in CLI_TOOLS]}


@router.get("")
def list_tools():
    defs = _merged_defs()
    return [_tool_row(tid, rec) for tid, rec in sorted(defs.items(), key=lambda x: (not x[1]["is_builtin"], x[0]))]


@router.post("/tools/{tool_id}/restore")
def restore_builtin(tool_id: str):
    """恢复被隐藏的内置工具，并清除其覆盖。"""
    tid = tool_id.strip()
    if tid not in CLI_TOOLS:
        raise HTTPException(400, "仅支持恢复内置工具 id")
    st = _load_state()
    hid = [x for x in (st.get("hidden") or []) if x != tid]
    st["hidden"] = hid
    ovr = dict(st.get("overrides") or {})
    ovr.pop(tid, None)
    st["overrides"] = ovr
    _save_state(st)
    return {"ok": True}


@router.post("/tools/{tool_id}")
def create_custom_tool(tool_id: str, body: CliToolUpsert):
    tid = (tool_id or "").strip().lower()
    if not _ID_RE.match(tid):
        raise HTTPException(400, "id 须为小写字母/数字/._-，1–64 字符")
    if tid in CLI_TOOLS:
        raise HTTPException(400, "与内置工具 id 冲突，请换 id")
    st = _load_state()
    if tid in (st.get("custom") or {}):
        raise HTTPException(409, "该 id 已存在")
    st.setdefault("custom", {})[tid] = {
        "name": body.name.strip(),
        "cmd": body.cmd.strip(),
        "description": body.description.strip(),
        "install_hint": body.install_hint.strip(),
    }
    _save_state(st)
    return {"ok": True, "id": tid}


@router.put("/tools/{tool_id}")
def upsert_tool(tool_id: str, body: CliToolUpsert):
    tid = tool_id.strip()
    if tid in CLI_TOOLS:
        st = _load_state()
        if tid in (st.get("hidden") or []):
            raise HTTPException(400, "该内置工具已从列表隐藏，请先恢复再编辑")
        ov = st.setdefault("overrides", {})
        prev = ov.get(tid, {})
        base = CLI_TOOLS[tid]
        ov[tid] = {
            "name": body.name.strip() or prev.get("name") or base["description"],
            "cmd": body.cmd.strip() or base["cmd"],
            "description": body.description.strip() if body.description is not None else prev.get("description", base["description"]),
            "install_hint": body.install_hint.strip(),
        }
        _save_state(st)
        return {"ok": True, "id": tid}
    st = _load_state()
    custom = st.setdefault("custom", {})
    if tid not in custom:
        raise HTTPException(404, "未知自定义工具")
    custom[tid] = {
        "name": body.name.strip(),
        "cmd": body.cmd.strip(),
        "description": body.description.strip(),
        "install_hint": body.install_hint.strip(),
    }
    _save_state(st)
    return {"ok": True, "id": tid}


@router.delete("/tools/{tool_id}")
def delete_or_hide_tool(tool_id: str):
    tid = tool_id.strip()
    st = _load_state()
    if tid in CLI_TOOLS:
        hid = list(st.get("hidden") or [])
        if tid not in hid:
            hid.append(tid)
        st["hidden"] = hid
        ovr = dict(st.get("overrides") or {})
        ovr.pop(tid, None)
        st["overrides"] = ovr
        _save_state(st)
        return {"ok": True, "action": "hidden"}
    custom = st.get("custom") or {}
    if tid not in custom:
        raise HTTPException(404, "工具不存在")
    del custom[tid]
    st["custom"] = custom
    _save_state(st)
    return {"ok": True, "action": "deleted"}


@router.post("/run")
def run_cli(body: CliRun):
    defs = _merged_defs()
    rec = defs.get(body.tool)
    if not rec:
        raise HTTPException(404, f"Unknown tool: {body.tool}")
    cmd0 = rec["cmd"].strip()
    if not cmd0:
        return {"ok": False, "error": "未配置可执行命令", "install_hint": rec.get("install_hint", "")}
    exe = cmd0.split()[0]
    if not shutil.which(exe):
        return {"ok": False, "error": f"'{exe}' not found", "install_hint": rec.get("install_hint", "")}
    cmd = cmd0.split() + body.args
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=body.timeout,
                           cwd=str(resolved_project_path()), input=body.stdin_input)
        return {"ok": r.returncode == 0, "stdout": r.stdout[-4000:], "stderr": r.stderr[-500:], "returncode": r.returncode}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"超时 ({body.timeout}s)"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/install-hints")
def install_hints():
    return {tid: rec["install_hint"] for tid, rec in _merged_defs().items()}
