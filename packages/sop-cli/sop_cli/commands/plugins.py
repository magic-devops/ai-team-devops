from __future__ import annotations

import typer
from rich.table import Table

from .._util import console, get_client, kv, warn

app = typer.Typer(help="插件治理：governance")


@app.command("governance")
def governance(
    q: str = typer.Option("", "--q", help="插件 ID/入口过滤"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    try:
        out = get_client().plugins_governance(q=q)
    except Exception as e:
        warn(f"Manager plugins governance 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("plugins", summary.get("plugins", len(out.get("items") or [])))
    kv("ready", summary.get("ready", 0))
    kv("risk", summary.get("risk", 0))
    kv("trace_id", out.get("trace_id", ""))
    tbl = Table(title="plugins governance", show_header=True, header_style="bold")
    for col in ("id", "version", "status", "routers", "cli", "errors"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("id", ""))[:30],
            str(item.get("version", "")),
            str(item.get("status", "")),
            str(item.get("routers", 0)),
            str(item.get("cli_commands", 0)),
            "; ".join(str(x) for x in item.get("errors") or [])[:60],
        )
    console.print(tbl)
