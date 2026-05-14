"""
@module: sop_cli.commands.status
@purpose: 本地 + Manager 状态总览（一屏式仪表盘）
"""
from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.panel import Panel
from rich.table import Table

from .._util import console, get_client, get_config, warn

app = typer.Typer(help="本地 + Manager 状态总览")


@app.callback(invoke_without_command=True)
def status() -> None:
    cfg = get_config()

    # 本地
    local = _read_local_state(cfg.project_path)
    tbl = Table(title="本地", show_header=True, header_style="bold")
    tbl.add_column("Key"); tbl.add_column("Value")
    for k, v in local.items():
        tbl.add_row(k, str(v))
    console.print(tbl)

    # Manager
    try:
        cli = get_client(cfg)
        h = cli.health()
        ok_text = f"[bold green]{h.get('service')}[/bold green]  v{h.get('version')}  mode={h.get('admin_mode')}"
        console.print(Panel(ok_text, title="Manager"))

        if cfg.project_id:
            try:
                ov = cli.console_overview()
                ov_tbl = Table(title="跨项目驾驶舱", show_header=True, header_style="bold")
                ov_tbl.add_column("指标"); ov_tbl.add_column("值")
                for k in ("projects_total", "projects_active", "agents_online",
                          "tasks_in_progress", "tasks_blocked", "sprints_active",
                          "llm_cost_30d_usd", "confidence_30d_avg"):
                    ov_tbl.add_row(k, str(ov.get(k, "-")))
                console.print(ov_tbl)
            except Exception:
                warn("跨项目驾驶舱接口暂不可用（M11 提供）")
    except Exception as e:
        warn(f"Manager 不可达：{e}")


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
