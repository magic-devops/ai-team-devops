"""
@module: sop_cli.commands.issue
@purpose: 问题原版本意图与只读Manager缓存
"""
from __future__ import annotations

import json
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, warn

app = typer.Typer(help="问题：list/create/update/resolve/delete（原版本写入、只读缓存）")


def _submit(record, *, action, expected_version, key, event_time, local, **basis):
    from ..local_intents import submit_record

    try:
        result = submit_record(
            get_config(),
            "issues",
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
    path = runtime / "sync" / "entities" / "issues.json"
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


def _local_items(*, status: str | None = None, severity: str | None = None) -> list[dict[str, Any]]:
    items = [dict(row) for row in _load_synced().values()]
    if status:
        items = [row for row in items if row.get("status") == status]
    if severity:
        items = [row for row in items if str(row.get("severity", "")).upper() == severity.upper()]
    return sorted(items, key=lambda row: str(row.get("created_at") or ""), reverse=True)


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
    owner_id: str = typer.Option("", "--owner-id", help="项目成员稳定 ID；留空表示未分配"),
    categories: str = typer.Option("", "--categories", help="逗号分隔过滤 severity,aging,traceability,intake"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将问题治理风险预览或生成任务。"""
    body = {
        "dry_run": not apply,
        "priority": priority,
        "owner_id": owner_id,
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
        warn("dry-run only; add --apply to create issue governance tasks")


@app.command(name="list")
def list_issues(
    status: str | None = typer.Option(None, "--status"),
    severity: str | None = typer.Option(None, "--severity"),
    page: int = typer.Option(1, "--page", min=1),
    size: int = typer.Option(50, "--size", min=1, max=100),
    local: bool = typer.Option(False, "--local", help="显式查看当前项目只读Manager拉取缓存"),
) -> None:
    if local:
        items = _local_items(status=status, severity=severity)
        warn("只读Manager拉取缓存，可能过期；不含未处理本地意图")
        start = (page - 1) * size
        _render(items[start : start + size], f"Manager cache issues total={len(items)}")
        return
    try:
        data = get_client().list_issues(status=status, severity=severity, page=page, size=size)
        _render(list(data.get("items", [])), f"issues total={data.get('total', '?')}")
    except Exception as exc:
        warn(f"Manager issues读取失败: {exc}")
        raise typer.Exit(1) from exc


@app.command(name="create")
def create_issue(
    title: str = typer.Argument(...),
    record_id: str = typer.Option(..., "--record-id", help="固定新问题ID"),
    description: str | None = typer.Option(None, "--desc"),
    issue_type: str | None = typer.Option(None, "--type"),
    severity: str | None = typer.Option(None, "--severity"),
    task_id: str | None = typer.Option(None, "--task"),
    sprint_id: str | None = typer.Option(None, "--sprint"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """提交固定创建原件；报告人由实际认证身份记录。"""
    record = {"id": record_id, "title": title}
    for name, value in {
        "description": description,
        "type": issue_type,
        "severity": severity.upper() if severity is not None else None,
        "task_id": task_id,
        "sprint_id": sprint_id,
    }.items():
        if value is not None:
            record[name] = value
    _submit(
        record,
        action="create",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command(name="update")
def update_issue(
    issue_id: str = typer.Argument(...),
    title: str | None = typer.Option(None, "--title"),
    description: str | None = typer.Option(None, "--desc"),
    issue_type: str | None = typer.Option(None, "--type"),
    severity: str | None = typer.Option(None, "--severity"),
    status: str | None = typer.Option(None, "--status"),
    sprint_id: str | None = typer.Option(None, "--sprint"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    record = {"id": issue_id}
    for name, value in {
        "title": title,
        "description": description,
        "type": issue_type,
        "severity": severity.upper() if severity is not None else None,
        "status": status,
        "sprint_id": sprint_id,
    }.items():
        if value is not None:
            record[name] = value
    if len(record) == 1:
        raise typer.BadParameter("没有明确的更新字段")
    _submit(
        record,
        action="update",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command(name="resolve")
def resolve_issue(
    issue_id: str = typer.Argument(...),
    resolution: str = typer.Option("", "--resolution", "-r"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """提交原解决意图；解决人/时间由服务端实际认证身份记录。"""
    _submit(
        {"id": issue_id, "status": "resolved", "resolution": resolution},
        action="update",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command(name="delete")
def delete_issue(
    issue_id: str = typer.Argument(..., help="稳定记录ID"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """持久提交原删除意图；处理完成前不隐藏当前记录。"""
    _submit(
        {"id": issue_id},
        action="delete",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )
