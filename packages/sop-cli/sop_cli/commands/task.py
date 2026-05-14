"""
@module: sop_cli.commands.task
@purpose: 任务管理：list / pull / done / fail / issue
"""
from __future__ import annotations

import typer
from rich.table import Table

from .._util import console, err, get_client, kv, ok

app = typer.Typer(help="任务操作（透传 Manager）")


@app.command(name="list")
def list_tasks(
    status: str = typer.Option(None, "--status"),
    priority: str = typer.Option(None, "--priority"),
    page: int = typer.Option(1, "--page"),
    size: int = typer.Option(50, "--size"),
) -> None:
    cli = get_client()
    data = cli.list_tasks(status=status, priority=priority, page=page, size=size)
    items = data.get("items", [])
    tbl = Table(title=f"tasks total={data.get('total','?')}", show_header=True, header_style="bold")
    for col in ("id", "status", "priority", "assigned_to", "confidence", "title"):
        tbl.add_column(col)
    for t in items:
        tbl.add_row(
            str(t.get("id", "")), str(t.get("status", "")), str(t.get("priority", "")),
            str(t.get("assigned_to", "")), f"{t.get('confidence', 0):.2f}",
            (t.get("title", "") or "")[:80],
        )
    console.print(tbl)


@app.command()
def pull(task_id: str) -> None:
    """认领任务（状态置 in_progress）。"""
    cli = get_client()
    try:
        t = cli.pull_task(task_id)
    except Exception as e:
        err(str(e)); raise typer.Exit(1)
    ok(f"pulled {task_id}")
    kv("status", t.get("status"))
    kv("title", t.get("title"))


@app.command()
def done(task_id: str, notes: str = typer.Option("", "--notes"), confidence: float = typer.Option(0.8, "--confidence")) -> None:
    cli = get_client()
    cli.update_task(task_id, {"status": "completed", "human_notes": notes, "confidence": confidence})
    ok(f"{task_id} → completed (confidence={confidence})")


@app.command()
def fail(task_id: str, notes: str = typer.Option("", "--notes")) -> None:
    cli = get_client()
    cli.update_task(task_id, {"status": "blocked", "human_notes": notes})
    ok(f"{task_id} → blocked")


@app.command()
def issue(title: str, severity: str = typer.Option("P2", "--severity"), description: str = typer.Option("", "--desc")) -> None:
    """通过 IPC 上报 issue（agentd 不可用时降级到直连 Manager）。"""
    from sop_sdk import AgentdIpcClient
    ipc = AgentdIpcClient()
    if ipc.available():
        out = ipc.report_issue(title=title, severity=severity, description=description)
        if out.get("ok"):
            ok(f"issue reported via agentd: {out.get('id', '-')}")
            return
    # 降级：直连 Manager（M3 完成后调 _request POST /api/v1/issues）
    err("agentd 不可达，且 SDK 直连 issue 接口尚未实现（M9 完成后补）")
    raise typer.Exit(2)
