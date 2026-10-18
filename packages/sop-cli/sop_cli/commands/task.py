"""
@module: sop_cli.commands.task
@purpose: 任务原版本意图与只读Manager缓存
"""
from __future__ import annotations

import json
from typing import Annotated, Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, kv, ok, warn
from . import hermes as hermes_cmd

app = typer.Typer(help="任务：list/show/schedule/feed/report/create/pull/done/fail/delete/issue（show 读取远端项目详情）")
app.add_typer(hermes_cmd.build_resource_app("tasks"), name="v1", help="Hermes 任务：list/get/create/patch")


def _acceptance_criteria(values: list[str]) -> list[str]:
    if len(values) > 80 or any(not value.strip() or len(value.strip()) > 2000 for value in values):
        raise typer.BadParameter("Use at most 80 nonblank criteria of at most 2000 characters", param_hint="--criterion")
    return [value.strip() for value in values]


def _submit(record, *, action, expected_version, key, event_time, local, **basis):
    from ..local_intents import submit_record

    try:
        result = submit_record(
            get_config(),
            "tasks",
            record,
            action=action,
            expected_version=expected_version,
            key=key,
            event_time=event_time,
            local=local,
            **basis,
        )
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc
    console.print_json(data=result)
    if not result["ok"]:
        raise typer.Exit(2)


def _load_synced() -> dict[str, dict[str, Any]]:
    """Read only the selected project's last Manager pull; never merge drafts."""
    cfg = get_config()
    runtime = cfg.project_path / ".sop-runtime"
    path = runtime / "sync" / "entities" / "tasks.json"
    if not path.is_file():
        return {}
    try:
        state = json.loads((runtime / "sync_state.json").read_text(encoding="utf-8"))
        if not isinstance(state, dict) or state.get("project_id") != cfg.project_id:
            raise ValueError("缓存不属于当前项目；请明确拉取当前项目后查看")
        rows = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(rows, dict) or any(not isinstance(row, dict) for row in rows.values()):
            raise ValueError("Manager缓存格式无效")
        for row in rows.values():
            if (
                "project_id" in row
                and row["project_id"] != cfg.project_id
                or "tenant_id" in row
                and row["tenant_id"] != cfg.tenant_id
            ):
                raise ValueError("缓存作用域与当前项目/租户不符")
        return rows
    except (OSError, ValueError, TypeError) as exc:
        warn(f"不能读取只读Manager缓存: {exc}")
        raise typer.Exit(2) from exc


def _local_items(*, status: str | None = None, priority: str | None = None) -> list[dict[str, Any]]:
    items = [dict(row) for row in _load_synced().values()]
    if status:
        items = [row for row in items if row.get("status") == status]
    if priority:
        items = [row for row in items if str(row.get("priority", "")).upper() == priority.upper()]
    return sorted(items, key=lambda row: str(row.get("created_at") or ""), reverse=True)


