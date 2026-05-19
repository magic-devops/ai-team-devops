"""
@module: sop_cli.commands.platforms
@purpose: 列举 / 自检 / 安装各 AI Agent·CLI·IDE 平台适配（Cursor/Codex/Claude/WorkBuddy/Hermes…）
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="AI 平台：list / doctor / init / install-shims / ops-plan / ops-tasks")


def _project_root() -> Path:
    return get_config().project_path


@app.command("list")
def platforms_list() -> None:
    try:
        r = get_client(get_config()).platforms_list()
        rows = r.get("platforms") if isinstance(r, dict) else []
    except Exception:
        rows = _local_registry_rows()
    tbl = Table(title="AI 平台（sop 统一控制平面）", show_header=True, header_style="bold")
    tbl.add_column("id")
    tbl.add_column("name")
    tbl.add_column("category")
    tbl.add_column("integration")
    tbl.add_column("cli")
    tbl.add_column("ready")
    for p in rows or []:
        if not isinstance(p, dict):
            continue
        cli_ok = "✓" if p.get("cli_available") else "—"
        tbl.add_row(
            str(p.get("id", "")),
            str(p.get("name", "")),
            str(p.get("category", "")),
            str(p.get("integration", "")),
            cli_ok,
            "✓" if p.get("ready") else "—",
        )
    console.print(tbl)


def _local_registry_rows() -> list[dict]:
    reg_path = _project_root() / "ai-sop-ops" / "platforms" / "registry.json"
    if not reg_path.is_file():
        return []
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    return reg.get("platforms") or []


@app.command("doctor")
def platforms_doctor() -> None:
    root = _project_root()
    reg_path = root / "ai-sop-ops" / "platforms" / "registry.json"
    if not reg_path.is_file():
        warn(f"缺少 {reg_path}")
        raise typer.Exit(1)
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    failed = 0
    for p in reg.get("platforms") or []:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id", ""))
        entries = [str(x) for x in (p.get("entry_files") or [])]
        shim = str(p.get("hook_shim") or "")
        has_entry = any((root / e).exists() for e in entries)
        has_shim = bool(shim) and (root / shim).is_file()
        integration = str(p.get("integration") or "")
        if integration == "hooks" and not has_shim:
            warn(f"{pid}: 缺少 hook shim {shim} → sop platforms install-shims {pid}")
            failed += 1
        elif not has_entry:
            warn(f"{pid}: 缺少入口文件（{', '.join(entries[:2])}…）")
            failed += 1
        else:
            ok(f"{pid}: 入口就绪" + (", shim 就绪" if has_shim else ""))
    if failed:
        raise typer.Exit(1)
    ok("平台适配检查通过")


@app.command("init")
def platforms_init(
    platform_id: str = typer.Argument("all", help="平台 id、逗号分隔列表，或 all"),
    overwrite: bool = typer.Option(False, "--overwrite", help="覆盖已有配置文件"),
    dry_run: bool = typer.Option(False, "--dry-run", help="只预览，不写文件"),
) -> None:
    """按 registry.json 一次性生成各 CLI/IDE/Agent 接入文件。"""
    root = _project_root()
    gen = root / "ai-sop-ops" / "platforms" / "onboard.py"
    if not gen.is_file():
        warn("缺少 ai-sop-ops/platforms/onboard.py")
        raise typer.Exit(1)
    cmd = ["python3", str(gen), "--root", str(root), "--platform", platform_id]
    if overwrite:
        cmd.append("--overwrite")
    if dry_run:
        cmd.append("--dry-run")
    r = subprocess.run(cmd, cwd=str(root), capture_output=True, text=True)
    if r.returncode != 0:
        warn(r.stderr or r.stdout)
        raise typer.Exit(r.returncode)
    try:
        manifest = json.loads(r.stdout)
    except Exception:
        console.print(r.stdout)
        return
    rows = manifest.get("platforms") or []
    tbl = Table(title="平台接入初始化", show_header=True, header_style="bold")
    tbl.add_column("id")
    tbl.add_column("entries")
    tbl.add_column("shim")
    tbl.add_column("configs")
    for row in rows:
        if not isinstance(row, dict):
            continue
        entries = ", ".join(f"{x.get('path')}:{x.get('status')}" for x in row.get("entries") or [])
        shim = row.get("shim") or {}
        configs = ", ".join(f"{x.get('path')}:{x.get('status')}" for x in row.get("configs") or [])
        tbl.add_row(str(row.get("id", "")), entries or "—", str(shim.get("status") or "—"), configs or "—")
    console.print(tbl)
    if dry_run:
        warn("dry-run 未写入文件")
    else:
        ok(".sop-runtime/platforms/onboarding.json 已更新")


@app.command("install-shims")
def install_shims(
    platform_id: str = typer.Argument(..., help="cursor|workbuddy|hermes|windsurf|opencode|…"),
) -> None:
    root = _project_root()
    gen = root / "ai-sop-ops" / "platforms" / "sop_hook_shim.py"
    if not gen.is_file():
        warn("缺少 ai-sop-ops/platforms/sop_hook_shim.py")
        raise typer.Exit(1)
    plat = next((p for p in _local_registry_rows() if p.get("id") == platform_id), None)
    shim_rel = str((plat or {}).get("hook_shim") or "")
    if not shim_rel:
        warn(f"平台 {platform_id} 无 hook_shim 定义")
        raise typer.Exit(1)
    dest_dir = (root / shim_rel).parent
    r = subprocess.run(
        ["python3", str(gen), platform_id, str(dest_dir)],
        cwd=str(root),
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        warn(r.stderr or r.stdout)
        raise typer.Exit(2)
    ok(r.stdout.strip() or f"shim → {dest_dir / 'sop_hook.py'}")


@app.command("ops-plan")
def ops_plan(
    as_json: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """生成 Agent 与工具链运行治理计划，供人和 AI CLI 同步消费。"""
    data = get_client(get_config()).platforms_ops_plan()
    if as_json:
        console.print_json(data=json.loads(json.dumps(data, ensure_ascii=False)))
        return
    health = data.get("health") if isinstance(data, dict) else {}
    summary = health.get("summary") if isinstance(health, dict) else {}
    console.print(f"[bold]Agent 与工具链健康分：[/bold]{health.get('score', 0)}")
    console.print(
        f"[dim]平台 {summary.get('platforms_total', 0)}，就绪 {summary.get('ready', 0)}，CLI 可用 {summary.get('cli_available', 0)}，Hook Shim {summary.get('hook_shim_present', 0)}[/dim]"
    )
    commands = data.get("commands") if isinstance(data, dict) else []
    tbl = Table(title="治理 Runbook", show_header=True, header_style="bold")
    tbl.add_column("id")
    tbl.add_column("category")
    tbl.add_column("command")
    for cmd in commands or []:
        if isinstance(cmd, dict):
            tbl.add_row(str(cmd.get("id", "")), str(cmd.get("category", "")), str(cmd.get("command", "")))
    console.print(tbl)
    risks = (health.get("risks") if isinstance(health, dict) else []) or []
    if risks:
        risk_tbl = Table(title="风险", show_header=True, header_style="bold")
        risk_tbl.add_column("level")
        risk_tbl.add_column("platform")
        risk_tbl.add_column("message")
        for r in risks:
            if isinstance(r, dict):
                risk_tbl.add_row(str(r.get("level", "")), str(r.get("platform_id", "")), str(r.get("message", "")))
        console.print(risk_tbl)
    tasks = data.get("task_candidates") if isinstance(data, dict) else []
    if tasks:
        task_tbl = Table(title="候选治理任务", show_header=True, header_style="bold")
        task_tbl.add_column("category")
        task_tbl.add_column("priority")
        task_tbl.add_column("title")
        for task in tasks:
            if isinstance(task, dict):
                task_tbl.add_row(str(task.get("category", "")), str(task.get("priority", "")), str(task.get("title", "")))
        console.print(task_tbl)


@app.command("ops-tasks")
def ops_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建任务；默认只预览"),
    priority: str = typer.Option("P1", "--priority", help="任务优先级"),
    assigned_to: str = typer.Option("DevOps", "--assigned-to", help="默认处理人"),
    category: list[str] = typer.Option([], "--category", help="仅生成指定类别，可多次传入"),
    as_json: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """把 Agent 与工具链治理项转为任务。"""
    body: dict[str, Any] = {
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "categories": category,
    }
    data = get_client(get_config()).platforms_ops_tasks(body)
    if as_json:
        console.print_json(data=json.loads(json.dumps(data, ensure_ascii=False)))
        return
    summary = data.get("summary") if isinstance(data, dict) else {}
    ok(
        f"{'已创建' if apply else '已预览'}治理任务：计划 {summary.get('planned', 0)}，创建 {summary.get('created', 0)}，跳过 {summary.get('skipped', 0)}"
    )


@app.command("agent-runs")
def agent_runs(
    agent: str = typer.Option("", "--agent", help="按 Agent ID/name 过滤"),
    status: str = typer.Option("", "--status", help="按运行状态过滤"),
    limit: int = typer.Option(50, "--limit", help="返回数量"),
    as_json: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看 Agent 运行、租约、报告和心跳汇总。"""
    data = get_client(get_config()).agents_runs(agent=agent, status=status, limit=limit)
    if as_json:
        console.print_json(data=json.loads(json.dumps(data, ensure_ascii=False)))
        return
    tbl = Table(title=f"Agent runs total={data.get('total', 0)}", show_header=True, header_style="bold")
    tbl.add_column("agent")
    tbl.add_column("task")
    tbl.add_column("status")
    tbl.add_column("progress")
    tbl.add_column("updated")
    tbl.add_column("summary")
    for row in data.get("items", []) if isinstance(data, dict) else []:
        if isinstance(row, dict):
            tbl.add_row(
                str(row.get("agent", "")),
                str(row.get("task_id", "")),
                str(row.get("status", "")),
                f"{row.get('progress', 0)}%",
                str(row.get("updated_at", "")),
                str(row.get("summary") or row.get("heartbeat_message") or "")[:64],
            )
    console.print(tbl)


