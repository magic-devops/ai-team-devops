"""Vibe Coding：界面化调用底层 CLI 开发工具或大模型；会话、上传、多模态 LLM"""
import base64
import datetime
import json
import mimetypes
import os
import re
import shlex
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/vibe", tags=["vibe"])
PROJECT_PATH = Path(os.getenv("PROJECT_PATH", "."))

HISTORY_FILE = PROJECT_PATH / ".ai-memory" / "vibe_history.json"
UPLOAD_ROOT = PROJECT_PATH / ".ai-memory" / "vibe_uploads"
SESSIONS_FILE = PROJECT_PATH / ".ai-memory" / "vibe_sessions.json"

_MAX_FILE_SIZE = 6 * 1024 * 1024
_MAX_SESSION_MESSAGES = 200


def _safe_session(s: str) -> str:
    s = (s or "default")[:64]
    if not re.match(r"^[a-zA-Z0-9._-]+$", s):
        return "default"
    return s


def _safe_filename(name: str) -> str:
    name = Path(name or "file").name
    if not name or ".." in name:
        return "file"
    return name[:200]


def _load_history():
    return json.loads(HISTORY_FILE.read_text()) if HISTORY_FILE.exists() else []


def _save_history(h):
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(h[-100:], ensure_ascii=False, indent=2))


def _load_sessions() -> Dict[str, Any]:
    if not SESSIONS_FILE.exists():
        return {"sessions": []}
    try:
        return json.loads(SESSIONS_FILE.read_text())
    except Exception:
        return {"sessions": []}


def _save_sessions(db: Dict[str, Any]):
    SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SESSIONS_FILE.write_text(json.dumps(db, ensure_ascii=False, indent=2))


def _resolve_upload_path(rel: str) -> Optional[Path]:
    rel = rel.replace("\\", "/").strip("/")
    parts = rel.split("/")
    if len(parts) < 2:
        return None
    sid = _safe_session(parts[0])
    if sid != parts[0]:
        return None
    fn = Path(parts[-1]).name
    if not fn:
        return None
    p = (UPLOAD_ROOT / sid / fn).resolve()
    try:
        p.relative_to(UPLOAD_ROOT.resolve())
    except ValueError:
        return None
    if p.exists() and p.is_file():
        return p
    return None


def _merge_cli_prompt(body: "VibeRequest") -> str:
    extras: List[str] = []
    if body.memory_context:
        extras.append(f"[长期记忆 / 项目上下文]\n{body.memory_context}")
    if body.expert_system:
        extras.append(f"[专家组 / 协作约束]\n{body.expert_system}")
    if body.mode and body.mode != "chat":
        extras.append(f"[模式: {body.mode}]")
    full = body.prompt
    if extras:
        full = "\n\n".join(extras) + "\n\n---\n\n" + full
    if body.attachment_paths and body.tool != "direct-llm":
        full += "\n\n[用户已上传附件，相对路径见 vibe_uploads]\n" + "\n".join(body.attachment_paths)
    return full


class VibeRequest(BaseModel):
    prompt: str
    tool: str = "claude"
    model: Optional[str] = None
    context_files: List[str] = []
    mode: str = "chat"
    memory_context: Optional[str] = None
    expert_system: Optional[str] = None
    attachment_paths: List[str] = []


class DirectLLMRequest(BaseModel):
    prompt: str
    model: str = "claude-opus-4-7"
    system: Optional[str] = None
    max_tokens: int = 4096
    attachment_paths: List[str] = []
    memory_context: Optional[str] = None
    expert_system: Optional[str] = None


class VibeSessionCreate(BaseModel):
    title: str = "新会话"


class VibeSessionPatch(BaseModel):
    title: Optional[str] = None
    messages: Optional[List[dict]] = None
    memory: Optional[str] = None
    preview_html: Optional[str] = None
    attachments: Optional[List[dict]] = None


class VibeTerminalExecBody(BaseModel):
    """在 PROJECT_PATH 下受控执行 shell 命令（首段可执行文件须在环境白名单内）。"""

    command: str = Field("", max_length=8000)
    cwd: str = Field("", max_length=500)
    timeout_sec: int = Field(120, ge=3, le=600)


@router.get("/history")
def get_history():
    return _load_history()


@router.delete("/history")
def clear_history():
    _save_history([])
    return {"ok": True}


@router.get("/sessions")
def list_sessions():
    db = _load_sessions()
    sessions = sorted(db.get("sessions", []), key=lambda x: x.get("updated_at", ""), reverse=True)
    out = []
    for s in sessions:
        row = dict(s)
        row.setdefault("attachments", [])
        out.append(row)
    return {"sessions": out}


