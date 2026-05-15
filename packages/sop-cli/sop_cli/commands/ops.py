"""
@module: sop_cli.commands.ops
@purpose: 运维：通知通道、同步拉取、Worker 探活
"""
from __future__ import annotations

import json

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="运维工具：notify / sync-pull / worker-health")


@app.command("notify-channels")
def notify_channels() -> None:
    try:
        rows = get_client(get_config()).notify_list_channels()
        tbl = Table(title="通知通道", show_header=True, header_style="bold")
        tbl.add_column("name")
        tbl.add_column("type")
        tbl.add_column("enabled")
        for ch in rows or []:
            if isinstance(ch, dict):
                tbl.add_row(str(ch.get("name", "")), str(ch.get("type", "")), str(ch.get("enabled", "")))
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("notify-test")
def notify_test(channel: str = typer.Argument(..., help="通道名称")) -> None:
    try:
        r = get_client(get_config()).notify_test_channel(channel)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("sync-pull")
def sync_pull(
    cursor: str = typer.Option("", "--cursor", help="ISO8601 游标"),
    modules: str = typer.Option("tasks,requirements,issues,sprints", "--modules", "-m"),
    out: str = typer.Option("", "--out", "-o", help="写入 JSON 文件"),
) -> None:
    try:
        r = get_client(get_config()).sync_pull(cursor=cursor, modules=modules)
        if out:
            with open(out, "w", encoding="utf-8") as f:
                json.dump(r, f, ensure_ascii=False, indent=2)
            ok(f"已写入 {out}")
        else:
            console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("worker-health")
def worker_health() -> None:
    try:
        r = get_client(get_config()).worker_health()
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print("[dim]子命令：notify-channels | notify-test | sync-pull | worker-health[/dim]")
