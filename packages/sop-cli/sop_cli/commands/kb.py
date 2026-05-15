"""
@module: sop_cli.commands.kb
@purpose: 知识库：search / rag / add / index / job
"""
from __future__ import annotations

import json

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="知识库检索、写入与索引（对接 Manager /api/v1/knowledge 与 /api/v1/rag）")


@app.command("search")
def kb_search(
    q: str = typer.Argument(..., help="关键词"),
    category: str = typer.Option("", "--category", "-c", help="分类过滤"),
) -> None:
    try:
        rows = get_client(get_config()).knowledge_search_workspace(q, category=category or None)
        tbl = Table(title=f"知识库: {q}", show_header=True, header_style="bold")
        tbl.add_column("id")
        tbl.add_column("category")
        tbl.add_column("path")
        tbl.add_column("content")
        for row in rows or []:
            if isinstance(row, dict):
                tbl.add_row(
                    str(row.get("id", "")),
                    str(row.get("category", "")),
                    str(row.get("path", "")),
                    str(row.get("content", ""))[:120],
                )
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("rag")
def kb_rag(
    q: str = typer.Argument(..., help="语义检索"),
    limit: int = typer.Option(8, "--limit", "-n", min=1, max=50),
) -> None:
    try:
        r = get_client(get_config()).rag_search(q, limit=limit)
        items = r.get("items") if isinstance(r, dict) else []
        tbl = Table(title=f"RAG: {q}", show_header=True, header_style="bold")
        tbl.add_column("collection")
        tbl.add_column("score")
        tbl.add_column("title")
        tbl.add_column("snippet")
        for it in items or []:
            if isinstance(it, dict):
                tbl.add_row(
                    str(it.get("collection", "")),
                    f"{it.get('score', 0):.3f}" if isinstance(it.get("score"), (int, float)) else "",
                    str(it.get("title", ""))[:40],
                    str(it.get("snippet", ""))[:100],
                )
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("add")
def kb_add(
    title: str = typer.Argument(..., help="标题"),
    content: str = typer.Argument(..., help="正文（Markdown）"),
    category: str = typer.Option("general", "--category", "-c"),
    tags: str = typer.Option("", "--tags", help="逗号分隔标签"),
) -> None:
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    try:
        r = get_client(get_config()).knowledge_create(
            {"title": title, "content": content, "category": category, "tags": tag_list}
        )
        console.print_json(data=r)
        ok("知识条目已写入")
    except Exception as e:
        warn(str(e))


@app.command("index")
def kb_index(async_job: bool = typer.Option(False, "--async", help="投递 Worker 异步索引")) -> None:
    try:
        client = get_client(get_config())
        if async_job:
            r = client.worker_enqueue("kb.index", {})
            console.print_json(data=r)
            ok(f"索引任务已投递: {r.get('job_id', '-')}")
        else:
            r = client.knowledge_index()
            console.print_json(data=r)
            ok(f"索引完成 count={r.get('count', '-')}")
    except Exception as e:
        warn(str(e))


@app.command("job")
def kb_job_status(job_id: str = typer.Argument(..., help="Worker job_id")) -> None:
    try:
        r = get_client(get_config()).worker_job_status(job_id)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print("[dim]子命令：search | rag | add | index | job[/dim]")
    if not get_config().project_id:
        warn("未配置 project_id：请在 .sop-runtime/agent.toml 设置 manager.project_id")
