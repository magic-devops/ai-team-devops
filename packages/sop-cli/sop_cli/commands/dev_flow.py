"""
@module: sop_cli.commands.dev_flow
@purpose: 研发全流程治理：AI/CLI 获取流程健康、风险、命令和任务化入口
"""
from __future__ import annotations

import typer
from rich.table import Table

from .._util import console, get_client, kv, warn

app = typer.Typer(help="研发全流程：ops-plan/ops-tasks")


@app.command("ops-plan")
def ops_plan(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """输出研发全流程 AI/CLI 治理操作包。"""
    try:
        out = get_client().dev_flow_ops_plan()
    except Exception as e:
        warn(f"Manager dev-flow ops-plan 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    health = out.get("health") or {}
    summary = out.get("summary") or {}
    kv("health_score", health.get("score", 0))
    kv("grade", health.get("grade", ""))
    kv("requirements", summary.get("requirements", 0))
    kv("tasks", summary.get("tasks", 0))
    kv("open_issues", summary.get("open_issues", 0))
    tbl = Table(title="dev-flow risks", show_header=True, header_style="bold")
    for col in ("id", "severity", "category", "title", "command"):
        tbl.add_column(col)
    for item in out.get("risks") or []:
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("severity", "")),
            str(item.get("category", "")),
            str(item.get("title", ""))[:60],
            str(item.get("command", "")),
        )
    console.print(tbl)


@app.command("lifecycle")
def lifecycle(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    try:
        out = get_client().dev_flow_lifecycle()
    except Exception as e:
        warn(f"Manager dev-flow lifecycle 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("ok", out.get("ok"))
    kv("score", summary.get("score", 0))
    kv("lifecycle", summary.get("lifecycle", ""))
    kv("trace_id", out.get("trace_id", ""))
    tbl = Table(title="dev-flow lifecycle", show_header=True, header_style="bold")
    for col in ("id", "label", "status", "cli"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("label", ""))[:32],
            str(item.get("status", "")),
            str(item.get("cli", ""))[:64],
        )
    console.print(tbl)


@app.command("ops-tasks")
def ops_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认仅预览"),
    priority: str = typer.Option("P1", "--priority", help="治理任务优先级"),
    assigned_to: str = typer.Option("FlowOps Agent", "--assigned-to", help="治理任务负责人"),
    categories: str = typer.Option("", "--categories", help="逗号分隔过滤 categories，如 requirements,tasks,issues"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将研发流程风险预览或生成治理任务。"""
    body = {
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "categories": [x.strip() for x in categories.split(",") if x.strip()],
        "limit": limit,
    }
    try:
        out = get_client().dev_flow_ops_tasks(body)
    except Exception as e:
        warn(f"Manager dev-flow ops-tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("health_score", summary.get("health_score", 0))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    tbl = Table(title="dev-flow governance tasks", show_header=True, header_style="bold")
    for col in ("priority", "assigned_to", "source_report_id", "title"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("priority", "")),
            str(item.get("assigned_to", "")),
            str(item.get("source_report_id", "")),
            str(item.get("title", ""))[:84],
        )
    console.print(tbl)
    if not apply:
        warn("dry-run only; add --apply to create dev-flow governance tasks")
