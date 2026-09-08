"""
@module: sop_cli.commands.task
@purpose: 任务管理：远端 Manager 优先，本地离线可写，并进入 sync push 队列
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, kv, ok, warn
from . import hermes as hermes_cmd

app = typer.Typer(help="任务：list/schedule/feed/report/create/pull/done/fail/delete/issue（本地优先，远端增强）")
app.add_typer(hermes_cmd.build_resource_app("tasks"), name="v1", help="Hermes 任务：list/get/create/patch")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _slug(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9._-]+", "-", s.strip()).strip("-").lower()
    return out[:80] or "task"


def _runtime_dir() -> Path:
    return get_config().project_path / ".sop-runtime"


def _local_path() -> Path:
    return _runtime_dir() / "local" / "tasks.json"


def _deleted_path() -> Path:
    return _runtime_dir() / "local" / "tasks_deleted.json"


def _sync_entities_path() -> Path:
    return _runtime_dir() / "sync" / "entities" / "tasks.json"


def _queue_path() -> Path:
    return _runtime_dir() / "sync" / "push_queue.jsonl"


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _load_local() -> dict[str, dict[str, Any]]:
    raw = _read_json(_local_path(), {})
    return raw if isinstance(raw, dict) else {}


def _save_local(data: dict[str, dict[str, Any]]) -> None:
    _write_json(_local_path(), data)


def _deleted_ids() -> set[str]:
    raw = _read_json(_deleted_path(), [])
    return {str(x) for x in raw} if isinstance(raw, list) else set()


def _save_deleted(ids: set[str]) -> None:
    _write_json(_deleted_path(), sorted(ids))


def _load_synced() -> dict[str, dict[str, Any]]:
    raw = _read_json(_sync_entities_path(), {})
    return raw if isinstance(raw, dict) else {}


def _enqueue(module: str, record: dict[str, Any], *, action: str = "upsert") -> None:
    _queue_path().parent.mkdir(parents=True, exist_ok=True)
    item = {
        "module": module,
        "action": action,
        "record": record,
        "idempotency_key": f"cli-{module}-{action}-{record.get('id', uuid.uuid4().hex)}-{uuid.uuid4().hex[:8]}",
    }
    with _queue_path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")


def _write_task_doc(row: dict[str, Any]) -> None:
    tid = str(row.get("id") or "")
    title = str(row.get("title") or tid)
    path = get_config().project_path / "sop" / "custom" / "tasks" / f"{tid}-{_slug(title)}.md"
    lines = [
        "---",
        f"id: {tid}",
        f"status: {row.get('status', 'pending')}",
        f"priority: {row.get('priority', 'P1')}",
        f"estimate: {row.get('estimate', 'M')}",
        f"assigned_to: {row.get('assigned_to', '')}",
        f"req_id: {row.get('req_id', '')}",
        f"sprint_id: {row.get('sprint_id', '')}",
        f"created_at: {row.get('created_at', '')}",
        "---",
        "",
        f"# {title}",
        "",
        str(row.get("description") or "").strip(),
        "",
        "## Notes",
        str(row.get("human_notes") or "待补充").strip(),
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def _local_items(*, status: str | None = None, priority: str | None = None) -> list[dict[str, Any]]:
    deleted = _deleted_ids()
    merged = _load_synced()
    merged.update(_load_local())
    items = [dict(v) for k, v in merged.items() if k not in deleted]
    if status:
        items = [x for x in items if str(x.get("status") or "") == status]
    if priority:
        pu = priority.upper()
        items = [x for x in items if str(x.get("priority") or "").upper() == pu]
    return sorted(items, key=lambda x: str(x.get("updated_at") or x.get("created_at") or ""), reverse=True)


def _render(items: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in ("id", "status", "priority", "assigned_to", "confidence", "title"):
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
            str(t.get("assigned_to", "")),
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


def _new_row(
    title: str,
    *,
    description: str,
    priority: str,
    estimate: str,
    assigned_to: str,
    sprint_id: str,
    req_id: str,
) -> dict[str, Any]:
    ts = _now()
    return {
        "id": f"T-local-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}",
        "req_id": req_id,
        "sprint_id": sprint_id,
        "title": title,
        "description": description,
        "status": "pending",
        "priority": priority.upper(),
        "estimate": estimate,
        "assigned_to": assigned_to or "Coder",
        "actual_hours": 0.0,
        "confidence": 0.0,
        "human_notes": "",
        "created_at": ts,
        "updated_at": ts,
    }


def _save_and_queue(row: dict[str, Any]) -> None:
    data = _load_local()
    data[str(row["id"])] = row
    _save_local(data)
    deleted = _deleted_ids()
    deleted.discard(str(row["id"]))
    _save_deleted(deleted)
    _enqueue("tasks", row)
    _write_task_doc(row)


@app.command(name="schedule")
def schedule_tasks(
    ids: str = typer.Option("", "--ids", help="逗号分隔任务 ID；为空则调度整个任务池"),
    policy: str = typer.Option("quality_first", "--policy", help="quality_first|balanced|throughput|cost_saver"),
    max_items: int = typer.Option(50, "--max-items", min=1, max=300),
    max_parallel: int = typer.Option(6, "--max-parallel", min=1, max=50),
    include_blocked: bool = typer.Option(False, "--include-blocked", help="包含被依赖/状态阻塞的任务包"),
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
    assigned_to: str = typer.Option("Ops", "--assigned-to", help="治理任务负责人"),
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
        "assigned_to": assigned_to,
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
    assigned_to: str = typer.Option("Scheduler Agent", "--assigned-to", help="治理任务负责人"),
    priority: str = typer.Option("P1", "--priority", help="治理任务优先级"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将调度洞察建议预览或生成治理任务。"""
    body = {"dry_run": not apply, "assigned_to": assigned_to, "priority": priority, "limit": limit}
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
    assigned_to: str = typer.Option("Dependency Agent", "--assigned-to", help="治理任务负责人"),
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
        "assigned_to": assigned_to,
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
    """查看 Agent 领取租约，用于调度中心、运维和自动执行器排障。"""
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


