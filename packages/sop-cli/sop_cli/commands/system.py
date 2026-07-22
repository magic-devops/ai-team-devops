from __future__ import annotations

import typer
from rich.table import Table

from .._util import console, get_client, kv, warn

app = typer.Typer(help="系统全域 readiness：backend/frontend/CLI/SDK/权限/scope/脚本")


@app.command("readiness")
def readiness(
    full: bool = typer.Option(False, "--full", help="执行全域 readiness 检查"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    if not full:
        warn("当前仅实现全域检查；请使用 --full")
    try:
        out = get_client().system_readiness_full()
    except Exception as e:
        warn(f"Manager system readiness 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("ok", out.get("ok"))
    kv("score", summary.get("score", 0))
    kv("ready", summary.get("ready", 0))
    kv("risk", summary.get("risk", 0))
    kv("trace_id", out.get("trace_id", ""))
    tbl = Table(title="system full readiness", show_header=True, header_style="bold")
    for col in ("id", "label", "status", "severity", "evidence"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("id", ""))[:42],
            str(item.get("label", ""))[:34],
            str(item.get("status", "")),
            str(item.get("severity", "")),
            str(item.get("evidence", ""))[:70],
        )
    console.print(tbl)
