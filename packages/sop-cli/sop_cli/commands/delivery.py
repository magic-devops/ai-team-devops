"""Versioned project delivery commands shared by people, agents and tools."""

import json
from enum import Enum
from pathlib import Path
from typing import Annotated

import typer

from .._util import console, get_client, warn
from . import delivery_discussion

app = typer.Typer(
    help="项目交付：context / requirements / requirement / tasks / task / issues / references / query-rebuild / workspace / discussion / inbox / progress-summary / progress / activity / requirement-history / requirement-change-preview / issue / issue-diagnoses / issue-diagnose / quality / releases / deployments / deployment-preview / schedule / reviews / team-runtime / targets / execution / execution-runtime / execution-output / execution-control-preview / preview / command"
)

app.add_typer(delivery_discussion.app, name="discussion")


def _query_output(method, *args, **selection):
    try:
        with get_client() as client:
            console.print_json(data=getattr(client, method)(*args, **selection))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("context")
def context():
    """读取项目概要、全范围有效统计和查询状态。"""
    _query_output("delivery_context")


@app.command("requirements")
def requirements(
    q: Annotated[str, typer.Option("--query")] = "",
    stage: Annotated[str, typer.Option("--stage")] = "",
    priority: Annotated[str, typer.Option("--priority")] = "",
    owner_id: Annotated[str, typer.Option("--owner")] = "",
    milestone_id: Annotated[str, typer.Option("--milestone")] = "",
    cursor: Annotated[str, typer.Option("--cursor")] = "",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 20,
    sort: Annotated[str, typer.Option("--sort")] = "created_desc",
):
    """按服务端筛选和排序分页读取需求摘要，total为全范围计数。"""
    _query_output(
        "delivery_requirements",
        q=q,
        stage=stage,
        priority=priority,
        owner_id=owner_id,
        milestone_id=milestone_id,
        cursor=cursor,
        limit=limit,
        sort=sort,
    )


@app.command("requirement")
def requirement(requirement_id: Annotated[str, typer.Option("--id")]):
    """按精确ID读取完整需求，不受列表页窗口影响。"""
    _query_output("delivery_requirement", requirement_id)


@app.command("tasks")
def tasks(
    requirement_id: Annotated[str, typer.Option("--requirement")] = "",
    q: Annotated[str, typer.Option("--query")] = "",
    status: Annotated[str, typer.Option("--status")] = "",
    priority: Annotated[str, typer.Option("--priority")] = "",
    owner_id: Annotated[str, typer.Option("--owner")] = "",
    milestone_id: Annotated[str, typer.Option("--milestone")] = "",
    cursor: Annotated[str, typer.Option("--cursor")] = "",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 20,
    sort: Annotated[str, typer.Option("--sort")] = "created_desc",
):
    """按六态有效进度筛选任务；变更后旧游标需从第一页重读。"""
    _query_output(
        "delivery_tasks",
        requirement_id=requirement_id,
        q=q,
        status=status,
        priority=priority,
        owner_id=owner_id,
        milestone_id=milestone_id,
        cursor=cursor,
        limit=limit,
        sort=sort,
    )


@app.command("task")
def task(task_id: Annotated[str, typer.Option("--id")]):
    """读取精确任务、有效验收和当前排期依据。"""
    _query_output("delivery_task", task_id)


@app.command("issues")
def issues(
    requirement_id: Annotated[str, typer.Option("--requirement")] = "",
    task_id: Annotated[str, typer.Option("--task")] = "",
    q: Annotated[str, typer.Option("--query")] = "",
    status: Annotated[str, typer.Option("--status")] = "",
    severity: Annotated[str, typer.Option("--severity")] = "",
    source: Annotated[str, typer.Option("--source")] = "",
    cursor: Annotated[str, typer.Option("--cursor")] = "",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 20,
):
    """分页查询项目问题；完整问题使用issue --id。"""
    _query_output(
        "delivery_issues",
        requirement_id=requirement_id,
        task_id=task_id,
        q=q,
        status=status,
        severity=severity,
        source=source,
        cursor=cursor,
        limit=limit,
    )


@app.command("execution")
def execution(execution_id: Annotated[str, typer.Option("--id")]):
    """读取精确执行记录，并核验当前工作区权限。"""
    _query_output("delivery_execution", execution_id)