@router.post("/sessions")
def create_session(body: VibeSessionCreate):
    db = _load_sessions()
    sid = f"vs-{uuid.uuid4().hex[:10]}"
    now = datetime.datetime.utcnow().isoformat()
    row = {
        "id": sid,
        "title": body.title or "新会话",
        "created_at": now,
        "updated_at": now,
        "memory": "",
        "messages": [],
        "preview_html": "",
        "attachments": [],
    }
    db.setdefault("sessions", []).append(row)
    _save_sessions(db)
    return {"ok": True, "session": row}


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    db = _load_sessions()
    for s in db.get("sessions", []):
        if s.get("id") == session_id:
            row = dict(s)
            row.setdefault("attachments", [])
            return row
    raise HTTPException(404, "会话不存在")


@router.patch("/sessions/{session_id}")
def patch_session(session_id: str, body: VibeSessionPatch):
    db = _load_sessions()
    for s in db.get("sessions", []):
        if s.get("id") != session_id:
            continue
        if body.title is not None:
            s["title"] = body.title
        if body.messages is not None:
            s["messages"] = body.messages[-_MAX_SESSION_MESSAGES:]
        if body.memory is not None:
            s["memory"] = body.memory
        if body.preview_html is not None:
            s["preview_html"] = (body.preview_html or "")[:500000]
        if body.attachments is not None:
            s["attachments"] = body.attachments[:50]
        s["updated_at"] = datetime.datetime.utcnow().isoformat()
        _save_sessions(db)
        return {"ok": True, "session": s}
    raise HTTPException(404, "会话不存在")


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    db = _load_sessions()
    db["sessions"] = [x for x in db.get("sessions", []) if x.get("id") != session_id]
    _save_sessions(db)
    return {"ok": True}


@router.post("/upload")
async def upload_vibe(session: str = Form("default"), files: List[UploadFile] = File()):
    if not files:
        raise HTTPException(400, "未选择文件")
    sid = _safe_session(session)
    dirp = UPLOAD_ROOT / sid
    dirp.mkdir(parents=True, exist_ok=True)
    out = []
    for uf in files[:12]:
        raw = await uf.read()
        if len(raw) > _MAX_FILE_SIZE:
            raise HTTPException(400, f"文件过大（>{_MAX_FILE_SIZE // (1024*1024)}MB）: {uf.filename}")
        fn = _safe_filename(uf.filename)
        dest_name = f"{uuid.uuid4().hex[:10]}_{fn}"
        dest = dirp / dest_name
        dest.write_bytes(raw)
        mime = uf.content_type or mimetypes.guess_type(fn)[0] or "application/octet-stream"
        out.append({"path": f"{sid}/{dest_name}", "name": fn, "mime": mime, "size": len(raw)})
    return {"ok": True, "files": out}


@router.get("/upload-file")
def serve_upload(path: str):
    p = _resolve_upload_path(path)
    if not p:
        raise HTTPException(404)
    media = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
    return FileResponse(p, media_type=media, filename=p.name)


@router.post("/run")
def run_vibe(body: VibeRequest):
    import shutil

    if not shutil.which(body.tool) and body.tool != "direct-llm":
        return {
            "ok": False,
            "error": f"工具 '{body.tool}' 未安装或不在 PATH 中",
            "install_hint": _install_hint(body.tool),
        }

    cmd = _build_cmd(body)
    if not cmd:
        return {"ok": False, "error": f"不支持的工具: {body.tool}"}

    full_prompt = _merge_cli_prompt(body)
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(PROJECT_PATH),
            input=full_prompt if body.tool == "aider" else None,
        )
        output = result.stdout or result.stderr
        h = _load_history()
        h.append(
            {
                "ts": datetime.datetime.utcnow().isoformat(),
                "tool": body.tool,
                "prompt": full_prompt[:200],
                "output": (output or "")[:500],
                "ok": result.returncode == 0,
            }
        )
        _save_history(h)
        return {"ok": result.returncode == 0, "output": (output or "")[-5000:], "returncode": result.returncode}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "执行超时（120s）"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _anthropic_text_from_response(resp) -> str:
    parts = []
    for block in resp.content:
        t = getattr(block, "text", None)
        if t:
            parts.append(t)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "".join(parts) or "(无文本内容)"


def _build_multimodal_user_content(attachment_paths: List[str], user_text: str) -> List[dict]:
    content: List[dict] = []
    for rel in (attachment_paths or [])[:8]:
        p = _resolve_upload_path(rel)
        if not p:
            continue
        raw = p.read_bytes()
        mime = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
        if mime.startswith("image/"):
            b64 = base64.standard_b64encode(raw).decode("ascii")
            content.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}})
        else:
            try:
                excerpt = raw.decode("utf-8")[:12000]
            except UnicodeDecodeError:
                excerpt = f"[二进制文件 {p.name}，无法作为 UTF-8 文本注入；若为 PDF 请用知识库「抽取文本」或先转文本上传]"
            content.append({"type": "text", "text": f"附件《{p.name}》节选：\n{excerpt}\n"})
    content.append({"type": "text", "text": user_text})
    return content


