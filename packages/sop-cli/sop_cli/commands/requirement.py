"""
@module: sop_cli.commands.requirement
@purpose: 需求管理：远端 Manager 优先，本地离线可写，并进入 sync push 队列
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

from .._util import console, err, get_client, get_config, ok, warn

app = typer.Typer(help="需求：list/create/update/delete（本地优先，远端增强）")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _slug(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9._-]+", "-", s.strip()).strip("-").lower()
    return out[:80] or "requirement"


def _runtime_dir() -> Path:
    return get_config().project_path / ".sop-runtime"


def _local_path() -> Path:
    return _runtime_dir() / "local" / "requirements.json"


def _deleted_path() -> Path:
    return _runtime_dir() / "local" / "requirements_deleted.json"


def _sync_entities_path() -> Path:
    return _runtime_dir() / "sync" / "entities" / "requirements.json"


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


def _write_requirement_doc(row: dict[str, Any]) -> None:
    rid = str(row.get("id") or "")
    title = str(row.get("title") or rid)
    path = get_config().project_path / "sop" / "custom" / "requirements" / f"{rid}-{_slug(title)}.md"
    ac = row.get("acceptance_criteria") or []
    tags = row.get("tags") or []
    lines = [
        "---",
        f"id: {rid}",
        f"priority: {row.get('priority', 'P1')}",
        f"status: {row.get('status', 'pending')}",
        f"created_at: {row.get('created_at', '')}",
        "---",
        "",
        f"# {title}",
        "",
        str(row.get("description") or "").strip(),
        "",
        "## Acceptance Criteria",
    ]
    lines.extend(f"- {x}" for x in ac)
    if not ac:
        lines.append("- 待补充")
    lines.extend(["", "## Tags", ", ".join(str(x) for x in tags) or "无", ""])
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
    for col in ("id", "status", "priority", "points", "title"):
        tbl.add_column(col)
    for r in items:
        tbl.add_row(
            str(r.get("id", "")),
            str(r.get("status", "")),
            str(r.get("priority", "")),
            str(r.get("story_points", 0)),
            (str(r.get("title") or ""))[:96],
        )
    console.print(tbl)


def _render_intake(items: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in ("priority", "agent", "tool", "title", "tags"):
        tbl.add_column(col)
    for r in items:
        tbl.add_row(
            str(r.get("priority", "")),
            str(r.get("assigned_agent", ""))[:28],
            str(r.get("dev_tool", ""))[:18],
            str(r.get("title") or "")[:72],
            ",".join(str(x) for x in (r.get("tags") or [])[:4]),
        )
    console.print(tbl)


def _new_row(
    title: str,
    *,
    description: str,
    priority: str,
    acceptance: list[str],
    tags: list[str],
    assigned_agent: str = "",
    dev_tool: str = "",
) -> dict[str, Any]:
    ts = _now()
    return {
        "id": f"REQ-local-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}",
        "title": title,
        "description": description,
        "status": "pending",
        "priority": priority.upper(),
        "sprint_id": "",
        "story_points": 0,
        "acceptance_criteria": acceptance,
        "tags": tags,
        "human_notes": "",
        "confidence": 0.0,
        "assigned_agent": assigned_agent,
        "dev_tool": dev_tool,
        "created_at": ts,
        "updated_at": ts,
    }


def _local_create(row: dict[str, Any]) -> None:
    data = _load_local()
    data[str(row["id"])] = row
    _save_local(data)
    deleted = _deleted_ids()
    deleted.discard(str(row["id"]))
    _save_deleted(deleted)
    _enqueue("requirements", row)
    _write_requirement_doc(row)


@app.command(name="list")
def list_requirements(
    status: str = typer.Option(None, "--status", help="pending|in_progress|completed|blocked"),
    priority: str = typer.Option(None, "--priority", help="P0|P1|P2|P3"),
    page: int = typer.Option(1, "--page"),
    size: int = typer.Option(50, "--size"),
    local: bool = typer.Option(False, "--local", help="只读取本地物化/离线需求"),
) -> None:
    """列出需求；Manager 不可用时回退本地。"""
    if not local:
        try:
            data = get_client().list_requirements(status=status, priority=priority, page=page, size=size)
            _render(list(data.get("items", [])), f"requirements total={data.get('total', '?')}")
            return
        except Exception as e:
            warn(f"Manager requirements 不可用，回退本地: {e}")
    items = _local_items(status=status, priority=priority)
    start = max(page - 1, 0) * size
    _render(items[start : start + size], f"local requirements total={len(items)}")


@app.command(name="create")
def create_requirement(
    title: str = typer.Argument(..., help="需求标题"),
    description: str = typer.Option("", "--desc", help="需求描述"),
    priority: str = typer.Option("P1", "--priority", help="P0|P1|P2|P3"),
    acceptance: list[str] | None = typer.Option(None, "--acceptance", "-a", help="验收标准，可重复"),
    tag: list[str] | None = typer.Option(None, "--tag", help="标签，可重复"),
    assigned_agent: str = typer.Option("", "--agent", help="建议处理 Agent/角色"),
    dev_tool: str = typer.Option("", "--tool", help="建议开发工具，如 codex/cursor/claude"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """创建需求；离线时写 .sop-runtime/local 并追加 push_queue。"""
    body = {
        "title": title,
        "description": description,
        "priority": priority.upper(),
        "acceptance_criteria": acceptance or [],
        "tags": tag or [],
        "assigned_agent": assigned_agent,
        "dev_tool": dev_tool,
    }
    if not local:
        try:
            out = get_client().create_requirement(body)
            ok(f"created requirement {out.get('id', '-')}")
            return
        except Exception as e:
            warn(f"Manager create requirement 不可用，写入本地队列: {e}")
    row = _new_row(
        title,
        description=description,
        priority=priority,
        acceptance=acceptance or [],
        tags=tag or [],
        assigned_agent=assigned_agent,
        dev_tool=dev_tool,
    )
    _local_create(row)
    ok(f"local requirement queued {row['id']}")


@app.command(name="parse-doc")
def parse_requirement_document(
    path: Path | None = typer.Option(None, "--file", "-f", exists=True, dir_okay=False, readable=True, help="需求文档文本文件"),
    text: str = typer.Option("", "--text", help="直接传入需求文本；与 --file 二选一"),
    mode: str = typer.Option("prd", "--mode", help="idea|prd|meeting|feedback|incident|data|mixed"),
    agent: str = typer.Option("Product Analyst Agent", "--agent", help="负责解析的 Agent/角色"),
    cli: str = typer.Option("codex", "--cli", help="建议执行 CLI/工具，如 codex/claude/cursor/openclaw/hermes-agent"),
    assigned_agent: str = typer.Option("", "--assigned-agent", help="导入后默认负责 Agent"),
    dev_tool: str = typer.Option("", "--dev-tool", help="导入后默认开发工具"),
    no_auto_priority: bool = typer.Option(False, "--no-auto-priority", help="关闭自动优先级评估"),
    no_auto_acceptance: bool = typer.Option(False, "--no-auto-acceptance", help="关闭自动验收标准生成"),
    apply: bool = typer.Option(False, "--apply", help="解析后批量写入 Manager 需求池"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将 PRD/会议纪要/想法文本解析为结构化需求，可直接导入需求池。"""
    content = text.strip()
    filename = "inline.txt"
    if path is not None:
        filename = path.name
        content = path.read_text(encoding="utf-8").strip()
    if len(content) < 20:
        err("请输入至少 20 个字符的需求文档内容")
        raise typer.Exit(2)
    body = {
        "text": content,
        "filename": filename,
        "mode": mode,
        "agent": agent,
        "cli": cli,
        "auto_priority": not no_auto_priority,
        "auto_acceptance": not no_auto_acceptance,
        "assigned_agent": assigned_agent or agent,
        "dev_tool": dev_tool or cli,
    }
    try:
        out = get_client().parse_requirements_document(body)
    except Exception as e:
        err(f"Manager requirement parse-doc 不可用: {e}")
        raise typer.Exit(1) from e
    if apply:
        items = out.get("items") or []
        if not items:
            warn("没有可导入需求")
        else:
            created = get_client().batch_create_requirements(items)
            out["created"] = created
    if json_out:
        console.print_json(data=out)
        return
    if out.get("warning"):
        warn(str(out.get("warning")))
    _render_intake(list(out.get("items") or []), f"parsed requirements count={out.get('count', 0)} source={out.get('source', '-')}")
    for command in out.get("commands") or []:
        console.print(f"{command.get('label')}: [bold]{command.get('command')}[/bold]")
    if apply:
        ok(f"imported requirements count={out.get('created', {}).get('count', 0)}")
    else:
        warn("dry-run only; add --apply to import requirements")


