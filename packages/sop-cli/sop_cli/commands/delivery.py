"""Versioned project delivery commands shared by people, agents and tools."""

import json
from enum import Enum
from pathlib import Path
from typing import Annotated

import typer

from .._util import console, get_client, warn

app = typer.Typer(
    help="项目交付：workspace / inbox / progress / schedule / schedule-preview / observation / baseline / reviews / team-runtime / targets / preview / command"
)


class ProgressScope(str, Enum):
    project = "project"
    milestone = "milestone"
    sprint = "sprint"


class ProjectState(str, Enum):
    planning = "planning"
    active = "active"
    paused = "paused"
    archived = "archived"


@app.command("lifecycle-preview")
def lifecycle_preview(
    target: Annotated[ProjectState, typer.Option("--target")],
    reason: Annotated[str, typer.Option("--reason")],
):
    """读取指定状态及理由的固定预览；保存时沿用原版本、依据和幂等键。"""
    try:
        if not reason.strip() or len(reason.strip()) > 2000:
            raise ValueError("reason must contain between 1 and 2000 characters")
        with get_client() as client:
            console.print_json(data=client.delivery_project_lifecycle_preview({"target_status": target.value, "reason": reason.strip()}))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("team-runtime")
def team_runtime(
    json_out: Annotated[bool, typer.Option("--json", help="保留固定版本、不可用原因及操作权限")] = False,
):
    """读取团队 Agent 与运行配置的关联，不修改绑定或授予执行权限。"""
    try:
        with get_client() as client:
            result = client.delivery_team_runtime_bindings()
        if not json_out:
            console.print("团队运行关联 · 配置有效性不代表执行设备或凭据就绪", markup=False)
        console.print_json(data=result)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


def _show_progress_record(result: dict, json_out: bool, label: str):
    if json_out:
        console.print_json(data=result)
        return
    console.print(f"{label} · 项目 {result.get('project_id', '')}", markup=False)
    if "days" in result:
        coverage = result.get("coverage", {})
        metrics = result.get("current", {}).get("metrics", {})
        console.print(
            f"真实观测 {len(coverage.get('observed_days', []))} 天 · "
            f"缺失 {len(coverage.get('missing_days', []))} 天 · "
            f"任务 {metrics.get('tasks_total', '—')} · 已验证 {metrics.get('verified_completed', '—')}",
            markup=False,
        )
    else:
        console.print_json(data=result)


