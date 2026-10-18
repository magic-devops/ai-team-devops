"""
@module: sop_cli.commands.requirement
@purpose: 需求原版本意图与只读Manager缓存
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Annotated, Any

import typer
from rich.table import Table

from .._util import console, err, get_client, get_config, ok, warn
from . import hermes as hermes_cmd

app = typer.Typer(help="需求：list/create/update/delete（原版本写入、只读缓存）")
app.add_typer(hermes_cmd.build_resource_app("requirements"), name="v1", help="Hermes 需求：list/get/create/patch")


def _generation_options(generator: str, request_id: str) -> dict[str, Any]:
    if generator not in {"ai", "rules"}:
        raise ValueError("generator must be ai or rules")
    result: dict[str, Any] = {"generator": generator}
    if request_id:
        if not 8 <= len(request_id) <= 100:
            raise ValueError("request-id must contain 8-100 characters")
        result["idempotency_key"] = request_id
    return result


def _adoption_fields(result: dict[str, Any], operation: str, *, requirement: bool = False) -> dict[str, Any]:
    generation = result.get("generation") or {}
    generation_id = generation.get("id")
    version = result.get("expected_version")
    if not generation_id or not isinstance(version, int) or (requirement and not generation.get("basis")):
        raise ValueError("Manager did not return a versioned generation; preview again on a compatible server before applying")
    fields = {
        "generation_id": generation_id,
        "expected_version": version,
        "idempotency_key": hashlib.sha256(f"{operation}:{generation_id}".encode()).hexdigest(),
    }
    if requirement:
        fields["requirement_basis"] = generation["basis"]
    return fields


def _submit(record, *, action, expected_version, key, event_time, local, **basis):
    from ..local_intents import submit_record

    try:
        result = submit_record(
            get_config(),
            "requirements",
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
    path = runtime / "sync" / "entities" / "requirements.json"
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


def _local_items(*, status: str | None = None, priority: str | None = None) -> list[dict[str, Any]]:
    items = [dict(row) for row in _load_synced().values()]
    if status:
        items = [row for row in items if row.get("status") == status]
    if priority:
        items = [row for row in items if str(row.get("priority", "")).upper() == priority.upper()]
    return sorted(items, key=lambda row: str(row.get("created_at") or ""), reverse=True)


def _render(items: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in ("id", "status", "priority", "points", "title"):
        tbl.add_column(col)
    for r in items:
        tbl.add_row(
            str(r.get("id", "")),
            str(r.get("status", "")),
            str(r.get("priority", "")),
            str(r.get("story_points", 0)),
            (str(r.get("title") or ""))[:96],
        )
    console.print(tbl)


def _render_intake(items: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in ("priority", "agent", "tool", "title", "tags"):
        tbl.add_column(col)
    for r in items:
        tbl.add_row(
            str(r.get("priority", "")),
            str(r.get("assigned_agent", ""))[:28],
            str(r.get("dev_tool", ""))[:18],
            str(r.get("title") or "")[:72],
            ",".join(str(x) for x in (r.get("tags") or [])[:4]),
        )
    console.print(tbl)


@app.command(name="list")
def list_requirements(
    status: str | None = typer.Option(None, "--status"),
    priority: str | None = typer.Option(None, "--priority"),
    page: int = typer.Option(1, "--page", min=1),
    size: int = typer.Option(50, "--size", min=1, max=100),
    local: bool = typer.Option(False, "--local", help="显式查看当前项目只读Manager拉取缓存"),
) -> None:
    if local:
        items = _local_items(status=status, priority=priority)
        warn("只读Manager拉取缓存，可能过期；不含未处理本地意图")
        start = (page - 1) * size
        _render(items[start : start + size], f"Manager cache requirements total={len(items)}")
        return
    try:
        data = get_client().list_requirements(status=status, priority=priority, page=page, size=size)
        _render(list(data.get("items", [])), f"requirements total={data.get('total', '?')}")
    except Exception as exc:
        warn(f"Manager requirements读取失败: {exc}")
        raise typer.Exit(1) from exc


@app.command(name="create")
def create_requirement(
    title: str = typer.Argument(..., help="需求标题"),
    record_id: str = typer.Option(..., "--record-id", help="固定新需求ID；未知结果时不可更换"),
    description: str | None = typer.Option(None, "--desc"),
    priority: str | None = typer.Option(None, "--priority"),
    acceptance: list[str] | None = typer.Option(None, "--acceptance", "-a"),
    tag: list[str] | None = typer.Option(None, "--tag"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """固定创建原件；不在网络失败后另造需求。"""
    record = {"id": record_id, "title": title}
    for name, value in {
        "description": description,
        "priority": priority.upper() if priority is not None else None,
        "acceptance_criteria": acceptance,
        "tags": tag,
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


@app.command(name="parse-doc")
def parse_requirement_document(
    path: Path | None = typer.Option(None, "--file", "-f", exists=True, dir_okay=False, readable=True, help="需求文档文本文件"),
    text: str = typer.Option("", "--text", help="直接传入需求文本；与 --file 二选一"),
    mode: str = typer.Option("prd", "--mode", help="idea|prd|meeting|feedback|incident|data|mixed"),
    agent: str = typer.Option("Product Analyst Agent", "--agent", help="负责解析的 Agent/角色"),
    cli: str = typer.Option("codex", "--cli", help="建议执行 CLI/工具，如 codex/claude/cursor/openclaw/hermes-agent"),
    assigned_agent: str = typer.Option("", "--assigned-agent", help="导入后默认负责 Agent"),
    dev_tool: str = typer.Option("", "--dev-tool", help="导入后默认开发工具"),
    no_auto_priority: bool = typer.Option(False, "--no-auto-priority", help="关闭自动优先级评估"),
    no_auto_acceptance: bool = typer.Option(False, "--no-auto-acceptance", help="关闭自动验收标准生成"),
    apply: bool = typer.Option(False, "--apply", help="解析后批量写入 Manager 需求池"),
    generator: str = typer.Option("ai", "--generator", help="ai | rules；模型失败不会自动使用规则"),
    request_id: str = typer.Option("", "--request-id", help="8-100字符稳定请求标识；重试保持一致"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将 PRD/会议纪要/想法文本解析为结构化需求，可直接导入需求池。"""
    content = text.strip()
    filename = "inline.txt"
    if path is not None:
        filename = path.name
        content = path.read_text(encoding="utf-8").strip()
    if len(content) < 20:
        err("请输入至少 20 个字符的需求文档内容")
        raise typer.Exit(2)
    body = {
        "text": content,
        "filename": filename,
        "mode": mode,
        "agent": agent,
        "cli": cli,
        "auto_priority": not no_auto_priority,
        "auto_acceptance": not no_auto_acceptance,
        "assigned_agent": assigned_agent or agent,
        "dev_tool": dev_tool or cli,
    }
    try:
        body.update(_generation_options(generator, request_id))
        out = get_client().parse_requirements_document(body)
        if apply:
            items = out.get("items") or []
            if not items:
                out["warning"] = "没有可导入需求"
            else:
                out["created"] = get_client().batch_create_requirements({
                    "items": items, **_adoption_fields(out, "intake"),
                })
    except Exception as e:
        err(f"Manager requirement parse-doc 不可用: {e}")
        raise typer.Exit(1) from e
    if json_out:
        console.print_json(data=out)
        return
    if out.get("warning"):
        warn(str(out.get("warning")))
    _render_intake(list(out.get("items") or []), f"parsed requirements count={out.get('count', 0)} source={out.get('source', '-')}")
    for command in out.get("commands") or []:
        console.print(f"{command.get('label')}: [bold]{command.get('command')}[/bold]")
    if apply:
        ok(f"imported requirements count={out.get('created', {}).get('count', 0)}")
    else:
        warn("dry-run only; add --apply to import requirements")


