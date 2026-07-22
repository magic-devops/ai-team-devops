from __future__ import annotations

import typer
from rich.table import Table

from .._util import console, get_client, kv, warn

app = typer.Typer(help="技能运行目录：runtime")


@app.command("runtime")
def runtime(
    skill: str = typer.Option("", "--skill", help="按技能 ID/名称过滤"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    try:
        out = get_client().skills_runtime()
    except Exception as e:
        warn(f"Manager skills runtime 不可用: {e}")
        raise typer.Exit(1)
    if skill:
        keyword = skill.lower()
        out["items"] = [
            item
            for item in out.get("items") or []
            if keyword in str(item.get("id", "")).lower() or keyword in str(item.get("name", "")).lower()
        ]
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("skills", summary.get("skills", len(out.get("items") or [])))
    kv("executable", summary.get("executable", 0))
    kv("trace_id", out.get("trace_id", ""))
    tbl = Table(title="skills runtime", show_header=True, header_style="bold")
    for col in ("id", "name", "role", "a2a", "mcp", "permissions"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("id", ""))[:28],
            str(item.get("name", ""))[:28],
            str(item.get("agent_role", "")),
            "yes" if item.get("a2a_exposed") else "no",
            "yes" if item.get("mcp_tool") else "no",
            ",".join(str(x) for x in item.get("permissions") or []),
        )
    console.print(tbl)
