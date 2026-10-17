"""
@module: sop_cli.commands.workflow
@purpose: WorkflowOps CLI：实例、事件、运行治理操作包和任务生成
"""
from __future__ import annotations

import json
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, kv, warn

app = typer.Typer(help="工作流：start/detail/review/instances/events/ops-plan/ops-tasks")


@app.command("start")
def start(
    type: str = typer.Argument(..., help="已注册工作流类型"),
    workflow_id: str = typer.Option(..., "--id", help="稳定工作流ID，重试使用相同ID"),
    args: str = typer.Option("{}", "--args", help="工作流参数JSON对象"),
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """启动明确命名的工作流，不将一次网络重试变成新的运行。"""
    try:
        values = json.loads(args)
        if not isinstance(values, dict):
            raise ValueError("args must be a JSON object")
        out = get_client().start_workflow({"type": type, "workflow_id": workflow_id, "args": values})
    except Exception as exc:
        warn(f"Workflow start failed: {exc}")
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=out)
    else:
        kv("workflow_id", out.get("workflow_id", workflow_id))
        kv("status", out.get("status"))


@app.command("detail")
def detail(workflow_id: str = typer.Argument(...), json_out: bool = typer.Option(False, "--json")) -> None:
    try:
        out = get_client().workflow_detail(workflow_id)
    except Exception as exc:
        warn(f"Workflow detail failed: {exc}")
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=out)
    else:
        instance = out.get("instance") or out
        kv("status", instance.get("status"))
        kv("phase", instance.get("phase"))
        kv("decision", instance.get("decision"))


@app.command("review")
def review(
    workflow_id: str = typer.Argument(...),
    decision: str = typer.Option(..., "--decision", help="approve | request_changes | reject"),
    comment: str = typer.Option(..., "--comment", help="明确的人工审查意见"),
    request_id: str = typer.Option(..., "--request-id", help="稳定信号ID，重试保持一致"),
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """提交人工审查结论，不自动合并代码或完成业务任务。"""
    try:
        out = get_client().review_workflow(workflow_id, decision, comment, request_id)
    except Exception as exc:
        warn(f"Workflow review failed: {exc}")
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=out)
    else:
        kv("status", out.get("status"))
        kv("decision", out.get("decision"))


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
    owner_id: str = typer.Option("", "--owner-id", help="项目成员稳定 ID；留空表示未分配"),
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """将 WorkflowOps 候选项预览或生成任务。"""
    try:
        out = get_client().workflow_ops_tasks({"dry_run": not apply, "priority": priority, "owner_id": owner_id})
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