def _render(items: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in ("id", "status", "priority", "owner_id", "confidence", "title"):
        tbl.add_column(col)
    for t in items:
        try:
            confidence = f"{float(t.get('confidence') or 0):.2f}"
        except Exception:
            confidence = "0.00"
        tbl.add_row(
            str(t.get("id", "")),
            str(t.get("status", "")),
            str(t.get("priority", "")),
            str(t.get("owner_id", "")),
            confidence,
            (str(t.get("title") or ""))[:80],
        )
    console.print(tbl)


def _csv_ids(raw: str) -> list[str]:
    return [x.strip() for x in (raw or "").split(",") if x.strip()]


def _render_packets(items: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in ("order", "lane", "ready", "task_id", "priority", "assigned_to", "dev_tool", "gates", "title"):
        tbl.add_column(col)
    for item in items:
        tbl.add_row(
            str(item.get("order", "")),
            str(item.get("lane", "")),
            "yes" if item.get("ready") else "no",
            str(item.get("task_id", "")),
            str(item.get("priority", "")),
            str(item.get("assigned_to", "")),
            str(item.get("dev_tool", "")),
            str(len(item.get("quality_gates") or [])),
            str(item.get("title") or "")[:72],
        )
    console.print(tbl)


def _parse_gate_results(items: list[str] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in items or []:
        parts = str(item).split(":", 2)
        if not parts or not parts[0].strip():
            continue
        out.append({
            "id": parts[0].strip(),
            "status": parts[1].strip() if len(parts) > 1 and parts[1].strip() else "passed",
            "evidence": parts[2].strip() if len(parts) > 2 else "",
        })
    return out


@app.command(name="show")
def show_task(
    task_id: str = typer.Argument(..., help="当前项目的任务 ID"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """读取当前授权项目的任务详情；失败时明确退出，不使用本地缓存。"""
    try:
        with get_client() as client:
            detail = client.get_task(task_id)
    except Exception as exc:
        warn(f"读取任务详情失败: {exc}")
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=detail)
        return
    for key, value in detail.items():
        console.print(f"{key}: {value}", markup=False)


@app.command(name="schedule")
def schedule_tasks(
    ids: str = typer.Option("", "--ids", help="逗号分隔任务 ID；为空则调度整个任务池"),
    policy: str = typer.Option("quality_first", "--policy", help="quality_first|balanced|throughput|cost_saver"),
    max_items: int = typer.Option(50, "--max-items", min=1, max=300),
    max_parallel: int = typer.Option(6, "--max-parallel", min=1, max=50),
    include_blocked: bool = typer.Option(False, "--include-blocked", help="包含被依赖/状态阻塞的任务包"),
    owner_pool: str = typer.Option("", "--owner-pool", help="逗号分隔的项目成员稳定 ID"),
    apply: bool = typer.Option(False, "--apply", help="应用调度分配；默认只预览"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """生成 Hermes DAG 调度计划，供人工预览或 Agent 执行器消费。"""
    body = {
        "ids": _csv_ids(ids),
        "dry_run": not apply,
        "policy": policy,
        "max_items": max_items,
        "max_parallel": max_parallel,
        "include_blocked": include_blocked,
        "event": "cli.task.schedule",
        "owner_pool": _csv_ids(owner_pool),
    }
    try:
        out = get_client().task_scheduler_plan(body)
    except Exception as e:
        warn(f"Manager scheduler 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("schedule_id", out.get("schedule_id", "-"))
    kv("policy", out.get("policy", policy))
    kv("ready", summary.get("ready", 0))
    kv("blocked", summary.get("blocked", 0))
    kv("scheduled", summary.get("scheduled", 0))
    kv("quality_gates", summary.get("quality_gates", 0))
    if not out.get("dry_run"):
        ok(f"applied {out.get('applied', 0)} ready tasks")
    _render_packets(list(out.get("agent_packets") or []), "hermes scheduler packets")


@app.command(name="schedule-runs")
def schedule_runs(
    schedule_id: str = typer.Option("", "--id", help="查看指定调度详情"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    q: str = typer.Option("", "--q", help="按调度 ID、事件、任务 ID 检索"),
    include_archived: bool = typer.Option(False, "--include-archived", help="包含已归档调度"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看任务 DAG 调度运行历史和详情。"""
    try:
        out = get_client().task_scheduler_run_detail(schedule_id) if schedule_id else get_client().task_scheduler_runs(limit=limit, q=q, include_archived=include_archived)
    except Exception as e:
        warn(f"Manager scheduler runs 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if schedule_id:
        item = out.get("item") or {}
        summary = item.get("summary") or {}
        kv("schedule_id", item.get("schedule_id", schedule_id))
        kv("status", item.get("status", ""))
        kv("policy", item.get("policy", ""))
        kv("scheduled", summary.get("scheduled", 0))
        kv("applied", item.get("applied", 0))
        _render_packets(list(item.get("agent_packets") or []), "scheduler run packets")
        return
    summary = out.get("summary") or {}
    kv("runs", summary.get("runs", out.get("total", 0)))
    kv("scheduled", summary.get("scheduled", 0))
    kv("applied", summary.get("applied", 0))
    tbl = Table(title=f"scheduler runs total={out.get('total', 0)}", show_header=True, header_style="bold")
    for col in ("schedule_id", "status", "policy", "scheduled", "applied", "created_at"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        s = item.get("summary") or {}
        tbl.add_row(
            str(item.get("schedule_id", "")),
            str(item.get("status", "")),
            str(item.get("policy", "")),
            str(s.get("scheduled", 0)),
            str(item.get("applied", 0)),
            str(item.get("created_at", "")),
        )
    console.print(tbl)


@app.command(name="schedule-action")
def schedule_action(
    schedule_id: str = typer.Option(..., "--id", help="调度 ID"),
    action: str = typer.Option(..., "--action", help="rerun|cancel|archive|restore"),
    apply: bool = typer.Option(False, "--apply", help="实际执行；默认 dry-run"),
    policy: str = typer.Option("quality_first", "--policy", help="quality_first|balanced|throughput|cost_saver"),
    max_parallel: int = typer.Option(6, "--max-parallel", min=1, max=50),
    include_blocked: bool = typer.Option(False, "--include-blocked", help="重放时包含阻塞任务"),
    note: str = typer.Option("", "--note", help="治理说明"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """治理任务 DAG 调度历史：重放、取消、归档或恢复。"""
    body = {
        "action": action,
        "dry_run": not apply,
        "policy": policy,
        "max_parallel": max_parallel,
        "include_blocked": include_blocked,
        "note": note,
    }
    try:
        out = get_client().task_scheduler_run_action(schedule_id, body)
    except Exception as e:
        warn(f"Manager scheduler action 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if action == "rerun":
        plan = out.get("plan") or {}
        summary = plan.get("summary") or {}
        kv("schedule_id", plan.get("schedule_id", ""))
        kv("parent_schedule_id", plan.get("parent_schedule_id", schedule_id))
        kv("scheduled", summary.get("scheduled", 0))
        kv("applied", out.get("applied", 0))
        if not apply:
            warn("dry-run only; add --apply to create rerun schedule")
        _render_packets(list(plan.get("agent_packets") or []), "rerun packets")
        return
    ok(f"schedule {schedule_id} {action}")


@app.command(name="schedule-ops")
def schedule_ops(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """查看任务调度运营健康、未领取任务包、过期租约和质量阻断。"""
    try:
        out = get_client().task_scheduler_ops_summary()
    except Exception as e:
        warn(f"Manager scheduler ops 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("health_score", summary.get("health_score", 0))
    kv("ready_unclaimed", summary.get("ready_unclaimed", 0))
    kv("stale_claims", summary.get("stale_claims", 0))
    kv("quality_blocks", summary.get("quality_blocks", 0))
    kv("dependency_blocked", summary.get("dependency_blocked", 0))
    tbl = Table(title="scheduler recommendations", show_header=True, header_style="bold")
    for col in ("id", "severity", "title", "command"):
        tbl.add_column(col)
    for item in out.get("recommendations") or []:
        tbl.add_row(str(item.get("id", "")), str(item.get("severity", "")), str(item.get("title", "")), str(item.get("command", "")))
    console.print(tbl)


@app.command(name="schedule-runbook")
def schedule_runbook(
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认仅预览"),
    include_unclaimed: bool = typer.Option(True, "--include-unclaimed/--no-include-unclaimed", help="纳入未领取 ready packet"),
    include_stale_claims: bool = typer.Option(True, "--include-stale-claims/--no-include-stale-claims", help="纳入心跳过期租约"),
    include_quality_blocks: bool = typer.Option(True, "--include-quality-blocks/--no-include-quality-blocks", help="纳入质量阻断"),
    include_dependency_blocks: bool = typer.Option(True, "--include-dependency-blocks/--no-include-dependency-blocks", help="纳入依赖阻塞"),
    stale_minutes: int = typer.Option(30, "--stale-minutes", min=5, max=1440),
    owner_id: str = typer.Option("", "--owner-id", help="任务负责人稳定 ID；留空表示未分配"),
    priority: str = typer.Option("P1", "--priority", help="治理任务优先级"),
    limit: int = typer.Option(50, "--limit", min=1, max=200),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """生成任务调度自动化 Runbook，可预览或落为治理任务。"""
    body = {
        "dry_run": not apply,
        "include_unclaimed": include_unclaimed,
        "include_stale_claims": include_stale_claims,
        "include_quality_blocks": include_quality_blocks,
        "include_dependency_blocks": include_dependency_blocks,
        "stale_minutes": stale_minutes,
        "owner_id": owner_id,
        "priority": priority,
        "limit": limit,
        "note": "cli.task.schedule-runbook",
    }
    try:
        out = get_client().task_scheduler_runbook(body)
    except Exception as e:
        warn(f"Manager scheduler runbook 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("health_score", summary.get("health_score", 0))
    kv("steps", summary.get("steps", 0))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    tbl = Table(title="scheduler runbook", show_header=True, header_style="bold")
    for col in ("id", "type", "severity", "task_id", "title"):
        tbl.add_column(col)
    for step in out.get("steps") or []:
        tbl.add_row(str(step.get("id", "")), str(step.get("type", "")), str(step.get("severity", "")), str(step.get("task_id", "")), str(step.get("title", ""))[:80])
    console.print(tbl)
    if not apply:
        warn("dry-run only; add --apply to create governance tasks")


@app.command(name="schedule-insights")
def schedule_insights(
    ids: str = typer.Option("", "--ids", help="逗号分隔任务 ID；为空则分析整个任务池"),
    max_items: int = typer.Option(80, "--max-items", min=1, max=300),
    max_parallel: int = typer.Option(6, "--max-parallel", min=1, max=50),
    include_blocked: bool = typer.Option(False, "--include-blocked", help="策略对比时包含阻塞任务"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """分析任务依赖调度关键路径、策略对比和瓶颈。"""
    body = {
        "ids": _csv_ids(ids),
        "max_items": max_items,
        "max_parallel": max_parallel,
        "include_blocked": include_blocked,
    }
    try:
        out = get_client().task_scheduler_insights(body)
    except Exception as e:
        warn(f"Manager scheduler insights 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("health_score", summary.get("health_score", 0))
    kv("ready", summary.get("ready", 0))
    kv("blocked", summary.get("blocked", 0))
    kv("cycles", summary.get("cycles", 0))
    tbl = Table(title="scheduler policy comparison", show_header=True, header_style="bold")
    for col in ("policy", "scheduled", "ready", "blocked", "stages", "quality_gates"):
        tbl.add_column(col)
    for row in out.get("policy_comparison") or []:
        tbl.add_row(
            str(row.get("policy", "")),
            str(row.get("scheduled", 0)),
            str(row.get("ready", 0)),
            str(row.get("blocked", 0)),
            str(row.get("stages", 0)),
            str(row.get("quality_gates", 0)),
        )
    console.print(tbl)


@app.command(name="schedule-insight-tasks")
def schedule_insight_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认仅预览"),
    owner_id: str = typer.Option("", "--owner-id", help="任务负责人稳定 ID；留空表示未分配"),
    priority: str = typer.Option("P1", "--priority", help="治理任务优先级"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将调度洞察建议预览或生成治理任务。"""
    body = {"dry_run": not apply, "owner_id": owner_id, "priority": priority, "limit": limit}
    try:
        out = get_client().task_scheduler_insight_tasks(body)
    except Exception as e:
        warn(f"Manager scheduler insight tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("health_score", summary.get("health_score", 0))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    if not apply:
        warn("dry-run only; add --apply to create governance tasks")


@app.command(name="deps")
def dependency_graph(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """查看任务依赖图、就绪队列、阻塞队列和治理建议。"""
    try:
        out = get_client().task_dependencies()
    except Exception as e:
        warn(f"Manager task dependencies 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("nodes", summary.get("nodes", 0))
    kv("edges", summary.get("edges", 0))
    kv("ready", summary.get("ready", 0))
    kv("blocked", summary.get("blocked", 0))
    kv("cycles", summary.get("cycles", 0))
    tbl = Table(title="task dependency nodes", show_header=True, header_style="bold")
    for col in ("id", "priority", "status", "in", "out", "risk", "title"):
        tbl.add_column(col)
    for node in out.get("nodes") or []:
        tbl.add_row(
            str(node.get("id", "")),
            str(node.get("priority", "")),
            str(node.get("status", "")),
            str(node.get("incoming", 0)),
            str(node.get("outgoing", 0)),
            str(node.get("risk_level", "")),
            str(node.get("title", ""))[:72],
        )
    console.print(tbl)


@app.command(name="dep-tasks")
def dependency_governance_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认仅预览"),
    owner_id: str = typer.Option("", "--owner-id", help="任务负责人稳定 ID；留空表示未分配"),
    priority: str = typer.Option("P1", "--priority", help="治理任务优先级"),
    limit: int = typer.Option(30, "--limit", min=1, max=100),
    include_cycles: bool = typer.Option(True, "--include-cycles/--no-include-cycles", help="纳入依赖环路"),
    include_blocked: bool = typer.Option(True, "--include-blocked/--no-include-blocked", help="纳入高优先级阻塞"),
    include_bottlenecks: bool = typer.Option(True, "--include-bottlenecks/--no-include-bottlenecks", help="纳入关键上游瓶颈"),
    include_missing_map: bool = typer.Option(True, "--include-missing-map/--no-include-missing-map", help="纳入缺依赖地图"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将任务依赖图风险预览或生成治理任务。"""
    body = {
        "dry_run": not apply,
        "owner_id": owner_id,
        "priority": priority,
        "limit": limit,
        "include_cycles": include_cycles,
        "include_blocked": include_blocked,
        "include_bottlenecks": include_bottlenecks,
        "include_missing_map": include_missing_map,
    }
    try:
        out = get_client().task_dependency_tasks(body)
    except Exception as e:
        warn(f"Manager dependency governance tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    kv("blocked", summary.get("blocked", 0))
    kv("cycles", summary.get("cycles", 0))
    tbl = Table(title="dependency governance tasks", show_header=True, header_style="bold")
    for col in ("priority", "assigned_to", "source_report_id", "title"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("priority", "")),
            str(item.get("assigned_to", "")),
            str(item.get("source_report_id", "")),
            str(item.get("title", ""))[:88],
        )
    console.print(tbl)
    if not apply:
        warn("dry-run only; add --apply to create dependency governance tasks")


@app.command(name="feed")
def agent_feed(
    limit: int = typer.Option(10, "--limit", min=1, max=100),
    agent: str = typer.Option("", "--agent", help="指定 Agent 名称，返回任务包时覆盖 assignee"),
    include_blocked: bool = typer.Option(False, "--include-blocked", help="包含阻塞任务包"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """拉取 AI/CLI 可消费任务包；适合 Agent 循环自动取活。"""
    try:
        out = get_client().task_agent_feed(limit=limit, agent=agent, include_blocked=include_blocked)
    except Exception as e:
        warn(f"Manager agent-feed 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("ready", summary.get("ready", 0))
    kv("blocked", summary.get("blocked", 0))
    kv("scheduled", summary.get("scheduled", 0))
    _render_packets(list(out.get("items") or []), "agent feed")


@app.command(name="claims")
def agent_claims(
    status: str = typer.Option("active", "--status", help="active|all|closed"),
    limit: int = typer.Option(50, "--limit", min=1, max=500),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """只读历史名称登记；当前设备在线与执行租约请看交付工作台。"""
    try:
        out = get_client().task_agent_claims(status=status, limit=limit)
    except Exception as e:
        warn(f"Manager agent claims 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    tbl = Table(title=f"agent claims total={out.get('total', 0)}", show_header=True, header_style="bold")
    for col in ("claim_id", "task_id", "agent", "status", "progress", "lease_expires_at"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("claim_id", "")),
            str(item.get("task_id", "")),
            str(item.get("agent", "")),
            str(item.get("status", "")),
            str(item.get("progress", 0)),
            str(item.get("lease_expires_at", "")),
        )
    console.print(tbl)


@app.command(name="agent-plan")
def agent_plan(
    task_id: str = typer.Option("", "--task-id", help="任务 ID"),
    claim_id: str = typer.Option("", "--claim-id", help="领取 ID；传入后自动定位任务并校验 Agent"),
    agent: str = typer.Option("", "--agent", help="Agent 名称"),
    no_context: bool = typer.Option(False, "--no-context", help="不返回上下文文件清单"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """获取 AI/CLI 自主开发执行包：目标、依赖、质量卡点、上下文和回写命令。"""
    try:
        if claim_id and not task_id:
            out = get_client().task_agent_execution_plan({"claim_id": claim_id, "agent": agent, "include_context": not no_context})
        else:
            if not task_id:
                warn("--task-id 或 --claim-id 至少需要一个")
                raise typer.Exit(2)
            out = get_client().task_agent_plan(task_id, claim_id=claim_id, agent=agent, include_context=not no_context)
    except Exception as e:
        warn(f"Manager agent-plan 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    task = out.get("task") or {}
    deps = out.get("dependency_state") or {}
    kv("task", f"{task.get('id')} {task.get('title')}")
    kv("ready", deps.get("ready"))
    if deps.get("blocked_by"):
        warn("blocked_by: " + ", ".join(deps.get("blocked_by") or []))
    tbl = Table(title="agent execution steps", show_header=True, header_style="bold")
    for col in ("id", "required", "title", "command"):
        tbl.add_column(col)
    for step in out.get("execution_steps") or []:
        tbl.add_row(str(step.get("id", "")), str(step.get("required", "")), str(step.get("title", "")), str(step.get("command", ""))[:100])
    console.print(tbl)
    gates = out.get("quality_gates") or []
    if gates:
        gt = Table(title="quality gates", show_header=True, header_style="bold")
        for col in ("id", "severity", "type", "evidence"):
            gt.add_column(col)
        for gate in gates:
            gt.add_row(str(gate.get("id", "")), str(gate.get("severity", "")), str(gate.get("type", "")), str(gate.get("evidence", ""))[:80])
        console.print(gt)


@app.command(name="reports")
def agent_reports(
    limit: int = typer.Option(50, "--limit", min=1, max=500),
    status: str = typer.Option("", "--status", help="按报告状态过滤，如 completed/blocked/heartbeat"),
    agent: str = typer.Option("", "--agent", help="按 Agent 名称过滤"),
    task_id: str = typer.Option("", "--task-id", help="按任务 ID 过滤"),
    q: str = typer.Option("", "--q", help="关键词检索摘要、阻塞原因、后续动作"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """只读历史报告；这些报告不作为当前执行、测试或人工验收证据。"""
    try:
        out = get_client().task_agent_reports(limit=limit, status=status, agent=agent, task_id=task_id, q=q)
    except Exception as e:
        warn(f"Manager agent reports 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("reports", summary.get("reports", 0))
    kv("failed_gates", summary.get("failed_gates", 0))
    kv("artifacts", summary.get("artifacts", 0))
    tbl = Table(title="agent reports", show_header=True, header_style="bold")
    for col in ("created_at", "task_id", "agent", "status", "quality", "score", "failed_gates", "summary"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("created_at", ""))[:19],
            str(item.get("task_id", "")),
            str(item.get("agent", "")),
            str(item.get("status", "")),
            str(item.get("quality_decision", "")),
            str(item.get("quality_score", "")),
            ",".join(item.get("failed_gates") or [])[:60],
            str(item.get("summary") or item.get("status_message") or "")[:80],
        )
    console.print(tbl)


@app.command(name="gates")
def quality_gates(
    task_id: str = typer.Option("", "--task-id", help="查看指定任务的质量卡点；为空则查看默认策略"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看质量卡点策略或单任务卡点。"""
    try:
        out = get_client().task_quality(task_id) if task_id else get_client().task_quality_policy()
    except Exception as e:
        warn(f"Manager quality gates 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    policy = out.get("policy") or (out.get("quality") or {}).get("policy") or {}
    gates = out.get("default_gates") or (out.get("quality") or {}).get("gates") or []
    kv("mode", policy.get("mode", "-"))
    kv("required", len(policy.get("required_gate_ids") or []))
    tbl = Table(title="quality gates", show_header=True, header_style="bold")
    for col in ("id", "type", "severity", "required", "name"):
        tbl.add_column(col)
    for gate in gates:
        tbl.add_row(str(gate.get("id", "")), str(gate.get("type", "")), str(gate.get("severity", "")), str(gate.get("required", "")), str(gate.get("name", "")))
    console.print(tbl)


@app.command(name="evaluate")
def quality_evaluate(
    task_id: str = typer.Argument(..., help="任务 ID"),
    gate: list[str] | None = typer.Option(None, "--gate", help="质量卡点，格式 gate_id:passed|failed[:evidence]，可重复"),
    confidence: float | None = typer.Option(None, "--confidence", min=0, max=1),
    artifact_url: str = typer.Option("", "--artifact-url"),
    artifact_path: str = typer.Option("", "--artifact-path"),
    status: str = typer.Option("completed", "--status"),
    apply: bool = typer.Option(False, "--apply", help="落库评估并在阻断时更新任务状态"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """执行质量卡点评估。"""
    body: dict[str, Any] = {
        "task_id": task_id,
        "gate_results": _parse_gate_results(gate),
        "artifact_url": artifact_url,
        "artifact_path": artifact_path,
        "status": status,
        "dry_run": not apply,
        "source": "cli.task.evaluate",
    }
    if confidence is not None:
        body["confidence"] = confidence
    try:
        out = get_client().task_quality_evaluate(body)
    except Exception as e:
        warn(f"Manager quality evaluate 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    quality = out.get("quality") or {}
    kv("decision", quality.get("decision", ""))
    kv("score", quality.get("score", ""))
    if quality.get("blockers"):
        warn("blockers: " + ", ".join(quality.get("blockers") or []))


@app.command(name="quality-ops")
def quality_ops(
    limit: int = typer.Option(100, "--limit", min=1, max=500, help="读取最近质量评估条数"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看任务质量运营摘要，供 AI/CLI 判断交付风险。"""
    try:
        out = get_client().task_quality_summary(limit=limit)
    except Exception as e:
        warn(f"Manager quality ops 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("mode", summary.get("mode", "-"))
    kv("evaluations", summary.get("evaluations", 0))
    kv("avg_score", summary.get("avg_score", 0))
    kv("block", summary.get("block", 0))
    kv("warn", summary.get("warn", 0))
    tbl = Table(title="recent quality evaluations", show_header=True, header_style="bold")
    for col in ("task_id", "decision", "score", "blockers"):
        tbl.add_column(col)
    for row in (out.get("recent") or [])[:10]:
        tbl.add_row(
            str(row.get("task_id", "")),
            str(row.get("decision", "")),
            str(row.get("score", "")),
            ",".join(row.get("blockers") or []),
        )
    console.print(tbl)


@app.command(name="quality-policy-set")
def quality_policy_set(
    mode: str = typer.Option("blocking", "--mode", help="blocking|advisory|strict"),
    required: str = typer.Option("", "--required", help="必需卡点 ID，逗号分隔"),
    advisory: str = typer.Option("", "--advisory", help="建议卡点 ID，逗号分隔"),
    min_confidence: float = typer.Option(0.65, "--min-confidence", min=0, max=1),
    require_artifact: bool = typer.Option(True, "--require-artifact/--no-require-artifact", help="完成时是否要求产物证据"),
    auto_block: bool = typer.Option(True, "--auto-block/--no-auto-block", help="必需卡点失败时是否自动阻断"),
    notes: str = typer.Option("", "--notes", help="策略备注"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """更新任务质量卡点策略。"""
    try:
        current = get_client().task_quality_policy()
        policy = current.get("policy") or {}
        body = {
            "mode": mode or policy.get("mode", "blocking"),
            "required_gate_ids": _csv_ids(required) if required else (policy.get("required_gate_ids") or []),
            "advisory_gate_ids": _csv_ids(advisory) if advisory else (policy.get("advisory_gate_ids") or []),
            "auto_block_on_failed_required": auto_block,
            "min_confidence_to_complete": min_confidence,
            "require_artifact_for_complete": require_artifact,
            "notes": notes or policy.get("notes", ""),
        }
        out = get_client().task_quality_policy_update(body)
    except Exception as e:
        warn(f"Manager quality policy set 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    ok("quality policy updated")
    next_policy = out.get("policy") or {}
    kv("mode", next_policy.get("mode", ""))
    kv("required", ",".join(next_policy.get("required_gate_ids") or []))
    kv("advisory", ",".join(next_policy.get("advisory_gate_ids") or []))


@app.command(name="quality-tasks")
def quality_tasks(
    apply: bool = typer.Option(False, "--apply", help="真正创建质量治理任务；默认仅预览"),
    decision: list[str] | None = typer.Option(None, "--decision", help="筛选决策：block/warn/pass，可重复"),
    owner_id: str = typer.Option("", "--owner-id", help="任务负责人稳定 ID；留空表示未分配"),
    priority: str = typer.Option("P1", "--priority", help="P0|P1|P2|P3"),
    limit: int = typer.Option(50, "--limit", min=1, max=200),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """把质量阻断/告警评估任务化。"""
    body = {
        "dry_run": not apply,
        "decisions": decision or ["block", "warn"],
        "owner_id": owner_id,
        "priority": priority,
        "limit": limit,
    }
    try:
        out = get_client().task_quality_tasks(body)
    except Exception as e:
        warn(f"Manager quality tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("dry_run", out.get("dry_run", True))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    tbl = Table(title="quality governance tasks", show_header=True, header_style="bold")
    for col in ("title", "priority", "assigned_to", "source_report_id"):
        tbl.add_column(col)
    for row in (out.get("created") or out.get("planned") or [])[:10]:
        tbl.add_row(
            str(row.get("title", ""))[:80],
            str(row.get("priority", "")),
            str(row.get("assigned_to", "")),
            str(row.get("source_report_id", "")),
        )
    console.print(tbl)


@app.command(name="list")
def list_tasks(
    status: str | None = typer.Option(None, "--status"),
    priority: str | None = typer.Option(None, "--priority"),
    page: int = typer.Option(1, "--page", min=1),
    size: int = typer.Option(50, "--size", min=1, max=100),
    local: bool = typer.Option(False, "--local", help="显式查看当前项目只读Manager拉取缓存"),
) -> None:
    if local:
        items = _local_items(status=status, priority=priority)
        warn("只读Manager拉取缓存，可能过期；不含未处理本地意图")
        start = (page - 1) * size
        _render(items[start : start + size], f"Manager cache tasks total={len(items)}")
        return
    try:
        data = get_client().list_tasks(status=status, priority=priority, page=page, size=size)
        _render(list(data.get("items", [])), f"tasks total={data.get('total', '?')}")
    except Exception as exc:
        warn(f"Manager tasks读取失败: {exc}")
        raise typer.Exit(1) from exc


@app.command(name="create")
def create_task(
    title: str = typer.Argument(...),
    record_id: str = typer.Option(..., "--record-id", help="固定新任务ID"),
    description: str | None = typer.Option(None, "--desc"),
    priority: str | None = typer.Option(None, "--priority"),
    estimate: str | None = typer.Option(None, "--estimate"),
    owner_id: str | None = typer.Option(None, "--owner-id", help="稳定成员ID；空字符串表示未分配"),
    sprint_id: str | None = typer.Option(None, "--sprint"),
    req_id: str | None = typer.Option(None, "--requirement"),
    criterion: Annotated[
        list[str] | None, typer.Option("--criterion", help="任务自身验收标准，可重复指定")
    ] = None,
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """先冻结固定任务创建原件；不创建本地业务副本。"""
    record = {"id": record_id, "title": title}
    for name, value in {
        "description": description,
        "priority": priority.upper() if priority is not None else None,
        "estimate": estimate,
        "owner_id": owner_id,
        "sprint_id": sprint_id,
        "req_id": req_id,
    }.items():
        if value is not None:
            record[name] = value
    if criterion is not None:
        record["acceptance_criteria"] = _acceptance_criteria(criterion)
    _submit(
        record,
        action="create",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command()
def pull(
    task_id: str,
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """提交任务进入in_progress的原状态意图；执行领取使用正式执行流程。"""
    _submit(
        {"id": task_id, "status": "in_progress"},
        action="update",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command()
def done(
    task_id: str,
    notes: str | None = typer.Option(None, "--notes"),
    confidence: float | None = typer.Option(None, "--confidence", min=0, max=1),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """提交原完成状态意图；受管执行仍须证据审查，不代表已验收。"""
    record = {"id": task_id, "status": "completed"}
    if notes is not None:
        record["human_notes"] = notes
    if confidence is not None:
        record["confidence"] = confidence
    _submit(
        record,
        action="update",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command()
def fail(
    task_id: str,
    notes: str | None = typer.Option(None, "--notes"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """提交原阻塞状态意图，未处理时不修改当前状态。"""
    record = {"id": task_id, "status": "blocked"}
    if notes is not None:
        record["human_notes"] = notes
    _submit(
        record,
        action="update",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command(name="update")
def update_task(
    task_id: str = typer.Argument(...),
    title: str | None = typer.Option(None, "--title"),
    description: str | None = typer.Option(None, "--desc"),
    status: str | None = typer.Option(
        None, "--status", help="pending|in_progress|completed|blocked；不替代验收"
    ),
    priority: str | None = typer.Option(None, "--priority"),
    estimate: str | None = typer.Option(None, "--estimate"),
    owner_id: str | None = typer.Option(None, "--owner-id", help="稳定成员ID；空字符串明确清空"),
    actual_hours: float | None = typer.Option(None, "--hours", min=0),
    confidence: float | None = typer.Option(None, "--confidence", min=0, max=1),
    sprint_id: str | None = typer.Option(None, "--sprint"),
    req_id: str | None = typer.Option(None, "--requirement"),
    human_notes: str | None = typer.Option(None, "--notes"),
    criterion: Annotated[
        list[str] | None, typer.Option("--criterion", help="完整替换任务自身验收标准，可重复指定")
    ] = None,
    clear_criteria: bool = typer.Option(False, "--clear-criteria"),
    task_basis: str | None = typer.Option(None, "--task-basis", help="明确核对的原任务范围摘要"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    if criterion is not None and clear_criteria:
        raise typer.BadParameter("--criterion and --clear-criteria cannot be used together")
    record = {"id": task_id}
    if criterion is not None or clear_criteria:
        record["acceptance_criteria"] = _acceptance_criteria(criterion or [])
    for name, value in {
        "title": title,
        "description": description,
        "status": status,
        "priority": priority.upper() if priority is not None else None,
        "estimate": estimate,
        "owner_id": owner_id,
        "actual_hours": actual_hours,
        "confidence": confidence,
        "sprint_id": sprint_id,
        "req_id": req_id,
        "human_notes": human_notes,
    }.items():
        if value is not None:
            record[name] = value
    if len(record) == 1:
        raise typer.BadParameter("没有明确的更新字段")
    if {"owner_id", "acceptance_criteria"} & record.keys() and not task_basis:
        raise typer.BadParameter("修改负责人或验收标准需要 --task-basis；先核对原任务范围")
    _submit(
        record,
        action="update",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
        task_basis=task_basis,
    )


@app.command(name="delete")
def delete_task(
    task_id: str = typer.Argument(..., help="稳定记录ID"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """持久提交原删除意图；处理完成前不隐藏当前记录。"""
    _submit(
        {"id": task_id},
        action="delete",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command()
def issue(
    title: str,
    expected_version: int = typer.Option(..., "--expected-version", min=0),
    event_id: str = typer.Option(..., "--id"),
    event_time: str = typer.Option(..., "--time"),
    severity: str = typer.Option("P2", "--severity"),
    description: str = typer.Option("", "--desc"),
    task_id: str = typer.Option("", "--task"),
    local: bool = typer.Option(False, "--local"),
) -> None:
    """以同一冻结操作上报问题，未知送达结果保留原意图。"""
    from sop_sdk.event_envelope import FrozenEvent, integer
    from sop_sdk.event_outbox import EventOutbox

    from .._util import console
    from .event import _flush, _outbox_path

    try:
        integer(expected_version, "expected_version")
        frozen = FrozenEvent.create(
            "sop.issue.opened",
            {
                "expected_version": expected_version,
                "title": title,
                "severity": severity,
                "description": description,
                "task_id": task_id,
            },
            event_id=event_id,
            time=event_time,
            source="sop-cli",
        )
        with EventOutbox(_outbox_path()) as box:
            console.print_json(data=box.enqueue(frozen, get_config().project_id))
        if not local:
            console.print_json(data=_flush(20))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc
