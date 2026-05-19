"""
@module: sop_cli.commands.issue
@purpose: 问题/缺陷管理：远端 Manager 优先，本地离线可写，并进入 sync push 队列
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

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="问题：list/create/update/resolve/delete（本地优先，远端增强）")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _slug(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9._-]+", "-", s.strip()).strip("-").lower()
    return out[:80] or "issue"


def _runtime_dir() -> Path:
    return get_config().project_path / ".sop-runtime"


def _local_path() -> Path:
    return _runtime_dir() / "local" / "issues.json"


def _deleted_path() -> Path:
    return _runtime_dir() / "local" / "issues_deleted.json"


def _sync_entities_path() -> Path:
    return _runtime_dir() / "sync" / "entities" / "issues.json"


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


def _write_issue_doc(row: dict[str, Any]) -> None:
    iid = str(row.get("id") or "")
    title = str(row.get("title") or iid)
    path = get_config().project_path / "sop" / "custom" / "issues" / f"{iid}-{_slug(title)}.md"
    lines = [
        "---",
        f"id: {iid}",
        f"type: {row.get('type', 'bug')}",
        f"severity: {row.get('severity', 'P2')}",
        f"status: {row.get('status', 'open')}",
        f"task_id: {row.get('task_id', '')}",
        f"created_at: {row.get('created_at', '')}",
        "---",
        "",
        f"# {title}",
        "",
        str(row.get("description") or "").strip(),
        "",
        "## Resolution",
        str(row.get("resolution") or "待处理").strip(),
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def _local_items(*, status: str | None = None, severity: str | None = None) -> list[dict[str, Any]]:
    deleted = _deleted_ids()
    merged = _load_synced()
    merged.update(_load_local())
    items = [dict(v) for k, v in merged.items() if k not in deleted]
    if status:
        items = [x for x in items if str(x.get("status") or "") == status]
    if severity:
        sv = severity.upper()
        items = [x for x in items if str(x.get("severity") or "").upper() == sv]
    return sorted(items, key=lambda x: str(x.get("created_at") or ""), reverse=True)


def _render(items: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in ("id", "status", "severity", "type", "task_id", "title"):
        tbl.add_column(col)
    for r in items:
        tbl.add_row(
            str(r.get("id", "")),
            str(r.get("status", "")),
            str(r.get("severity", "")),
            str(r.get("type", "")),
            str(r.get("task_id", "")),
            (str(r.get("title") or ""))[:88],
        )
    console.print(tbl)


def _render_ops_plan(out: dict[str, Any]) -> None:
    health = out.get("health") or {}
    summary = out.get("summary") or {}
    console.print(f"health_score: {health.get('score', 0)}")
    console.print(f"grade: {health.get('grade', '')}")
    console.print(f"open: {summary.get('open', 0)}")
    console.print(f"critical_open: {summary.get('critical_open', 0)}")
    console.print(f"stale_open: {summary.get('stale_open', 0)}")
    tbl = Table(title="issue ops risks", show_header=True, header_style="bold")
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
def issue_ops_plan(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """输出问题治理 AI/CLI 操作包。"""
    try:
        out = get_client().issue_ops_plan()
    except Exception as e:
        warn(f"Manager issue ops-plan 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    _render_ops_plan(out)


@app.command(name="ops-tasks")
def issue_ops_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认仅预览"),
    priority: str = typer.Option("P1", "--priority", help="治理任务优先级"),
    assigned_to: str = typer.Option("IssueOps Agent", "--assigned-to", help="治理任务负责人"),
    categories: str = typer.Option("", "--categories", help="逗号分隔过滤 severity,aging,traceability,intake"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将问题治理风险预览或生成任务。"""
    body = {
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "categories": [x.strip() for x in categories.split(",") if x.strip()],
        "limit": limit,
    }
    try:
        out = get_client().issue_ops_tasks(body)
    except Exception as e:
        warn(f"Manager issue ops-tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    console.print(f"planned: {summary.get('planned', 0)}")
    console.print(f"created: {summary.get('created', 0)}")
    tbl = Table(title="issue governance tasks", show_header=True, header_style="bold")
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
        warn("dry-run only; add --apply to create issue governance tasks")


def _new_row(
    title: str,
    *,
    description: str,
    issue_type: str,
    severity: str,
    task_id: str,
    sprint_id: str,
    reported_by: str,
) -> dict[str, Any]:
    ts = _now()
    return {
        "id": f"ISSUE-local-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}",
        "title": title,
        "description": description,
        "type": issue_type,
        "severity": severity.upper(),
        "status": "open",
        "sprint_id": sprint_id,
        "task_id": task_id,
        "reported_by": reported_by,
        "resolved_by": "",
        "resolution": "",
        "created_at": ts,
        "resolved_at": None,
    }


def _save_and_queue(row: dict[str, Any]) -> None:
    data = _load_local()
    data[str(row["id"])] = row
    _save_local(data)
    deleted = _deleted_ids()
    deleted.discard(str(row["id"]))
    _save_deleted(deleted)
    _enqueue("issues", row)
    _write_issue_doc(row)


@app.command(name="list")
def list_issues(
    status: str | None = typer.Option(None, "--status", help="open|resolved|closed"),
    severity: str | None = typer.Option(None, "--severity", help="P0|P1|P2|P3"),
    page: int = typer.Option(1, "--page"),
    size: int = typer.Option(50, "--size"),
    local: bool = typer.Option(False, "--local", help="只读取本地物化/离线问题"),
) -> None:
    """列出问题；Manager 不可用时回退本地。"""
    if not local:
        try:
            data = get_client().list_issues(status=status, severity=severity, page=page, size=size)
            _render(list(data.get("items", [])), f"issues total={data.get('total', '?')}")
            return
        except Exception as e:
            warn(f"Manager issues 不可用，回退本地: {e}")
    items = _local_items(status=status, severity=severity)
    start = max(page - 1, 0) * size
    _render(items[start : start + size], f"local issues total={len(items)}")


@app.command(name="create")
def create_issue(
    title: str = typer.Argument(..., help="问题标题"),
    description: str = typer.Option("", "--desc", help="问题描述"),
    issue_type: str = typer.Option("bug", "--type", help="bug|risk|incident|question"),
    severity: str = typer.Option("P2", "--severity", help="P0|P1|P2|P3"),
    task_id: str = typer.Option("", "--task", help="关联任务 ID"),
    sprint_id: str = typer.Option("", "--sprint", help="关联 Sprint ID"),
    reported_by: str = typer.Option("cli", "--reporter", help="报告人/工具"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """创建问题；离线时写 .sop-runtime/local 并追加 push_queue。"""
    body = {
        "title": title,
        "description": description,
        "type": issue_type,
        "severity": severity.upper(),
        "task_id": task_id,
        "sprint_id": sprint_id,
    }
    if not local:
        try:
            out = get_client().create_issue(body)
            ok(f"created issue {out.get('id', '-')}")
            return
        except Exception as e:
            warn(f"Manager create issue 不可用，写入本地队列: {e}")
    row = _new_row(
        title,
        description=description,
        issue_type=issue_type,
        severity=severity,
        task_id=task_id,
        sprint_id=sprint_id,
        reported_by=reported_by,
    )
    _save_and_queue(row)
    ok(f"local issue queued {row['id']}")


@app.command(name="update")
def update_issue(
    issue_id: str = typer.Argument(..., help="问题 ID"),
    title: str | None = typer.Option(None, "--title"),
    description: str | None = typer.Option(None, "--desc"),
    issue_type: str | None = typer.Option(None, "--type"),
    severity: str | None = typer.Option(None, "--severity"),
    status: str | None = typer.Option(None, "--status"),
    sprint_id: str | None = typer.Option(None, "--sprint"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """更新问题；离线时对本地副本打补丁并追加 upsert 队列。"""
    patch: dict[str, Any] = {}
    for k, v in {
        "title": title,
        "description": description,
        "type": issue_type,
        "severity": severity.upper() if severity else None,
        "status": status,
        "sprint_id": sprint_id,
    }.items():
        if v is not None:
            patch[k] = v
    if not patch:
        warn("没有可更新字段")
        return
    if not local:
        try:
            get_client().update_issue(issue_id, patch)
            ok(f"updated issue {issue_id}")
            return
        except Exception as e:
            warn(f"Manager update issue 不可用，写入本地队列: {e}")
    data = _load_local()
    base = dict(_load_synced().get(issue_id) or data.get(issue_id) or {"id": issue_id, "title": issue_id, "status": "open"})
    base.update(patch)
    _save_and_queue(base)
    ok(f"local issue update queued {issue_id}")


@app.command(name="resolve")
def resolve_issue(
    issue_id: str = typer.Argument(..., help="问题 ID"),
    resolution: str = typer.Option("", "--resolution", "-r", help="解决说明"),
    resolved_by: str = typer.Option("cli", "--resolver", help="解决人/工具"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """解决问题；离线时标记 resolved 并追加 upsert 队列。"""
    if not local:
        try:
            get_client().resolve_issue(issue_id, resolution=resolution)
            ok(f"resolved issue {issue_id}")
            return
        except Exception as e:
            warn(f"Manager resolve issue 不可用，写入本地队列: {e}")
    data = _load_local()
    base = dict(_load_synced().get(issue_id) or data.get(issue_id) or {"id": issue_id, "title": issue_id})
    base.update({"status": "resolved", "resolution": resolution, "resolved_by": resolved_by, "resolved_at": _now()})
    _save_and_queue(base)
    ok(f"local issue resolve queued {issue_id}")


@app.command(name="delete")
def delete_issue(
    issue_id: str = typer.Argument(..., help="问题 ID"),
    local: bool = typer.Option(False, "--local", help="只写本地删除标记并进入同步队列"),
) -> None:
    """删除问题；离线时写 tombstone 并追加 delete 队列。"""
    if not local:
        try:
            get_client().delete_issue(issue_id)
            ok(f"deleted issue {issue_id}")
            return
        except Exception as e:
            warn(f"Manager delete issue 不可用，写入本地队列: {e}")
    data = _load_local()
    data.pop(issue_id, None)
    _save_local(data)
    deleted = _deleted_ids()
    deleted.add(issue_id)
    _save_deleted(deleted)
    _enqueue("issues", {"id": issue_id}, action="delete")
    ok(f"local issue delete queued {issue_id}")
