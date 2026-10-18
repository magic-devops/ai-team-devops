"""
@module: sop_cli.commands.status
@purpose: 本地 + Manager 状态总览（一屏式仪表盘）
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import typer
from rich.panel import Panel
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="本地 + Manager 状态总览")


@app.callback(invoke_without_command=True)
def status(
    json_output: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
    out: str = typer.Option("", "--out", "-o", help="JSON 输出文件路径（相对项目根目录）"),
) -> None:
    cfg = get_config()
    snapshot = build_status_snapshot()
    if json_output or out:
        text = json.dumps(snapshot, ensure_ascii=False, indent=2, default=str)
        if out:
            path = Path(out).expanduser()
            if not path.is_absolute():
                path = cfg.project_path / path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text + "\n", encoding="utf-8")
            ok(f"wrote {path}")
        else:
            console.print_json(text)
        return

    # 本地
    tbl = Table(title="本地", show_header=True, header_style="bold")
    tbl.add_column("Key"); tbl.add_column("Value")
    for k, v in snapshot["local"].items():
        tbl.add_row(k, str(v))
    console.print(tbl)

    outbox_tbl = Table(title="Outbox / 本地队列", show_header=True, header_style="bold")
    outbox_tbl.add_column("name")
    outbox_tbl.add_column("pending")
    outbox_tbl.add_column("bad")
    outbox_tbl.add_column("dead_letter")
    outbox_tbl.add_column("state")
    for name, row in snapshot["outboxes"].items():
        outbox_tbl.add_row(name, str(row.get("pending") if row.get("pending") is not None else "—"),
                          str(row.get("bad", 0)), str(row.get("dead_letter", "—")), str(row.get("storage_state", "ready")))
    console.print(outbox_tbl)

    # Manager
    manager = snapshot.get("manager") or {}
    if manager.get("ok"):
        h = manager.get("health") or {}
        ok_text = f"[bold green]{h.get('service')}[/bold green]  v{h.get('version')}  mode={h.get('admin_mode')}"
        console.print(Panel(ok_text, title="Manager"))

        ov = manager.get("overview") or {}
        if ov:
            ov_tbl = Table(title="跨项目驾驶舱", show_header=True, header_style="bold")
            ov_tbl.add_column("指标"); ov_tbl.add_column("值")
            for k in ("projects_total", "projects_active", "agents_online",
                      "tasks_in_progress", "tasks_blocked", "sprints_active",
                      "llm_cost_30d_usd", "confidence_30d_avg"):
                ov_tbl.add_row(k, str(ov.get(k, "-")))
            console.print(ov_tbl)
        usage = manager.get("usage") or {}
        if usage:
            usage_tbl = Table(title="用量", show_header=True, header_style="bold")
            usage_tbl.add_column("metric")
            usage_tbl.add_column("total")
            usage_tbl.add_column("remaining")
            remaining = usage.get("remaining") if isinstance(usage.get("remaining"), dict) else {}
            for k, v in (usage.get("totals") or {}).items():
                usage_tbl.add_row(str(k), str(v), str(remaining.get(k, "")))
            console.print(usage_tbl)
    else:
        warn(f"Manager 不可达：{manager.get('error', '-')}")


def build_status_snapshot() -> dict[str, Any]:
    cfg = get_config()
    out: dict[str, Any] = {
        "schema": "sop.status.snapshot.v1",
        "local": _read_local_state(cfg.project_path),
        "artifacts": _read_artifacts(cfg.project_path),
        "outboxes": _read_outboxes(cfg.project_path, cfg.outbox_path),
        "sync": _read_sync_state(cfg.project_path),
        "manager": {"ok": False},
    }
    try:
        cli = get_client(cfg)
        health = cli.health()
        manager: dict[str, Any] = {"ok": bool(health.get("ok", True)), "health": health}
        if cfg.project_id:
            try:
                manager["overview"] = cli.console_overview()
            except Exception as e:
                manager["overview_error"] = str(e)
            try:
                manager["usage"] = cli.usage_summary(limit=1000)
            except Exception as e:
                manager["usage_error"] = str(e)
        out["manager"] = manager
    except Exception as e:
        out["manager"] = {"ok": False, "error": str(e)}
    return out


def _read_local_state(project_path: Path) -> dict[str, object]:
    out: dict[str, object] = {"project_path": str(project_path)}
    f = project_path / "memory" / "current_state.json"
    if f.is_file():
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            out["project_id"] = d.get("project_id", "-")
            out["phase"]      = d.get("phase", "-")
            out["sprint"]     = d.get("sprint") or "-"
            tasks = d.get("tasks", {})
            out["tasks_completed"]   = len(tasks.get("completed", []))
            out["tasks_in_progress"] = len(tasks.get("in_progress", []))
            out["tasks_blocked"]     = len(tasks.get("blocked", []))
            out["tasks_pending"]     = len(tasks.get("pending", []))
        except Exception:
            out["error"] = "current_state.json 解析失败"
    else:
        out["state"] = "未初始化（执行 sop init）"
    return out


def _jsonl_count(path: Path) -> dict[str, int]:
    if not path.is_file():
        return {"pending": 0, "bad": 0}
    pending = 0
    bad = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        pending += 1
        try:
            json.loads(line)
        except json.JSONDecodeError:
            bad += 1
    return {"pending": pending, "bad": bad}


def _read_outboxes(project_path: Path, outbox_path=".sop-runtime/outbox.sqlite") -> dict[str, dict[str, Any]]:
    from .event import queue_health
    return {
        "memory": _jsonl_count(project_path / ".sop-runtime" / "memory" / "outbox.jsonl"),
        "kb": _jsonl_count(project_path / ".sop-runtime" / "kb" / "outbox.jsonl"),
        "events": queue_health(project_path, outbox_path),
        "usage": _jsonl_count(project_path / ".sop-runtime" / "usage" / "outbox.jsonl"),
    }


def _read_artifacts(project_path: Path) -> dict[str, Any]:
    files = {
        "manifest": project_path / ".sop-runtime" / "project_manifest.json",
        "agent_context": project_path / ".sop-runtime" / "agent_context.json",
        "env": project_path / ".sop-runtime" / "sop.env",
        "work_snapshot": project_path / ".sop-runtime" / "work_snapshot.json",
        "pages_manifest": project_path / ".sop-runtime" / "pages_manifest.json",
        "pages_capabilities": project_path / ".sop-runtime" / "pages_capabilities.json",
        "copilot_sessions": project_path / ".sop-runtime" / "copilot" / "sessions.jsonl",
        "memory_local": project_path / ".sop-runtime" / "memory" / "local.jsonl",
        "kb_outbox": project_path / ".sop-runtime" / "kb" / "outbox.jsonl",
        "db_connections": project_path / ".sop-runtime" / "db_connections.json",
    }
    result = {k: {"path": str(v), "exists": v.is_file()} for k, v in files.items()}
    for key, directory in {
        "rule_proposals": project_path / ".sop-runtime/rules/proposals",
        "asset_plans": project_path / ".sop-runtime/sync/plans",
    }.items():
        result[key] = {"path": str(directory), "exists": directory.is_dir()}
    from .event import _legacy_files

    result["legacy_read_only"] = _legacy_files(project_path)
    return result


def _read_sync_state(project_path: Path) -> dict[str, Any]:
    state = project_path / ".sop-runtime" / "sync_state.json"
    out: dict[str, Any] = {"state_exists": state.is_file(), "entities": {}}
    if state.is_file():
        try:
            out["state"] = json.loads(state.read_text(encoding="utf-8"))
        except Exception as e:
            out["state_error"] = str(e)
    entities = project_path / ".sop-runtime" / "sync" / "entities"
    if entities.is_dir():
        for f in sorted(entities.glob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                out["entities"][f.stem] = len(data) if isinstance(data, dict) else None
            except Exception:
                out["entities"][f.stem] = None
    return out
