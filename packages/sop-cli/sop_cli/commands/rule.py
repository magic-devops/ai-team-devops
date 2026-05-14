"""
@module: sop_cli.commands.rule
@purpose: 规则操作：list / propose / apply
"""
from __future__ import annotations

import typer
from rich.table import Table

from .._util import console, err, get_client, ok

app = typer.Typer(help="规则库操作")


@app.command(name="list")
def list_rules() -> None:
    """列出当前活跃规则（GET /api/v1/rules）。"""
    cli = get_client()
    try:
        rows = cli._request("GET", "/api/v1/rules")
    except Exception as e:
        err(str(e)); raise typer.Exit(1)
    rows = rows if isinstance(rows, list) else []
    tbl = Table(title=f"rules total={len(rows)}", show_header=True, header_style="bold")
    for col in ("id", "category", "confidence", "rule"):
        tbl.add_column(col)
    for r in rows[:200]:
        tbl.add_row(str(r.get("id", "")), str(r.get("category", "")),
                    f"{r.get('confidence', 0):.2f}", (r.get("rule", "") or "")[:100])
    console.print(tbl)


@app.command()
def propose(rule: str, category: str = typer.Option("coding"), source: str = typer.Option("human"),
            confidence: float = typer.Option(0.75)) -> None:
    cli = get_client()
    try:
        out = cli._request(
            "POST",
            "/api/v1/rules",
            json_body={
                "rule": rule,
                "category": category,
                "source": source,
                "confidence": confidence,
            },
        )
    except Exception as e:
        err(str(e)); raise typer.Exit(1)
    ok(f"rule proposed: {out.get('id', '-')}")
