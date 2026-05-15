"""
@module: sop_cli.commands.commands_cmd
@purpose: `sop commands` — 命令树与快速示例
"""
from __future__ import annotations

import typer
from rich.panel import Panel

from ..commands_info import COMMAND_TREE, QUICK_START, format_command_tree
from .._util import console

app = typer.Typer(help="列出全部子命令与说明", invoke_without_command=True)


@app.callback()
def list_commands(
    json_out: bool = typer.Option(False, "--json", help="JSON 输出（供脚本消费）"),
    examples: bool = typer.Option(False, "--examples", "-e", help="附带常用示例"),
) -> None:
    """打印 sop 命令树。"""
    if json_out:
        console.print_json(data={"commands": COMMAND_TREE})
        return
    body = format_command_tree()
    console.print(Panel(body, title="sop 子命令", border_style="blue"))
    if examples:
        console.print(Panel(QUICK_START.strip(), title="常用示例", border_style="green"))
