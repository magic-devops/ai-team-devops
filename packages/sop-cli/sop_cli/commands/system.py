from __future__ import annotations

import typer

from .hermes import remote_worker, system_readiness

app = typer.Typer(help="系统全域 readiness：backend/frontend/CLI/SDK/权限/scope/脚本")
app.command("remote-worker")(remote_worker)


@app.command("readiness")
def readiness(
    full: bool = typer.Option(False, "--full", help="执行全域 readiness 检查"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    system_readiness(json_output=json_out, full=full)
