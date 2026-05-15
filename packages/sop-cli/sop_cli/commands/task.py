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

from .._util import console, err, get_client, get_config, kv, ok, warn

app = typer.Typer(help="任务：list/create/pull/done/fail/delete/issue（本地优先，远端增强）")


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
def issue(title: str, severity: str = typer.Option("P2", "--severity"), description: str = typer.Option("", "--desc")) -> None:
    """通过 IPC 上报 issue（agentd 不可用时降级到直连 Manager）。"""
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
        out = get_client().create_issue({"title": title, "severity": severity, "description": description})
    except Exception as e:
        err(str(e))
        raise typer.Exit(2) from e
    ok(f"issue reported via Manager: {out.get('id', '-')}")
