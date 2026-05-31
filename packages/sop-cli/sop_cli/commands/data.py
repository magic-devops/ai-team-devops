"""
@module: sop_cli.commands.data
@purpose: 数据智能控制面：蓝图查询、能力缺口任务化，供 CLI/Agent 消费
"""
from __future__ import annotations

from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, kv, ok, warn

app = typer.Typer(help="数据智能：blueprint/assets/metrics/tags/quality/tasks（智能数据平台蓝图与治理）")


def _csv_ids(raw: str) -> list[str]:
    return [x.strip() for x in (raw or "").split(",") if x.strip()]


def _render_gaps(items: list[dict[str, Any]]) -> None:
    tbl = Table(title="data intelligence gaps", show_header=True, header_style="bold")
    for col in ("id", "priority", "maturity", "target", "title"):
        tbl.add_column(col)
    for item in items:
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("priority", "")),
            str(item.get("maturity", "")),
            str(item.get("target_maturity", "")),
            str(item.get("title", ""))[:80],
        )
    console.print(tbl)


def _render_assets(items: list[dict[str, Any]]) -> None:
    tbl = Table(title="data assets", show_header=True, header_style="bold")
    for col in ("id", "domain", "source", "status", "quality", "owner"):
        tbl.add_column(col)
    for item in items:
        quality = item.get("quality") or {}
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("domain", "")),
            str(item.get("source", "")),
            str(item.get("status", "")),
            f"{quality.get('decision', '-')}/{quality.get('score', '-')}",
            str(item.get("owner", "")),
        )
    console.print(tbl)


def _render_simple(title: str, items: list[dict[str, Any]], cols: tuple[str, ...]) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in cols:
        tbl.add_column(col)
    for item in items:
        tbl.add_row(*[str(item.get(col, ""))[:80] for col in cols])
    console.print(tbl)


