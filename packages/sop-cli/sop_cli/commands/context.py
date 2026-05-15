"""
@module: sop_cli.commands.context
@purpose: 展示 v4 隔离上下文（tenant / business / project 码与 id）及 Manager 探活回显
@ai_safe_edit: 仅追加展示字段；不改 TOML 结构约定
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="v4 上下文：三码 + project_path（默认子命令 show）")


def build_project_manifest() -> dict[str, Any]:
    """Build a secret-free manifest for IDEs, CLIs, and agents."""
    cfg = get_config()
    rt = cfg.project_path / ".sop-runtime"
    sync_dir = rt / "sync"
    manifest: dict[str, Any] = {
        "schema": "sop.project-manifest.v1",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "project": {
            "path": str(cfg.project_path),
            "id": cfg.project_id,
            "code": cfg.project_code or cfg.project_id,
            "tenant_id": cfg.tenant_id,
            "tenant_code": cfg.tenant_code or cfg.tenant_id,
            "business_code": cfg.business_code,
        },
        "manager": {
            "url": cfg.manager_url,
            "auth": "bearer" if cfg.bearer_token else ("api_key" if cfg.api_key or cfg.api_key_ref else "none"),
            "verify_ssl": cfg.verify_ssl,
        },
        "local": {
            "agent_toml": str(rt / "agent.toml"),
            "sync_state": str(rt / "sync_state.json"),
            "push_queue": str(sync_dir / "push_queue.jsonl"),
            "entities_dir": str(sync_dir / "entities"),
            "local_dir": str(rt / "local"),
            "rules_dir": str(cfg.project_path / ".ai-memory" / "rules"),
            "rule_proposals": str(rt / "rules" / "proposals.jsonl"),
            "custom_dir": str(cfg.project_path / "sop" / "custom"),
            "memory_state": str(cfg.project_path / "memory" / "current_state.json"),
            "platform_onboarding": str(rt / "platforms" / "onboarding.json"),
            "env": str(rt / "sop.env"),
            "work_snapshot": str(rt / "work_snapshot.json"),
            "memory_local": str(rt / "memory" / "local.jsonl"),
            "memory_outbox": str(rt / "memory" / "outbox.jsonl"),
            "kb_outbox": str(rt / "kb" / "outbox.jsonl"),
            "event_outbox": str(rt / "events" / "outbox.jsonl"),
            "usage_outbox": str(rt / "usage" / "outbox.jsonl"),
            "db_connections": str(rt / "db_connections.json"),
            "copilot_sessions": str(rt / "copilot" / "sessions.jsonl"),
        },
        "capabilities": {
            "context": ["sop context show", "sop context services", "sop context manifest", "sop context env", "sop status --json"],
            "sync": [
                "sop sync",
                "sop sync flush",
                "sop sync pull --direct --materialize",
                "sop sync watch --once",
                "sop sync status",
            ],
            "work_items": [
                "sop requirement list",
                "sop task list",
                "sop issue list",
                "sop sprint list",
                "sop work summary --json",
                "sop work next --json",
                "sop work export --local",
            ],
            "events": ["sop event emit", "sop event flush", "sop event list --json", "sop event subscribe --json"],
            "usage": [
                "sop usage record",
                "sop usage flush",
                "sop usage summary --json",
                "sop usage quota",
                "sop usage check llm_tokens 1000",
            ],
            "memory": [
                "sop memory add",
                "sop memory search --local",
                "sop memory recent --local --json",
                "sop memory summarize --local",
                "sop memory flush",
            ],
            "knowledge": ["sop kb add", "sop kb search --local --json", "sop kb flush", "sop kb index"],
            "copilot": ["sop copilot ask", "sop copilot sessions --json", "sop copilot show --json"],
            "data_sources": [
                "sop db-config drivers --json",
                "sop db-config list --json",
                "sop db-config add",
                "sop db-config test",
                "sop db-config export",
            ],
            "rules": ["sop rule list --local --proposals --json", "sop rule propose", "sop rule apply", "sop rule flush"],
            "platforms": ["sop platforms init all", "sop platforms doctor"],
            "ops": ["sop doctor", "sop ops health", "sop ops stack doctor"],
        },
        "interfaces": {
            "http": cfg.manager_url.rstrip("/") + "/api/v1",
            "agentd_socket": str(cfg.agentd_socket),
            "a2a_port": cfg.a2a_port,
            "mcp_servers": cfg.mcp_servers,
        },
    }
    onboarding_path = rt / "platforms" / "onboarding.json"
    if onboarding_path.is_file():
        try:
            manifest["platforms"] = json.loads(onboarding_path.read_text(encoding="utf-8"))
        except Exception:
            manifest["platforms"] = {"error": "failed to parse onboarding.json"}
    return manifest


def write_project_manifest(path: Path | None = None) -> Path:
    cfg = get_config()
    target = path or (cfg.project_path / ".sop-runtime" / "project_manifest.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(build_project_manifest(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target


def write_db_connections_cache(path: Path | None = None) -> Path | None:
    """Cache secret-free Manager data source configs for local agents."""
    cfg = get_config()
    target = path or (cfg.project_path / ".sop-runtime" / "db_connections.json")
    try:
        data = get_client(cfg).db_connections()
    except Exception as e:
        warn(f"远端数据源配置未刷新，可稍后执行 sop db-config export: {e}")
        return target if target.is_file() else None
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target


def _run_sop_optional(args: list[str], label: str) -> bool:
    cmd = [os.environ.get("SOP_CLI_PYTHON", sys.executable), "-m", "sop_cli", *args]
    r = subprocess.run(cmd, cwd=str(get_config().project_path), text=True)
    if r.returncode == 0:
        ok(f"{label} 完成")
        return True
    warn(f"{label} 未完成，可稍后手动执行: sop {' '.join(args)}")
    return False


def write_agent_context(
    *,
    manifest_path: Path,
    work_snapshot_path: Path,
    out: Path | None = None,
    prepared: dict[str, bool] | None = None,
) -> Path:
    """Write a secret-free context index for generic CLI/IDE/Agent consumers."""
    cfg = get_config()
    rt = cfg.project_path / ".sop-runtime"
    target = out or (rt / "agent_context.json")
    payload = {
        "schema": "sop.agent-context.v1",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "project_path": str(cfg.project_path),
        "project": {
            "id": cfg.project_id,
            "code": cfg.project_code or cfg.project_id,
            "tenant_code": cfg.tenant_code or cfg.tenant_id,
            "business_code": cfg.business_code,
        },
        "files": {
            "manifest": str(manifest_path),
            "env": str(rt / "sop.env"),
            "work_snapshot": str(work_snapshot_path),
            "sync_entities": str(rt / "sync" / "entities"),
            "push_queue": str(rt / "sync" / "push_queue.jsonl"),
            "rules": str(cfg.project_path / ".ai-memory" / "rules"),
            "rule_proposals": str(rt / "rules" / "proposals.jsonl"),
            "custom": str(cfg.project_path / "sop" / "custom"),
            "memory_state": str(cfg.project_path / "memory" / "current_state.json"),
            "platform_onboarding": str(rt / "platforms" / "onboarding.json"),
            "memory_local": str(rt / "memory" / "local.jsonl"),
            "memory_outbox": str(rt / "memory" / "outbox.jsonl"),
            "kb_outbox": str(rt / "kb" / "outbox.jsonl"),
            "event_outbox": str(rt / "events" / "outbox.jsonl"),
            "usage_outbox": str(rt / "usage" / "outbox.jsonl"),
            "db_connections": str(rt / "db_connections.json"),
            "copilot_sessions": str(rt / "copilot" / "sessions.jsonl"),
        },
        "commands": {
            "refresh": "sop context prepare",
            "manifest": "sop context manifest --write",
            "env": "sop context env --out .sop-runtime/sop.env",
            "work_snapshot": "sop work export --local",
            "sync_pull": "sop sync pull --direct --materialize",
            "sync_flush": "sop sync flush",
            "sync_watch": "sop sync watch --once",
            "next_work": "sop work next --local --json",
            "doctor": "sop doctor",
            "status": "sop status --json",
            "memory_recent": "sop memory recent --local --json",
            "memory_search": "sop memory search",
            "memory_flush": "sop memory flush",
            "kb_search": "sop kb search --local --json",
            "kb_flush": "sop kb flush",
            "rule_list": "sop rule list --local --proposals --json",
            "rule_flush": "sop rule flush",
            "event_emit": "sop event emit",
            "event_flush": "sop event flush",
            "event_subscribe": "sop event subscribe --json",
            "usage_summary": "sop usage summary --json",
            "usage_flush": "sop usage flush",
            "usage_check": "sop usage check llm_tokens 1000 --json",
            "db_drivers": "sop db-config drivers --json",
            "db_connections": "sop db-config list --json",
            "copilot_ask": "sop copilot ask",
            "copilot_sessions": "sop copilot sessions --json",
        },
        "prepared": prepared or {},
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target


def _show_table() -> None:
    cfg = get_config()
    tbl = Table(title="sop context（SDK / agent.toml）", show_header=True, header_style="bold")
    tbl.add_column("Key")
    tbl.add_column("Value")
    rows: list[tuple[str, str]] = [
        ("project_path", str(cfg.project_path)),
        ("manager_url", cfg.manager_url),
        ("tenant_id", cfg.tenant_id),
        ("tenant_code", cfg.tenant_code or "(空，请求头用 tenant_id 回填)"),
        ("business_code", cfg.business_code or "(空)"),
        ("project_id", cfg.project_id or "(空)"),
        ("project_code", cfg.project_code or "(空，请求头用 project_id 回填)"),
        ("auth", "bearer" if cfg.bearer_token else ("api_key" if cfg.api_key else "none")),
    ]
    for k, v in rows:
        tbl.add_row(k, v)
    console.print(tbl)

    try:
        cli = get_client(cfg)
        h = cli.health()
        tbl2 = Table(title="Manager GET /api/v1/health", show_header=True, header_style="bold")
        tbl2.add_column("Key")
        tbl2.add_column("Value")
        for key in ("ok", "service", "version", "admin_mode"):
            if key in h:
                tbl2.add_row(key, str(h.get(key)))
        console.print(tbl2)

        if cfg.bearer_token:
            d = cli.health_detail()
            paths = d.get("paths") if isinstance(d.get("paths"), dict) else {}
            tbl3 = Table(title="/api/v1/health/detail → paths（v4 作用域）", show_header=True, header_style="bold")
            tbl3.add_column("Key")
            tbl3.add_column("Value")
            for key in (
                "scope",
                "scopedTenantId",
                "scopedProjectId",
                "scopedTenantCode",
                "scopedBusinessCode",
                "scopedProjectCode",
                "projectPath",
            ):
                if key in paths:
                    tbl3.add_row(key, str(paths.get(key)))
            console.print(tbl3)
        else:
            warn("未配置 bearer：省略 health/detail 中的三码回显（sop login 或 SOP_BEARER_TOKEN）")
    except Exception as e:
        warn(f"Manager 不可达或未授权：{e}")


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    _show_table()


@app.command("show")
def show_cmd() -> None:
    """打印当前上下文（默认无子命令时等同本命令）。"""
    _show_table()


@app.command("json")
def json_cmd() -> None:
    """机器可读 JSON（CI / 脚本）。"""
    cfg = get_config()
    out: dict[str, object] = {
        "project_path": str(cfg.project_path),
        "manager_url": cfg.manager_url,
        "tenant_id": cfg.tenant_id,
        "tenant_code": cfg.tenant_code,
        "business_code": cfg.business_code,
        "project_id": cfg.project_id,
        "project_code": cfg.project_code,
    }
    try:
        cli = get_client(cfg)
        out["health"] = cli.health()
        if cfg.bearer_token:
            out["health_detail"] = cli.health_detail()
    except Exception as e:
        out["health_error"] = str(e)
    console.print(json.dumps(out, ensure_ascii=False, indent=2))


@app.command("manifest")
def manifest_cmd(
    write: bool = typer.Option(False, "--write", help="写入 .sop-runtime/project_manifest.json"),
    out: str = typer.Option("", "--out", "-o", help="写入指定路径；隐含 --write"),
) -> None:
    """输出/生成项目接入 manifest（不含密钥，适合 IDE/CLI/Agent 读取）。"""
    if write or out:
        target = write_project_manifest(Path(out).expanduser() if out else None)
        ok(f"manifest written: {target}")
        return
    console.print_json(data=build_project_manifest())


def _shell_quote(value: object) -> str:
    s = str(value if value is not None else "")
    return "'" + s.replace("'", "'\"'\"'") + "'"


def build_env_lines(*, export: bool = True) -> list[str]:
    """Build secret-free SOP_* env lines for generic CLI/Agent bootstrapping."""
    cfg = get_config()
    rt = cfg.project_path / ".sop-runtime"
    values = {
        "SOP_PROJECT_PATH": cfg.project_path,
        "SOP_MANAGER_URL": cfg.manager_url,
        "SOP_TENANT_ID": cfg.tenant_id,
        "SOP_TENANT_CODE": cfg.tenant_code or cfg.tenant_id,
        "SOP_BUSINESS_CODE": cfg.business_code,
        "SOP_PROJECT_ID": cfg.project_id,
        "SOP_PROJECT_CODE": cfg.project_code or cfg.project_id,
        "SOP_AGENT_TOML": rt / "agent.toml",
        "SOP_PROJECT_MANIFEST": rt / "project_manifest.json",
        "SOP_AGENT_CONTEXT": rt / "agent_context.json",
        "SOP_WORK_SNAPSHOT": rt / "work_snapshot.json",
        "SOP_DB_CONNECTIONS": rt / "db_connections.json",
        "SOP_COPILOT_SESSIONS": rt / "copilot" / "sessions.jsonl",
        "SOP_RULE_PROPOSALS": rt / "rules" / "proposals.jsonl",
        "SOP_MEMORY_LOCAL": rt / "memory" / "local.jsonl",
        "SOP_MEMORY_OUTBOX": rt / "memory" / "outbox.jsonl",
        "SOP_KB_OUTBOX": rt / "kb" / "outbox.jsonl",
        "SOP_EVENT_OUTBOX": rt / "events" / "outbox.jsonl",
        "SOP_USAGE_OUTBOX": rt / "usage" / "outbox.jsonl",
    }
    prefix = "export " if export else ""
    return [f"{prefix}{k}={_shell_quote(v)}" for k, v in values.items()]


@app.command("env")
def env_cmd(
    out: str = typer.Option("", "--out", "-o", help="写入 env 文件；例如 .sop-runtime/sop.env"),
    no_export: bool = typer.Option(False, "--no-export", help="不带 export 前缀，适合 .env 文件"),
) -> None:
    """输出无密钥 SOP_* 环境变量，供任意 CLI/Agent 快速接入。"""
    text = "\n".join(build_env_lines(export=not no_export)) + "\n"
    if out:
        target = Path(out).expanduser()
        if not target.is_absolute():
            target = get_config().project_path / target
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        ok(f"env written: {target}")
        return
    sys.stdout.write(text)


@app.command("prepare")
def prepare_cmd(
    pull: bool = typer.Option(False, "--pull", help="先直连 Manager 拉取并物化同步数据"),
    flush: bool = typer.Option(False, "--flush", help="冲刷 sync/memory/kb/event/usage 本地 outbox"),
    db_config: bool = typer.Option(True, "--db-config/--no-db-config", help="刷新远端无密钥数据库连接配置缓存"),
    platforms: bool = typer.Option(True, "--platforms/--no-platforms", help="刷新各 CLI/IDE/Agent 平台接入文件"),
    out: str = typer.Option(".sop-runtime/agent_context.json", "--out", "-o", help="Agent 上下文索引输出路径"),
) -> None:
    """一键准备本地 Agent 上下文：manifest、work snapshot、平台接入和可选远端物化。"""
    cfg = get_config()
    prepared: dict[str, bool] = {}
    if pull:
        prepared["sync_pull"] = _run_sop_optional(["sync", "pull", "--direct", "--materialize"], "同步物化")
    if flush:
        prepared["sync_flush"] = _run_sop_optional(["sync", "flush"], "同步队列冲刷")
        prepared["memory_flush"] = _run_sop_optional(["memory", "flush"], "记忆 outbox 冲刷")
        prepared["kb_flush"] = _run_sop_optional(["kb", "flush"], "知识库 outbox 冲刷")
        prepared["event_flush"] = _run_sop_optional(["event", "flush"], "事件 outbox 冲刷")
        prepared["usage_flush"] = _run_sop_optional(["usage", "flush"], "用量 outbox 冲刷")
    if platforms:
        prepared["platforms"] = _run_sop_optional(["platforms", "init", "all"], "平台接入刷新")

    manifest_path = write_project_manifest()
    prepared["manifest"] = True
    ok(f"manifest written: {manifest_path}")

    from .work import _build_snapshot

    work_snapshot_path = cfg.project_path / ".sop-runtime" / "work_snapshot.json"
    work_snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    work_snapshot_path.write_text(
        json.dumps(_build_snapshot(local=True, limit=20), ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    prepared["work_snapshot"] = True
    ok(f"work snapshot written: {work_snapshot_path}")
    if db_config:
        db_path = write_db_connections_cache()
        prepared["db_config"] = bool(db_path and db_path.is_file())
        if db_path and db_path.is_file():
            ok(f"db connections written: {db_path}")
    env_path = cfg.project_path / ".sop-runtime" / "sop.env"
    env_path.write_text("\n".join(build_env_lines(export=True)) + "\n", encoding="utf-8")
    prepared["env"] = True
    ok(f"env written: {env_path}")

    target = Path(out).expanduser()
    if not target.is_absolute():
        target = cfg.project_path / target
    agent_context_path = write_agent_context(
        manifest_path=manifest_path,
        work_snapshot_path=work_snapshot_path,
        out=target,
        prepared=prepared,
    )
    ok(f"agent context written: {agent_context_path}")


@app.command("services")
def services_cmd() -> None:
    """探测远端 Manager / Memory / KB / Sync / Worker / Data 能力。"""
    cfg = get_config()
    cli = get_client(cfg)
    checks = [
        ("manager", lambda: cli.health()),
        ("memory", lambda: cli.memory_health()),
        ("rag", lambda: cli.rag_backend()),
        ("sync", lambda: cli.sync_health()),
        ("worker", lambda: cli.worker_health()),
        ("data", lambda: cli.data_analytics_overview()),
    ]
    tbl = Table(title="远端能力探测", show_header=True, header_style="bold")
    tbl.add_column("service")
    tbl.add_column("status")
    tbl.add_column("detail")
    for name, fn in checks:
        try:
            data = fn()
            if isinstance(data, dict):
                detail = data.get("service") or data.get("backend") or data.get("ok") or "ok"
            else:
                detail = "ok"
            tbl.add_row(name, "ok", str(detail))
        except Exception as e:
            tbl.add_row(name, "offline", str(e)[:120])
    console.print(tbl)
