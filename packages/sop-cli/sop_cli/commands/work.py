"""
@module: sop_cli.commands.work
@purpose: 聚合研发工作台：需求/任务/问题/迭代的一站式本地优先视图
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, kv, ok, warn

app = typer.Typer(help="工作台：summary/list/next/export（聚合需求、任务、问题、迭代）")


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _load_module(module: str) -> list[dict[str, Any]]:
    cfg = get_config()
    rt = cfg.project_path / ".sop-runtime"
    synced = _read_json(rt / "sync" / "entities" / f"{module}.json", {})
    local = _read_json(rt / "local" / f"{module}.json", {})
    deleted = _read_json(rt / "local" / f"{module}_deleted.json", [])
    deleted_ids = {str(x) for x in deleted} if isinstance(deleted, list) else set()
    merged: dict[str, dict[str, Any]] = {}
    if isinstance(synced, dict):
        merged.update({str(k): v for k, v in synced.items() if isinstance(v, dict)})
    if isinstance(local, dict):
        merged.update({str(k): v for k, v in local.items() if isinstance(v, dict)})
    return [dict(v) for k, v in merged.items() if k not in deleted_ids]


def _remote_or_local(*, local: bool = False) -> dict[str, list[dict[str, Any]]]:
    if local:
        return {
            "requirements": _load_module("requirements"),
            "tasks": _load_module("tasks"),
            "issues": _load_module("issues"),
            "sprints": _load_module("sprints"),
        }
    try:
        cli = get_client()
        return {
            "requirements": list(cli.list_requirements(size=200).get("items", [])),
            "tasks": list(cli.list_tasks(size=200).get("items", [])),
            "issues": list(cli.list_issues(size=200).get("items", [])),
            "sprints": list(cli.list_sprints(size=100).get("items", [])),
        }
    except Exception as e:
        warn(f"Manager 工作台不可用，回退本地: {e}")
        return _remote_or_local(local=True)


def _count_by(items: list[dict[str, Any]], field: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for it in items:
        k = str(it.get(field) or "-")
        out[k] = out.get(k, 0) + 1
    return out


def _sort_work(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    return sorted(
        items,
        key=lambda x: (
            order.get(str(x.get("priority") or x.get("severity") or "P9").upper(), 9),
            str(x.get("updated_at") or x.get("created_at") or x.get("started_at") or ""),
        ),
    )


def _next_items(data: dict[str, list[dict[str, Any]]], *, limit: int) -> list[dict[str, Any]]:
    tasks = [
        x
        for x in data["tasks"]
        if str(x.get("status") or "") in {"pending", "in_progress", "blocked"}
    ]
    issues = [x for x in data["issues"] if str(x.get("status") or "") == "open"]
    reqs = [x for x in data["requirements"] if str(x.get("status") or "") in {"pending", "in_progress"}]
    combined = (
        [{"kind": "task", **x} for x in tasks]
        + [{"kind": "issue", **x} for x in issues]
        + [{"kind": "requirement", **x} for x in reqs]
    )
    return _sort_work(combined)[: max(1, limit)]


def _build_snapshot(*, local: bool = False, limit: int = 20) -> dict[str, Any]:
    data = _remote_or_local(local=local)
    reqs = data["requirements"]
    tasks = data["tasks"]
    issues = data["issues"]
    sprints = data["sprints"]
    active_sprint = next((x for x in sprints if str(x.get("status") or "") == "active"), None)
    blocked = [x for x in tasks if str(x.get("status") or "") == "blocked"]
    open_issues = [x for x in issues if str(x.get("status") or "") in {"open", "blocked"}]
    return {
        "schema": "sop.work.snapshot.v1",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "local" if local else "manager_or_local_fallback",
        "project_path": str(get_config().project_path),
        "summary": {
            "requirements": {"total": len(reqs), "by_status": _count_by(reqs, "status")},
            "tasks": {"total": len(tasks), "by_status": _count_by(tasks, "status")},
            "issues": {"total": len(issues), "by_status": _count_by(issues, "status")},
            "sprints": {"total": len(sprints), "by_status": _count_by(sprints, "status")},
            "active_sprint": active_sprint,
            "blocked_tasks": len(blocked),
            "open_issues": len(open_issues),
        },
        "next": _next_items(data, limit=limit),
        "entities": {
            "requirements": reqs,
            "tasks": tasks,
            "issues": issues,
            "sprints": sprints,
        },
    }


def _write_json_payload(payload: dict[str, Any] | list[dict[str, Any]], out: str = "") -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
    if not out:
        console.print_json(text)
        return
    path = Path(out).expanduser()
    if not path.is_absolute():
        path = get_config().project_path / path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")
    ok(f"wrote {path}")


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context, local: bool = typer.Option(False, "--local", help="只读取本地物化/离线数据")) -> None:
    if ctx.invoked_subcommand is not None:
        return
    summary(local=local)


@app.command("summary")
def summary(
    local: bool = typer.Option(False, "--local", help="只读取本地物化/离线数据"),
    json_output: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
    out: str = typer.Option("", "--out", "-o", help="JSON 输出文件路径（相对项目根目录）"),
) -> None:
    """聚合显示项目研发态势。"""
    data = _remote_or_local(local=local)
    reqs = data["requirements"]
    tasks = data["tasks"]
    issues = data["issues"]
    sprints = data["sprints"]
    active_sprint = next((x for x in sprints if str(x.get("status") or "") == "active"), None)
    if json_output or out:
        _write_json_payload(_build_snapshot(local=local, limit=20)["summary"], out)
        return

    tbl = Table(title="sop work summary", show_header=True, header_style="bold")
    tbl.add_column("area")
    tbl.add_column("total")
    tbl.add_column("breakdown")
    tbl.add_row("requirements", str(len(reqs)), json.dumps(_count_by(reqs, "status"), ensure_ascii=False))
    tbl.add_row("tasks", str(len(tasks)), json.dumps(_count_by(tasks, "status"), ensure_ascii=False))
    tbl.add_row("issues", str(len(issues)), json.dumps(_count_by(issues, "status"), ensure_ascii=False))
    tbl.add_row("sprints", str(len(sprints)), json.dumps(_count_by(sprints, "status"), ensure_ascii=False))
    console.print(tbl)
    if active_sprint:
        kv("active_sprint", f"{active_sprint.get('id')} {active_sprint.get('goal') or ''}")
    blocked = [x for x in tasks if str(x.get("status") or "") == "blocked"]
    open_issues = [x for x in issues if str(x.get("status") or "") in {"open", "blocked"}]
    kv("blocked_tasks", len(blocked))
    kv("open_issues", len(open_issues))


@app.command("list")
def list_work(
    kind: str = typer.Option("all", "--kind", help="all|requirements|tasks|issues|sprints"),
    status: str = typer.Option("", "--status", help="按 status 过滤"),
    local: bool = typer.Option(False, "--local", help="只读取本地物化/离线数据"),
    json_output: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
    out: str = typer.Option("", "--out", "-o", help="JSON 输出文件路径（相对项目根目录）"),
) -> None:
    """聚合列出工作项。"""
    data = _remote_or_local(local=local)
    picks = ["requirements", "tasks", "issues", "sprints"] if kind == "all" else [kind]
    rows_out: list[dict[str, Any]] = []
    for mod in picks:
        if mod not in data:
            continue
        rows = data[mod]
        if status:
            rows = [x for x in rows if str(x.get("status") or "") == status]
        rows_out.extend([{"kind": mod, **row} for row in _sort_work(rows)[:200]])
    if json_output or out:
        _write_json_payload(rows_out, out)
        return

    tbl = Table(title="sop work list", show_header=True, header_style="bold")
    for col in ("kind", "id", "status", "priority", "title/goal"):
        tbl.add_column(col)
    for row in rows_out:
        tbl.add_row(
            str(row.get("kind", "")),
            str(row.get("id", "")),
            str(row.get("status", "")),
            str(row.get("priority") or row.get("severity") or ""),
            (str(row.get("title") or row.get("goal") or ""))[:96],
        )
    console.print(tbl)


@app.command("next")
def next_work(
    limit: int = typer.Option(10, "--limit", "-n", help="返回数量"),
    local: bool = typer.Option(False, "--local", help="只读取本地物化/离线数据"),
    json_output: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
    out: str = typer.Option("", "--out", "-o", help="JSON 输出文件路径（相对项目根目录）"),
) -> None:
    """列出下一批建议处理项：P0/P1、pending/in_progress/blocker 优先。"""
    data = _remote_or_local(local=local)
    rows = _next_items(data, limit=limit)
    if json_output or out:
        _write_json_payload(rows, out)
        return

    tbl = Table(title="sop work next", show_header=True, header_style="bold")
    for col in ("kind", "id", "status", "priority", "title"):
        tbl.add_column(col)
    for row in rows:
        tbl.add_row(
            str(row.get("kind")),
            str(row.get("id", "")),
            str(row.get("status", "")),
            str(row.get("priority") or row.get("severity") or ""),
            (str(row.get("title") or row.get("goal") or ""))[:96],
        )
    console.print(tbl)


@app.command("export")
def export_work(
    local: bool = typer.Option(False, "--local", help="只读取本地物化/离线数据"),
    out: str = typer.Option(".sop-runtime/work_snapshot.json", "--out", "-o", help="输出文件路径（相对项目根目录）"),
    limit: int = typer.Option(20, "--limit", "-n", help="next 建议项数量"),
) -> None:
    """导出完整工作台快照，供 CLI/IDE/Agent 机器读取。"""
    _write_json_payload(_build_snapshot(local=local, limit=limit), out)
