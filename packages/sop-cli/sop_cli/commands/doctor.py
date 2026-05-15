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
    pidf = cfg.project_path / ".sop-runtime" / "agentd.pid"
    if not sock.exists():
        hint = "修复: sop agentd start  或  make start-agentd"
        if pidf.is_file():
            hint += "（PID 文件存在但 socket 缺失，可先 sop agentd stop 再 start）"
        return False, f"socket 不存在：{sock} — {hint}"
    try:
        from sop_sdk import AgentdIpcClient
        ipc = AgentdIpcClient(sock)
        if ipc.available():
            h = ipc.health()
            if h.get("ok"):
                r = h.get("result") or {}
                auth = "bearer" if r.get("has_bearer") else ("apikey" if r.get("has_api_key") else "none")
                return True, f"{sock} project_id={r.get('project_id','-')} auth={auth}"
        s = socket.socket(socket.AF_UNIX)
        s.settimeout(0.5)
        s.connect(str(sock))
        s.close()
        return True, str(sock)
    except Exception as e:
        return False, f"连接失败：{e}"


def _check_binaries(_cfg) -> tuple[bool, str]:
    missing = [b for b in ("python3", "git") if not shutil.which(b)]
    return (not missing), ("缺少：" + ",".join(missing) if missing else "齐全")


def _check_platforms(cfg) -> tuple[bool, str]:
    reg_path = cfg.project_path / "ai-sop-ops" / "platforms" / "registry.json"
    if not reg_path.is_file():
        return False, "缺少 ai-sop-ops/platforms/registry.json"
    try:
        reg = json.loads(reg_path.read_text(encoding="utf-8"))
    except Exception as e:
        return False, f"registry 解析失败：{e}"
    root = cfg.project_path
    missing_shims: list[str] = []
    for p in reg.get("platforms") or []:
        if not isinstance(p, dict):
            continue
        if str(p.get("integration") or "") != "hooks":
            continue
        shim = str(p.get("hook_shim") or "")
        if shim and not (root / shim).is_file():
            missing_shims.append(str(p.get("id", "?")))
    if missing_shims:
        return False, f"缺少 hook shim：{', '.join(missing_shims)} → sop platforms init all"
    count = len(reg.get("platforms") or [])
    return True, f"{count} 个平台已注册"


def _check_auth_credentials(cfg) -> tuple[bool, str]:
    has_b = bool((cfg.bearer_token or "").strip())
    has_k = bool((cfg.api_key or "").strip())
    if has_b and has_k:
        return True, "Bearer + API Key 已配置（优先 Bearer）"
    if has_b:
        return True, "Bearer 已配置"
    if has_k:
        return True, "API Key 已配置"
    return False, "未登录 → sop login 或 sop login --pair"


def _check_sync_api(cfg) -> tuple[bool, str]:
    if not cfg.project_id:
        return True, "跳过（未配置 project_id → sop login）"
    if not cfg.bearer_token and not cfg.api_key:
        return False, "无鉴权 → sop login 或 sop login --pair"
    try:
        from sop_sdk import build_default_client
        cli = build_default_client(cfg)
        r = cli.sync_pull(cursor="", modules="tasks")
        return bool(r.get("ok")), f"pull ok total={r.get('total', 0)} cursor={r.get('cursor', '-')}"
    except Exception as e:
        return False, f"sync API 失败：{e}"


