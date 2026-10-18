"""Bounded work observations from Manager queries or an explicitly scoped read-only cache."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import typer
from rich.table import Table
from sop_sdk.event_envelope import manager_origin, strict_json, timestamp

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="工作台：有界项目观察、明确缓存及覆盖说明")
MODULES = ("requirements", "tasks", "issues", "sprints")
PAGE_SIZE = 100
MAX_CACHE_BYTES = 16 * 1024 * 1024


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _integer(value, field):
    if type(value) is not int or value < 0:
        raise ValueError("Invalid Manager " + field)
    return value


def _rows(value, config):
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ValueError("Manager rows must be an array of objects")
    identifiers = set()
    for row in value:
        record_id = row.get("id")
        if not isinstance(record_id, str) or not record_id or record_id in identifiers:
            raise ValueError("Invalid or repeated Manager record identity")
        identifiers.add(record_id)
        if ("project_id" in row and row["project_id"] != config.project_id) or (
            "tenant_id" in row and row["tenant_id"] != config.tenant_id
        ):
            raise ValueError("Manager row scope differs from the selected project/tenant")
    return value


def _read_remote(config, modules):
    data, coverage, stamp = {}, {}, None
    with get_client(config) as client:
        for module in modules:
            if module == "sprints":
                page = client.list_sprints(page=1, size=PAGE_SIZE)
            elif module == "issues":
                page = client.delivery_issues(limit=PAGE_SIZE)
            else:
                page = getattr(client, "delivery_" + module)(limit=PAGE_SIZE, sort="priority_asc")
            if not isinstance(page, dict):
                raise ValueError("Manager page must be an object")
            rows = _rows(page.get("items"), config)
            total = _integer(page.get("total"), "total")
            if len(rows) != min(PAGE_SIZE, total):
                raise ValueError("Inconsistent bounded Manager page")
            current = {
                "state": "observed",
                "loaded": len(rows),
                "total": total,
                "complete": total == len(rows),
                "observed_at": _now(),
                "query_generation": None,
                "version": None,
                "next_cursor": None,
                "next_page": None,
            }
            if module == "sprints":
                if page.get("page") != 1 or page.get("size") != PAGE_SIZE:
                    raise ValueError("Unexpected Sprint pagination contract")
                current.update(
                    pagination="offset",
                    next_page=2 if total > len(rows) else None,
                    consistency="independent_sprint_observation",
                )
            else:
                if page.get("project_id") != config.project_id or page.get("limit") != PAGE_SIZE:
                    raise ValueError("Manager query project or limit differs from the selected scope")
                version = _integer(page.get("version"), "version")
                generation = _integer(page.get("query_generation"), "query_generation")
                observed_stamp = (version, generation)
                if stamp is not None and stamp != observed_stamp:
                    raise ValueError("Project changed between bounded queries; explicitly read again")
                stamp = observed_stamp
                timestamp(page.get("as_of"))
                cursor = page.get("next_cursor")
                if cursor is not None and (not isinstance(cursor, str) or not cursor):
                    raise ValueError("Invalid Manager continuation cursor")
                if (total > len(rows)) != (cursor is not None):
                    raise ValueError("Manager page coverage and continuation disagree")
                current.update(
                    pagination="cursor",
                    next_cursor=cursor,
                    version=version,
                    query_generation=generation,
                    as_of=page["as_of"],
                    consistency="matching_delivery_query_generation",
                )
            data[module], coverage[module] = rows, current
    return data, coverage


def _read_json(path, maximum):
    with path.open("rb") as handle:
        original = handle.read(maximum + 1)
    if len(original) > maximum:
        raise ValueError("Manager cache is too large for a bounded work observation")
    return strict_json(original.decode("utf-8")), original


def _read_cache(config, modules):
    runtime = config.project_path / ".sop-runtime"
    state_path = runtime / "sync_state.json"
    state = None
    if state_path.is_file():
        state, _ = _read_json(state_path, 65536)
        if not isinstance(state, dict) or state.get("project_id") != config.project_id:
            raise ValueError("缓存缺少当前项目依据；请明确拉取当前项目")
        if "tenant_id" in state and state["tenant_id"] != config.tenant_id:
            raise ValueError("Manager缓存租户与当前项目不符")
        if "manager_origin" in state and state["manager_origin"] != manager_origin(config.manager_url):
            raise ValueError("Manager缓存来源与当前配置不符")
    data, coverage = {}, {}
    for module in modules:
        path = runtime / "sync/entities" / (module + ".json")
        current = {
            "state": "cache_missing",
            "loaded": 0,
            "total": None,
            "complete": None,
            "cached_count": 0,
            "has_more_in_cache": False,
            "as_of": state.get("last_pull_at") if state else None,
            "query_generation": None,
            "version": None,
            "next_cursor": None,
            "next_page": None,
            "consistency": "cached_observation_without_current_verification",
        }
        rows = []
        if path.is_file():
            if state is None:
                raise ValueError("缓存缺少项目范围；请明确拉取当前项目")
            cached, original = _read_json(path, MAX_CACHE_BYTES)
            if not isinstance(cached, dict):
                raise ValueError("Invalid Manager entity cache")
            rows = _rows(list(cached.values()), config)
            if any(key != row["id"] for key, row in cached.items()):
                raise ValueError("Manager cache keys differ from original record IDs")
            rows = sorted(rows, key=lambda row: row["id"])
            current.update(
                state="cached",
                loaded=min(len(rows), PAGE_SIZE),
                cached_count=len(rows),
                has_more_in_cache=len(rows) > PAGE_SIZE,
                sha256=hashlib.sha256(original).hexdigest(),
            )
        data[module], coverage[module] = rows[:PAGE_SIZE], current
    return data, coverage


def _count(items, field):
    result = {}
    for item in items:
        value = str(item.get(field) or "unknown")
        result[value] = result.get(value, 0) + 1
    return result


def _sort(items):
    rank = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    return sorted(
        items,
        key=lambda row: (rank.get(row.get("priority") or row.get("severity"), 4), str(row.get("id", ""))),
    )


def _next(data, *, local, limit):
    result = []
    for module in ("tasks", "issues", "requirements"):
        for row in data.get(module, []):
            status = row.get("delivery_status") if module == "tasks" and not local else row.get("status")
            if status in {
                "pending",
                "in_progress",
                "blocked",
                "awaiting_review",
                "recorded_completed",
                "open",
            } or (local and status == "completed"):
                result.append(
                    {
                        **row,
                        "kind": module,
                        "recommendation_basis": "verify_current_state"
                        if local
                        else "loaded_manager_observation",
                    }
                )
    return _sort(result)[:limit]


def _capture(*, local, limit=20, modules=MODULES, config=None):
    config = copy.deepcopy(config or get_config())
    if not isinstance(config.project_id, str) or not config.project_id.strip():
        raise ValueError("明确当前项目后再读取工作台")
    data, coverage = _read_cache(config, modules) if local else _read_remote(config, modules)
    summary = {}
    for module, rows in data.items():
        summary[module] = {
            "total": coverage[module]["total"],
            "loaded": len(rows),
            "by_recorded_status": _count(rows, "status"),
        }
        if module == "tasks":
            summary[module].update(
                by_effective_status=None if local else _count(rows, "delivery_status"),
                verified_completed_loaded=None
                if local
                else sum(row.get("delivery_status") == "verified_completed" for row in rows),
            )
    snapshot = {
        "schema": "sop.work.snapshot.v2",
        "generated_at": _now(),
        "source": "manager_cache" if local else "manager",
        "scope": {
            "project_id": config.project_id,
            "tenant_id": config.tenant_id,
            "manager_origin": manager_origin(config.manager_url),
            "project_path": str(config.project_path),
        },
        "counts_scope": "loaded_rows_except_explicit_server_totals",
        "coverage": coverage,
        "summary": summary,
        "next": _next(data, local=local, limit=limit),
        "entities": data,
    }
    return config, snapshot


def _write(payload, config, out):
    if not out:
        console.print_json(data=payload)
        return
    path = Path(out).expanduser()
    if not path.is_absolute():
        path = config.project_path / path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=".work-", suffix=".tmp", delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    ok(f"wrote {path}")


def _metadata(snapshot):
    return {key: value for key, value in snapshot.items() if key not in {"entities", "next", "summary"}}


def write_cache_snapshot(config, path: Path) -> Path:
    """Export the caller's original project cache for onboarding without re-reading configuration."""
    captured, snapshot = _capture(local=True, config=config)
    _write(snapshot, captured, str(path))
    return path


