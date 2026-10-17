"""
@module: sop_cli.commands.sprint
@purpose: Sprint 迭代管理：远端 Manager 优先，本地离线可写，并进入 sync push 队列
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

app = typer.Typer(help="迭代：list/create/update/complete/progress/delete（本地优先，远端增强）")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _slug(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9._-]+", "-", s.strip()).strip("-").lower()
    return out[:80] or "sprint"


def _runtime_dir() -> Path:
    return get_config().project_path / ".sop-runtime"


def _local_path() -> Path:
    return _runtime_dir() / "local" / "sprints.json"


def _deleted_path() -> Path:
    return _runtime_dir() / "local" / "sprints_deleted.json"


def _sync_entities_path() -> Path:
    return _runtime_dir() / "sync" / "entities" / "sprints.json"


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


def _write_sprint_doc(row: dict[str, Any]) -> None:
    sid = str(row.get("id") or "")
    goal = str(row.get("goal") or sid)
    path = get_config().project_path / "sop" / "custom" / "sprints" / f"{sid}-{_slug(goal)}.md"
    lines = [
        "---",
        f"id: {sid}",
        f"status: {row.get('status', 'active')}",
        f"planned_points: {row.get('planned_points', 0)}",
        f"velocity: {row.get('velocity', 0)}",
        f"completion_rate: {row.get('completion_rate', 0)}",
        f"started_at: {row.get('started_at', '')}",
        f"ends_at: {row.get('ends_at') or ''}",
        "---",
        "",
        f"# {goal}",
        "",
        "## Retrospective",
        str(row.get("retrospective") or "待补充").strip(),
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def _local_items(*, status: str | None = None) -> list[dict[str, Any]]:
    deleted = _deleted_ids()
    merged = _load_synced()
    merged.update(_load_local())
    items = [dict(v) for k, v in merged.items() if k not in deleted]
    if status:
        items = [x for x in items if str(x.get("status") or "") == status]
    return sorted(items, key=lambda x: str(x.get("started_at") or ""), reverse=True)


def _render(items: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in ("id", "status", "points", "velocity", "completion", "goal"):
        tbl.add_column(col)
    for r in items:
        tbl.add_row(
            str(r.get("id", "")),
            str(r.get("status", "")),
            str(r.get("planned_points", 0)),
            str(r.get("velocity", 0)),
            str(r.get("completion_rate", 0)),
            (str(r.get("goal") or ""))[:88],
        )
    console.print(tbl)


def _render_ops_plan(out: dict[str, Any]) -> None:
    health = out.get("health") or {}
    summary = out.get("summary") or {}
    tasks = summary.get("tasks") or {}
    kv("health_score", health.get("score", 0))
    kv("grade", health.get("grade", ""))
    kv("active_sprint", (out.get("sprint") or {}).get("id", "-"))
    kv("completion_rate", tasks.get("completion_rate", 0))
    kv("blocked", len(tasks.get("blocked") or []))
    tbl = Table(title="sprint ops risks", show_header=True, header_style="bold")
    for col in ("id", "severity", "category", "title", "command"):
        tbl.add_column(col)
    for item in out.get("risks") or []:
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("severity", "")),
            str(item.get("category", "")),
            str(item.get("title", ""))[:64],
            str(item.get("command", "")),
        )
    console.print(tbl)


@app.command(name="ops-plan")
def sprint_ops_plan(
    sprint_id: str = typer.Option("", "--sprint", help="指定 Sprint ID；默认使用活跃 Sprint"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """输出迭代治理 AI/CLI 操作包。"""
    try:
        out = get_client().sprint_ops_plan(sprint_id=sprint_id)
    except Exception as e:
        warn(f"Manager sprint ops-plan 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    _render_ops_plan(out)


@app.command(name="ops-tasks")
def sprint_ops_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认仅预览"),
    sprint_id: str = typer.Option("", "--sprint", help="指定 Sprint ID；默认使用活跃 Sprint"),
    priority: str = typer.Option("P1", "--priority", help="治理任务优先级"),
    owner_id: str = typer.Option("", "--owner-id", help="项目成员稳定 ID；留空表示未分配"),
    categories: str = typer.Option("", "--categories", help="逗号分隔过滤 planning,scope,blocking,quality,delivery,retrospective"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将迭代风险预览或生成治理任务。"""
    body = {
        "dry_run": not apply,
        "priority": priority,
        "owner_id": owner_id,
        "sprint_id": sprint_id,
        "categories": [x.strip() for x in categories.split(",") if x.strip()],
        "limit": limit,
    }
    try:
        out = get_client().sprint_ops_tasks(body)
    except Exception as e:
        warn(f"Manager sprint ops-tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    tbl = Table(title="sprint governance tasks", show_header=True, header_style="bold")
    for col in ("priority", "owner_id", "source_report_id", "title"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("priority", "")),
            str(item.get("owner_id", "")),
            str(item.get("source_report_id", "")),
            str(item.get("title", ""))[:84],
        )
    console.print(tbl)
    if not apply:
        warn("dry-run only; add --apply to create sprint governance tasks")


