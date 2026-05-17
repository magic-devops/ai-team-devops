"""Agent 编排：工作流定义、工具选择、版本管理、开发工具自定义与受控安装"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root, resolved_project_path

router = APIRouter(prefix="/api/v1/orchestration", tags=["orchestration"])


def _orch_dir() -> Path:
    d = resolved_ai_memory_root() / "orchestration"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _dev_tools_state() -> Path:
    return _orch_dir() / "dev_tools_state.json"

# category: agent_cli | ide | assistant | chain（链路与运行时工具）
DEV_TOOLS: List[Dict[str, str]] = [
    {"id": "codex", "name": "Codex CLI", "cmd": "codex", "description": "OpenAI 本地编码 Agent，支持 AGENTS.md、MCP、hooks", "category": "agent_cli"},
    {"id": "claude", "name": "Claude Code", "cmd": "claude", "description": "Anthropic CLI，支持 hooks/commands", "category": "agent_cli"},
    {"id": "opencode", "name": "opencode", "cmd": "opencode", "description": "SST 多模型 TUI", "category": "agent_cli"},
    {"id": "openclaw", "name": "OpenClaw", "cmd": "openclaw", "description": "OpenClaw AI 编码 CLI", "category": "agent_cli"},
    {"id": "gemini", "name": "Gemini CLI", "cmd": "gemini", "description": "Google Gemini CLI（若已安装）", "category": "agent_cli"},
    {"id": "cursor", "name": "Cursor", "cmd": "cursor", "description": "IDE，读取 .cursorrules", "category": "ide"},
    {"id": "trae", "name": "Trae", "cmd": "trae", "description": "字节跳动 AI IDE", "category": "ide"},
    {"id": "qoder", "name": "Qoder", "cmd": "qoder", "description": "读取 .qoder/context.md（CLI 名因环境可能为 qcoder）", "category": "ide"},
    {"id": "windsurf", "name": "Windsurf", "cmd": "windsurf", "description": "Codeium IDE", "category": "ide"},
    {"id": "vscode", "name": "VS Code", "cmd": "code", "description": "VS Code 命令行（code）", "category": "ide"},
    {"id": "aider", "name": "Aider", "cmd": "aider", "description": "终端 AI 编码助手", "category": "assistant"},
    {"id": "docker", "name": "Docker", "cmd": "docker", "description": "容器运行时 CLI", "category": "chain"},
    {
        "id": "docker-compose",
        "name": "Docker Compose",
        "cmd": "docker",
        "description": "Compose v2 插件（请以环境检查中 docker compose 结果为准）",
        "category": "chain",
    },
    {"id": "curl", "name": "curl", "cmd": "curl", "description": "HTTP/下载命令行", "category": "chain"},
    {"id": "npx", "name": "npx", "cmd": "npx", "description": "npm 附带的一次性包执行器", "category": "chain"},
    {"id": "git", "name": "Git", "cmd": "git", "description": "版本控制", "category": "chain"},
    {"id": "kubectl", "name": "kubectl", "cmd": "kubectl", "description": "Kubernetes CLI", "category": "chain"},
    {"id": "node", "name": "Node.js", "cmd": "node", "description": "JavaScript 运行时", "category": "chain"},
    {"id": "npm", "name": "npm", "cmd": "npm", "description": "Node 包管理器", "category": "chain"},
    {"id": "yarn", "name": "Yarn", "cmd": "yarn", "description": "经典 Yarn 包管理器", "category": "chain"},
    {"id": "pnpm", "name": "pnpm", "cmd": "pnpm", "description": "快速节省磁盘空间的包管理器", "category": "chain"},
    {"id": "bun", "name": "Bun", "cmd": "bun", "description": "JS 运行时与包管理", "category": "chain"},
    {"id": "deno", "name": "Deno", "cmd": "deno", "description": "安全 JS/TS 运行时", "category": "chain"},
    {"id": "uv", "name": "uv", "cmd": "uv", "description": "Astral 高速 Python 包管理", "category": "chain"},
    {"id": "go", "name": "Go", "cmd": "go", "description": "Go 工具链", "category": "chain"},
    {"id": "java", "name": "Java", "cmd": "java", "description": "JVM（java 命令）", "category": "chain"},
    {"id": "mvn", "name": "Maven", "cmd": "mvn", "description": "Java 构建", "category": "chain"},
    {"id": "gradle", "name": "Gradle", "cmd": "gradle", "description": "JVM 构建（Gradle）", "category": "chain"},
    {"id": "python3", "name": "Python 3", "cmd": "python3", "description": "Python 解释器", "category": "chain"},
    {"id": "pip3", "name": "pip", "cmd": "pip3", "description": "Python 包安装器（pip3）", "category": "chain"},
    {"id": "poetry", "name": "Poetry", "cmd": "poetry", "description": "Python 依赖与打包", "category": "chain"},
    {"id": "ruff", "name": "Ruff", "cmd": "ruff", "description": "Python linter / formatter", "category": "chain"},
    {"id": "pre_commit", "name": "pre-commit", "cmd": "pre-commit", "description": "Git hooks 管理", "category": "chain"},
    {"id": "rustc", "name": "Rustc", "cmd": "rustc", "description": "Rust 编译器", "category": "chain"},
    {"id": "cargo", "name": "Cargo", "cmd": "cargo", "description": "Rust 包管理与构建", "category": "chain"},
    {"id": "terraform", "name": "Terraform", "cmd": "terraform", "description": "IaC 编排 CLI", "category": "chain"},
    {"id": "aws", "name": "AWS CLI", "cmd": "aws", "description": "Amazon Web Services CLI", "category": "chain"},
    {"id": "gh", "name": "GitHub CLI", "cmd": "gh", "description": "gh pr/issue/release", "category": "chain"},
    {"id": "rg", "name": "ripgrep", "cmd": "rg", "description": "高速递归搜索", "category": "chain"},
    {"id": "make", "name": "Make", "cmd": "make", "description": "Makefile 构建", "category": "chain"},
    {"id": "cmake", "name": "CMake", "cmd": "cmake", "description": "跨平台构建生成", "category": "chain"},
    {"id": "jq", "name": "jq", "cmd": "jq", "description": "JSON 命令行处理", "category": "chain"},
    {"id": "helm", "name": "Helm", "cmd": "helm", "description": "Kubernetes Chart 管理", "category": "chain"},
    {"id": "tsx", "name": "tsx", "cmd": "tsx", "description": "TypeScript 直接执行（Node）", "category": "chain"},
]

# 受控一键安装：仅允许下列固定 argv（npm / pip 官方包名）
GUARD_INSTALL_RECIPES: Dict[str, List[str]] = {
    "npm_codex": ["npm", "install", "-g", "@openai/codex@latest"],
    "npm_opencode": ["npm", "install", "-g", "opencode@latest"],
    "npm_claude_code": ["npm", "install", "-g", "@anthropic-ai/claude-code@latest"],
    "npm_openclaw": ["npm", "install", "-g", "openclaw@latest"],
    "npm_gemini": ["npm", "install", "-g", "@google/gemini-cli@latest"],
    "pip_aider": ["python3", "-m", "pip", "install", "--user", "aider-chat"],
    "npm_pnpm": ["npm", "install", "-g", "pnpm@latest"],
    "pip_uv": ["python3", "-m", "pip", "install", "--user", "uv"],
    "npm_bun": ["npm", "install", "-g", "bun"],
    "npm_deno": ["npm", "install", "-g", "deno"],
    "pip_poetry": ["python3", "-m", "pip", "install", "--user", "poetry"],
    "pip_ruff": ["python3", "-m", "pip", "install", "--user", "ruff"],
    "pip_pre_commit": ["python3", "-m", "pip", "install", "--user", "pre-commit"],
    "npm_tsx": ["npm", "install", "-g", "tsx"],
    "npm_yarn": ["npm", "install", "-g", "yarn"],
}

TOOL_TO_RECIPE: Dict[str, str] = {
    "codex": "npm_codex",
    "opencode": "npm_opencode",
    "claude": "npm_claude_code",
    "openclaw": "npm_openclaw",
    "gemini": "npm_gemini",
    "aider": "pip_aider",
    "pnpm": "npm_pnpm",
    "yarn": "npm_yarn",
    "uv": "pip_uv",
    "bun": "npm_bun",
    "deno": "npm_deno",
    "poetry": "pip_poetry",
    "ruff": "pip_ruff",
    "pre_commit": "pip_pre_commit",
    "tsx": "npm_tsx",
}

# 不能仅用 cmd 首段判断是否在 PATH（须与子命令一致时）
TOOL_AVAILABILITY_ARGV: Dict[str, List[str]] = {
    "docker-compose": ["docker", "compose", "version"],
}


def _tool_available(tool_id: str, cmd: str) -> bool:
    cmd = (cmd or "").strip()
    if not cmd:
        return False
    argv = TOOL_AVAILABILITY_ARGV.get(tool_id)
    if argv:
        try:
            r = subprocess.run(list(argv), capture_output=True, text=True, timeout=10, cwd=str(resolved_project_path()))
            return r.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            return False
    exe = cmd.split()[0]
    return shutil.which(exe) is not None


def _tool_availability_hint(tool_id: str, cmd: str) -> str:
    """供 AI 规划上下文：简述当前机器上该工具是否可执行。"""
    cmd = (cmd or "").strip()
    if not cmd:
        return "未配置命令"
    argv = TOOL_AVAILABILITY_ARGV.get(tool_id)
    if argv:
        try:
            r = subprocess.run(list(argv), capture_output=True, text=True, timeout=10, cwd=str(resolved_project_path()))
            line = ((r.stdout or r.stderr or "").split("\n")[0] or "").strip()[:200]
            if r.returncode == 0:
                return f"docker compose 检查: 可用 — {line}"
            return f"docker compose 检查: 不可用(rc={r.returncode}) — {line}"
        except FileNotFoundError:
            return "docker compose 检查: 未找到 docker 可执行文件"
        except subprocess.TimeoutExpired:
            return "docker compose 检查: 超时"
        except OSError as e:
            return f"docker compose 检查: 错误 {e}"
    exe = cmd.split()[0]
    w = shutil.which(exe)
    if w:
        return f"PATH 可执行: {exe} -> {w}"
    return f"PATH 未找到: {exe}"


def _default_state() -> Dict[str, Any]:
    return {"custom": [], "hidden": [], "overrides": {}}


def _load_dev_tools_state() -> Dict[str, Any]:
    if not _dev_tools_state().exists():
        return _default_state()
    try:
        d = json.loads(_dev_tools_state().read_text(encoding="utf-8"))
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
    _dev_tools_state().write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


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
            for k in ("name", "cmd", "description", "category"):
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
            "category": str(c.get("category") or "agent_cli"),
        }
        if cid in TOOL_TO_RECIPE:
            row["guard_install_recipe"] = TOOL_TO_RECIPE.get(cid)
        out.append(row)
    return out


def _merged_tool_ids() -> List[str]:
    return [t["id"] for t in _merged_tools()]


def _fix_config_default_tool() -> None:
    f = _orch_dir() / "config.json"
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


def _enrich_cmd_result(res: Dict[str, Any]) -> Dict[str, Any]:
    stderr = str(res.get("stderr") or "").strip()
    if stderr == "timeout":
        res["error_code"] = "timeout"
    elif stderr.startswith("cmd_not_found:"):
        res["error_code"] = "cmd_not_found"
        rest = stderr.split(":", 1)[1].strip()
        if rest:
            res["exe"] = rest
    return res


def _run_cmd(cmd: List[str], timeout: int = 600, cwd: Optional[str] = None) -> Dict[str, Any]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd or str(resolved_project_path()))
        out = (r.stdout or "")[-16000:]
        err = (r.stderr or "")[-8000:]
        log_parts: List[str] = []
        if out.strip():
            log_parts.append("--- stdout ---\n" + out)
        if err.strip():
            log_parts.append("--- stderr ---\n" + err)
        log = "\n".join(log_parts) if log_parts else "(no output)"
        return _enrich_cmd_result(
            {
                "ok": r.returncode == 0,
                "returncode": r.returncode,
                "stdout": (r.stdout or "")[-4000:],
                "stderr": (r.stderr or "")[-2000:],
                "log": log,
            }
        )
    except FileNotFoundError:
        exe0 = cmd[0] if cmd else ""
        return _enrich_cmd_result(
            {"ok": False, "returncode": -1, "stdout": "", "stderr": f"cmd_not_found:{exe0}", "log": f"cmd_not_found:{exe0}"}
        )
    except subprocess.TimeoutExpired:
        return _enrich_cmd_result({"ok": False, "returncode": -1, "stdout": "", "stderr": "timeout", "log": "timeout"})


def _append_install_log(entry: Dict[str, Any]) -> None:
    """追加 JSONL 安装日志，供管理端「安装控制台」查看。"""
    _orch_dir().mkdir(parents=True, exist_ok=True)
    path = _orch_dir() / "install_logs.jsonl"
    row = {**entry, "ts": datetime.now(timezone.utc).isoformat()}
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError:
        pass


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


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    s = (text or "").strip()
    if not s:
        return None
    try:
        obj = json.loads(s)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    i = s.find("{")
    j = s.rfind("}")
    if i < 0 or j <= i:
        return None
    try:
        obj = json.loads(s[i : j + 1])
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def _filter_guard_actions(actions: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(actions, list):
        return out
    for a in actions:
        if not isinstance(a, dict):
            continue
        rid = str(a.get("recipe_id") or "").strip()
        if rid not in GUARD_INSTALL_RECIPES:
            continue
        lab = str(a.get("label") or a.get("label_zh") or a.get("label_en") or rid).strip()[:200]
        out.append({"recipe_id": rid, "label": lab or rid})
        if len(out) >= 16:
            break
    return out


def _actions_with_argv(actions: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for a in actions:
        row: Dict[str, Any] = dict(a)
        rid = str(row.get("recipe_id") or "").strip()
        if rid in GUARD_INSTALL_RECIPES:
            argv = GUARD_INSTALL_RECIPES[rid]
            row["argv_shell"] = " ".join(shlex.quote(x) for x in argv)
        out.append(row)
    return out


def _orch_llm_install_plan_v2(user: str) -> Dict[str, Any]:
    """返回 Markdown + 可一键执行的白名单 recipe 列表（由模型在允许集合内选取）。"""
    key_list = ", ".join(sorted(GUARD_INSTALL_RECIPES.keys()))
    system = (
        "你是开发环境工程师。请只输出一个 JSON 对象（不要用 markdown 代码围栏），UTF-8，格式严格为:\n"
        '{"markdown":"...（Markdown，含步骤与验证方式）","actions":[]}\n'
        'actions 为数组，元素形如 {"recipe_id":"npm_claude_code","label":"简短说明"}。\n'
        f"recipe_id 必须且只能从下列白名单选取（禁止发明 id）: {key_list}\n"
        "若该工具无法用上述 npm/pip 全局安装命令覆盖（例如只能 brew/apt 或需官网安装包），则 actions 必须为空数组 []。\n"
        "markdown 中可写非白名单的手动步骤供用户自行在终端执行。"
    )
    try:
        import anthropic
    except ImportError:
        return {"markdown": _orch_llm(user), "actions": []}
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        return {"markdown": _orch_llm(user), "actions": []}
    client = anthropic.Anthropic(api_key=key)
    msg = client.messages.create(
        model=os.getenv("ORCH_AI_MODEL", "claude-3-5-sonnet-20241022"),
        max_tokens=4096,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    raw = getattr(msg.content[0], "text", "") if msg.content else ""
    data = _extract_json_object(raw or "")
    if not isinstance(data, dict):
        return {"markdown": _orch_llm(user), "actions": []}
    md = str(data.get("markdown") or "").strip()
    if not md:
        md = _orch_llm(user)
    acts = _actions_with_argv(_filter_guard_actions(data.get("actions")))
    return {"markdown": md, "actions": acts}


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
    category: str = Field("agent_cli", max_length=32)


class DevToolUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    cmd: Optional[str] = Field(None, min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=500)
    category: Optional[str] = Field(None, max_length=32)


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
        tid = str(t.get("id") or "")
        available = _tool_available(tid, cmd)
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
        {
            "id": tid,
            "name": body.name.strip(),
            "cmd": body.cmd.strip(),
            "description": (body.description or "").strip(),
            "category": (body.category or "agent_cli").strip() or "agent_cli",
        }
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
def unhide_one_builtin_tool(body: DevToolHideBody):
    """从 hidden 列表移除单个内置工具 id，恢复列表显示。"""
    tid = (body.id or "").strip()
    if tid not in _builtin_ids():
        raise HTTPException(400, "仅可恢复内置工具 id")
    st = _load_dev_tools_state()
    h = st.setdefault("hidden", [])
    st["hidden"] = [x for x in h if str(x) != tid]
    _save_dev_tools_state(st)
    _fix_config_default_tool()
    return {"ok": True}


@router.post("/tools/unhide-all")
def unhide_all_builtin_tools():
    """恢复显示所有内置开发工具（清空 hidden 列表）。"""
    st = _load_dev_tools_state()
    st["hidden"] = []
    _save_dev_tools_state(st)
    _fix_config_default_tool()
    return {"ok": True}


@router.post("/tools/ai-install-plan")
def ai_tool_install_plan(body: AiToolInstallPlanBody):
    lines = []
    if body.tool_id:
        merged = {t["id"]: t for t in _merged_tools()}
        info = merged.get(body.tool_id.strip())
        if info:
            lines.append(
                f"工具 id: {info['id']}\n名称: {info.get('name')}\n命令: {info.get('cmd')}\n说明: {info.get('description')}"
            )
            lines.append(_tool_availability_hint(info["id"], str(info.get("cmd") or "")))
    if body.goal:
        lines.append("用户目标:\n" + (body.goal or "").strip())
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


@router.post("/tools/ai-install-plan-v2")
def ai_tool_install_plan_v2(body: AiToolInstallPlanBody):
    """结构化安装方案：Markdown + 可选白名单 recipe 按钮（供前端逐步执行）。"""
    lines: List[str] = []
    if body.tool_id:
        merged = {t["id"]: t for t in _merged_tools()}
        info = merged.get(body.tool_id.strip())
        if info:
            lines.append(
                f"工具 id: {info['id']}\n名称: {info.get('name')}\n命令: {info.get('cmd')}\n说明: {info.get('description')}"
            )
            lines.append(_tool_availability_hint(info["id"], str(info.get("cmd") or "")))
            rid = TOOL_TO_RECIPE.get(info["id"])
            if rid:
                lines.append(f"服务端白名单配方 id: {rid}（若适用可在 actions 中引用）")
    if body.goal:
        lines.append("用户补充说明:\n" + (body.goal or "").strip())
    if not lines:
        raise HTTPException(400, "请提供 tool_id 或 goal")
    user = "\n\n".join(lines)
    try:
        pack = _orch_llm_install_plan_v2(user)
        return {"ok": True, "markdown": pack.get("markdown") or "", "actions": pack.get("actions") or []}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI 规划失败: {e}") from e


@router.get("/environment-checks")
def orchestration_environment_checks():
    """委托 env 模块的内置检查，供编排页「环境 / 链路与运行时」展示。"""
    try:
        from sop_manager.routers.docker_env import env_check

        return env_check()
    except Exception as e:
        raise HTTPException(503, f"环境检查不可用: {e}") from e


@router.post("/tools/ai-auto-install")
def ai_auto_install_tool(body: AiToolInstallPlanBody):
    """对具备白名单 recipe 的工具执行受控安装并返回完整日志（需用户从 UI 确认后调用）。"""
    tid = (body.tool_id or "").strip()
    if not tid:
        raise HTTPException(400, "缺少 tool_id")
    merged = {t["id"]: t for t in _merged_tools()}
    info = merged.get(tid)
    if not info:
        raise HTTPException(404, "未知工具")
    rid = TOOL_TO_RECIPE.get(tid) or (info.get("guard_install_recipe") if isinstance(info.get("guard_install_recipe"), str) else None)
    if not rid or rid not in GUARD_INSTALL_RECIPES:
        raise HTTPException(400, "该工具暂无受控一键安装配方，请使用 AI 安装说明或手动安装")
    argv = GUARD_INSTALL_RECIPES[rid]
    result = _run_cmd(list(argv), timeout=900, cwd=str(resolved_project_path()))
    result["recipe_id"] = rid
    result["tool_id"] = tid
    _append_install_log(
        {
            "kind": "ai_auto_install",
            "tool_id": tid,
            "recipe_id": rid,
            "argv": argv,
            "ok": result.get("ok"),
            "returncode": result.get("returncode"),
            "log": (result.get("log") or "")[:20000],
            "stderr": (result.get("stderr") or "")[:2000],
            "error_code": result.get("error_code"),
            "exe": result.get("exe"),
        }
    )
    return result


@router.post("/tools/install-guarded")
def install_tool_guarded(body: GuardInstallBody):
    rid = (body.recipe_id or "").strip()
    if rid not in GUARD_INSTALL_RECIPES:
        raise HTTPException(400, f"未知 recipe_id，允许: {', '.join(GUARD_INSTALL_RECIPES)}")
    argv = GUARD_INSTALL_RECIPES[rid]
    result = _run_cmd(list(argv), timeout=900, cwd=str(resolved_project_path()))
    _append_install_log(
        {
            "kind": "install_guarded",
            "recipe_id": rid,
            "argv": argv,
            "ok": result.get("ok"),
            "returncode": result.get("returncode"),
            "log": (result.get("log") or "")[:20000],
            "stderr": (result.get("stderr") or "")[:2000],
            "error_code": result.get("error_code"),
            "exe": result.get("exe"),
        }
    )
    return result


@router.get("/tools/install-logs")
def list_install_logs(limit: int = Query(40, ge=1, le=200)):
    path = _orch_dir() / "install_logs.jsonl"
    if not path.is_file():
        return {"items": []}
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except OSError:
        return {"items": []}
    if not raw:
        return {"items": []}
    lines = raw.split("\n")
    tail = lines[-limit:]
    items: List[Any] = []
    for ln in tail:
        try:
            items.append(json.loads(ln))
        except json.JSONDecodeError:
            items.append({"raw": ln})
    return {"items": items}


@router.get("/hub")
def orchestration_hub() -> dict[str, Any]:
    tools = list_tools()
    workflows = list_workflows()
    tool_rows = tools if isinstance(tools, list) else []
    wf_rows = workflows if isinstance(workflows, list) else []
    by_category: dict[str, int] = dict(Counter(str(t.get("category") or "unknown") for t in tool_rows))
    available = sum(1 for t in tool_rows if t.get("available"))
    try:
        versions = list_versions()
        version_count = len(versions) if isinstance(versions, list) else 0
    except Exception:
        version_count = 0

    def _pie(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]

    return {
        "ok": True,
        "summary": {
            "tools_total": len(tool_rows),
            "tools_available": available,
            "workflows_total": len(wf_rows),
            "versions_total": version_count,
        },
        "charts": {"by_category": _pie(by_category)},
        "domains": [
            {"id": "studio", "path": "#/orchestration/studio", "capability": "delivery.orchestration.studio"},
            {"id": "workflows", "path": "#/workflows", "capability": "delivery.workflows"},
            {"id": "cli", "path": "#/platforms/cli", "capability": "ecosystem.platforms.cli"},
            {"id": "dev-flow", "path": "#/dev-flow/workbench", "capability": "delivery.dev-flow.workbench"},
        ],
    }


@router.get("/workflows")
def list_workflows():
    return [json.loads(f.read_text()) for f in sorted(_orch_dir().glob("wf_*.json"))]


@router.get("/workflows/{wf_id}")
def get_workflow(wf_id: str):
    f = _orch_dir() / f"wf_{wf_id}.json"
    if not f.is_file():
        raise HTTPException(404, "工作流不存在")
    data = json.loads(f.read_text(encoding="utf-8"))
    steps = data.get("steps") or data.get("nodes") or []
    return {"ok": True, "workflow": data, "step_count": len(steps)}


@router.post("/workflows")
def create_workflow(body: WorkflowDef):
    wid = (body.id or "").strip()
    if not re.match(r"^[a-z][a-z0-9_-]{1,40}$", wid):
        raise HTTPException(400, "工作流 id 须为小写字母开头，仅含 a-z0-9_-，长度 2–41")
    f = _orch_dir() / f"wf_{wid}.json"
    if f.is_file():
        raise HTTPException(409, "该工作流 id 已存在，请更换 id 或先删除已有工作流")
    try:
        payload = body.model_dump()
    except AttributeError:
        payload = body.dict()
    payload["id"] = wid
    f.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    return {"ok": True, "id": wid}


@router.delete("/workflows/{wf_id}")
def delete_workflow(wf_id: str):
    f = _orch_dir() / f"wf_{wf_id}.json"
    if f.exists():
        f.unlink()
    return {"ok": True}


@router.get("/config")
def get_config():
    _fix_config_default_tool()
    f = _orch_dir() / "config.json"
    return json.loads(f.read_text()) if f.exists() else {"default_tool": "claude", "quality_config": {}, "version": "1.0.0"}


@router.put("/config")
def update_config(body: dict):
    f = _orch_dir() / "config.json"
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
            cwd=str(resolved_project_path()),
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
            cwd=str(resolved_project_path()),
        )
        return {"ok": True, "tag": body.tag}
    except Exception as e:
        raise HTTPException(500, str(e)) from e
