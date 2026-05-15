"""
@module: sop_cli.commands.context
@purpose: 展示 v4 隔离上下文（tenant / business / project 码与 id）及 Manager 探活回显
@ai_safe_edit: 仅追加展示字段；不改 TOML 结构约定
"""
from __future__ import annotations

import json
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
            "custom_dir": str(cfg.project_path / "sop" / "custom"),
            "memory_state": str(cfg.project_path / "memory" / "current_state.json"),
            "platform_onboarding": str(rt / "platforms" / "onboarding.json"),
        },
        "capabilities": {
            "context": ["sop context show", "sop context services", "sop context manifest"],
            "sync": ["sop sync", "sop sync flush", "sop sync pull --direct --materialize", "sop sync status"],
            "work_items": ["sop requirement list", "sop task list", "sop issue list", "sop sprint list"],
            "memory": ["sop memory add", "sop memory search", "sop memory summarize"],
            "knowledge": ["sop kb add", "sop kb search", "sop kb index"],
            "rules": ["sop rule list", "sop rule propose"],
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
