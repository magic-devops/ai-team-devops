"""
@module: sop_cli.commands.project
@purpose: 项目管理与治理操作包；供 CLI/Agent 获取项目清单、体检、接入包和治理任务
"""
from __future__ import annotations

from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, kv, warn

app = typer.Typer(help="项目：list/review/ops-plan/ops-tasks/onboarding/clone-preview")


def _project_id(value: str) -> str:
    pid = (value or "").strip() or (get_config().project_id or "").strip()
    if not pid:
        warn("未提供 project_id，且本地配置没有 project_id。请使用 --project-id 或先 sop login --pair。")
        raise typer.Exit(1)
    return pid


def _items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        raw = payload.get("items") or payload.get("projects") or []
    else:
        raw = payload or []
    return [item for item in raw if isinstance(item, dict)]


@app.command("list")
def list_projects(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """列出当前租户可见项目。"""
    try:
        out = get_client().list_projects()
    except Exception as e:
        warn(f"Manager projects 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    rows = _items(out)
    tbl = Table(title="projects", show_header=True, header_style="bold")
    for col in ("id", "name", "status", "business", "members", "tasks"):
        tbl.add_column(col)
    for item in rows:
        counts = item.get("counts") or {}
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("name", ""))[:32],
            str(item.get("status", "")),
            str(item.get("business_name") or item.get("business_id") or ""),
            str(counts.get("members", 0)),
            str(counts.get("tasks", 0)),
        )
    console.print(tbl)


@app.command("review")
def review(project_id: str = typer.Option("", "--project-id", "-p"), json_out: bool = typer.Option(False, "--json")) -> None:
    """查看项目智能体检结果。"""
    pid = _project_id(project_id)
    try:
        out = get_client().project_review(pid)
    except Exception as e:
        warn(f"Manager project review 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    kv("project_id", pid)
    kv("score", out.get("score"))
    kv("grade", out.get("grade"))
    for risk in out.get("risks") or []:
        warn(f"{risk.get('level')}: {risk.get('message')}")


@app.command("ops-plan")
def ops_plan(project_id: str = typer.Option("", "--project-id", "-p"), json_out: bool = typer.Option(False, "--json")) -> None:
    """输出 AI/CLI 可消费的项目治理操作包。"""
    pid = _project_id(project_id)
    try:
        out = get_client().project_ops_plan(pid)
    except Exception as e:
        warn(f"Manager project ops-plan 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    kv("project_id", pid)
    kv("health", (out.get("health") or {}).get("score"))
    kv("task_candidates", len(out.get("task_candidates") or []))
    tbl = Table(title="ops commands", show_header=True, header_style="bold")
    tbl.add_column("id")
    tbl.add_column("category")
    tbl.add_column("command")
    for cmd in out.get("commands") or []:
        tbl.add_row(str(cmd.get("id", "")), str(cmd.get("category", "")), str(cmd.get("command", "")))
    console.print(tbl)


@app.command("ops-tasks")
def ops_tasks(
    project_id: str = typer.Option("", "--project-id", "-p"),
    apply: bool = typer.Option(False, "--apply", help="实际创建任务；默认仅预览"),
    priority: str = typer.Option("P1", "--priority"),
    owner_id: str = typer.Option("", "--owner-id", help="项目成员稳定 ID；留空表示未分配"),
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """将项目治理操作包候选项预览或生成任务。"""
    pid = _project_id(project_id)
    body = {"dry_run": not apply, "priority": priority, "owner_id": owner_id}
    try:
        out = get_client().project_ops_tasks(pid, body)
    except Exception as e:
        warn(f"Manager project ops-tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("dry_run", out.get("dry_run"))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    kv("skipped", summary.get("skipped", 0))


@app.command("onboarding")
def onboarding(project_id: str = typer.Option("", "--project-id", "-p"), json_out: bool = typer.Option(False, "--json")) -> None:
    """查看项目 CLI / Agent 接入包。"""
    pid = _project_id(project_id)
    try:
        out = get_client().project_onboarding(pid)
    except Exception as e:
        warn(f"Manager project onboarding 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    scope = out.get("scope") or out.get("isolation") or {}
    manager = out.get("manager") or {}
    kv("project_id", pid)
    kv("manager_url", out.get("manager_url") or manager.get("url"))
    kv("tenant_code", scope.get("tenant_code"))
    kv("business_code", scope.get("business_code"))
    kv("project_code", scope.get("project_code") or scope.get("project_id"))
    commands = out.get("commands") or {}
    for key in ("new_project", "existing_project", "prepare_context", "doctor"):
        if commands.get(key):
            kv(key, commands[key])


@app.command("clone-preview")
def clone_preview(
    template_id: str = typer.Option(..., "--template-id", "-t"),
    name: str = typer.Option("", "--name", help="新项目名称"),
    description: str = typer.Option("", "--description"),
    business_id: str = typer.Option("", "--business-id"),
    project_path: str = typer.Option("", "--project-path"),
    clone_requirements: bool = typer.Option(True, "--requirements/--no-requirements"),
    clone_tasks: bool = typer.Option(False, "--tasks/--no-tasks"),
    clone_knowledge: bool = typer.Option(True, "--knowledge/--no-knowledge"),
    clone_rules: bool = typer.Option(True, "--rules/--no-rules"),
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """预览从模板克隆项目会复制的资产、风险和后续治理步骤。"""
    body = {
        "name": name,
        "description": description,
        "business_id": business_id or None,
        "project_path": project_path,
        "clone_requirements": clone_requirements,
        "clone_tasks": clone_tasks,
        "clone_knowledge": clone_knowledge,
        "clone_rules": clone_rules,
    }
    try:
        out = get_client().project_clone_preview(template_id, body)
    except Exception as e:
        warn(f"Manager project clone-preview 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    kv("template_id", template_id)
    kv("target_name", name)
    assets = out.get("selected_assets") or {}
    tbl = Table(title="clone preview", show_header=True, header_style="bold")
    tbl.add_column("asset")
    tbl.add_column("count")
    for key in ("requirements", "tasks", "knowledge", "rules", "specs"):
        tbl.add_row(key, str(assets.get(key, 0)))
    console.print(tbl)
    for item in out.get("warnings") or []:
        warn(f"{item.get('level')}: {item.get('message')}")