@app.command("references")
def references(
    kind: Annotated[str, typer.Option("--kind")],
    q: Annotated[str, typer.Option("--query")] = "",
    ids: Annotated[str, typer.Option("--ids")] = "",
    requirement_id: Annotated[str, typer.Option("--requirement")] = "",
    task_id: Annotated[str, typer.Option("--task")] = "",
    member_kind: Annotated[str, typer.Option("--member-kind")] = "",
    resource_kind: Annotated[str, typer.Option("--resource-kind")] = "",
    member_active: Annotated[bool | None, typer.Option("--member-active/--member-inactive")] = None,
    archived: Annotated[bool | None, typer.Option("--archived/--not-archived")] = None,
    sort: Annotated[str, typer.Option("--sort")] = "id_asc",
    cursor: Annotated[str, typer.Option("--cursor")] = "",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 50,
):
    """分页查找成员、里程碑、资源等引用，或用逗号分隔ID取已选对象。"""
    _query_output(
        "delivery_references",
        kind,
        q=q,
        ids=[value for value in ids.split(",") if value],
        requirement_id=requirement_id,
        task_id=task_id,
        cursor=cursor,
        limit=limit,
        member_kind=member_kind,
        resource_kind=resource_kind,
        member_active=member_active,
        archived=archived,
        sort=sort,
    )


@app.command("query-rebuild")
def query_rebuild():
    """显式重建当前项目派生查询索引；需要项目配置权限。"""
    _query_output("delivery_query_rebuild")


class ProgressScope(str, Enum):
    project = "project"
    milestone = "milestone"
    sprint = "sprint"


class ProjectState(str, Enum):
    planning = "planning"
    active = "active"
    paused = "paused"
    archived = "archived"


class OutputStream(str, Enum):
    stdout = "stdout"
    stderr = "stderr"


class ActivityScope(str, Enum):
    project = "project"
    requirement = "requirement"


@app.command("activity")
def activity(
    scope: Annotated[ActivityScope, typer.Option("--scope")] = ActivityScope.project,
    scope_id: Annotated[str, typer.Option("--scope-id")] = "",
    event_id: Annotated[str, typer.Option("--event")] = "",
    action: Annotated[str, typer.Option("--action")] = "",
    cursor: Annotated[str, typer.Option("--cursor")] = "",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 20,
):
    """分页读取已记录活动，或按精确事件ID查看当前有权访问的来源。"""
    try:
        if event_id and (scope != ActivityScope.project or scope_id or cursor or action or limit != 20):
            raise ValueError("--event 不能同时使用范围或分页参数")
        if not event_id and (scope == ActivityScope.requirement) != bool(scope_id):
            raise ValueError("requirement 范围需要 --scope-id；project 范围不使用该参数")
        with get_client() as client:
            options = {"scope": scope.value, "scope_id": scope_id, "cursor": cursor, "limit": limit}
            if action:
                options["action"] = action
            result = client.delivery_activity_event(event_id) if event_id else client.delivery_activity(**options)
            console.print_json(data=result)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("requirement-history")
def requirement_history(
    requirement_id: Annotated[str, typer.Option("--id")],
    version_id: Annotated[str, typer.Option("--version")] = "",
    cursor: Annotated[str, typer.Option("--cursor")] = "",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 20,
):
    """读取真实观测的需求内容历史，或精确只读版本；不补造早期内容。"""
    try:
        if version_id and (cursor or limit != 20):
            raise ValueError("--version 不能同时使用分页参数")
        with get_client() as client:
            result = client.delivery_requirement_version(requirement_id, version_id) if version_id else client.delivery_requirement_history(
                requirement_id, cursor=cursor, limit=limit,
            )
            console.print_json(data=result)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("requirement-change-preview")
