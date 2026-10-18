"""
@module: sop_cli.commands.sprint
@purpose: 迭代原版本意图与只读Manager缓存
"""
from __future__ import annotations

import json
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, kv, warn

app = typer.Typer(help="迭代：list/create/update/complete/progress/delete（原版本写入、只读缓存）")


def _submit(record, *, action, expected_version, key, event_time, local, **basis):
    from ..local_intents import submit_record

    try:
        result = submit_record(
            get_config(),
            "sprints",
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
    path = runtime / "sync" / "entities" / "sprints.json"
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


def _local_items(*, status: str | None = None) -> list[dict[str, Any]]:
    items = [dict(row) for row in _load_synced().values()]
    if status:
        items = [row for row in items if row.get("status") == status]
    return sorted(items, key=lambda row: str(row.get("started_at") or ""), reverse=True)


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


@app.command(name="list")
def list_sprints(
    status: str | None = typer.Option(None, "--status"),
    page: int = typer.Option(1, "--page", min=1),
    size: int = typer.Option(20, "--size", min=1, max=100),
    local: bool = typer.Option(False, "--local", help="显式查看当前项目只读Manager拉取缓存"),
) -> None:
    if local:
        items = _local_items(status=status)
        warn("只读Manager拉取缓存，可能过期；不含未处理本地意图")
        start = (page - 1) * size
        _render(items[start : start + size], f"Manager cache sprints total={len(items)}")
        return
    try:
        data = get_client().list_sprints(page=page, size=size)
        items = list(data.get("items", []))
        if status:
            items = [row for row in items if row.get("status") == status]
        _render(items, f"sprints total={data.get('total', '?')}")
    except Exception as exc:
        warn(f"Manager sprints读取失败: {exc}")
        raise typer.Exit(1) from exc


@app.command(name="create")
def create_sprint(
    goal: str = typer.Argument(...),
    record_id: str = typer.Option(..., "--record-id", help="固定新迭代ID"),
    planned_points: int | None = typer.Option(None, "--points", min=0),
    ends_at: str | None = typer.Option(None, "--ends-at"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """固定创建原件；不隐式完成其他活跃迭代。"""
    record = {"id": record_id, "goal": goal}
    if planned_points is not None:
        record["planned_points"] = planned_points
    if ends_at is not None:
        record["ends_at"] = ends_at
    _submit(
        record,
        action="create",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command(name="update")
def update_sprint(
    sprint_id: str = typer.Argument(...),
    goal: str | None = typer.Option(None, "--goal"),
    status: str | None = typer.Option(None, "--status"),
    planned_points: int | None = typer.Option(None, "--points", min=0),
    velocity: float | None = typer.Option(
        None, "--velocity", min=0, help="迭代元数据，不替代当前有效交付指标"
    ),
    completion_rate: float | None = typer.Option(
        None, "--completion", min=0, max=100, help="迭代百分比元数据，不代表已验收"
    ),
    retrospective: str | None = typer.Option(None, "--retro"),
    ends_at: str | None = typer.Option(None, "--ends-at"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    record = {"id": sprint_id}
    for name, value in {
        "goal": goal,
        "status": status,
        "planned_points": planned_points,
        "velocity": velocity,
        "completion_rate": completion_rate,
        "retrospective": retrospective,
        "ends_at": ends_at,
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


@app.command(name="complete")
def complete_sprint(
    sprint_id: str = typer.Argument(...),
    retrospective: str | None = typer.Option(None, "--retro"),
    velocity: float | None = typer.Option(None, "--velocity", min=0),
    completion_rate: float | None = typer.Option(None, "--completion", min=0, max=100),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """提交迭代完成意图；已验证交付仍由真实验收计算。"""
    record = {"id": sprint_id, "status": "completed"}
    for name, value in {
        "retrospective": retrospective,
        "velocity": velocity,
        "completion_rate": completion_rate,
    }.items():
        if value is not None:
            record[name] = value
    _submit(
        record,
        action="update",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )


@app.command(name="progress")
def sprint_progress(
    sprint_id: str = typer.Argument(...),
    local: bool = typer.Option(False, "--local", help="仅查看只读Manager缓存元数据，不计算当前验收进度"),
) -> None:
    if local:
        row = _load_synced().get(sprint_id)
        if row is None:
            warn("只读Manager缓存没有此迭代；请明确拉取")
            raise typer.Exit(2)
        console.print_json(data={"source": "manager_cache", "current_verified_progress": None, "sprint": row})
        return
    try:
        console.print_json(data=get_client().sprint_progress(sprint_id))
    except Exception as exc:
        warn(f"Manager sprint progress读取失败: {exc}")
        raise typer.Exit(1) from exc


@app.command(name="delete")
def delete_sprint(
    sprint_id: str = typer.Argument(..., help="稳定记录ID"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """持久提交原删除意图；处理完成前不隐藏当前记录。"""
    _submit(
        {"id": sprint_id},
        action="delete",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )
