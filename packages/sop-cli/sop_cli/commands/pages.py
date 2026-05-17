"""
@module: sop_cli.commands.pages
@purpose: 系统页面、菜单、能力码控制面；供 CLI/Agent 理解模块边界
"""
from __future__ import annotations

from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, kv, warn

app = typer.Typer(help="页面菜单与能力：list/manifest/capabilities")


def _items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        raw = payload.get("items") or payload.get("react") or payload.get("pages") or []
    else:
        raw = payload or []
    return [item for item in raw if isinstance(item, dict)]


@app.command("list")
def list_pages(
    view: str = typer.Option("react", "--view", help="react|legacy|all"),
    domain: str = typer.Option("", "--domain", help="能力域过滤，如 portfolio/delivery/data/ai"),
    status: str = typer.Option("", "--status", help="状态过滤，如 active/migrating/legacy"),
    q: str = typer.Option("", "--q", help="关键词"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看 Manager 页面/菜单注册表，Agent 可据此选择专业模块入口。"""
    try:
        out = get_client().system_pages(view=view, domain=domain, status=status, q=q)
    except Exception as e:
        warn(f"Manager system pages 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    rows = _items(out)
    summary = out.get("summary") if isinstance(out, dict) else {}
    if isinstance(summary, dict):
        kv("total", summary.get("total", len(rows)))
        kv("avg_maturity", summary.get("avg_maturity", "-"))
    tbl = Table(title="system pages", show_header=True, header_style="bold")
    for col in ("id", "name", "domain", "path", "status", "maturity"):
        tbl.add_column(col)
    for item in rows:
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("name", ""))[:32],
            str(item.get("domain", "")),
            str(item.get("path", "")),
            str(item.get("status", "")),
            str(item.get("maturity", "")),
        )
    console.print(tbl)


@app.command("manifest")
def manifest(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """查看模块 Manifest，包含 React/legacy/权限/AI surfaces/分包策略。"""
    try:
        out = get_client().system_pages_manifest()
    except Exception as e:
        warn(f"Manager system pages manifest 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("schema", out.get("schema", ""))
    kv("react_modules", summary.get("react_modules", 0))
    kv("legacy_modules", summary.get("legacy_modules", 0))
    kv("capabilities", summary.get("capabilities", 0))
    kv("ai_surfaces", summary.get("ai_surfaces", 0))


@app.command("capabilities")
def capabilities(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """查看页面能力码、角色权限矩阵和 AI 能力覆盖。"""
    try:
        out = get_client().system_pages_capabilities()
    except Exception as e:
        warn(f"Manager system pages capabilities 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    rows = _items(out)
    tbl = Table(title="page capabilities", show_header=True, header_style="bold")
    for col in ("id", "domain", "capability", "submodules", "ai_surfaces"):
        tbl.add_column(col)
    for item in rows:
        submodules = item.get("submodules") or []
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("domain", "")),
            str(item.get("capability", "")),
            str(len(submodules) if isinstance(submodules, list) else 0),
            ",".join(str(x) for x in item.get("ai_surfaces") or [])[:60],
        )
    console.print(tbl)