def requirement_change_preview(
    requirement_id: Annotated[str, typer.Option("--id")],
    file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)],
):
    """核对固定需求内容变更及影响；不会保存、重派或重新验收。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(body, dict) or set(body) != {"requirement_basis", "changes"}:
            raise ValueError("需要明确 requirement_basis 和 changes")
        if not isinstance(body["requirement_basis"], str) or not isinstance(body["changes"], dict) or not body["changes"]:
            raise ValueError("requirement_basis 必须为字符串，changes 必须为非空对象")
        if set(body["changes"]) - {"title", "description", "acceptance_criteria"}:
            raise ValueError("changes 只能修改 title、description、acceptance_criteria")
        with get_client() as client:
            console.print_json(data=client.delivery_requirement_change_preview(requirement_id, body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("execution-runtime")
def execution_runtime(execution_id: Annotated[str, typer.Option("--id")]):
    """核对明确运行、节点、停止事实及实际可用操作；不会启动运行。"""
    try:
        with get_client() as client:
            console.print_json(data=client.delivery_execution_runtime(execution_id))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("execution-output")
def execution_output(
    execution_id: Annotated[str, typer.Option("--id")],
    node_id: Annotated[str, typer.Option("--node")],
    attempt: Annotated[int, typer.Option("--attempt", min=1)],
    stream: Annotated[OutputStream, typer.Option("--stream")] = OutputStream.stdout,
    cursor: Annotated[str, typer.Option("--cursor")] = "",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 50,
):
    """读取明确节点/尝试/通道的净化输出，保留来源和缺失提示。"""
    try:
        with get_client() as client:
            console.print_json(data=client.delivery_execution_output(
                execution_id, node_id, attempt=attempt, stream=stream.value, cursor=cursor, limit=limit,
            ))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("execution-control-preview")
def execution_control_preview(
    file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)],
):
    """预览原操作理由与固定运行；提交仍需明确 command 和原幂等键。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(body, dict):
            raise ValueError("Expected a JSON object")
        with get_client() as client:
            console.print_json(data=client.delivery_execution_control_preview(body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("issue")
def issue_detail(issue_id: Annotated[str, typer.Option("--id")]):
    """查看明确问题、实际来源证据及诊断提案；不会默认选择首项。"""
    try:
        with get_client() as client:
            console.print_json(data=client.delivery_issue(issue_id))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("issue-diagnoses")
def issue_diagnoses(
    issue_id: Annotated[str, typer.Option("--id")],
    cursor: Annotated[str, typer.Option("--cursor")] = "",
    diagnosis_id: Annotated[str, typer.Option("--diagnosis-id")] = "",
):
    """读取明确问题的诊断历史；游标保留原项目和问题范围。"""
    try:
        if cursor and diagnosis_id:
            raise ValueError("Choose history cursor or an exact diagnosis ID")
        with get_client() as client:
            result = client.delivery_issue_diagnosis(issue_id, diagnosis_id) if diagnosis_id else client.delivery_issue_diagnoses(issue_id, cursor=cursor)
            console.print_json(data=result)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("issue-diagnose")
def issue_diagnose(
    issue_id: Annotated[str, typer.Option("--id")],
    file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)],
):
    """按原文件生成或查询同一诊断请求；不自动采纳、执行或关闭问题。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(body, dict):
            raise ValueError("Expected a JSON object")
        with get_client() as client:
            console.print_json(data=client.delivery_issue_diagnose(issue_id, body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("deployments")
def deployments(deployment_id: Annotated[str, typer.Option("--id")] = ""):
    """读取受控环境与真实部署，或明确ID的固定计划和实际证据。"""
    try:
        with get_client() as client:
            result = client.delivery_deployment(deployment_id) if deployment_id else client.delivery_deployments()
        console.print_json(data=result)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("deployment-preview")
def deployment_preview(file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)]):
    """预览明确候选部署或已验证基线回滚；写入使用通用command和原key。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(body, dict):
            raise ValueError("Expected a JSON object")
        with get_client() as client:
            console.print_json(data=client.delivery_deployment_preview(body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("quality")
def quality(
    requirement_ids: Annotated[list[str] | None, typer.Option("--requirement-id")] = None,
    task_ids: Annotated[list[str] | None, typer.Option("--task-id")] = None,
    kind: Annotated[str, typer.Option("--kind", help="all / requirement / task")] = "all",
    readiness: Annotated[str, typer.Option("--readiness", help="all / ready / attention")] = "all",
    query: Annotated[str, typer.Option("--query")] = "",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 20,
    cursor: Annotated[str, typer.Option("--cursor")] = "",
):
    """浏览一页质量目录；指定需求/独立任务时检查完整范围，不自动翻页。"""
    try:
        selected = bool(requirement_ids or task_ids)
        if selected and (kind != "all" or readiness != "all" or query or cursor or limit != 20):
            raise ValueError("Explicit proof scope cannot be combined with catalogue filters")
        with get_client() as client:
            result = (
                client.delivery_quality(requirement_ids=requirement_ids or [], task_ids=task_ids or [])
                if selected else client.delivery_quality_catalogue(kind=kind, readiness=readiness, q=query, limit=limit, cursor=cursor)
            )
        console.print_json(data=result)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("releases")
def releases(
    release_id: Annotated[str, typer.Option("--id")] = "",
    kind: Annotated[str, typer.Option("--kind", help="candidate / evidence / legacy")] = "candidate",
    query: Annotated[str, typer.Option("--query")] = "",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100)] = 20,
    cursor: Annotated[str, typer.Option("--cursor")] = "",
):
    """浏览一页候选/CI/手工历史摘要；--id 读取明确候选或 CI 原件。"""
    try:
        if kind not in {"candidate", "evidence", "legacy"}:
            raise ValueError("kind must be candidate, evidence or legacy")
        if release_id and (kind == "legacy" or query or cursor or limit != 20):
            raise ValueError("Exact detail requires candidate/evidence and no catalogue filters")
        with get_client() as client:
            if release_id:
                result = client.delivery_release_evidence(release_id) if kind == "evidence" else client.delivery_release(release_id)
            else:
                result = client.delivery_release_page(kind=kind, q=query, limit=limit, cursor=cursor)
        console.print_json(data=result)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("release-context")
