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

app = typer.Typer(help="任务：list/schedule/feed/report/create/pull/done/fail/delete/issue（本地优先，远端增强）")


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