@app.command(name="claim")
def agent_claim(
    task_id: str = typer.Option("", "--task-id", help="指定任务 ID；为空则自动领取一个就绪任务"),
    agent: str = typer.Option("HermesAgent", "--agent", help="Agent 名称"),
    dev_tool: str = typer.Option("", "--dev-tool", help="codex/claude/cursor/qoder/openclaw/hermes-agent 等"),
    lease_seconds: int = typer.Option(900, "--lease-seconds", min=60, max=86400),
    force: bool = typer.Option(False, "--force", help="强制覆盖其他 Agent 的活跃租约"),
    no_start: bool = typer.Option(False, "--no-start", help="只领取，不自动把任务置为 in_progress"),
    note: str = typer.Option("", "--note", help="领取说明"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """领取一个 Agent 任务包并创建租约。"""
    body = {
        "task_id": task_id,
        "agent": agent,
        "dev_tool": dev_tool,
        "lease_seconds": lease_seconds,
        "force": force,
        "auto_start": not no_start,
        "note": note,
    }
    try:
        out = get_client().task_agent_claim(body)
    except Exception as e:
        warn(f"Manager agent claim 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    claim = out.get("claim") or {}
    ok(f"claimed {claim.get('task_id')} as {claim.get('agent')} claim_id={claim.get('claim_id')}")
    kv("lease_expires_at", claim.get("lease_expires_at", ""))
    plan = out.get("execution_plan") or {}
    if plan.get("execution_steps"):
        kv("execution_plan", f"sop task agent-plan --task-id {claim.get('task_id')} --claim-id {claim.get('claim_id')} --json")


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


@app.command(name="heartbeat")
def agent_heartbeat(
    claim_id: str = typer.Option("", "--claim-id", help="领取 ID；推荐传入"),
    task_id: str = typer.Option("", "--task-id", help="未传 claim-id 时可用任务 ID + agent 定位"),
    agent: str = typer.Option("", "--agent", help="Agent 名称"),
    progress: int = typer.Option(0, "--progress", min=0, max=100),
    state: str = typer.Option("running", "--state", help="claimed|running|heartbeat|blocked"),
    status_message: str = typer.Option("", "--message", "--status-message"),
    extend_seconds: int = typer.Option(900, "--extend-seconds", min=60, max=86400),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """发送 Agent 心跳并续约。"""
    body = {
        "claim_id": claim_id,
        "task_id": task_id,
        "agent": agent,
        "progress": progress,
        "state": state,
        "status_message": status_message,
        "extend_seconds": extend_seconds,
    }
    try:
        out = get_client().task_agent_heartbeat(body)
    except Exception as e:
        warn(f"Manager agent heartbeat 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    claim = out.get("claim") or {}
    ok(f"heartbeat {claim.get('claim_id')} progress={claim.get('progress')} lease={claim.get('lease_expires_at')}")


@app.command(name="report")
def agent_report(
    task_id: str = typer.Argument(..., help="任务 ID"),
    claim_id: str = typer.Option("", "--claim-id", help="领取 ID，用于关闭租约"),
    agent: str = typer.Option("", "--agent", help="Agent 名称"),
    status: str = typer.Option("completed", "--status", help="pending|in_progress|blocked|completed"),
    progress: int = typer.Option(100, "--progress", min=0, max=100),
    summary: str = typer.Option("", "--summary", "--notes", help="执行摘要"),
    confidence: float | None = typer.Option(None, "--confidence", min=0, max=1),
    artifact_url: str = typer.Option("", "--artifact-url"),
    artifact_path: str = typer.Option("", "--artifact-path"),
    branch: str = typer.Option("", "--branch"),
    gate: list[str] | None = typer.Option(None, "--gate", help="质量卡点，格式 gate_id:passed|failed[:evidence]，可重复"),
    block_reason: str = typer.Option("", "--block-reason"),
    next_action: str = typer.Option("", "--next-action"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """回写 Agent 执行结果、质量卡点和交付证据。"""
    body: dict[str, Any] = {
        "claim_id": claim_id,
        "agent": agent,
        "status": status,
        "progress": progress,
        "summary": summary,
        "artifact_url": artifact_url,
        "artifact_path": artifact_path,
        "branch": branch,
        "gate_results": _parse_gate_results(gate),
        "block_reason": block_reason,
        "next_action": next_action,
    }
    if confidence is not None:
        body["confidence"] = confidence
    try:
        out = get_client().task_agent_report(task_id, body)
    except Exception as e:
        warn(f"Manager agent-report 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    ok(f"reported {task_id} → {out.get('status', status)}")
    if out.get("failed_gates"):
        warn("failed gates: " + ", ".join(out.get("failed_gates") or []))
    quality = out.get("quality") or {}
    if quality:
        kv("quality_decision", quality.get("decision", ""))
        kv("quality_score", quality.get("score", ""))


@app.command(name="reports")
def agent_reports(
    limit: int = typer.Option(50, "--limit", min=1, max=500),
    status: str = typer.Option("", "--status", help="按报告状态过滤，如 completed/blocked/heartbeat"),
    agent: str = typer.Option("", "--agent", help="按 Agent 名称过滤"),
    task_id: str = typer.Option("", "--task-id", help="按任务 ID 过滤"),
    q: str = typer.Option("", "--q", help="关键词检索摘要、阻塞原因、后续动作"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看 Agent 执行报告、质量决策、失败卡点和交付证据。"""
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
    assigned_to: str = typer.Option("QA Agent", "--assigned-to", help="治理任务负责人"),
    priority: str = typer.Option("P1", "--priority", help="P0|P1|P2|P3"),
    limit: int = typer.Option(50, "--limit", min=1, max=200),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """把质量阻断/告警评估任务化。"""
    body = {
        "dry_run": not apply,
        "decisions": decision or ["block", "warn"],
        "assigned_to": assigned_to,
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
    status: str = typer.Option(None, "--status"),
    priority: str = typer.Option(None, "--priority"),
    page: int = typer.Option(1, "--page"),
    size: int = typer.Option(50, "--size"),
    local: bool = typer.Option(False, "--local", help="只读取本地物化/离线任务"),
) -> None:
    if not local:
        try:
            data = get_client().list_tasks(status=status, priority=priority, page=page, size=size)
            _render(list(data.get("items", [])), f"tasks total={data.get('total','?')}")
            return
        except Exception as e:
            warn(f"Manager tasks 不可用，回退本地: {e}")
    items = _local_items(status=status, priority=priority)
    start = max(page - 1, 0) * size
    _render(items[start : start + size], f"local tasks total={len(items)}")


@app.command(name="create")
def create_task(
    title: str = typer.Argument(..., help="任务标题"),
    description: str = typer.Option("", "--desc", help="任务描述"),
    priority: str = typer.Option("P1", "--priority", help="P0|P1|P2|P3"),
    estimate: str = typer.Option("M", "--estimate", help="XS|S|M|L|XL 或团队自定义"),
    assigned_to: str = typer.Option("Coder", "--assignee", help="负责人/角色"),
    sprint_id: str = typer.Option("", "--sprint", help="Sprint ID"),
    req_id: str = typer.Option("", "--requirement", help="需求 ID"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """创建任务；离线时写 .sop-runtime/local 并追加 push_queue。"""
    body = {
        "title": title,
        "description": description,
        "priority": priority,
        "estimate": estimate,
        "assigned_to": assigned_to,
        "sprint_id": sprint_id,
        "req_id": req_id,
    }
    if not local:
        try:
            out = get_client().create_task(body)
            ok(f"created task {out.get('id', '-')}")
            return
        except Exception as e:
            warn(f"Manager create task 不可用，写入本地队列: {e}")
    row = _new_row(
        title,
        description=description,
        priority=priority,
        estimate=estimate,
        assigned_to=assigned_to,
        sprint_id=sprint_id,
        req_id=req_id,
    )
    _save_and_queue(row)
    ok(f"local task queued {row['id']}")


@app.command()
def pull(task_id: str, local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列")) -> None:
    """认领任务（状态置 in_progress）。"""
    if not local:
        try:
            t = get_client().pull_task(task_id)
            ok(f"pulled {task_id}")
            kv("status", t.get("status"))
            kv("title", t.get("title"))
            return
        except Exception as e:
            warn(f"Manager pull task 不可用，写入本地队列: {e}")
    data = _load_local()
    base = dict(_load_synced().get(task_id) or data.get(task_id) or {"id": task_id, "title": task_id})
    base.update({"status": "in_progress", "updated_at": _now()})
    _save_and_queue(base)
    ok(f"local task pull queued {task_id}")


@app.command()
def done(
    task_id: str,
    notes: str = typer.Option("", "--notes"),
    confidence: float = typer.Option(0.8, "--confidence"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """完成任务；离线时标记 completed 并追加 upsert 队列。"""
    patch = {"status": "completed", "human_notes": notes, "confidence": confidence}
    if not local:
        try:
            get_client().update_task(task_id, patch)
            ok(f"{task_id} → completed (confidence={confidence})")
            return
        except Exception as e:
            warn(f"Manager done task 不可用，写入本地队列: {e}")
    data = _load_local()
    base = dict(_load_synced().get(task_id) or data.get(task_id) or {"id": task_id, "title": task_id})
    base.update(patch)
    base["updated_at"] = _now()
    _save_and_queue(base)
    ok(f"local task done queued {task_id}")


@app.command()
def fail(
    task_id: str,
    notes: str = typer.Option("", "--notes"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """阻塞任务；离线时标记 blocked 并追加 upsert 队列。"""
    patch = {"status": "blocked", "human_notes": notes}
    if not local:
        try:
            get_client().update_task(task_id, patch)
            ok(f"{task_id} → blocked")
            return
        except Exception as e:
            warn(f"Manager fail task 不可用，写入本地队列: {e}")
    data = _load_local()
    base = dict(_load_synced().get(task_id) or data.get(task_id) or {"id": task_id, "title": task_id})
    base.update(patch)
    base["updated_at"] = _now()
    _save_and_queue(base)
    ok(f"local task fail queued {task_id}")


@app.command(name="update")
def update_task(
    task_id: str = typer.Argument(..., help="任务 ID"),
    title: str | None = typer.Option(None, "--title"),
    description: str | None = typer.Option(None, "--desc"),
    status: str | None = typer.Option(None, "--status", help="pending|in_progress|completed|blocked"),
    priority: str | None = typer.Option(None, "--priority", help="P0|P1|P2|P3"),
    estimate: str | None = typer.Option(None, "--estimate"),
    assigned_to: str | None = typer.Option(None, "--assignee"),
    actual_hours: float | None = typer.Option(None, "--hours"),
    confidence: float | None = typer.Option(None, "--confidence"),
    sprint_id: str | None = typer.Option(None, "--sprint"),
    req_id: str | None = typer.Option(None, "--requirement"),
    human_notes: str | None = typer.Option(None, "--notes"),
    dev_tool: str | None = typer.Option(None, "--tool", help="codex/cursor/claude 等"),
    artifact_url: str | None = typer.Option(None, "--artifact-url"),
    artifact_path: str | None = typer.Option(None, "--artifact-path"),
    debug_notes: str | None = typer.Option(None, "--debug-notes"),
    branch: str | None = typer.Option(None, "--branch"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """更新任务；离线时对本地副本打补丁并追加 upsert 队列。"""
    patch: dict[str, Any] = {}
    for k, v in {
        "title": title,
        "description": description,
        "status": status,
        "priority": priority.upper() if priority else None,
        "estimate": estimate,
        "assigned_to": assigned_to,
        "actual_hours": actual_hours,
        "confidence": confidence,
        "sprint_id": sprint_id,
        "req_id": req_id,
        "human_notes": human_notes,
        "dev_tool": dev_tool,
        "artifact_url": artifact_url,
        "artifact_path": artifact_path,
        "debug_notes": debug_notes,
        "branch": branch,
    }.items():
        if v is not None:
            patch[k] = v
    if not patch:
        warn("没有可更新字段")
        return
    if not local:
        try:
            get_client().update_task(task_id, patch)
            ok(f"updated task {task_id}")
            return
        except Exception as e:
            warn(f"Manager update task 不可用，写入本地队列: {e}")
    data = _load_local()
    base = dict(_load_synced().get(task_id) or data.get(task_id) or {"id": task_id, "title": task_id})
    base.update(patch)
    base.setdefault("created_at", _now())
    base["updated_at"] = _now()
    _save_and_queue(base)
    ok(f"local task update queued {task_id}")


@app.command(name="delete")
def delete_task(
    task_id: str = typer.Argument(..., help="任务 ID"),
    local: bool = typer.Option(False, "--local", help="只写本地删除标记并进入同步队列"),
) -> None:
    """删除任务；离线时写 tombstone 并追加 delete 队列。"""
    if not local:
        try:
            get_client().delete_task(task_id)
            ok(f"deleted task {task_id}")
            return
        except Exception as e:
            warn(f"Manager delete task 不可用，写入本地队列: {e}")
    data = _load_local()
    data.pop(task_id, None)
    _save_local(data)
    deleted = _deleted_ids()
    deleted.add(task_id)
    _save_deleted(deleted)
    _enqueue("tasks", {"id": task_id}, action="delete")
    ok(f"local task delete queued {task_id}")


@app.command()
def issue(
    title: str,
    severity: str = typer.Option("P2", "--severity"),
    description: str = typer.Option("", "--desc"),
    task_id: str = typer.Option("", "--task", help="关联任务 ID"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """上报 issue；优先 agentd/Manager，离线时写入本地队列。"""
    if not local:
        from sop_sdk import AgentdIpcClient

        ipc = AgentdIpcClient()
        if ipc.available():
            out = ipc.report_issue(title=title, severity=severity, description=description)
            if out.get("ok"):
                ok(f"issue reported via agentd: {out.get('id', '-')}")
                return
            warn(f"agentd issue 上报失败，回退直连 Manager: {out.get('error', '-')}")
        else:
            warn("agentd 不可达，回退直连 Manager")
        try:
            out = get_client().create_issue(
                {"title": title, "severity": severity.upper(), "description": description, "task_id": task_id}
            )
            ok(f"issue reported via Manager: {out.get('id', '-')}")
            return
        except Exception as e:
            warn(f"Manager issue 上报不可用，写入本地队列: {e}")

    from . import issue as issue_cmd

    row = issue_cmd._new_row(
        title,
        description=description,
        issue_type="bug",
        severity=severity,
        task_id=task_id,
        sprint_id="",
        reported_by="sop task issue",
    )
    issue_cmd._save_and_queue(row)
    ok(f"local issue queued {row['id']}")