def _new_row(goal: str, *, planned_points: int, ends_at: str) -> dict[str, Any]:
    ts = _now()
    return {
        "id": f"SPRINT-local-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}",
        "goal": goal,
        "status": "active",
        "planned_points": planned_points,
        "velocity": 0.0,
        "completion_rate": 0.0,
        "retrospective": "",
        "started_at": ts,
        "ends_at": ends_at or None,
    }


def _save_and_queue(row: dict[str, Any]) -> None:
    data = _load_local()
    data[str(row["id"])] = row
    _save_local(data)
    deleted = _deleted_ids()
    deleted.discard(str(row["id"]))
    _save_deleted(deleted)
    _enqueue("sprints", row)
    _write_sprint_doc(row)


@app.command(name="list")
def list_sprints(
    status: str | None = typer.Option(None, "--status", help="active|completed|planned"),
    page: int = typer.Option(1, "--page"),
    size: int = typer.Option(20, "--size"),
    local: bool = typer.Option(False, "--local", help="只读取本地物化/离线迭代"),
) -> None:
    """列出 Sprint；Manager 不可用时回退本地。"""
    if not local:
        try:
            data = get_client().list_sprints(page=page, size=size)
            items = list(data.get("items", []))
            if status:
                items = [x for x in items if str(x.get("status") or "") == status]
            _render(items, f"sprints total={data.get('total', '?')}")
            return
        except Exception as e:
            warn(f"Manager sprints 不可用，回退本地: {e}")
    items = _local_items(status=status)
    start = max(page - 1, 0) * size
    _render(items[start : start + size], f"local sprints total={len(items)}")