def _check_sync_local(cfg) -> tuple[bool, str]:
    try:
        from .sync import _compact_queue_items, _load_queue_items

        items, bad = _load_queue_items()
        compacted = _compact_queue_items(items)
    except Exception as e:
        return False, f"队列检查失败：{e}"

    entities = cfg.project_path / ".sop-runtime" / "sync" / "entities"
    entity_bad: list[str] = []
    entity_ok = 0
    if entities.is_dir():
        for f in sorted(entities.glob("*.json")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                if isinstance(d, dict):
                    entity_ok += 1
                else:
                    entity_bad.append(f.name)
            except Exception:
                entity_bad.append(f.name)
    state = cfg.project_path / ".sop-runtime" / "sync_state.json"
    duplicates = max(0, len(items) - len(compacted))
    detail = f"queue={len(items)} bad={bad} duplicates={duplicates} entities_ok={entity_ok} state={'✓' if state.is_file() else '—'}"
    if bad or entity_bad:
        if entity_bad:
            detail += f" bad_entities={','.join(entity_bad)}"
        return False, detail
    if duplicates:
        return True, detail + "（建议 sop sync compact）"
    return True, detail


def _check_project_manifest(cfg) -> tuple[bool, str]:
    p = cfg.project_path / ".sop-runtime" / "project_manifest.json"
    if not p.is_file():
        return False, "缺少 .sop-runtime/project_manifest.json → sop context manifest --write"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        return False, f"manifest 解析失败：{e}"
    schema = data.get("schema") if isinstance(data, dict) else ""
    project = data.get("project") if isinstance(data, dict) else {}
    if schema != "sop.project-manifest.v1" or not isinstance(project, dict):
        return False, f"manifest schema 异常：{schema or '-'}"
    return True, f"schema={schema} project={project.get('id') or '-'}"


_FIX_HINTS: dict[str, str] = {
    "memory/current_state.json": "sop init <project>  或  bash ai-sop-ops/init-ai-project.sh <project>",
    ".ai-memory/": "sop init 会创建 .ai-memory → .sop-runtime/ai-memory 符号链接",
    "AI 工具配置": "sop register <project>  或  sop platforms init all",
    "AI 平台适配": "sop platforms init all  或  检查 ai-sop-ops/platforms/registry.json",
    "Manager 连通": "bash ai-sop-ops/start-manager.sh  或  sop-manager start（默认 :8765）",
    "鉴权凭据": "sop login（Bearer）或 sop login --pair（API Key）",
    "sync API": "sop login 后 sop sync 或 sop sync --direct；agentd 会自动热加载凭据",
    "项目接入 manifest": "sop context manifest --write",
    "sync 本地状态": "坏队列行: sop sync repair；重复队列: sop sync compact；缺本地数据: sop sync pull --direct --materialize",
    "RAG 向量后端": "检查 Manager 环境变量 VECTOR_DB_TYPE / DATABASE_URL，见 ai-sop-ops/DATA_AND_VECTOR.md",
    "sop-agentd IPC": "sop agentd start  或  make start-agentd（需先 make build-agentd）",
    "基础依赖": "安装 python3、git（macOS: xcode-select --install）",
}


_CHECKS: list[tuple[str, Callable]] = [
    ("memory/current_state.json", _check_local_state),
    (".ai-memory/", _check_ai_memory),
    ("AI 工具配置", _check_tool_configs),
    ("AI 平台适配", _check_platforms),
    ("Manager 连通", _check_manager),
    ("鉴权凭据", _check_auth_credentials),
    ("sync API", _check_sync_api),
    ("项目接入 manifest", _check_project_manifest),
    ("sync 本地状态", _check_sync_local),
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
    failed_names: list[str] = []
    for name, fn in _CHECKS:
        try:
            o, msg = fn(cfg)
        except Exception as e:  # pragma: no cover
            o, msg = False, f"异常：{e}"
        (ok if o else warn)(f"{name}: {msg}")
        if not o:
            failed += 1
            failed_names.append(name)
    if failed == 0:
        console.print("[bold green]全部检查通过[/bold green]")
        if not cfg.project_id:
            console.print(
                "[muted]提示: project_id 未配对，sync 相关能力受限 → sop login --pair[/muted]"
            )
        raise typer.Exit(0)
    console.print(f"[bold red]{failed} 项未通过[/bold red]")
    console.print("\n[bold]修复建议[/bold]")
    for name in failed_names:
        if name in _FIX_HINTS:
            console.print(f"  • {name}: {_FIX_HINTS[name]}")
    console.print("[muted]完整说明: docs/TOOLS_AND_SCRIPTS.md[/muted]")
    raise typer.Exit(1)