@app.command("agent-summary")
def agent_summary(as_json: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """查看 Agent 能力画像、负载和成功率。"""
    data = get_client(get_config()).agents_runs_summary()
    if as_json:
        console.print_json(data=json.loads(json.dumps(data, ensure_ascii=False)))
        return
    summary = data.get("summary") if isinstance(data, dict) else {}
    console.print(
        f"[bold]Agent 运行中心：[/bold]注册 {summary.get('registered_agents', 0)}，活跃租约 {summary.get('active_claims', 0)}，报告 {summary.get('reports', 0)}，成功率 {summary.get('success_rate', 0)}%"
    )
    tbl = Table(title="Agent 画像与负载", show_header=True, header_style="bold")
    tbl.add_column("agent")
    tbl.add_column("role")
    tbl.add_column("active")
    tbl.add_column("reports")
    tbl.add_column("success")
    tbl.add_column("tools")
    for row in data.get("agents", []) if isinstance(data, dict) else []:
        if isinstance(row, dict):
            tbl.add_row(
                str(row.get("agent", "")),
                str(row.get("role", "")),
                str(row.get("active_claims", 0)),
                str(row.get("reports", 0)),
                f"{row.get('success_rate', 0)}%",
                ",".join(str(x) for x in (row.get("tools") or [])[:4]),
            )
    console.print(tbl)


@app.command("agent-slo")
def agent_slo(as_json: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """查看 Agent SLO、健康状态和再平衡建议。"""
    data = get_client(get_config()).agents_runs_slo()
    if as_json:
        console.print_json(data=json.loads(json.dumps(data, ensure_ascii=False)))
        return
    summary = data.get("summary") if isinstance(data, dict) else {}
    console.print(
        f"[bold]Agent SLO：[/bold]评分 {summary.get('slo_score', 0)}，健康 {summary.get('healthy_agents', 0)}，观察 {summary.get('watch_agents', 0)}，风险 {summary.get('risk_agents', 0)}，建议 {summary.get('recommendations', 0)}"
    )
    tbl = Table(title="Agent SLO", show_header=True, header_style="bold")
    for col in ("agent", "status", "score", "active", "success", "issues"):
        tbl.add_column(col)
    for row in data.get("agents", []) if isinstance(data, dict) else []:
        if isinstance(row, dict):
            tbl.add_row(
                str(row.get("agent", "")),
                str(row.get("slo_status", "")),
                str(row.get("slo_score", "")),
                str(row.get("active_claims", 0)),
                f"{row.get('success_rate', 0)}%",
                ",".join(str(x) for x in row.get("issues") or []),
            )
    console.print(tbl)


@app.command("agent-rebalance-tasks")
def agent_rebalance_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认仅预览"),
    priority: str = typer.Option("P1", "--priority", help="任务优先级"),
    assigned_to: str = typer.Option("Coder", "--assigned-to", help="负责人"),
    category: list[str] = typer.Option([], "--category", help="按 category/severity 过滤，可多次传入"),
    as_json: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将 Agent SLO/再平衡建议预览或落为治理任务。"""
    body = {"dry_run": not apply, "priority": priority, "assigned_to": assigned_to, "categories": category}
    data = get_client(get_config()).agents_runs_rebalance_tasks(body)
    if as_json:
        console.print_json(data=json.loads(json.dumps(data, ensure_ascii=False)))
        return
    summary = data.get("summary") if isinstance(data, dict) else {}
    ok(
        f"{'已创建' if apply else '已预览'} Agent 再平衡任务：计划 {summary.get('planned', 0)}，创建 {summary.get('created', 0)}，SLO {summary.get('slo_score', 0)}"
    )


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print("[dim]子命令：list | doctor | init | install-shims | ops-plan | ops-tasks | agent-runs | agent-summary | agent-slo | agent-rebalance-tasks[/dim]")