@app.command(name="create")
def create_sprint(
    goal: str = typer.Argument(..., help="Sprint 目标"),
    planned_points: int = typer.Option(0, "--points", help="计划点数"),
    ends_at: str = typer.Option("", "--ends-at", help="结束时间 ISO8601，如 2026-06-01T18:00:00"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """创建 Sprint；离线时写 .sop-runtime/local 并追加 push_queue。"""
    body = {"goal": goal, "planned_points": planned_points, "ends_at": ends_at or None}
    if not local:
        try:
            out = get_client().create_sprint(body)
            ok(f"created sprint {out.get('id', '-')}")
            return
        except Exception as e:
            warn(f"Manager create sprint 不可用，写入本地队列: {e}")
    row = _new_row(goal, planned_points=planned_points, ends_at=ends_at)
    _save_and_queue(row)
    ok(f"local sprint queued {row['id']}")


@app.command(name="update")
def update_sprint(
    sprint_id: str = typer.Argument(..., help="Sprint ID"),
    goal: str | None = typer.Option(None, "--goal"),
    status: str | None = typer.Option(None, "--status"),
    planned_points: int | None = typer.Option(None, "--points"),
    velocity: float | None = typer.Option(None, "--velocity"),
    completion_rate: float | None = typer.Option(None, "--completion"),
    retrospective: str | None = typer.Option(None, "--retro"),
    ends_at: str | None = typer.Option(None, "--ends-at"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """更新 Sprint；离线时对本地副本打补丁并追加 upsert 队列。"""
    patch: dict[str, Any] = {}
    for k, v in {
        "goal": goal,
        "status": status,
        "planned_points": planned_points,
        "velocity": velocity,
        "completion_rate": completion_rate,
        "retrospective": retrospective,
        "ends_at": ends_at,
    }.items():
        if v is not None:
            patch[k] = v
    if not patch:
        warn("没有可更新字段")
        return
    if not local:
        try:
            get_client().update_sprint(sprint_id, patch)
            ok(f"updated sprint {sprint_id}")
            return
        except Exception as e:
            warn(f"Manager update sprint 不可用，写入本地队列: {e}")
    data = _load_local()
    base = dict(_load_synced().get(sprint_id) or data.get(sprint_id) or {"id": sprint_id, "goal": sprint_id})
    base.update(patch)
    base.setdefault("started_at", _now())
    _save_and_queue(base)
    ok(f"local sprint update queued {sprint_id}")


@app.command(name="complete")
def complete_sprint(
    sprint_id: str = typer.Argument(..., help="Sprint ID"),
    retrospective: str = typer.Option("", "--retro", help="回顾总结"),
    velocity: float | None = typer.Option(None, "--velocity"),
    completion_rate: float | None = typer.Option(None, "--completion"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """完成 Sprint；离线时标记 completed 并追加 upsert 队列。"""
    patch: dict[str, Any] = {"status": "completed", "retrospective": retrospective}
    if velocity is not None:
        patch["velocity"] = velocity
    if completion_rate is not None:
        patch["completion_rate"] = completion_rate
    if not local:
        try:
            get_client().update_sprint(sprint_id, patch)
            ok(f"completed sprint {sprint_id}")
            return
        except Exception as e:
            warn(f"Manager complete sprint 不可用，写入本地队列: {e}")
    data = _load_local()
    base = dict(_load_synced().get(sprint_id) or data.get(sprint_id) or {"id": sprint_id, "goal": sprint_id})
    base.update(patch)
    base.setdefault("started_at", _now())
    _save_and_queue(base)
    ok(f"local sprint complete queued {sprint_id}")


@app.command(name="progress")
def sprint_progress(
    sprint_id: str = typer.Argument(..., help="Sprint ID"),
    local: bool = typer.Option(False, "--local", help="只读取本地 Sprint 摘要"),
) -> None:
    """查看 Sprint 进度；远端不可用时展示本地 Sprint 元数据。"""
    if not local:
        try:
            data = get_client().sprint_progress(sprint_id)
            console.print_json(data=data)
            return
        except Exception as e:
            warn(f"Manager sprint progress 不可用，回退本地: {e}")
    row = (_load_local().get(sprint_id) or _load_synced().get(sprint_id) or {})
    if not row:
        warn(f"本地未找到 Sprint: {sprint_id}")
        raise typer.Exit(2)
    kv("id", row.get("id"))
    kv("status", row.get("status"))
    kv("planned_points", row.get("planned_points", 0))
    kv("velocity", row.get("velocity", 0))
    kv("completion_rate", row.get("completion_rate", 0))
    kv("goal", row.get("goal", ""))


@app.command(name="delete")
def delete_sprint(
    sprint_id: str = typer.Argument(..., help="Sprint ID"),
    local: bool = typer.Option(False, "--local", help="只写本地删除标记并进入同步队列"),
) -> None:
    """删除 Sprint；离线时写 tombstone 并追加 delete 队列。"""
    if not local:
        try:
            get_client().delete_sprint(sprint_id)
            ok(f"deleted sprint {sprint_id}")
            return
        except Exception as e:
            warn(f"Manager delete sprint 不可用，写入本地队列: {e}")
    data = _load_local()
    data.pop(sprint_id, None)
    _save_local(data)
    deleted = _deleted_ids()
    deleted.add(sprint_id)
    _save_deleted(deleted)
    _enqueue("sprints", {"id": sprint_id}, action="delete")
    ok(f"local sprint delete queued {sprint_id}")
