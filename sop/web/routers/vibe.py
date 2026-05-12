"""Vibe Coding：界面化调用底层 CLI 开发工具或大模型"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import subprocess, os, json, asyncio
from pathlib import Path

router = APIRouter(prefix="/api/vibe", tags=["vibe"])
PROJECT_PATH = Path(os.getenv("PROJECT_PATH", "."))

HISTORY_FILE = PROJECT_PATH / ".ai-memory" / "vibe_history.json"

def _load_history():
    return json.loads(HISTORY_FILE.read_text()) if HISTORY_FILE.exists() else []

def _save_history(h):
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(h[-100:], ensure_ascii=False, indent=2))  # 保留最近100条

class VibeRequest(BaseModel):
    prompt: str
    tool: str = "claude"          # claude | opencode | aider | direct-llm
    model: Optional[str] = None
    context_files: List[str] = [] # 附加上下文文件
    mode: str = "chat"            # chat | code | review | plan

class DirectLLMRequest(BaseModel):
    prompt: str; model: str = "claude-opus-4-7"
    system: Optional[str] = None; max_tokens: int = 4096

@router.get("/history")
def get_history(): return _load_history()

@router.delete("/history")
def clear_history():
    _save_history([]); return {"ok": True}

@router.post("/run")
def run_vibe(body: VibeRequest):
    """调用指定 CLI 工具执行开发任务"""
    import shutil, datetime
    if not shutil.which(body.tool) and body.tool != "direct-llm":
        return {"ok": False, "error": f"工具 '{body.tool}' 未安装或不在 PATH 中",
                "install_hint": _install_hint(body.tool)}

    # 构建命令
    cmd = _build_cmd(body)
    if not cmd: return {"ok": False, "error": f"不支持的工具: {body.tool}"}

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120,
                                cwd=str(PROJECT_PATH), input=body.prompt if body.tool == "aider" else None)
        output = result.stdout or result.stderr
        # 记录历史
        h = _load_history()
        h.append({"ts": datetime.datetime.utcnow().isoformat(), "tool": body.tool,
                  "prompt": body.prompt[:200], "output": output[:500], "ok": result.returncode == 0})
        _save_history(h)
        return {"ok": result.returncode == 0, "output": output[-5000:], "returncode": result.returncode}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "执行超时（120s）"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@router.post("/llm")
def call_llm(body: DirectLLMRequest):
    """直接调用 LLM API（不经过 CLI 工具）"""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY",""))
        msgs = [{"role": "user", "content": body.prompt}]
        kwargs = {"model": body.model, "max_tokens": body.max_tokens, "messages": msgs}
        if body.system: kwargs["system"] = body.system
        resp = client.messages.create(**kwargs)
        return {"ok": True, "content": resp.content[0].text, "model": body.model,
                "usage": {"input": resp.usage.input_tokens, "output": resp.usage.output_tokens}}
    except ImportError:
        return {"ok": False, "error": "请安装 anthropic: pip install anthropic --break-system-packages"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@router.get("/templates")
def get_templates():
    """常用 Vibe Coding 提示词模板"""
    return [
        {"id":"implement","name":"实现功能","template":"请实现以下功能：\n{description}\n\n技术栈：{tech_stack}\n验收标准：{criteria}"},
        {"id":"review","name":"代码审查","template":"请审查以下代码，检查安全性、性能和代码质量：\n{code}"},
        {"id":"fix","name":"修复 Bug","template":"修复以下 Bug：\n错误信息：{error}\n相关代码：{code}\n期望行为：{expected}"},
        {"id":"refactor","name":"重构代码","template":"重构以下代码，保持功能不变，提升可读性和可维护性：\n{code}"},
        {"id":"test","name":"编写测试","template":"为以下代码编写单元测试（JUnit/Jest）：\n{code}"},
        {"id":"doc","name":"生成文档","template":"为以下代码生成 API 文档和使用说明：\n{code}"},
        {"id":"plan","name":"需求规划","template":"将以下需求拆解为可执行任务树：\n{requirement}\n技术栈：{tech_stack}"},
    ]

def _build_cmd(body: VibeRequest) -> Optional[list]:
    if body.tool == "claude":
        cmd = ["claude", "--print", body.prompt]
        if body.model: cmd += ["--model", body.model]
        return cmd
    if body.tool == "opencode":
        return ["opencode", "run", "--prompt", body.prompt]
    if body.tool == "aider":
        cmd = ["aider", "--message", body.prompt, "--no-git"]
        if body.model: cmd += ["--model", body.model]
        return cmd
    return None

def _install_hint(tool: str) -> str:
    hints = {"claude": "npm install -g @anthropic-ai/claude-code",
             "opencode": "参考 https://github.com/sst/opencode",
             "aider": "pip install aider-chat --break-system-packages"}
    return hints.get(tool, f"请安装 {tool}")
