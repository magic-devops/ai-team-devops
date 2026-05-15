"""
@module: sop_cli.commands.copilot
@purpose: 对接 Manager Copilot API（ask / classify / summarize / suggest）
"""
from __future__ import annotations

import json

import typer

from .._util import console, get_client, get_config, warn

app = typer.Typer(help="AI Copilot：ask / classify / summarize / suggest")


@app.command("ask")
def copilot_ask(
    query: str = typer.Argument(..., help="自然语言问题"),
    context_json: str = typer.Option("{}", "--context", help="JSON 上下文"),
) -> None:
    try:
        ctx = json.loads(context_json) if context_json.strip() else {}
        if not isinstance(ctx, dict):
            raise ValueError("context 须为 JSON object")
        r = get_client(get_config()).copilot_ask(query, context=ctx)
        console.print_json(data=r)
    except json.JSONDecodeError:
        warn("--context 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        warn(str(e))


@app.command("classify")
def copilot_classify(text: str = typer.Argument(..., help="需求/任务文本")) -> None:
    try:
        r = get_client(get_config()).copilot_classify(text)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("summarize")
def copilot_summarize(items: list[str] = typer.Argument(..., help="多条事项")) -> None:
    try:
        r = get_client(get_config()).copilot_summarize(items)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("suggest")
def copilot_suggest(
    context: str = typer.Argument(..., help="上下文"),
    goal: str = typer.Option("", "--goal", "-g"),
) -> None:
    try:
        r = get_client(get_config()).copilot_suggest(context, goal=goal)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print("[dim]子命令：ask | classify | summarize | suggest[/dim]")
