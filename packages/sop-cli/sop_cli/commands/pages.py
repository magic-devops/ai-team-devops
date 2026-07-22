"""
@module: sop_cli.commands.pages
@purpose: 系统页面、菜单、能力码控制面；供 CLI/Agent 理解模块边界
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, kv, ok, warn

app = typer.Typer(help="页面菜单与能力：list/manifest/capabilities/health/menu-prefs")


def _items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        raw = payload.get("items") or payload.get("react") or payload.get("pages") or []
    else:
        raw = payload or []
    return [item for item in raw if isinstance(item, dict)]


@app.command("list")
def list_pages(
    view: str = typer.Option("react", "--view", help="react|legacy|all"),
    domain: str = typer.Option("", "--domain", help="能力域过滤，如 portfolio/delivery/data/ai"),
    status: str = typer.Option("", "--status", help="状态过滤，如 active/migrating/legacy"),
    q: str = typer.Option("", "--q", help="关键词"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看 Manager 页面/菜单注册表，Agent 可据此选择专业模块入口。"""
    try:
        out = get_client().system_pages(view=view, domain=domain, status=status, q=q)
    except Exception as e:
        warn(f"Manager system pages 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    rows = _items(out)
    summary = out.get("summary") if isinstance(out, dict) else {}
    if isinstance(summary, dict):
        kv("total", summary.get("total", len(rows)))
        kv("avg_maturity", summary.get("avg_maturity", "-"))
    tbl = Table(title="system pages", show_header=True, header_style="bold")
    for col in ("id", "name", "domain", "path", "status", "maturity"):
        tbl.add_column(col)
    for item in rows:
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("name", ""))[:32],
            str(item.get("domain", "")),
            str(item.get("path", "")),
            str(item.get("status", "")),
            str(item.get("maturity", "")),
        )
    console.print(tbl)


