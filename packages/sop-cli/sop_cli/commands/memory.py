"""
@module: sop_cli.commands.memory
@purpose: v4 记忆：health / recent / search / add / forget / summarize / attach-run
"""
from __future__ import annotations

import json

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="v4 记忆：add/search/recent/forget/summarize/attach-run")


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


@app.command("forget")
def memory_forget(
    memory_id: list[str] = typer.Option(None, "--id", help="要删除的 memory id，可重复"),
    query: str = typer.Option("", "--query", "-q", help="按内容/metadata 包含关系删除"),
    kind: str = typer.Option("", "--kind", help="限制 kind"),
    yes: bool = typer.Option(False, "--yes", "-y", help="跳过确认"),
) -> None:
    ids = memory_id or []
    if not ids and not query.strip():
        warn("forget 需要 --id 或 --query")
        raise typer.Exit(2)
    if not yes:
        target = ", ".join(ids) if ids else f"query={query!r}"
        typer.confirm(f"确认删除记忆 {target}?", abort=True)
    try:
        r = get_client(get_config()).memory_forget(ids=ids, query=query, kind=kind)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))
        raise typer.Exit(2) from e


@app.command("summarize")
def memory_summarize(
    query: str = typer.Option("", "--query", "-q", help="仅摘要匹配内容"),
    limit: int = typer.Option(50, "--limit", "-n", min=1, max=200),
    meta_json: str = typer.Option("{}", "--meta", help="JSON 元数据"),
) -> None:
    try:
        md = json.loads(meta_json) if meta_json.strip() else {}
        if not isinstance(md, dict):
            raise ValueError("meta 须为 JSON object")
        r = get_client(get_config()).memory_summarize(query=query, limit=limit, metadata=md)
        console.print_json(data=r)
    except json.JSONDecodeError:
        warn("--meta 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        warn(str(e))
        raise typer.Exit(2) from e


@app.command("attach-run")
def memory_attach_run(
    memory_id: str = typer.Argument(..., help="memory id"),
    run_id: str = typer.Argument(..., help="Agent run id / workflow run id"),
    meta_json: str = typer.Option("{}", "--meta", help="JSON 元数据"),
) -> None:
    try:
        md = json.loads(meta_json) if meta_json.strip() else {}
        if not isinstance(md, dict):
            raise ValueError("meta 须为 JSON object")
        r = get_client(get_config()).memory_attach_run(memory_id, run_id=run_id, metadata=md)
        console.print_json(data=r)
        if r.get("updated"):
            ok(f"memory {memory_id} attached to run {run_id}")
    except json.JSONDecodeError:
        warn("--meta 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        warn(str(e))
        raise typer.Exit(2) from e


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    cfg = get_config()
    console.print("[dim]子命令：health | recent | search | add | forget | summarize | attach-run[/dim]")
    if not cfg.project_id:
        warn("未配置 project_id：请在 .sop-runtime/agent.toml 设置 manager.project_id")
