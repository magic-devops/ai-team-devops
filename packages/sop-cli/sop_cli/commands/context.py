"""
@module: sop_cli.commands.context
@purpose: 展示 v4 隔离上下文（tenant / business / project 码与 id）及 Manager 探活回显
@ai_safe_edit: 仅追加展示字段；不改 TOML 结构约定
"""
from __future__ import annotations

import json

import typer
from rich.table import Table

from .._util import console, get_client, get_config, warn

app = typer.Typer(help="v4 上下文：三码 + project_path（默认子命令 show）")


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