@app.command(name="blueprint")
def blueprint(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """查看 Hermes 数据智能平台蓝图、成熟度、技术栈和能力缺口。"""
    try:
        out = get_client().data_analytics_blueprint()
    except Exception as e:
        warn(f"Manager analytics blueprint 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    scope = out.get("scope") or {}
    kv("tenant_code", scope.get("tenant_code", ""))
    kv("business_code", scope.get("business_code", ""))
    kv("project_id", scope.get("project_id", ""))
    kv("maturity", f"{summary.get('maturity', 0)}%")
    kv("capabilities", summary.get("capabilities", 0))
    kv("stack_items", summary.get("stack_items", 0))
    kv("gaps", summary.get("gaps", 0))
    _render_gaps(list(out.get("gaps") or []))


@app.command(name="tasks")
def blueprint_tasks(
    ids: str = typer.Option("", "--ids", help="逗号分隔 data-gap ID；为空则处理全部缺口"),
    apply: bool = typer.Option(False, "--apply", help="落库生成任务；默认只预览"),
    priority: str = typer.Option("P1", "--priority", help="P0|P1|P2|P3"),
    assigned_to: str = typer.Option("Data Platform Agent", "--assignee", help="负责人/Agent"),
    dev_tool: str = typer.Option("codex", "--tool", help="推荐开发工具"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将数据智能蓝图能力缺口预览或生成为研发任务。"""
    body = {
        "ids": _csv_ids(ids),
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "dev_tool": dev_tool,
    }
    try:
        out = get_client().data_analytics_blueprint_tasks(body)
    except Exception as e:
        warn(f"Manager analytics blueprint tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if out.get("dry_run"):
        kv("preview", len(out.get("items") or []))
    else:
        ok(f"created {out.get('created', 0)} data intelligence tasks")
    _render_gaps(
        [
            {
                "id": item.get("source_report_id") or item.get("id"),
                "priority": item.get("priority"),
                "maturity": "-",
                "target_maturity": "-",
                "title": item.get("title"),
            }
            for item in out.get("items", [])
        ]
    )


@app.command(name="assets")
def assets(
    status: str = typer.Option("", "--status", help="active|planned|paused|deprecated"),
    q: str = typer.Option("", "--q", help="关键词"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看数据资产目录、质量得分、血缘和 owner。"""
    try:
        out = get_client().data_assets(status=status, q=q)
    except Exception as e:
        warn(f"Manager data assets 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("assets", summary.get("assets", 0))
    kv("quality_avg", summary.get("quality_avg", 0))
    kv("quality_blocked", summary.get("quality_blocked", 0))
    _render_assets(list(out.get("items") or []))


@app.command(name="metrics")
def metrics(
    domain: str = typer.Option("", "--domain", help="领域"),
    q: str = typer.Option("", "--q", help="关键词"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看指标中心目录。"""
    try:
        out = get_client().data_metrics_center(domain=domain, q=q)
    except Exception as e:
        warn(f"Manager data metrics 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    _render_simple("metrics center", list(out.get("items") or []), ("id", "name", "domain", "source", "owner"))


@app.command(name="nlq")
def nlq(
    question: str = typer.Argument(..., help="自然语言指标问题"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """基于当前项目指标执行自然语言问数；LLM 不可用时返回规则兜底答案。"""
    try:
        out = get_client().data_analytics_nlq(question)
    except Exception as e:
        warn(f"Manager analytics NLQ 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    kv("engine", out.get("engine", ""))
    if out.get("model"):
        kv("model", out.get("model", ""))
    if out.get("confidence") is not None:
        kv("confidence", f"{float(out.get('confidence') or 0) * 100:.0f}%")
    if out.get("fallback_reason"):
        kv("fallback_reason", out.get("fallback_reason", ""))
    console.print(str(out.get("answer") or ""))
    cards = out.get("cards") if isinstance(out.get("cards"), list) else []
    if cards:
        _render_simple("nlq metric cards", cards, ("label", "value", "metric"))


@app.command(name="tags")
def tags(
    category: str = typer.Option("", "--category", help="标签分类"),
    q: str = typer.Option("", "--q", help="关键词"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看标签服务目录。"""
    try:
        out = get_client().data_tags(category=category, q=q)
    except Exception as e:
        warn(f"Manager data tags 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    _render_simple("tag service", list(out.get("items") or []), ("id", "name", "category", "owner", "status"))


@app.command(name="quality")
def quality(
    asset_ids: str = typer.Option("", "--asset-ids", help="逗号分隔资产 ID；为空则评估全部"),
    rules: bool = typer.Option(False, "--rules", help="查看质量规则目录"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看质量规则或执行数据资产质量评估。"""
    try:
        out = get_client().data_quality_rules() if rules else get_client().data_quality_evaluate({"asset_ids": _csv_ids(asset_ids)})
    except Exception as e:
        warn(f"Manager data quality 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if rules:
        _render_simple("data quality rules", list(out.get("items") or []), ("id", "name", "severity", "dimension"))
    else:
        _render_simple("data quality evaluation", list(out.get("items") or []), ("asset_id", "decision", "score", "rules_checked"))


@app.command(name="governance-tasks")
def governance_tasks(
    ids: str = typer.Option("", "--ids", help="逗号分隔资产 ID；为空则处理未通过质量评估的资产"),
    apply: bool = typer.Option(False, "--apply", help="落库生成任务；默认只预览"),
    priority: str = typer.Option("P1", "--priority", help="P0|P1|P2|P3"),
    assigned_to: str = typer.Option("Data Governance Agent", "--assignee", help="负责人/Agent"),
    dev_tool: str = typer.Option("codex", "--tool", help="推荐开发工具"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将数据资产质量问题预览或生成为治理任务。"""
    body = {
        "ids": _csv_ids(ids),
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "dev_tool": dev_tool,
    }
    try:
        out = get_client().data_governance_tasks(body)
    except Exception as e:
        warn(f"Manager data governance tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if out.get("dry_run"):
        kv("preview", len(out.get("items") or []))
    else:
        ok(f"created {out.get('created', 0)} data governance tasks")
    _render_simple("data governance tasks", list(out.get("items") or []), ("source_report_id", "priority", "assigned_to", "title"))


@app.command(name="services")
def services(
    status: str = typer.Option("", "--status", help="draft|published|paused|deprecated"),
    q: str = typer.Option("", "--q", help="关键词"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看数据服务目录与发布健康。"""
    try:
        out = get_client().data_services(status=status, q=q)
    except Exception as e:
        warn(f"Manager data services 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("services", summary.get("services", 0))
    kv("published", summary.get("published_services", 0))
    rows = []
    for item in out.get("items", []) or []:
        health = item.get("health") or {}
        rows.append({**item, "health": f"{health.get('decision', '-')}/{health.get('score', '-')}"})
    _render_simple("data services", rows, ("id", "status", "type", "owner", "health"))


@app.command(name="publish-service")
def publish_service(
    service_id: str = typer.Argument(..., help="数据服务 ID"),
    status: str = typer.Option("published", "--status", help="published|paused|deprecated|draft"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """发布、暂停或回退数据服务。"""
    try:
        out = get_client().data_service_publish(service_id, {"status": status})
    except Exception as e:
        warn(f"Manager data service publish 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    item = out.get("item") or {}
    ok(f"{item.get('id', service_id)} -> {item.get('status', status)}")


@app.command(name="alerts")
def alerts(
    severity: str = typer.Option("", "--severity", help="critical|warning"),
    q: str = typer.Option("", "--q", help="关键词"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看数据质量和服务健康告警。"""
    try:
        out = get_client().data_quality_alerts(severity=severity, q=q)
    except Exception as e:
        warn(f"Manager data alerts 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("alerts", summary.get("total", 0))
    kv("critical", summary.get("critical", 0))
    _render_simple("data quality alerts", list(out.get("items") or []), ("id", "severity", "type", "score", "title"))


@app.command(name="alert-tasks")
def alert_tasks(
    ids: str = typer.Option("", "--ids", help="逗号分隔告警/资产/服务 ID；为空处理全部告警"),
    apply: bool = typer.Option(False, "--apply", help="落库生成任务；默认只预览"),
    priority: str = typer.Option("P1", "--priority", help="P0|P1|P2|P3"),
    assigned_to: str = typer.Option("Data Governance Agent", "--assignee", help="负责人/Agent"),
    dev_tool: str = typer.Option("codex", "--tool", help="推荐开发工具"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将质量告警预览或生成为治理任务。"""
    body = {
        "ids": _csv_ids(ids),
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "dev_tool": dev_tool,
    }
    try:
        out = get_client().data_quality_alert_tasks(body)
    except Exception as e:
        warn(f"Manager data alert tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if out.get("dry_run"):
        kv("preview", len(out.get("items") or []))
    else:
        ok(f"created {out.get('created', 0)} data alert tasks")
    _render_simple("data alert tasks", list(out.get("items") or []), ("source_report_id", "priority", "assigned_to", "title"))


@app.command(name="dev-templates")
def dev_templates(
    status: str = typer.Option("", "--status", help="active|planned|paused|deprecated"),
    q: str = typer.Option("", "--q", help="关键词"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看数据开发模板目录。"""
    try:
        out = get_client().data_dev_templates(status=status, q=q)
    except Exception as e:
        warn(f"Manager data dev templates 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    _render_simple("data development templates", list(out.get("items") or []), ("id", "status", "type", "engine", "owner"))


@app.command(name="dev-tasks")
def dev_tasks(
    ids: str = typer.Option("", "--ids", help="逗号分隔模板 ID；为空处理全部模板"),
    apply: bool = typer.Option(False, "--apply", help="落库生成任务；默认只预览"),
    priority: str = typer.Option("", "--priority", help="覆盖 P0|P1|P2|P3"),
    assigned_to: str = typer.Option("", "--assignee", help="覆盖负责人/Agent"),
    dev_tool: str = typer.Option("", "--tool", help="覆盖推荐开发工具"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将数据开发模板预览或生成为研发任务。"""
    body = {
        "ids": _csv_ids(ids),
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "dev_tool": dev_tool,
    }
    try:
        out = get_client().data_dev_template_tasks(body)
    except Exception as e:
        warn(f"Manager data dev tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if out.get("dry_run"):
        kv("preview", len(out.get("items") or []))
    else:
        ok(f"created {out.get('created', 0)} data development tasks")
    _render_simple("data development tasks", list(out.get("items") or []), ("source_report_id", "priority", "assigned_to", "title"))


@app.command(name="dev-schedule")
def dev_schedule(
    ids: str = typer.Option("", "--ids", help="逗号分隔模板 ID；为空调度全部模板"),
    apply: bool = typer.Option(False, "--apply", help="应用调度并生成任务；默认只预览"),
    max_parallel: int = typer.Option(4, "--max-parallel", min=1, max=20, help="最大并发泳道"),
    policy: str = typer.Option("quality_first", "--policy", help="quality_first|balanced|throughput|cost_saver"),
    priority: str = typer.Option("", "--priority", help="覆盖 P0|P1|P2|P3"),
    assigned_to: str = typer.Option("", "--assignee", help="覆盖负责人/Agent"),
    dev_tool: str = typer.Option("", "--tool", help="覆盖推荐开发工具"),
    event: str = typer.Option("cli", "--event", help="触发事件来源"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """预览或应用数据开发智能调度计划，输出 DAG、质量卡点与 Agent packet。"""
    body = {
        "ids": _csv_ids(ids),
        "dry_run": not apply,
        "max_parallel": max_parallel,
        "policy": policy,
        "priority": priority,
        "assigned_to": assigned_to,
        "dev_tool": dev_tool,
        "event": event,
    }
    try:
        out = get_client().data_dev_schedule(body)
    except Exception as e:
        warn(f"Manager data dev schedule 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("schedule_id", out.get("schedule_id", ""))
    kv("packets", summary.get("packets", 0))
    kv("quality_gates", summary.get("quality_gates", 0))
    kv("event_wakeups", summary.get("event_wakeups", 0))
    if out.get("dry_run"):
        kv("mode", "preview")
    else:
        ok(f"applied schedule and created {out.get('created', 0)} data development tasks")
    _render_simple("data development agent packets", list(out.get("agent_packets") or []), ("template_id", "priority", "lane", "assigned_to", "dev_tool"))


@app.command(name="dev-ops")
def dev_ops(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    """查看数据开发调度、Agent Feed 和质量证据运营汇总。"""
    try:
        out = get_client().data_dev_ops_summary()
    except Exception as e:
        warn(f"Manager data dev ops 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("health", summary.get("health", 0))
    kv("schedules", summary.get("schedules", 0))
    kv("packets", summary.get("packets", 0))
    kv("claimed", summary.get("claimed_packets", 0))
    kv("reported", summary.get("reported_packets", 0))
    kv("block", summary.get("block", 0))
    _render_simple("data dev recommendations", list(out.get("recommendations") or []), ("id", "priority", "title", "action"))


@app.command(name="dev-runbook")
def dev_runbook(
    schedule_id: str = typer.Option("", "--schedule-id", help="限定调度 ID"),
    packet_id: str = typer.Option("", "--packet-id", help="限定 packet ID"),
    decisions: str = typer.Option("block,warn", "--decisions", help="逗号分隔 pass|warn|block"),
    include_unclaimed: bool = typer.Option(True, "--include-unclaimed/--no-include-unclaimed", help="纳入未领取的 ready packet"),
    apply: bool = typer.Option(False, "--apply", help="落库生成 Runbook 任务；默认只预览"),
    priority: str = typer.Option("P1", "--priority", help="P0|P1|P2|P3"),
    assigned_to: str = typer.Option("Data Automation Agent", "--assignee", help="默认负责人/Agent"),
    dev_tool: str = typer.Option("codex", "--tool", help="推荐开发工具"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """生成数据开发自动化 Runbook，并可转为可执行任务。"""
    body = {
        "schedule_id": schedule_id,
        "packet_id": packet_id,
        "decisions": _csv_ids(decisions),
        "include_unclaimed": include_unclaimed,
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "dev_tool": dev_tool,
    }
    try:
        out = get_client().data_dev_runbook(body)
    except Exception as e:
        warn(f"Manager data dev runbook 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("steps", summary.get("steps", 0))
    kv("quality_steps", summary.get("quality_steps", 0))
    kv("claim_steps", summary.get("claim_steps", 0))
    if out.get("dry_run"):
        kv("mode", "preview")
    else:
        ok(f"created {out.get('created', 0)} data development runbook tasks")
    _render_simple("data development runbook", list(out.get("steps") or []), ("id", "type", "priority", "agent", "dev_tool", "title"))


@app.command(name="dev-schedules")
def dev_schedules(
    schedule_id: str = typer.Option("", "--id", help="查看指定调度详情"),
    limit: int = typer.Option(20, "--limit", min=1, max=100, help="列表数量"),
    q: str = typer.Option("", "--q", help="关键词过滤"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看数据开发智能调度历史。"""
    try:
        out = get_client().data_dev_schedule_detail(schedule_id) if schedule_id else get_client().data_dev_schedules(limit=limit, q=q)
    except Exception as e:
        warn(f"Manager data dev schedules 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if schedule_id:
        item = out.get("item") or {}
        summary = item.get("summary") or {}
        kv("schedule_id", item.get("id", schedule_id))
        kv("created_at", item.get("created_at", ""))
        kv("templates", summary.get("templates", len(item.get("template_ids") or [])))
        kv("packets", summary.get("packets", len(item.get("agent_packets") or [])))
        kv("created_tasks", len(item.get("created_task_ids") or item.get("created_tasks") or []))
        _render_simple("data schedule stages", list(item.get("stages") or []), ("template_id", "engine", "status", "lane"))
        return
    summary = out.get("summary") or {}
    kv("schedules", summary.get("schedules", out.get("total", 0)))
    kv("created_tasks", summary.get("created_tasks", 0))
    _render_simple("data development schedules", list(out.get("items") or []), ("id", "status", "policy", "templates", "packets", "created_tasks"))


@app.command(name="dev-schedule-action")
def dev_schedule_action(
    schedule_id: str = typer.Option(..., "--id", help="调度 ID"),
    action: str = typer.Option(..., "--action", help="rerun|cancel|archive|restore"),
    apply: bool = typer.Option(False, "--apply", help="rerun 时应用生成任务；默认只预览"),
    max_parallel: int = typer.Option(4, "--max-parallel", min=1, max=20, help="最大并发泳道"),
    policy: str = typer.Option("quality_first", "--policy", help="quality_first|balanced|throughput|cost_saver"),
    priority: str = typer.Option("", "--priority", help="覆盖 P0|P1|P2|P3"),
    assigned_to: str = typer.Option("", "--assignee", help="覆盖负责人/Agent"),
    dev_tool: str = typer.Option("", "--tool", help="覆盖推荐开发工具"),
    note: str = typer.Option("cli", "--note", help="动作备注"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """治理数据开发调度历史：重放、取消、归档或恢复。"""
    body = {
        "action": action,
        "dry_run": not apply,
        "max_parallel": max_parallel,
        "policy": policy,
        "priority": priority,
        "assigned_to": assigned_to,
        "dev_tool": dev_tool,
        "note": note,
    }
    try:
        out = get_client().data_dev_schedule_action(schedule_id, body)
    except Exception as e:
        warn(f"Manager data dev schedule action 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if action == "rerun":
        summary = out.get("summary") or {}
        kv("schedule_id", out.get("schedule_id", ""))
        kv("parent_schedule_id", out.get("parent_schedule_id", schedule_id))
        kv("packets", summary.get("packets", 0))
        if out.get("dry_run"):
            kv("mode", "preview")
        else:
            ok(f"rerun applied and created {out.get('created', 0)} data development tasks")
        _render_simple("data development rerun packets", list(out.get("agent_packets") or []), ("template_id", "priority", "lane", "assigned_to", "dev_tool"))
        return
    item = out.get("item") or {}
    ok(f"schedule {schedule_id} {action}: {item.get('status', '')}")


@app.command(name="dev-feed")
def dev_feed(
    schedule_id: str = typer.Option("", "--schedule-id", help="限定调度 ID"),
    agent: str = typer.Option("", "--agent", help="按负责人/Agent 过滤"),
    include_blocked: bool = typer.Option(False, "--include-blocked", help="包含阻塞 packet"),
    limit: int = typer.Option(20, "--limit", min=1, max=100, help="返回数量"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """拉取数据开发调度 Agent Feed。"""
    try:
        out = get_client().data_dev_agent_feed(limit=limit, schedule_id=schedule_id, agent=agent, include_blocked=include_blocked)
    except Exception as e:
        warn(f"Manager data dev feed 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("ready", summary.get("ready", 0))
    kv("claimed", summary.get("claimed", 0))
    kv("reported", summary.get("reported", 0))
    _render_simple("data development agent feed", list(out.get("items") or []), ("schedule_id", "packet_id", "packet_status", "lane", "assigned_to"))


@app.command(name="dev-packet-action")
def dev_packet_action(
    schedule_id: str = typer.Option(..., "--schedule-id", help="调度 ID"),
    packet_id: str = typer.Option(..., "--packet-id", help="packet ID"),
    action: str = typer.Option(..., "--action", help="claim|heartbeat|report"),
    agent: str = typer.Option("Data Platform Agent", "--agent", help="执行 Agent"),
    progress: int = typer.Option(0, "--progress", min=0, max=100, help="执行进度"),
    status: str = typer.Option("running", "--status", help="running|blocked|completed|failed"),
    summary: str = typer.Option("", "--summary", help="回报摘要"),
    artifact_url: str = typer.Option("", "--artifact-url", help="产物 URL"),
    evidence: list[str] = typer.Option(None, "--evidence", help="证据，格式 gate_id=evidence，可重复"),
    blocker: list[str] = typer.Option(None, "--blocker", help="阻断项，可重复"),
    warning: list[str] = typer.Option(None, "--warning", help="警告项，可重复"),
    note: str = typer.Option("cli", "--note", help="备注"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """领取、心跳或回报数据开发调度 packet。"""
    body = {
        "schedule_id": schedule_id,
        "packet_id": packet_id,
        "action": action,
        "agent": agent,
        "progress": progress,
        "status": status,
        "summary": summary,
        "artifact_url": artifact_url,
        "evidence": [
            {"gate_id": x.split("=", 1)[0].strip(), "status": "pass", "evidence": x.split("=", 1)[1].strip() if "=" in x else x}
            for x in (evidence or [])
            if str(x).strip()
        ],
        "blockers": [x for x in (blocker or []) if str(x).strip()],
        "warnings": [x for x in (warning or []) if str(x).strip()],
        "note": note,
    }
    try:
        out = get_client().data_dev_agent_feed_action(body)
    except Exception as e:
        warn(f"Manager data dev packet action 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    result = out.get("result") or {}
    ok(f"packet {packet_id} {action}: {result.get('status', '')}")
    kv("agent", result.get("agent", agent))
    kv("progress", result.get("progress", progress))
    if result.get("quality"):
        kv("quality", f"{result['quality'].get('decision')}/{result['quality'].get('score')}")


@app.command(name="dev-evidence")
def dev_evidence(
    schedule_id: str = typer.Option("", "--schedule-id", help="限定调度 ID"),
    packet_id: str = typer.Option("", "--packet-id", help="限定 packet ID"),
    decision: str = typer.Option("", "--decision", help="pass|warn|block"),
    limit: int = typer.Option(50, "--limit", min=1, max=200, help="返回数量"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看数据开发 packet 质量证据与卡点评估。"""
    try:
        out = get_client().data_dev_evidence(limit=limit, schedule_id=schedule_id, packet_id=packet_id, decision=decision)
    except Exception as e:
        warn(f"Manager data dev evidence 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("pass", summary.get("pass", 0))
    kv("warn", summary.get("warn", 0))
    kv("block", summary.get("block", 0))
    _render_simple("data development evidence", list(out.get("items") or []), ("schedule_id", "packet_id", "title", "artifact_url"))


@app.command(name="dev-evidence-tasks")
def dev_evidence_tasks(
    schedule_id: str = typer.Option("", "--schedule-id", help="限定调度 ID"),
    packet_id: str = typer.Option("", "--packet-id", help="限定 packet ID"),
    decisions: str = typer.Option("block,warn", "--decisions", help="逗号分隔 pass|warn|block"),
    apply: bool = typer.Option(False, "--apply", help="落库生成任务；默认只预览"),
    priority: str = typer.Option("P1", "--priority", help="P0|P1|P2|P3"),
    assigned_to: str = typer.Option("Data Quality Agent", "--assignee", help="负责人/Agent"),
    dev_tool: str = typer.Option("codex", "--tool", help="推荐开发工具"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """将数据开发质量证据问题预览或生成为修复任务。"""
    body = {
        "schedule_id": schedule_id,
        "packet_id": packet_id,
        "decisions": _csv_ids(decisions),
        "dry_run": not apply,
        "priority": priority,
        "assigned_to": assigned_to,
        "dev_tool": dev_tool,
    }
    try:
        out = get_client().data_dev_evidence_tasks(body)
    except Exception as e:
        warn(f"Manager data dev evidence tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    if out.get("dry_run"):
        kv("preview", len(out.get("items") or []))
    else:
        ok(f"created {out.get('created', 0)} data evidence fix tasks")
    _render_simple("data evidence fix tasks", list(out.get("items") or []), ("source_report_id", "priority", "assigned_to", "title"))


@app.command(name="dev-evidence-notify")
def dev_evidence_notify(
    schedule_id: str = typer.Option("", "--schedule-id", help="限定调度 ID"),
    packet_id: str = typer.Option("", "--packet-id", help="限定 packet ID"),
    decisions: str = typer.Option("block,warn", "--decisions", help="逗号分隔 pass|warn|block"),
    channels: str = typer.Option("", "--channels", help="逗号分隔通知通道；--send 时必填"),
    send: bool = typer.Option(False, "--send", help="发送通知；默认只预览"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """预览或发送数据开发质量证据通知。"""
    body = {
        "schedule_id": schedule_id,
        "packet_id": packet_id,
        "decisions": _csv_ids(decisions),
        "channels": _csv_ids(channels),
        "dry_run": not send,
    }
    try:
        out = get_client().data_dev_evidence_notify(body)
    except Exception as e:
        warn(f"Manager data dev evidence notify 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    draft = out.get("draft") or {}
    kv("title", draft.get("title", ""))
    kv("level", draft.get("level", ""))
    kv("items", out.get("total", 0))
    if out.get("dry_run"):
        console.print(draft.get("content", ""))
    else:
        ok(f"sent evidence notify to {len(out.get('results') or {})} channels")