@app.command(name="update")
def update_requirement(
    req_id: str = typer.Argument(..., help="需求 ID"),
    title: str | None = typer.Option(None, "--title"),
    description: str | None = typer.Option(None, "--desc"),
    status: str | None = typer.Option(None, "--status"),
    priority: str | None = typer.Option(None, "--priority"),
    story_points: int | None = typer.Option(None, "--points"),
    human_notes: str | None = typer.Option(None, "--notes"),
    acceptance: list[str] | None = typer.Option(None, "--acceptance", "-a", help="覆盖验收标准，可重复"),
    tag: list[str] | None = typer.Option(None, "--tag", help="覆盖标签，可重复"),
    local: bool = typer.Option(False, "--local", help="只写本地并进入同步队列"),
) -> None:
    """更新需求；离线时对本地副本打补丁并追加 upsert 队列。"""
    patch: dict[str, Any] = {}
    for k, v in {
        "title": title,
        "description": description,
        "status": status,
        "priority": priority.upper() if priority else None,
        "story_points": story_points,
        "human_notes": human_notes,
    }.items():
        if v is not None:
            patch[k] = v
    if acceptance:
        patch["acceptance_criteria"] = acceptance
    if tag:
        patch["tags"] = tag
    if not patch:
        warn("没有可更新字段")
        return
    if not local:
        try:
            get_client().update_requirement(req_id, patch)
            ok(f"updated requirement {req_id}")
            return
        except Exception as e:
            warn(f"Manager update requirement 不可用，写入本地队列: {e}")
    data = _load_local()
    base = dict(_load_synced().get(req_id) or data.get(req_id) or {"id": req_id, "title": req_id, "status": "pending"})
    base.update(patch)
    base["updated_at"] = _now()
    data[req_id] = base
    _save_local(data)
    deleted = _deleted_ids()
    deleted.discard(req_id)
    _save_deleted(deleted)
    _enqueue("requirements", base)
    _write_requirement_doc(base)
    ok(f"local requirement update queued {req_id}")