@router.post("/llm")
def call_llm(body: DirectLLMRequest):
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
        user_parts: List[str] = []
        if body.memory_context:
            user_parts.append(f"[持久记忆 / 会话上下文]\n{body.memory_context}")
        user_parts.append(body.prompt)
        user_text = "\n\n".join(user_parts)

        sys_parts: List[str] = []
        if body.system:
            sys_parts.append(body.system)
        if body.expert_system:
            sys_parts.append(body.expert_system)
        system = "\n\n".join(sys_parts) if sys_parts else None

        if body.attachment_paths:
            blocks = _build_multimodal_user_content(body.attachment_paths, user_text)
            msgs = [{"role": "user", "content": blocks}]
        else:
            msgs = [{"role": "user", "content": user_text}]

        kwargs = {"model": body.model, "max_tokens": body.max_tokens, "messages": msgs}
        if system:
            kwargs["system"] = system
        resp = client.messages.create(**kwargs)
        text = _anthropic_text_from_response(resp)
        return {
            "ok": True,
            "content": text,
            "model": body.model,
            "usage": {"input": resp.usage.input_tokens, "output": resp.usage.output_tokens},
        }
    except ImportError:
        return {"ok": False, "error": "请安装 anthropic: pip install anthropic --break-system-packages"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/templates")
def get_templates():
    return [
        {"id": "implement", "name": "实现功能", "template": "请实现以下功能：\n{description}\n\n技术栈：{tech_stack}\n验收标准：{criteria}"},
        {"id": "review", "name": "代码审查", "template": "请审查以下代码，检查安全性、性能和代码质量：\n{code}"},
        {"id": "fix", "name": "修复 Bug", "template": "修复以下 Bug：\n错误信息：{error}\n相关代码：{code}\n期望行为：{expected}"},
        {"id": "refactor", "name": "重构代码", "template": "重构以下代码，保持功能不变，提升可读性和可维护性：\n{code}"},
        {"id": "test", "name": "编写测试", "template": "为以下代码编写单元测试（JUnit/Jest）：\n{code}"},
        {"id": "doc", "name": "生成文档", "template": "为以下代码生成 API 文档和使用说明：\n{code}"},
        {"id": "plan", "name": "需求规划", "template": "将以下需求拆解为可执行任务树：\n{requirement}\n技术栈：{tech_stack}"},
    ]


def _build_cmd(body: VibeRequest) -> Optional[list]:
    full_prompt = _merge_cli_prompt(body)
    if body.tool == "claude":
        cmd = ["claude", "--print", full_prompt]
        if body.model:
            cmd += ["--model", body.model]
        return cmd
    if body.tool == "opencode":
        return ["opencode", "run", "--prompt", full_prompt]
    if body.tool == "aider":
        cmd = ["aider", "--message", full_prompt, "--no-git"]
        if body.model:
            cmd += ["--model", body.model]
        return cmd
    return None


def _install_hint(tool: str) -> str:
    hints = {
        "claude": "npm install -g @anthropic-ai/claude-code",
        "opencode": "参考 https://github.com/sst/opencode",
        "aider": "pip install aider-chat --break-system-packages",
    }
    return hints.get(tool, f"请安装 {tool}")


# ── 工作区浏览（PROJECT_PATH 内，防路径穿越）────────────────────────────
_SKIP_LIST_DIR_NAMES = {
    "node_modules",
    ".git",
    "venv",
    ".venv",
    "__pycache__",
    ".mypy_cache",
    "dist",
    "build",
    ".gradle",
    "target",
    ".idea",
}


def _workspace_resolve(rel: str) -> Path:
    rel = (rel or "").replace("\\", "/").strip("/")
    if ".." in rel or rel.startswith("/"):
        raise HTTPException(400, "非法路径")
    base = PROJECT_PATH.resolve()
    target = (base / rel).resolve()
    try:
        target.relative_to(base)
    except ValueError as e:
        raise HTTPException(400, "路径越界") from e
    return target


def _terminal_cwd(rel: str) -> Path:
    rel = (rel or "").strip().replace("\\", "/")
    if not rel:
        return PROJECT_PATH.resolve()
    p = _workspace_resolve(rel)
    if not p.is_dir():
        raise HTTPException(400, "cwd 不是有效目录")
    return p


def _terminal_cwd_display(cwd_p: Path) -> str:
    root = PROJECT_PATH.resolve()
    try:
        if cwd_p.resolve() == root:
            return "."
        return str(cwd_p.resolve().relative_to(root))
    except ValueError:
        return str(cwd_p.resolve())


@router.get("/terminal/allowlist")
def vibe_terminal_allowlist():
    """返回可与「环境 / Docker」页相同的 argv[0] 白名单，便于 IDE 终端自检。"""
    from sop.web.routers.docker_env import _exec_allowlist

    return {"programs": sorted(_exec_allowlist())}


@router.post("/terminal/exec")
def vibe_terminal_exec(body: VibeTerminalExecBody):
    """在仓库根或子目录下执行命令；argv 由 shlex 解析，首段受白名单约束（见 docker_env._validate_argv）。"""
    from sop.web.routers.docker_env import _validate_argv

    raw = (body.command or "").strip()
    if not raw:
        raise HTTPException(400, "command 不能为空")
    try:
        argv = shlex.split(raw, posix=os.name != "nt")
    except ValueError as e:
        raise HTTPException(400, f"无法解析命令: {e}") from e
    if not argv:
        raise HTTPException(400, "解析后 argv 为空")
    cwd_p = _terminal_cwd(body.cwd or "")
    timeout = max(3, min(int(body.timeout_sec), 600))
    argv2 = _validate_argv([str(x) for x in argv])
    try:
        result = subprocess.run(
            argv2,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(cwd_p),
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "returncode": -1, "stdout": "", "stderr": f"执行超时（{timeout}s）", "argv": argv2, "cwd_display": _terminal_cwd_display(cwd_p)}
    except FileNotFoundError:
        return {"ok": False, "returncode": -1, "stdout": "", "stderr": f"命令未找到: {argv2[0]}", "argv": argv2, "cwd_display": _terminal_cwd_display(cwd_p)}
    except Exception as e:
        return {"ok": False, "returncode": -1, "stdout": "", "stderr": str(e), "argv": argv2, "cwd_display": _terminal_cwd_display(cwd_p)}

    out = (result.stdout or "")[-48000:]
    err = (result.stderr or "")[-24000:]
    h = _load_history()
    h.append(
        {
            "ts": datetime.datetime.utcnow().isoformat(),
            "tool": "terminal",
            "prompt": raw[:400],
            "output": ((out or "") + "\n" + (err or ""))[:500],
            "ok": result.returncode == 0,
        }
    )
    _save_history(h)
    return {
        "ok": result.returncode == 0,
        "returncode": result.returncode,
        "stdout": out,
        "stderr": err,
        "argv": argv2,
        "cwd_display": _terminal_cwd_display(cwd_p),
    }


_MAX_WORKSPACE_FILE = 600_000


@router.get("/workspace/list")
def workspace_list(path: str = ""):
    """列出项目目录下的子项（用于 IDE 目录树）。"""
    p = _workspace_resolve(path)
    if not p.exists():
        raise HTTPException(404, "路径不存在")
    if not p.is_dir():
        raise HTTPException(400, "不是目录")
    items: List[dict] = []
    try:
        children = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    except PermissionError:
        raise HTTPException(403, "无权限读取目录") from None
    for c in children:
        if c.is_dir() and c.name in _SKIP_LIST_DIR_NAMES:
            continue
        rel = str(c.relative_to(PROJECT_PATH.resolve())).replace("\\", "/")
        items.append({"name": c.name, "path": rel, "dir": c.is_dir()})
    return {"path": path, "items": items}


@router.get("/workspace/file")
def workspace_read_file(path: str):
    """读取项目内文本文件（用于 IDE 代码查看）。"""
    p = _workspace_resolve(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(404, "文件不存在")
    size = p.stat().st_size
    if size > _MAX_WORKSPACE_FILE * 4:
        return {
            "ok": True,
            "path": path,
            "size": size,
            "truncated": True,
            "binary": True,
            "hint": "文件过大，请在本地编辑器打开",
        }
    raw = p.read_bytes()[: _MAX_WORKSPACE_FILE + 1]
    truncated = len(raw) > _MAX_WORKSPACE_FILE or size > len(raw)
    raw = raw[:_MAX_WORKSPACE_FILE]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return {
            "ok": True,
            "path": path,
            "size": size,
            "binary": True,
            "truncated": truncated,
            "hint": "非 UTF-8 文本或二进制文件，无法在此预览",
        }
    mime = mimetypes.guess_type(str(p))[0] or "text/plain"
    return {
        "ok": True,
        "path": path,
        "size": size,
        "mime": mime,
        "content": text,
        "truncated": truncated,
        "binary": False,
    }