@app.command(name="update")
def update_requirement(
    req_id: str = typer.Argument(...),
    title: str | None = typer.Option(None, "--title"),
    description: str | None = typer.Option(None, "--desc"),
    priority: str | None = typer.Option(None, "--priority"),
    story_points: int | None = typer.Option(None, "--points", min=0),
    human_notes: str | None = typer.Option(None, "--notes"),
    acceptance: list[str] | None = typer.Option(None, "--acceptance", "-a"),
    clear_acceptance: bool = typer.Option(False, "--clear-acceptance"),
    tag: list[str] | None = typer.Option(None, "--tag"),
    clear_tags: bool = typer.Option(False, "--clear-tags"),
    requirement_basis: str | None = typer.Option(None, "--requirement-basis", help="核对的原需求定义摘要"),
    change_preview_basis: str | None = typer.Option(
        None, "--change-preview-basis", help="实际审查的变更影响预览摘要"
    ),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """只提交明确字段；定义修改保留原预览，状态变更使用交付阶段评审。"""
    if acceptance is not None and clear_acceptance or tag is not None and clear_tags:
        raise typer.BadParameter("不能同时指定替换列表和清空列表")
    record = {"id": req_id}
    for name, value in {
        "title": title,
        "description": description,
        "priority": priority.upper() if priority is not None else None,
        "story_points": story_points,
        "human_notes": human_notes,
    }.items():
        if value is not None:
            record[name] = value
    if acceptance is not None or clear_acceptance:
        record["acceptance_criteria"] = acceptance or []
    if tag is not None or clear_tags:
        record["tags"] = tag or []
    if len(record) == 1:
        raise typer.BadParameter("没有明确的更新字段")
    if {"title", "description", "acceptance_criteria"} & record.keys() and not (
        requirement_basis and change_preview_basis
    ):
        raise typer.BadParameter(
            "定义修改需要 --requirement-basis 和 --change-preview-basis；先核对 requirement-change-preview"
        )
    _submit(
        record,
        action="update",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
        requirement_basis=requirement_basis,
        change_preview_basis=change_preview_basis,
    )


def _render_review(data: dict[str, Any]) -> None:
    tbl = Table(title=f"requirement review {data.get('requirement_id', '')}", show_header=True, header_style="bold")
    tbl.add_column("field")
    tbl.add_column("value")
    tbl.add_row("score", f"{data.get('score', 0)}/100")
    tbl.add_row("level", str(data.get("level") or "-"))
    tbl.add_row("linked_tasks", str(data.get("linked_tasks", 0)))
    console.print(tbl)
    risks = data.get("risks") or []
    if risks:
        console.print("[bold]risks[/bold]")
        for item in risks:
            console.print(f"- {item.get('message')}")
    suggestions = data.get("suggestions") or []
    if suggestions:
        console.print("[bold]suggestions[/bold]")
        for item in suggestions:
            console.print(f"- {item}")
    criteria = data.get("suggested_acceptance_criteria") or []
    if criteria:
        console.print("[bold]suggested acceptance[/bold]")
        for item in criteria:
            console.print(f"- {item}")


def _render_ops_plan(out: dict[str, Any]) -> None:
    health = out.get("health") or {}
    summary = out.get("summary") or {}
    console.print(f"health_score: {health.get('score', 0)}")
    console.print(f"grade: {health.get('grade', '')}")
    console.print(f"avg_review_score: {health.get('avg_review_score', 0)}")
    console.print(f"needs_work: {summary.get('needs_work', 0)}")
    console.print(f"high_priority_without_tasks: {summary.get('high_priority_without_tasks', 0)}")
    tbl = Table(title="requirement ops risks", show_header=True, header_style="bold")
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
def requirement_ops_plan(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """输出需求池治理 AI/CLI 操作包。"""
    try:
        out = get_client().requirement_ops_plan()
    except Exception as e:
        err(f"Manager requirement ops-plan 不可用: {e}")
        raise typer.Exit(1) from e
    if json_out:
        console.print_json(data=out)
        return
    _render_ops_plan(out)


@app.command(name="ops-tasks")
def requirement_ops_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认仅预览"),
    priority: str = typer.Option("P1", "--priority", help="治理任务优先级"),
    owner_id: str = typer.Option("", "--owner-id", help="项目成员稳定 ID；留空表示未分配"),
    categories: str = typer.Option("", "--categories", help="逗号分隔过滤 review,acceptance,generation,routing,dedupe,intake"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将需求池治理风险预览或生成任务。"""
    body = {
        "dry_run": not apply,
        "priority": priority,
        "owner_id": owner_id,
        "categories": [x.strip() for x in categories.split(",") if x.strip()],
        "limit": limit,
    }
    try:
        out = get_client().requirement_ops_tasks(body)
    except Exception as e:
        err(f"Manager requirement ops-tasks 不可用: {e}")
        raise typer.Exit(1) from e
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    console.print(f"planned: {summary.get('planned', 0)}")
    console.print(f"created: {summary.get('created', 0)}")
    tbl = Table(title="requirement governance tasks", show_header=True, header_style="bold")
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
        warn("dry-run only; add --apply to create requirement governance tasks")


@app.command(name="review")
def review_requirement(
    req_id: str = typer.Argument(..., help="需求 ID"),
    apply_acceptance: bool = typer.Option(False, "--apply-acceptance", help="将评审建议的验收标准回写到 Manager"),
    generator: str = typer.Option("rules", "--generator", help="rules | ai；明确选择建议来源"),
    request_id: str = typer.Option("", "--request-id", help="8-100字符稳定请求标识"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读JSON"),
) -> None:
    """智能评审需求质量，并可把建议验收标准回写到远端需求。"""
    try:
        out = get_client().review_requirement(req_id, _generation_options(generator, request_id))
        if not json_out:
            _render_review(out)
        criteria = out.get("suggested_acceptance_criteria") or []
        if apply_acceptance and criteria:
            applied = get_client().apply_requirement_review(
                req_id,
                {
                    "acceptance_criteria": criteria,
                    "human_notes": "已通过 sop requirement review --apply-acceptance 应用智能评审建议。",
                    **_adoption_fields(out, "review", requirement=True),
                },
            )
            out["applied"] = applied
            if not json_out:
                ok(f"applied review suggestions: {', '.join(applied.get('updated', [])) or 'none'}")
        elif apply_acceptance:
            out["warning"] = "没有可应用的建议验收标准"
            if not json_out:
                warn(out["warning"])
        if json_out:
            console.print_json(data=out)
    except Exception as e:
        err(f"Manager requirement review 不可用: {e}")
        raise typer.Exit(1) from e


@app.command("prototype")
def prototype(
    req_id: str = typer.Argument(..., help="需求 ID"),
    mode: str = typer.Option("wireframe", "--mode", help="wireframe | user_journey | ia"),
    context: str = typer.Option("", "--context", help="补充设计背景"),
    generator: str = typer.Option("ai", "--generator", help="ai | rules"),
    request_id: str = typer.Option("", "--request-id", help="稳定生成请求标识"),
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """预览设计建议；不自动覆盖原型或采用交付产物。"""
    try:
        out = get_client().generate_requirement_prototype(req_id, {
            **_generation_options(generator, request_id), "mode": mode,
            "extra_context": context, "gen_image": False,
        })
    except Exception as exc:
        err(f"Prototype preview failed: {exc}")
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=out)
    else:
        generation = out.get("generation") or {}
        console.print(f"source: {generation.get('source')} model: {generation.get('model', '')}", markup=False)
        console.print(str(out.get("content") or ""), markup=False)


@app.command("prototype-apply")
def prototype_apply(
    req_id: Annotated[str, typer.Argument(help="需求 ID")],
    path: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True, help="已编辑内容、生成ID、基准、版本和幂等键的JSON对象")],
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """明确采用已核对的设计，追加一条交付产物。"""
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(body, dict):
            raise ValueError("Adoption file must contain a JSON object")
        if any(key not in body for key in ("content", "generation_id", "requirement_basis", "expected_version", "idempotency_key")):
            raise ValueError("Adoption file must retain content, generation_id, requirement_basis, expected_version and idempotency_key")
        out = get_client().apply_requirement_prototype(req_id, body)
    except Exception as exc:
        err(f"Prototype adoption failed: {exc}")
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=out)
    else:
        ok(f"recorded artifact: {out.get('artifact_id', '')}")


@app.command("assistance-history")
def assistance_history(req_id: str = typer.Argument(...), json_out: bool = typer.Option(False, "--json")) -> None:
    """读取需求建议的来源、失败和采用记录。"""
    try:
        out = get_client().requirement_assistance_history(req_id)
    except Exception as exc:
        err(f"Assistance history failed: {exc}")
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=out)
    else:
        for row in out.get("items") or []:
            generation = row.get("generation") or {}
            console.print(f"{generation.get('id')} {generation.get('action')} {row.get('status')} {generation.get('source')} {generation.get('model', '')}", markup=False)


@app.command(name="delete")
def delete_requirement(
    req_id: str = typer.Argument(..., help="稳定记录ID"),
    expected_version: int = typer.Option(..., "--expected-version", min=0, help="实际核对的原项目版本"),
    key: str = typer.Option(..., "--key", help="固定原操作键；重发保持一致"),
    event_time: str = typer.Option(..., "--time", help="原操作RFC3339时间；重发保持一致"),
    local: bool = typer.Option(False, "--local", help="仅持久入同一SQLite队列，不修改业务副本"),
) -> None:
    """持久提交原删除意图；处理完成前不隐藏当前记录。"""
    _submit(
        {"id": req_id},
        action="delete",
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
    )