def _failure(exc):
    warn(f"工作台读取失败，未使用其他来源替代: {exc}")
    raise typer.Exit(2) from exc


@app.callback(invoke_without_command=True)
def _root(
    ctx: typer.Context, local: bool = typer.Option(False, "--local", help="显式读取项目只读Manager缓存")
):
    if ctx.invoked_subcommand is None:
        summary(local=local, json_output=False, out="")


@app.command("summary")
def summary(
    local: bool = typer.Option(False, "--local", help="显式读取项目只读Manager缓存"),
    json_output: bool = typer.Option(False, "--json"),
    out: str = typer.Option("", "--out", "-o"),
):
    """展示有界观察；状态分布仅对应已加载行，缓存完整性及验收未知。"""
    try:
        config, snapshot = _capture(local=local)
        if json_output or out:
            _write({**_metadata(snapshot), "summary": snapshot["summary"]}, config, out)
            return
        table = Table(title="work · " + snapshot["source"], show_header=True)
        for name in ("area", "loaded", "server total", "coverage", "recorded status · loaded rows"):
            table.add_column(name)
        for module, values in snapshot["summary"].items():
            complete = snapshot["coverage"][module]["complete"]
            table.add_row(
                module,
                str(values["loaded"]),
                str(values["total"]) if values["total"] is not None else "unknown",
                "complete" if complete is True else "partial" if complete is False else "unknown cache",
                json.dumps(values["by_recorded_status"], ensure_ascii=False),
            )
        console.print(table)
        console.print("状态分布仅覆盖已加载行；缓存可能过期且无法证明当前验收。更多页见 --json 的 coverage。")
    except Exception as exc:
        _failure(exc)


