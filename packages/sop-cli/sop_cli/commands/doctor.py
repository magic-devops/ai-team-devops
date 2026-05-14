"""
@module: sop_cli.commands.doctor
@purpose: 端到端连通性自检（项目结构 / Manager / IPC / MCP / 工具配置）
@ai_safe_edit: 新增检测项往 _checks 表里加一条函数
"""
from __future__ import annotations

import json
import shutil
import socket
from pathlib import Path
from typing import Callable

import typer

from .._util import console, get_config, kv, ok, warn

app = typer.Typer(help="端到端自检")


def _check_local_state(cfg) -> tuple[bool, str]:
    f = cfg.project_path / "memory" / "current_state.json"
    if not f.is_file():
        return False, "memory/current_state.json 缺失 → sop init"
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
        return True, f"phase={d.get('phase','-')} pid={d.get('project_id','-')}"
    except Exception as e:
        return False, f"解析失败：{e}"


def _check_ai_memory(cfg) -> tuple[bool, str]:
    p = cfg.project_path / ".ai-memory"
    if not p.exists() and not p.is_symlink():
        return False, "缺少 .ai-memory（指向 .sop-runtime/ai-memory）"
    return True, str(p)


def _check_tool_configs(cfg) -> tuple[bool, str]:
    found = []
    for f in ("AGENTS.md", "CLAUDE.md", "opencode.json", ".cursorrules", ".windsurfrules",
              ".codex/config.toml", ".codex/hooks.json"):
        if (cfg.project_path / f).exists():
            found.append(f)
    return (len(found) >= 3), f"{len(found)} 个工具配置：{', '.join(found)}"


def _check_manager(cfg) -> tuple[bool, str]:
    try:
        from sop_sdk import build_default_client
        cli = build_default_client(cfg)
        h = cli.health()
        return bool(h.get("ok")), f"{h.get('service')} v{h.get('version')} mode={h.get('admin_mode')}"
    except Exception as e:
        return False, f"不可达：{e}"


def _check_rag_vector(cfg) -> tuple[bool, str]:
    try:
        from sop_sdk import build_default_client
        cli = build_default_client(cfg)
        r = cli.rag_backend()
        return True, f"VECTOR_DB_TYPE={r.get('backend')} sql_db={r.get('sql_db')}"
    except Exception as e:
        return False, f"RAG 探测失败：{e}"


def _check_agentd_ipc(cfg) -> tuple[bool, str]:
    sock = cfg.agentd_socket
    if not sock.exists():
        return False, f"socket 不存在：{sock}"
    try:
        s = socket.socket(socket.AF_UNIX); s.settimeout(0.5); s.connect(str(sock)); s.close()
        return True, str(sock)
    except Exception as e:
        return False, f"连接失败：{e}"


def _check_binaries(_cfg) -> tuple[bool, str]:
    missing = [b for b in ("python3", "git") if not shutil.which(b)]
    return (not missing), ("缺少：" + ",".join(missing) if missing else "齐全")


_CHECKS: list[tuple[str, Callable]] = [
    ("memory/current_state.json", _check_local_state),
    (".ai-memory/", _check_ai_memory),
    ("AI 工具配置", _check_tool_configs),
    ("Manager 连通", _check_manager),
    ("RAG 向量后端", _check_rag_vector),
    ("sop-agentd IPC", _check_agentd_ipc),
    ("基础依赖", _check_binaries),
]


@app.callback(invoke_without_command=True)
def doctor() -> None:
    cfg = get_config()
    console.rule("[bold]sop doctor")
    kv("project_path", cfg.project_path)
    kv("manager_url", cfg.manager_url)
    kv("project_id", cfg.project_id or "(未配对)")

    failed = 0
    for name, fn in _CHECKS:
        try:
            o, msg = fn(cfg)
        except Exception as e:  # pragma: no cover
            o, msg = False, f"异常：{e}"
        (ok if o else warn)(f"{name}: {msg}")
        if not o:
            failed += 1
    if failed == 0:
        console.print("[bold green]全部检查通过[/bold green]")
        raise typer.Exit(0)
    console.print(f"[bold red]{failed} 项未通过[/bold red]")
    raise typer.Exit(1)
