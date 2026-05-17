"""
@module: sop_cli.commands.commands_cmd
@purpose: `sop commands` — 命令树与快速示例
"""
from __future__ import annotations

import typer
from ..commands_info import COMMAND_TREE, QUICK_START_GROUP_NAMES, command_tree_table, quick_start_panels
from .._util import console

app = typer.Typer(help="列出全部子命令与说明", invoke_without_command=True)


@app.callback()
def list_commands(
    json_out: bool = typer.Option(False, "--json", help="JSON 输出（供脚本消费）"),
    examples: bool = typer.Option(False, "--examples", "-e", help="附带常用示例"),
    group: str | None = typer.Option(
        None,
        "--group",
        "-g",
        help=f"只显示指定示例分组：{', '.join(QUICK_START_GROUP_NAMES)}",
    ),
) -> None:
    """打印 sop 命令树。"""
    if json_out:
        console.print_json(data={"commands": COMMAND_TREE})
        return
    if not group:
        console.print(command_tree_table())
    if examples or group:
        panels = quick_start_panels(group)
        if not panels:
            console.print(f"[yellow]未找到示例分组：{group}[/yellow]")
            console.print(f"可选分组：{', '.join(QUICK_START_GROUP_NAMES)}")
            raise typer.Exit(1)
        for panel in panels:
            console.print(panel)