@app.command("list")
def list_work(
    kind: str = typer.Option("all", "--kind", help="all|requirements|tasks|issues|sprints"),
    status: str = typer.Option("", "--status", help="在已加载行内过滤；远端Task使用有效交付状态"),
    local: bool = typer.Option(False, "--local"),
    json_output: bool = typer.Option(False, "--json"),
    out: str = typer.Option("", "--out", "-o"),
):
    if kind != "all" and kind not in MODULES:
        raise typer.BadParameter("kind只能为all/requirements/tasks/issues/sprints")
    try:
        config, snapshot = _capture(local=local, modules=MODULES if kind == "all" else (kind,))
        rows = []
        for module, values in snapshot["entities"].items():
            field = "delivery_status" if module == "tasks" and not local else "status"
            rows.extend({**row, "kind": module} for row in values if not status or row.get(field) == status)
        payload = {
            **_metadata(snapshot),
            "selection": {"kind": kind, "status": status, "scope": "loaded_rows"},
            "items": _sort(rows),
        }
        if json_output or out:
            _write(payload, config, out)
        else:
            _render(payload["items"], snapshot["source"] + " · loaded rows")
    except Exception as exc:
        _failure(exc)


def _render(rows, title):
    table = Table(title=title, show_header=True)
    for name in ("kind", "id", "recorded status", "effective status", "priority", "title/goal"):
        table.add_column(name)
    for row in rows:
        table.add_row(
            str(row["kind"]),
            str(row["id"]),
            str(row.get("status", "")),
            str(row.get("delivery_status") or "unknown"),
            str(row.get("priority") or row.get("severity") or ""),
            str(row.get("title") or row.get("goal") or "")[:96],
        )
    console.print(table)
    console.print("仅展示有界已加载观察；完整性、后续页与来源见 --json 的 coverage。")


@app.command("next")
def next_work(
    limit: int = typer.Option(10, "--limit", "-n", min=1, max=100),
    local: bool = typer.Option(False, "--local"),
    json_output: bool = typer.Option(False, "--json"),
    out: str = typer.Option("", "--out", "-o"),
):
    """在已加载观察内提供待核对候选，不声明全项目最高优先级或自动领取。"""
    try:
        config, snapshot = _capture(local=local, limit=limit)
        payload = {
            **_metadata(snapshot),
            "selection": {"scope": "loaded_rows", "limit": limit},
            "items": snapshot["next"],
        }
        if json_output or out:
            _write(payload, config, out)
        else:
            _render(payload["items"], snapshot["source"] + " · candidates requiring current review")
    except Exception as exc:
        _failure(exc)


@app.command("export")
def export_work(
    local: bool = typer.Option(False, "--local"),
    out: str = typer.Option(".sop-runtime/work_snapshot.json", "--out", "-o"),
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=100),
):
    """导出固定配置下的有界观察与明确覆盖，不承诺全项目完整统计。"""
    try:
        config, snapshot = _capture(local=local, limit=limit)
        _write(snapshot, config, out)
    except Exception as exc:
        _failure(exc)