def _render_review(data: dict[str, Any]) -> None:
    tbl = Table(title=f"requirement review {data.get('requirement_id', '')}", show_header=True, header_style="bold")
    tbl.add_column("field")
    tbl.add_column("value")
    tbl.add_row("score", f"{data.get('score', 0)}/100")
    tbl.add_row("level", str(data.get("level") or "-"))
    tbl.add_row("linked_tasks", str(data.get("linked_tasks", 0)))
    console.print(tbl)
    risks = data.get("risks") or []
    if risks:
        console.print("[bold]risks[/bold]")
        for item in risks:
            console.print(f"- {item.get('message')}")
    suggestions = data.get("suggestions") or []
    if suggestions:
        console.print("[bold]suggestions[/bold]")
        for item in suggestions:
            console.print(f"- {item}")
    criteria = data.get("suggested_acceptance_criteria") or []
    if criteria:
        console.print("[bold]suggested acceptance[/bold]")
        for item in criteria:
            console.print(f"- {item}")


def _render_ops_plan(out: dict[str, Any]) -> None:
    health = out.get("health") or {}
    summary = out.get("summary") or {}
    console.print(f"health_score: {health.get('score', 0)}")
    console.print(f"grade: {health.get('grade', '')}")
    console.print(f"avg_review_score: {health.get('avg_review_score', 0)}")
    console.print(f"needs_work: {summary.get('needs_work', 0)}")
    console.print(f"high_priority_without_tasks: {summary.get('high_priority_without_tasks', 0)}")
    tbl = Table(title="requirement ops risks", show_header=True, header_style="bold")
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
def requirement_ops_plan(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """输出需求池治理 AI/CLI 操作包。"""
    try:
        out = get_client().requirement_ops_plan()
    except Exception as e:
        err(f"Manager requirement ops-plan 不可用: {e}")
        raise typer.Exit(1) from e
    if json_out:
        console.print_json(data=out)
        return
    _render_ops_plan(out)


@app.command(name="ops-tasks")
def requirement_ops_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认仅预览"),
    priority: str = typer.Option("P1", "--priority", help="治理任务优先级"),
    assigned_to: str = typer.Option("RequirementOps Agent", "--assigned-to", help="治理任务负责人"),
    categories: str = typer.Option("", "--categories", help="逗号分隔过滤 review,acceptance,generation,routing,dedupe,intake"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将需求池治理风险预览或生成任务。"""
    body = {
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "categories": [x.strip() for x in categories.split(",") if x.strip()],
        "limit": limit,
    }
    try:
        out = get_client().requirement_ops_tasks(body)
    except Exception as e:
        err(f"Manager requirement ops-tasks 不可用: {e}")
        raise typer.Exit(1) from e
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    console.print(f"planned: {summary.get('planned', 0)}")
    console.print(f"created: {summary.get('created', 0)}")
    tbl = Table(title="requirement governance tasks", show_header=True, header_style="bold")
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
        warn("dry-run only; add --apply to create requirement governance tasks")


@app.command(name="review")
def review_requirement(
    req_id: str = typer.Argument(..., help="需求 ID"),
    apply_acceptance: bool = typer.Option(False, "--apply-acceptance", help="将评审建议的验收标准回写到 Manager"),
) -> None:
    """智能评审需求质量，并可把建议验收标准回写到远端需求。"""
    try:
        out = get_client().review_requirement(req_id)
        _render_review(out)
        criteria = out.get("suggested_acceptance_criteria") or []
        if apply_acceptance and criteria:
            applied = get_client().apply_requirement_review(
                req_id,
                {
                    "acceptance_criteria": criteria,
                    "human_notes": "已通过 sop requirement review --apply-acceptance 应用智能评审建议。",
                },
            )
            ok(f"applied review suggestions: {', '.join(applied.get('updated', [])) or 'none'}")
        elif apply_acceptance:
            warn("没有可应用的建议验收标准")
    except Exception as e:
        err(f"Manager requirement review 不可用: {e}")
        raise typer.Exit(1) from e


@app.command(name="delete")
def delete_requirement(
    req_id: str = typer.Argument(..., help="需求 ID"),
    local: bool = typer.Option(False, "--local", help="只写本地删除标记并进入同步队列"),
) -> None:
    """删除需求；离线时写 tombstone 并追加 delete 队列。"""
    if not local:
        try:
            get_client().delete_requirement(req_id)
            ok(f"deleted requirement {req_id}")
            return
        except Exception as e:
            warn(f"Manager delete requirement 不可用，写入本地队列: {e}")
    data = _load_local()
    data.pop(req_id, None)
    _save_local(data)
    deleted = _deleted_ids()
    deleted.add(req_id)
    _save_deleted(deleted)
    _enqueue("requirements", {"id": req_id}, action="delete")
    ok(f"local requirement delete queued {req_id}")
