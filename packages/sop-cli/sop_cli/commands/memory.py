"""
@module: sop_cli.commands.memory
@purpose: v4 记忆：health / recent / search / add（对接 Manager /api/v1/memory）
"""
from __future__ import annotations

import json

import typer
from rich.table import Table

from .._util import console, get_client, get_config, warn

app = typer.Typer(help="v4 记忆（文件后端；MEMORY_BACKEND 可扩展）")


@app.command("health")
def memory_health() -> None:
    try:
        h = get_client(get_config()).memory_health()
        console.print_json(data=h)
    except Exception as e:
        warn(str(e))


@app.command("recent")
def memory_recent(limit: int = typer.Option(20, "--limit", "-n", min=1, max=200)) -> None:
    try:
        r = get_client(get_config()).memory_recent(limit=limit)
        items = r.get("items") if isinstance(r, dict) else []
        tbl = Table(title="记忆 recent", show_header=True, header_style="bold")
        tbl.add_column("id")
        tbl.add_column("kind")
        tbl.add_column("content")
        for it in items or []:
            if isinstance(it, dict):
                c = str(it.get("content", ""))[:120]
                tbl.add_row(str(it.get("id", "")), str(it.get("kind", "")), c)
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("search")
def memory_search(
    q: str = typer.Argument(..., help="关键词"),
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=100),
) -> None:
    try:
        r = get_client(get_config()).memory_search(q, limit=limit)
        items = r.get("items") if isinstance(r, dict) else []
        tbl = Table(title=f"记忆 search: {q}", show_header=True, header_style="bold")
        tbl.add_column("id")
        tbl.add_column("kind")
        tbl.add_column("content")
        for it in items or []:
            if isinstance(it, dict):
                c = str(it.get("content", ""))[:160]
                tbl.add_row(str(it.get("id", "")), str(it.get("kind", "")), c)
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("add")
def memory_add(
    content: str = typer.Argument(..., help="记忆正文"),
    kind: str = typer.Option("long", "--kind", "-k", help="short|long|episodic"),
    meta_json: str = typer.Option("{}", "--meta", help="JSON 元数据"),
) -> None:
    try:
        md = json.loads(meta_json) if meta_json.strip() else {}
        if not isinstance(md, dict):
            raise ValueError("meta 须为 JSON object")
        if kind not in ("short", "long", "episodic"):
            warn("kind 应为 short|long|episodic")
            raise typer.Exit(2)
        r = get_client(get_config()).memory_add({"content": content, "kind": kind, "metadata": md})
        console.print_json(data=r)
    except json.JSONDecodeError:
        warn("--meta 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        warn(str(e))


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    cfg = get_config()
    console.print("[dim]子命令：health | recent | search | add；例：sop memory health[/dim]")
    if not cfg.project_id:
        warn("未配置 project_id：请在 .sop-runtime/agent.toml 设置 manager.project_id")
