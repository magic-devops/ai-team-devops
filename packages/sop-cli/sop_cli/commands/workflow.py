"""
@module: sop_cli.commands.workflow
@purpose: WorkflowOps CLI：实例、事件、运行治理操作包和任务生成
"""
from __future__ import annotations

from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, kv, warn

app = typer.Typer(help="工作流：instances/events/ops-plan/ops-tasks")


def _rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        raw = payload.get("items") or []
    else:
        raw = payload or []
    return [item for item in raw if isinstance(item, dict)]


@app.command("instances")
def instances(
    limit: int = typer.Option(100, "--limit"),
    status: str = typer.Option("", "--status"),
    type: str = typer.Option("", "--type"),
    q: str = typer.Option("", "--q"),
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """查看工作流运行实例。"""
    try:
        out = get_client().workflow_instances(limit=limit, status=status, type=type, q=q)
    except Exception as e:
        warn(f"Manager workflow instances 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    tbl = Table(title="workflow instances", show_header=True, header_style="bold")
    for col in ("workflow_id", "type", "status", "duration_s", "engine"):
        tbl.add_column(col)
    for row in _rows(out):
        tbl.add_row(str(row.get("workflow_id", "")), str(row.get("type", "")), str(row.get("status", "")), str(row.get("duration_s", "")), str(row.get("engine", "")))
    console.print(tbl)


@app.command("events")
def events(limit: int = typer.Option(100, "--limit"), workflow_id: str = typer.Option("", "--workflow-id"), json_out: bool = typer.Option(False, "--json")) -> None:
    """查看工作流事件流水。"""
    try:
        out = get_client().workflow_events(limit=limit, workflow_id=workflow_id)
    except Exception as e:
        warn(f"Manager workflow events 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    tbl = Table(title="workflow events", show_header=True, header_style="bold")
    for col in ("ts", "workflow_id", "event", "status"):
        tbl.add_column(col)
    for row in _rows(out):
        tbl.add_row(str(row.get("ts", "")), str(row.get("workflow_id", "")), str(row.get("event", row.get("signal", ""))), str(row.get("status", "")))
    console.print(tbl)


@app.command("ops-plan")
def ops_plan(json_out: bool = typer.Option(False, "--json")) -> None:
    """输出 AI/CLI 可消费的 WorkflowOps 操作包。"""
    try:
        out = get_client().workflow_ops_plan()
    except Exception as e:
        warn(f"Manager workflow ops-plan 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    kv("health", (out.get("health") or {}).get("score"))
    kv("grade", (out.get("health") or {}).get("grade"))
    kv("task_candidates", len(out.get("task_candidates") or []))


@app.command("ops-tasks")
def ops_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建任务；默认仅预览"),
    priority: str = typer.Option("P1", "--priority"),
    assigned_to: str = typer.Option("Coder", "--assigned-to"),
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """将 WorkflowOps 候选项预览或生成任务。"""
    try:
        out = get_client().workflow_ops_tasks({"dry_run": not apply, "priority": priority, "assigned_to": assigned_to})
    except Exception as e:
        warn(f"Manager workflow ops-tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("dry_run", out.get("dry_run"))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