def release_context():
    """读取当前发布信任策略与权限上下文，不加载候选或 CI 目录。"""
    try:
        with get_client() as client:
            console.print_json(data=client.delivery_releases())
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("release-preview")
def release_preview(file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)]):
    """读取当前文件的固定发布候选预览；写入沿用通用command及原key。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(body, dict):
            raise ValueError("Expected a JSON object")
        with get_client() as client:
            console.print_json(data=client.delivery_release_preview(body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


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
    if "days" in result or ("coverage" in result and "current" in result):
        coverage = result.get("coverage", {})
        metrics = result.get("current", {}).get("metrics", {})
        console.print(
            f"真实观测 {len(coverage.get('observed_days', []))} 天 · "
            f"缺失 {len(coverage.get('missing_days', []))} 天 · "
            f"未来 {len(coverage.get('future_days', []))} 天 · "
            f"任务 {metrics.get('tasks_total', '—')} · 已验证 {metrics.get('verified_completed', '—')}",
            markup=False,
        )
    else:
        console.print_json(data=result)


@app.command("progress-summary")
def progress_summary(
    starts_on: Annotated[str | None, typer.Option("--starts-on", help="UTC 开始日期 YYYY-MM-DD")] = None,
    ends_on: Annotated[str | None, typer.Option("--ends-on", help="UTC 结束日期 YYYY-MM-DD，最多366天")] = None,
    json_out: Annotated[bool, typer.Option("--json", help="保留当前指标、观测缺口及查询代次")] = False,
):
    """读取轻量进度摘要与真实观测覆盖，不加载任务或历史快照。"""
    try:
        with get_client() as client:
            result = client.delivery_progress_summary(starts_on=starts_on, ends_on=ends_on)
        _show_progress_record(result, json_out, "进度摘要")
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


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
    category: Annotated[str, typer.Option("--category", help="all/work/approval/acceptance/blocked/overdue")] = "all",
    limit: Annotated[int, typer.Option("--limit", min=1, max=100, help="每页事项数")] = 20,
    cursor: Annotated[str, typer.Option("--cursor", help="上一页返回的 next_cursor")] = "",
    json_out: Annotated[bool, typer.Option("--json", help="保留服务端分类、全范围计数与分页信息")] = False,
):
    """分页查看待处理、阶段评审、执行验收及阻塞，不修改业务状态。"""
    try:
        if scope not in {"mine", "team"}:
            raise ValueError("scope must be mine or team")
        if category not in {"all", "work", "approval", "acceptance", "blocked", "overdue"}:
            raise ValueError("invalid inbox category")
        with get_client() as client:
            result = client.delivery_inbox(scope=scope, category=category, limit=limit, cursor=cursor)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=result)
        return
    items = result.get("items", [])
    has_more = result.get("has_more", False)
    console.print(f"项目 {result.get('project_id', '')} · {scope} · {category}", markup=False)
    console.print(
        f"本页 {len(items)} 项 · 匹配总数 {result.get('total', len(items))} 项 · "
        f"每页上限 {result.get('limit', limit)} · has_more={str(has_more).lower()}",
        markup=False,
    )
    for item in items:
        categories = ", ".join(item.get("categories", []))
        status = f" · {item['status']}" if item.get("status") else ""
        console.print(f"[{categories}] {item.get('title', '')} ({item.get('resource_id', '')}){status}", markup=False)
    if not items:
        console.print("本页没有匹配事项。")
    if has_more and result.get("next_cursor"):
        console.print(f"next_cursor: {result['next_cursor']}", markup=False, soft_wrap=True)
        console.print("继续查看：保持 --scope、--category、--limit，并传入 --cursor。", markup=False)


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
        if not isinstance(body, dict) or not required <= set(body) <= required | {"source_reference"} or not isinstance(body["payload"], dict):
            raise ValueError("需要 action、payload、expected_version、idempotency_key；仅允许可选根source_reference")
        if body.get("source_reference") is not None and body["action"] not in {
            "requirement.update", "task.update", "tasks.plan", "issue.promote", "issue.diagnosis.adopt"
        }:
            raise ValueError("source_reference 仅用于明确的业务采纳动作")
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