@app.command("progress")
def progress(
    starts_on: Annotated[str | None, typer.Option("--from", help="UTC 开始日期 YYYY-MM-DD")] = None,
    ends_on: Annotated[str | None, typer.Option("--to", help="UTC 结束日期 YYYY-MM-DD，最多366天")] = None,
    scope: Annotated[
        ProgressScope, typer.Option("--scope", help="项目、里程碑或迭代范围")
    ] = ProgressScope.project,
    scope_id: Annotated[str, typer.Option("--scope-id", help="里程碑或迭代的真实 ID")] = "",
    baseline_id: Annotated[str, typer.Option("--baseline", help="比较不可变计划基线")] = "",
    json_out: Annotated[bool, typer.Option("--json", help="保留历史缺口、范围变化和来源")] = False,
):
    """读取真实历史与当前状态，不创建观测或填补缺失日期。"""
    try:
        with get_client() as client:
            result = client.delivery_progress(
                starts_on=starts_on,
                ends_on=ends_on,
                scope=scope.value,
                scope_id=scope_id,
                baseline_id=baseline_id,
            )
        _show_progress_record(result, json_out, "进度历史")
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("observation")
def observation(
    observation_id: str,
    scope: Annotated[ProgressScope, typer.Option("--scope")] = ProgressScope.project,
    scope_id: Annotated[str, typer.Option("--scope-id")] = "",
    json_out: Annotated[bool, typer.Option("--json")] = False,
):
    """查看当时的真实任务快照；历史状态不替代当前任务。"""
    try:
        with get_client() as client:
            result = client.delivery_progress_observation(
                observation_id, scope=scope.value, scope_id=scope_id
            )
        _show_progress_record(result, json_out, "历史观测")
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("schedule")
def schedule(
    starts_on: Annotated[str | None, typer.Option("--from", help="计划开始日期 YYYY-MM-DD")] = None,
    ends_on: Annotated[str | None, typer.Option("--to", help="计划结束日期 YYYY-MM-DD，最多92天")] = None,
    json_out: Annotated[bool, typer.Option("--json", help="保留明确单位、未知容量及规划依据")] = False,
):
    """读取当前项目日历、明确预留和依赖排期，不推算或改排任务。"""
    try:
        with get_client() as client:
            result = client.delivery_schedule(starts_on=starts_on, ends_on=ends_on)
        _show_progress_record(result, json_out, "团队容量与排期")
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("schedule-preview")
def schedule_preview(
    file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)],
):
    """校验固定 planning_basis 和显式 changes；预览不保存，提交使用 command。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(body, dict) or set(body) != {"planning_basis", "changes"}:
            raise ValueError("需要 planning_basis 和 changes")
        if not isinstance(body["changes"], list) or not 1 <= len(body["changes"]) <= 200:
            raise ValueError("changes 必须包含1至200项明确任务编辑")
        with get_client() as client:
            console.print_json(data=client.delivery_schedule_preview(body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("baseline")
def baseline(baseline_id: str, json_out: Annotated[bool, typer.Option("--json")] = False):
    """查看不可变基线；冻结新计划使用 command --file 提交显式范围。"""
    try:
        with get_client() as client:
            result = client.delivery_baseline(baseline_id)
        _show_progress_record(result, json_out, "计划基线")
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("workspace")
def workspace():
    """读取项目需求、任务、执行和审查快照。"""
    with get_client() as client:
        console.print_json(data=client.delivery_workspace())


@app.command("reviews")
def reviews(
    task_id: str,
    limit: Annotated[int, typer.Option("--limit", min=1, max=100, help="每页审查记录数")] = 20,
    cursor: Annotated[str, typer.Option("--cursor", help="上一页返回的 next_cursor")] = "",
    json_out: Annotated[bool, typer.Option("--json", help="保留原始证据、资格和分页信息")] = False,
):
    """读取人工任务验收历史；删除或失效的历史不替代当前交付。"""
    try:
        with get_client() as client:
            result = client.delivery_task_reviews(task_id, limit=limit, cursor=cursor)
        _show_progress_record(result, json_out, "人工任务验收")
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("inbox")
def inbox(
    scope: Annotated[str, typer.Option("--scope", help="mine 或 team，当前项目的个人/团队事项")] = "mine",
    json_out: Annotated[bool, typer.Option("--json", help="保留服务端分类与定位信息")] = False,
):
    """查看待处理、阶段评审、执行验收及阻塞，不修改业务状态。"""
    try:
        if scope not in {"mine", "team"}:
            raise ValueError("scope must be mine or team")
        with get_client() as client:
            result = client.delivery_inbox(scope=scope)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=result)
        return
    console.print(f"项目 {result.get('project_id', '')} · {scope}", markup=False)
    for item in result.get("items", []):
        categories = ", ".join(item.get("categories", []))
        console.print(f"[{categories}] {item.get('title', '')} ({item.get('resource_id', '')})", markup=False)
    if not result.get("items"):
        console.print("当前没有待处理事项。")


@app.command("targets")
def targets():
    """读取当前账户可访问的执行工作区、智能体与设备。"""
    with get_client() as client:
        console.print_json(data=client.delivery_execution_targets())


@app.command("command")
def command(file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)]):
    """提交含 action/payload/expected_version/idempotency_key 的 JSON；重试复用原文件。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        required = {"action", "payload", "expected_version", "idempotency_key"}
        if not isinstance(body, dict) or set(body) != required or not isinstance(body["payload"], dict):
            raise ValueError("需要 action、payload、expected_version 和 idempotency_key")
        with get_client() as client:
            console.print_json(data=client.delivery_command(body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("execution-preview")
def execution_preview(file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)]):
    """纯预览固定任务、目标、智能体与测试；冲突不自动采用新依据。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(body, dict):
            raise ValueError("执行提案必须是 JSON 对象")
        with get_client() as client:
            console.print_json(data=client.delivery_execution_preview(body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("execution-observations")
def execution_observations(
    execution_id: str,
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 30,
    cursor: Annotated[str, typer.Option("--cursor", help="该执行返回的原始 next_cursor")] = "",
    json_out: Annotated[bool, typer.Option("--json")] = False,
):
    """读取真实节点事件和完成后日志；保留未知用量与截断标记。"""
    try:
        with get_client() as client:
            result = client.delivery_execution_observations(execution_id, limit=limit, cursor=cursor)
        _show_progress_record(result, json_out, "执行观测")
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("preview")
def preview(file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)]):
    """预览任务计划；JSON 显式指定 generator=template 或 ai，重试复用原文件。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        required = {"requirement_id", "expected_version", "idempotency_key", "generator"}
        allowed = required | {"mode", "max_items"}
        if not isinstance(body, dict) or not required <= set(body) <= allowed:
            raise ValueError("需要 requirement_id、expected_version、idempotency_key 和 generator")
        if body["generator"] not in ("template", "ai"):
            raise ValueError("generator 必须显式指定为 template 或 ai")
        with get_client() as client:
            console.print_json(data=client.delivery_task_plan_preview(body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc
