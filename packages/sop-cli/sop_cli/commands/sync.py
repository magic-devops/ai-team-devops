"""
@module: sop_cli.commands.sync
@purpose: 双向同步规约/规则/知识（项目侧 ↔ Manager）
@ai_safe_edit:
  - 实际同步实现在 sop-agentd Reporter/Puller（M4）；本命令仅触发一次性同步
"""
from __future__ import annotations

import typer

from .._util import err, ok, warn
from sop_sdk import AgentdIpcClient

app = typer.Typer(help="一次性同步（规约/规则/知识）")


@app.callback(invoke_without_command=True)
def sync(
    rules: bool = typer.Option(True, "--rules/--no-rules", help="同步规则库"),
    specs: bool = typer.Option(True, "--specs/--no-specs", help="同步规约文档"),
    knowledge: bool = typer.Option(False, "--knowledge", help="同步知识库（默认关闭，体量大）"),
) -> None:
    ipc = AgentdIpcClient()
    if not ipc.available():
        warn("sop-agentd 未运行；当前只能手动调用 Manager")
        warn("启动：sop agentd start")
        raise typer.Exit(1)
    out = ipc.send("sync.trigger", data={"rules": rules, "specs": specs, "knowledge": knowledge})
    if out.get("ok"):
        ok(f"sync 已触发：{out.get('summary', '-')}")
    else:
        err(f"sync 失败：{out.get('error', '-')}")
        raise typer.Exit(2)