@app.command("productize")
def productize(
    module: str = typer.Option("", "--module", help="按模块 ID/名称过滤"),
    domain: str = typer.Option("all", "--domain", help="能力域过滤"),
    q: str = typer.Option("", "--q", help="关键词"),
    dry_run: bool = typer.Option(False, "--dry-run", help="仅输出产品化矩阵，不创建任务"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    keyword = module or q
    try:
        out = get_client().pages_productization(domain=domain, q=keyword)
    except Exception as e:
        warn(f"Manager pages productization 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("score", summary.get("score", 0))
    kv("modules", summary.get("total", len(out.get("items") or [])))
    kv("surfaces", summary.get("surfaces", 0))
    kv("mode", "dry-run" if dry_run else "read")
    tbl = Table(title="pages productization", show_header=True, header_style="bold")
    for col in ("id", "domain", "capability", "submodules", "cli"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("id", ""))[:34],
            str(item.get("domain", "")),
            str(item.get("capability", ""))[:42],
            str(item.get("submodules", 0)),
            str(item.get("cli", ""))[:60],
        )
    console.print(tbl)


@app.command("interaction-analysis")
def interaction_analysis(
    module: str = typer.Option("", "--module", help="按模块 ID/名称过滤"),
    domain: str = typer.Option("all", "--domain", help="能力域过滤"),
    status: str = typer.Option("all", "--status", help="交互状态过滤：all/ready/watch/risk"),
    q: str = typer.Option("", "--q", help="关键词"),
    limit: int = typer.Option(20, "--limit", help="展示模块数量"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    keyword = module or q
    try:
        out = get_client().pages_interaction_analysis(domain=domain, q=keyword, status=status, limit=limit)
    except Exception as e:
        warn(f"Manager pages interaction analysis 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("score", summary.get("avg_interaction_score", summary.get("score", 0)))
    kv("ready", summary.get("ready", 0))
    kv("watch", summary.get("watch", 0))
    kv("risk", summary.get("risk", 0))
    kv("mode", summary.get("analysis_mode", "static_registry_contract"))
    tbl = Table(title="pages interaction analysis", show_header=True, header_style="bold")
    for col in ("id", "domain", "status", "score", "primary_gap", "next_cli"):
        tbl.add_column(col)
    for item in _items(out)[: max(1, min(int(limit or 20), 100))]:
        quick_actions = item.get("quick_actions") or []
        tbl.add_row(
            str(item.get("id", ""))[:34],
            str(item.get("domain", "")),
            str(item.get("status", "")),
            str(item.get("interaction_score", "")),
            str(item.get("primary_gap", ""))[:28],
            str(quick_actions[0] if quick_actions else item.get("cli", ""))[:64],
        )
    console.print(tbl)


@app.command("interaction-tasks")
def interaction_tasks(
    domain: str = typer.Option("all", "--domain", help="能力域过滤"),
    status: str = typer.Option("watch", "--status", help="交互状态过滤：all/ready/watch/risk"),
    q: str = typer.Option("", "--q", help="关键词"),
    ids: str = typer.Option("", "--ids", help="逗号分隔模块 ID；为空则使用筛选结果"),
    dry_run: bool = typer.Option(True, "--dry-run/--create", help="预览或实际生成任务"),
    include_ready: bool = typer.Option(False, "--include-ready", help="包含 ready 模块，用于持续增强"),
    priority: str = typer.Option("P1", "--priority", help="任务优先级 P0-P3"),
    assigned_to: str = typer.Option("Designer", "--assigned-to", help="负责人"),
    max_items: int = typer.Option(12, "--max-items", help="最大任务数"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    body = {
        "ids": [item.strip() for item in ids.split(",") if item.strip()],
        "domain": domain,
        "status": status,
        "q": q,
        "dry_run": dry_run,
        "include_ready": include_ready,
        "priority": priority,
        "assigned_to": assigned_to,
        "max_items": max_items,
    }
    try:
        out = get_client().pages_interaction_tasks(**body)
    except Exception as e:
        warn(f"Manager pages interaction tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("dry_run", out.get("dry_run", summary.get("dry_run")))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    kv("skipped", summary.get("skipped", 0))
    tbl = Table(title="interaction tasks", show_header=True, header_style="bold")
    for col in ("source_report_id", "priority", "title"):
        tbl.add_column(col)
    for item in (out.get("planned") or out.get("items") or [])[: max(1, min(int(max_items or 12), 100))]:
        tbl.add_row(str(item.get("source_report_id", "")), str(item.get("priority", "")), str(item.get("title", ""))[:80])
    console.print(tbl)


def _write_runtime_json(default_name: str, payload: Any, out: str = "") -> Path:
    target = Path(out).expanduser() if out else get_config().project_path / ".sop-runtime" / default_name
    if not target.is_absolute():
        target = get_config().project_path / target
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target


@app.command("manifest")
def manifest(
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
    write: bool = typer.Option(False, "--write", help="写入 .sop-runtime/pages_manifest.json"),
    out_path: str = typer.Option("", "--out", "-o", help="写入指定路径；隐含 --write"),
) -> None:
    """查看模块 Manifest，包含 React/legacy/权限/AI surfaces/分包策略。"""
    try:
        out = get_client().system_pages_manifest()
    except Exception as e:
        warn(f"Manager system pages manifest 不可用: {e}")
        raise typer.Exit(1)
    if write or out_path:
        target = _write_runtime_json("pages_manifest.json", out, out_path)
        ok(f"pages manifest written: {target}")
        return
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("schema", out.get("schema", ""))
    kv("react_modules", summary.get("react_modules", 0))
    kv("legacy_modules", summary.get("legacy_modules", 0))
    kv("capabilities", summary.get("capabilities", 0))
    kv("ai_surfaces", summary.get("ai_surfaces", 0))


@app.command("capabilities")
def capabilities(
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
    write: bool = typer.Option(False, "--write", help="写入 .sop-runtime/pages_capabilities.json"),
    out_path: str = typer.Option("", "--out", "-o", help="写入指定路径；隐含 --write"),
) -> None:
    """查看页面能力码、角色权限矩阵和 AI 能力覆盖。"""
    try:
        out = get_client().system_pages_capabilities()
    except Exception as e:
        warn(f"Manager system pages capabilities 不可用: {e}")
        raise typer.Exit(1)
    if write or out_path:
        target = _write_runtime_json("pages_capabilities.json", out, out_path)
        ok(f"pages capabilities written: {target}")
        return
    if json_out:
        console.print_json(data=out)
        return
    rows = _items(out)
    tbl = Table(title="page capabilities", show_header=True, header_style="bold")
    for col in ("id", "domain", "capability", "submodules", "ai_surfaces"):
        tbl.add_column(col)
    for item in rows:
        submodules = item.get("submodules") or []
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("domain", "")),
            str(item.get("capability", "")),
            str(len(submodules) if isinstance(submodules, list) else 0),
            ",".join(str(x) for x in item.get("ai_surfaces") or [])[:60],
        )
    console.print(tbl)


@app.command("health")
def health(
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
    limit: int = typer.Option(12, "--limit", help="展示问题数量"),
) -> None:
    """查看菜单健康分：假菜单、能力码、i18n、API 契约、AI surfaces 与子菜单路径。"""
    try:
        out = get_client().system_pages_health()
    except Exception as e:
        warn(f"Manager system pages health 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    health_payload = out.get("health") or {}
    summary = health_payload.get("summary") or {}
    kv("score", health_payload.get("score", 0))
    kv("status", health_payload.get("status", ""))
    kv("issues", summary.get("issues", 0))
    kv("critical", summary.get("critical", 0))
    kv("high", summary.get("high", 0))
    tbl = Table(title="menu health issues", show_header=True, header_style="bold")
    for col in ("severity", "category", "module", "path", "recommendation"):
        tbl.add_column(col)
    for item in (health_payload.get("issues") or [])[: max(1, min(int(limit or 12), 100))]:
        tbl.add_row(
            str(item.get("severity", "")),
            str(item.get("category", "")),
            str(item.get("module_id", ""))[:34],
            str(item.get("path", ""))[:38],
            str(item.get("recommendation", ""))[:72],
        )
    console.print(tbl)


@app.command("readiness")
def readiness(
    domain: str = typer.Option("", "--domain", help="能力域过滤，如 portfolio/delivery/data/ai"),
    status: str = typer.Option("", "--status", help="完整度过滤：complete/watch/risk"),
    q: str = typer.Option("", "--q", help="关键词"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
    limit: int = typer.Option(12, "--limit", help="展示模块数量"),
) -> None:
    """查看模块前后端/API/权限/AI surface 完整度矩阵。"""
    try:
        out = get_client().system_pages_readiness(domain=domain, status=status, q=q)
    except Exception as e:
        warn(f"Manager system pages readiness 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("avg_score", summary.get("avg_score", 0))
    kv("complete", summary.get("complete", 0))
    kv("watch", summary.get("watch", 0))
    kv("risk", summary.get("risk", 0))
    tbl = Table(title="module readiness", show_header=True, header_style="bold")
    for col in ("id", "domain", "status", "score", "gaps", "route"):
        tbl.add_column(col)
    for item in _items(out)[: max(1, min(int(limit or 12), 100))]:
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("domain", "")),
            str(item.get("status", "")),
            str(item.get("readiness_score", "")),
            str(len(item.get("gaps") or [])),
            str(item.get("path", "")),
        )
    console.print(tbl)


@app.command("isolation")
def isolation(
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
    limit: int = typer.Option(12, "--limit", help="展示领域数量"),
) -> None:
    """查看 tenant_code/business_code/project_id 三码隔离审计矩阵。"""
    try:
        out = get_client().system_pages_isolation()
    except Exception as e:
        warn(f"Manager system pages isolation audit 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("score", summary.get("score", 0))
    kv("protected", summary.get("protected", 0))
    kv("watch", summary.get("watch", 0))
    kv("high_risk", summary.get("high_risk", 0))
    tbl = Table(title="three-code isolation", show_header=True, header_style="bold")
    for col in ("id", "status", "storage", "scope_fields", "guard"):
        tbl.add_column(col)
    for item in (out.get("domains") or [])[: max(1, min(int(limit or 12), 100))]:
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("status", "")),
            str(item.get("storage", "")),
            ",".join(str(x) for x in item.get("scope_fields") or [])[:56],
            str(item.get("guard", ""))[:72],
        )
    console.print(tbl)


@app.command("isolation-scan")
def isolation_scan(
    status: str = typer.Option("all", "--status", help="源码隔离状态过滤：all/protected/watch/risk"),
    q: str = typer.Option("", "--q", help="关键词"),
    limit: int = typer.Option(12, "--limit", help="展示文件数量"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """扫描 Manager 源码中的文件型存储与 scope_guard 隔离风险。"""
    try:
        out = get_client().system_pages_isolation_scan(status=status, q=q)
    except Exception as e:
        warn(f"Manager system pages isolation scan 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("scanned_files", summary.get("scanned_files", 0))
    kv("protected", summary.get("protected", 0))
    kv("watch", summary.get("watch", 0))
    kv("risk", summary.get("risk", 0))
    tbl = Table(title="isolation source scan", show_header=True, header_style="bold")
    for col in ("module", "status", "risk", "storage", "file", "recommendation"):
        tbl.add_column(col)
    for item in (out.get("items") or [])[: max(1, min(int(limit or 12), 100))]:
        tbl.add_row(
            str(item.get("module", "")),
            str(item.get("status", "")),
            str(item.get("risk_level", "")),
            str(item.get("storage", "")),
            str(item.get("file", "")),
            str(item.get("recommendation", ""))[:72],
        )
    console.print(tbl)


@app.command("isolation-scan-tasks")
def isolation_scan_tasks(
    status: str = typer.Option("watch", "--status", help="源码隔离状态过滤：all/protected/watch/risk"),
    q: str = typer.Option("", "--q", help="关键词"),
    ids: str = typer.Option("", "--ids", help="逗号分隔源码模块 ID；为空则使用筛选结果"),
    dry_run: bool = typer.Option(True, "--dry-run/--create", help="预览或实际生成任务"),
    include_protected: bool = typer.Option(False, "--include-protected", help="包含已 protected 源码项，用于持续审计"),
    priority: str = typer.Option("P0", "--priority", help="任务优先级 P0-P3"),
    assigned_to: str = typer.Option("SecurityAgent", "--assigned-to", help="负责人"),
    max_items: int = typer.Option(12, "--max-items", help="最大任务数"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """把源码隔离扫描项预览/生成源码加固任务，供 Agent 领取增强。"""
    body = {
        "ids": [x.strip() for x in ids.split(",") if x.strip()],
        "status": status,
        "q": q,
        "dry_run": dry_run,
        "include_protected": include_protected,
        "priority": priority,
        "assigned_to": assigned_to,
        "max_items": max_items,
    }
    try:
        out = get_client().system_pages_isolation_scan_tasks(**body)
    except Exception as e:
        warn(f"Manager system pages isolation scan tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("dry_run", out.get("dry_run"))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    kv("skipped", summary.get("skipped", 0))
    tbl = Table(title="isolation source scan tasks", show_header=True, header_style="bold")
    for col in ("source_report_id", "priority", "title"):
        tbl.add_column(col)
    for item in (out.get("planned") or [])[: max(1, min(int(max_items or 12), 100))]:
        tbl.add_row(str(item.get("source_report_id", "")), str(item.get("priority", "")), str(item.get("title", ""))[:80])
    console.print(tbl)


@app.command("isolation-scan-runs")
def isolation_scan_runs(
    limit: int = typer.Option(10, "--limit", help="展示快照数量"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看源码隔离扫描快照历史。"""
    try:
        out = get_client().system_pages_isolation_scan_runs(limit=limit)
    except Exception as e:
        warn(f"Manager system pages isolation scan runs 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("total", summary.get("total", 0))
    kv("risk_runs", summary.get("risk_runs", 0))
    tbl = Table(title="isolation scan runs", show_header=True, header_style="bold")
    for col in ("id", "created_at", "created_by", "score", "risk", "note"):
        tbl.add_column(col)
    for item in (out.get("items") or [])[: max(1, min(int(limit or 10), 100))]:
        item_summary = item.get("summary") or {}
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("created_at", "")),
            str(item.get("created_by", "")),
            str(item_summary.get("score", "")),
            str(item_summary.get("risk", "")),
            str(item.get("note", ""))[:60],
        )
    console.print(tbl)


@app.command("isolation-scan-run")
def isolation_scan_run(
    status: str = typer.Option("all", "--status", help="源码隔离状态过滤：all/protected/watch/risk"),
    q: str = typer.Option("", "--q", help="关键词"),
    note: str = typer.Option("", "--note", help="快照备注"),
    created_by: str = typer.Option("CLI", "--created-by", help="创建人/Agent"),
    max_items: int = typer.Option(20, "--max-items", help="快照保留明细数量"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """保存一次源码隔离扫描快照。"""
    try:
        out = get_client().system_pages_isolation_scan_run_create(
            status=status,
            q=q,
            note=note,
            created_by=created_by,
            max_items=max_items,
        )
    except Exception as e:
        warn(f"Manager system pages isolation scan run create 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    run = out.get("run") or {}
    summary = run.get("summary") or {}
    ok("isolation scan snapshot saved")
    kv("id", run.get("id", ""))
    kv("total", summary.get("total", 0))
    kv("risk", summary.get("risk", 0))
    kv("history", "sop pages isolation-scan-runs --json")


@app.command("isolation-scan-compare")
def isolation_scan_compare(
    base_id: str = typer.Option("", "--base-id", help="基线快照 ID；为空使用最新快照"),
    target_id: str = typer.Option("", "--target-id", help="目标快照 ID；为空使用当前源码扫描"),
    status: str = typer.Option("all", "--status", help="当前扫描状态过滤：all/protected/watch/risk"),
    q: str = typer.Option("", "--q", help="当前扫描关键词"),
    limit: int = typer.Option(12, "--limit", help="展示差异数量"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """对比源码隔离扫描快照与当前扫描，识别新增风险和已修复项。"""
    try:
        out = get_client().system_pages_isolation_scan_compare(
            base_id=base_id,
            target_id=target_id,
            status=status,
            q=q,
        )
    except Exception as e:
        warn(f"Manager system pages isolation scan compare 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("new_risks", summary.get("new_risks", 0))
    kv("resolved", summary.get("resolved", 0))
    kv("score_delta", summary.get("score_delta", 0))
    tbl = Table(title="isolation scan compare", show_header=True, header_style="bold")
    for col in ("module", "before", "after", "change", "recommendation"):
        tbl.add_column(col)
    rows = [item for item in (out.get("items") or []) if item.get("change") != "unchanged"]
    for item in rows[: max(1, min(int(limit or 12), 100))]:
        tbl.add_row(
            str(item.get("module", "")),
            str(item.get("before_status", "")),
            str(item.get("after_status", "")),
            str(item.get("change", "")),
            str(item.get("recommendation", ""))[:72],
        )
    console.print(tbl)


@app.command("isolation-scan-compare-tasks")
def isolation_scan_compare_tasks(
    base_id: str = typer.Option("", "--base-id", help="基线快照 ID；为空使用最新快照"),
    target_id: str = typer.Option("", "--target-id", help="目标快照 ID；为空使用当前源码扫描"),
    status: str = typer.Option("all", "--status", help="当前扫描状态过滤：all/protected/watch/risk"),
    q: str = typer.Option("", "--q", help="当前扫描关键词"),
    dry_run: bool = typer.Option(True, "--dry-run/--create", help="预览或实际生成任务"),
    include_resolved: bool = typer.Option(False, "--include-resolved", help="包含已修复项，用于回归验证任务"),
    priority: str = typer.Option("P0", "--priority", help="任务优先级 P0-P3"),
    assigned_to: str = typer.Option("SecurityAgent", "--assigned-to", help="负责人"),
    max_items: int = typer.Option(12, "--max-items", help="最大任务数"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """把源码隔离智能基线对比差异预览/生成治理任务。"""
    body = {
        "base_id": base_id,
        "target_id": target_id,
        "status": status,
        "q": q,
        "dry_run": dry_run,
        "include_resolved": include_resolved,
        "priority": priority,
        "assigned_to": assigned_to,
        "max_items": max_items,
    }
    try:
        out = get_client().system_pages_isolation_scan_compare_tasks(**body)
    except Exception as e:
        warn(f"Manager system pages isolation scan compare tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("dry_run", out.get("dry_run"))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    kv("skipped", summary.get("skipped", 0))
    tbl = Table(title="isolation scan compare tasks", show_header=True, header_style="bold")
    for col in ("source_report_id", "priority", "title"):
        tbl.add_column(col)
    for item in (out.get("planned") or [])[: max(1, min(int(max_items or 12), 100))]:
        tbl.add_row(str(item.get("source_report_id", "")), str(item.get("priority", "")), str(item.get("title", ""))[:80])
    console.print(tbl)


@app.command("isolation-tasks")
def isolation_tasks(
    status: str = typer.Option("watch", "--status", help="审计状态过滤：all/protected/watch/risk"),
    q: str = typer.Option("", "--q", help="关键词"),
    ids: str = typer.Option("", "--ids", help="逗号分隔审计域 ID；为空则使用筛选结果"),
    dry_run: bool = typer.Option(True, "--dry-run/--create", help="预览或实际生成任务"),
    include_protected: bool = typer.Option(False, "--include-protected", help="包含已 protected 领域，用于持续审计"),
    priority: str = typer.Option("P0", "--priority", help="任务优先级 P0-P3"),
    assigned_to: str = typer.Option("SecurityAgent", "--assigned-to", help="负责人"),
    max_items: int = typer.Option(12, "--max-items", help="最大任务数"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """把三码隔离审计项预览/生成安全治理任务，供 Agent 领取增强。"""
    body = {
        "ids": [x.strip() for x in ids.split(",") if x.strip()],
        "status": status,
        "q": q,
        "dry_run": dry_run,
        "include_protected": include_protected,
        "priority": priority,
        "assigned_to": assigned_to,
        "max_items": max_items,
    }
    try:
        out = get_client().system_pages_isolation_tasks(**body)
    except Exception as e:
        warn(f"Manager system pages isolation tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("dry_run", out.get("dry_run"))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    kv("skipped", summary.get("skipped", 0))
    tbl = Table(title="isolation tasks", show_header=True, header_style="bold")
    for col in ("source_report_id", "priority", "title"):
        tbl.add_column(col)
    for item in (out.get("planned") or [])[: max(1, min(int(max_items or 12), 100))]:
        tbl.add_row(str(item.get("source_report_id", "")), str(item.get("priority", "")), str(item.get("title", ""))[:80])
    console.print(tbl)


@app.command("readiness-tasks")
def readiness_tasks(
    domain: str = typer.Option("all", "--domain", help="能力域过滤，如 ecosystem/system/all"),
    status: str = typer.Option("watch", "--status", help="完整度过滤：all/complete/watch/risk"),
    q: str = typer.Option("", "--q", help="关键词"),
    ids: str = typer.Option("", "--ids", help="逗号分隔模块 ID；为空则使用筛选结果"),
    dry_run: bool = typer.Option(True, "--dry-run/--create", help="预览或实际生成任务"),
    include_complete: bool = typer.Option(False, "--include-complete", help="包含已 complete 模块，用于持续增强"),
    priority: str = typer.Option("P1", "--priority", help="任务优先级 P0-P3"),
    assigned_to: str = typer.Option("Coder", "--assigned-to", help="负责人"),
    max_items: int = typer.Option(12, "--max-items", help="最大任务数"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """把模块完整度缺口预览/生成治理任务，供 Agent 领取增强。"""
    body = {
        "ids": [x.strip() for x in ids.split(",") if x.strip()],
        "domain": domain,
        "status": status,
        "q": q,
        "dry_run": dry_run,
        "include_complete": include_complete,
        "priority": priority,
        "assigned_to": assigned_to,
        "max_items": max_items,
    }
    try:
        out = get_client().system_pages_readiness_tasks(**body)
    except Exception as e:
        warn(f"Manager system pages readiness tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("dry_run", out.get("dry_run"))
    kv("planned", summary.get("planned", 0))
    kv("created", summary.get("created", 0))
    kv("skipped", summary.get("skipped", 0))
    tbl = Table(title="readiness tasks", show_header=True, header_style="bold")
    for col in ("source_report_id", "priority", "title"):
        tbl.add_column(col)
    for item in (out.get("planned") or [])[: max(1, min(int(max_items or 12), 100))]:
        tbl.add_row(str(item.get("source_report_id", "")), str(item.get("priority", "")), str(item.get("title", ""))[:80])
    console.print(tbl)


@app.command("governance-tasks")
def governance_tasks(
    status: str = typer.Option("all", "--status", help="任务状态：all/pending/in_progress/blocked/completed"),
    source: str = typer.Option("all", "--source", help="任务来源：all/system_page_readiness/..."),
    q: str = typer.Option("", "--q", help="关键词"),
    limit: int = typer.Option(50, "--limit", help="返回数量"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看 SystemMap 各专业治理单元生成的真实任务运营看板。"""
    try:
        out = get_client().system_pages_governance_tasks(status=status, source=source, q=q, limit=limit)
    except Exception as e:
        warn(f"Manager system pages governance tasks 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("total", summary.get("total", 0))
    kv("open", summary.get("open", 0))
    kv("blocked", summary.get("blocked", 0))
    kv("completed", summary.get("completed", 0))
    tbl = Table(title="system governance tasks", show_header=True, header_style="bold")
    for col in ("id", "source", "status", "priority", "title"):
        tbl.add_column(col)
    for item in (out.get("items") or [])[: max(1, min(int(limit or 50), 200))]:
        tbl.add_row(
            str(item.get("id", "")),
            str(item.get("source_label") or item.get("source") or ""),
            str(item.get("status", "")),
            str(item.get("priority", "")),
            str(item.get("title", ""))[:80],
        )
    console.print(tbl)


@app.command("governance-tasks-update")
def governance_tasks_update(
    ids: str = typer.Option(..., "--ids", help="逗号分隔治理任务 ID"),
    dry_run: bool = typer.Option(True, "--dry-run/--apply", help="预览或实际批量更新"),
    status: str = typer.Option("", "--status", help="任务状态：pending/in_progress/blocked/completed"),
    priority: str = typer.Option("", "--priority", help="优先级：P0-P3"),
    assigned_to: str = typer.Option("", "--assigned-to", help="负责人"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """对 SystemMap 治理任务做 scoped 批量处置，普通任务会被跳过。"""
    body = {
        "ids": [x.strip() for x in ids.split(",") if x.strip()],
        "dry_run": dry_run,
        "status": status or None,
        "priority": priority or None,
        "assigned_to": assigned_to or None,
    }
    try:
        out = get_client().system_pages_governance_tasks_bulk_update(**body)
    except Exception as e:
        warn(f"Manager system pages governance tasks bulk update 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("dry_run", out.get("dry_run"))
    kv("planned", summary.get("planned", 0))
    kv("updated", summary.get("updated", 0))
    kv("skipped", summary.get("skipped", 0))
    tbl = Table(title="governance task update", show_header=True, header_style="bold")
    for col in ("id", "source", "title"):
        tbl.add_column(col)
    for item in out.get("planned") or []:
        tbl.add_row(str(item.get("id", "")), str(item.get("source", "")), str(item.get("title", ""))[:80])
    console.print(tbl)


@app.command("menu-prefs")
def menu_prefs(
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    """查看当前用户菜单偏好、最近访问和角色化默认折叠策略。"""
    try:
        out = get_client().system_pages_menu_preferences_me()
    except Exception as e:
        warn(f"Manager system pages menu preferences 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    prefs = out.get("preferences") or {}
    strategy = out.get("strategy") or {}
    kv("role", out.get("role", ""))
    kv("home", strategy.get("home", ""))
    kv("density", prefs.get("density", ""))
    kv("favorites", ", ".join(str(x) for x in prefs.get("favorites") or []))
    kv("recents", ", ".join(str(x) for x in prefs.get("recents") or []))
    tbl = Table(title="role menu collapse", show_header=True, header_style="bold")
    for col in ("group", "collapsed"):
        tbl.add_column(col)
    for key, value in (prefs.get("collapsed_groups") or {}).items():
        tbl.add_row(str(key), "yes" if value else "no")
    console.print(tbl)
