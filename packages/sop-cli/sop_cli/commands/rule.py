"""Rule review documents, explicit local application and frozen remote file intents."""

from __future__ import annotations

from datetime import datetime, timezone

import typer
from rich.table import Table

from .. import rule_store
from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="规则：本地提案、明确应用与原依据推送")


def _now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _rules_file(config=None):
    return rule_store.rules_target(config or get_config())


def _proposals_path():
    return rule_store.proposal_directory(get_config())


def _proposal_by_id(rule_id):
    return rule_store.proposal(get_config(), rule_id)


def _local_rules(config=None):
    target = _rules_file(config)
    if not target.is_file():
        return []
    rows = []
    for number, line in enumerate(target.read_bytes().decode("utf-8").splitlines(), 1):
        if line.strip().startswith("- "):
            rows.append(
                {"id": f"local-{number}", "rule": line.strip()[2:], "category": "local", "confidence": 1.0}
            )
    return rows


@app.command(name="list")
def list_rules(
    local: bool = typer.Option(False, "--local", help="明确读取本地规则，不自动回落"),
    proposals: bool = typer.Option(False, "--proposals", help="同时显示当前本地提案"),
    json_output: bool = typer.Option(False, "--json"),
):
    try:
        config = get_config()
        rows = _local_rules(config) if local else get_client(config)._request("GET", "/api/v1/rules")
        documents = (
            rule_store.list_proposals(config) if proposals else {"items": [], "total": 0, "has_more": False}
        )
        if json_output:
            console.print_json(
                data={
                    "ok": True,
                    "source": "local" if local else "Manager",
                    "items": rows,
                    "proposals": documents["items"],
                    "proposals_total": documents["total"],
                    "proposals_has_more": documents["has_more"],
                }
            )
            return
        table = Table(title=f"rules · {'local' if local else 'Manager'}", show_header=True)
        for name in ("id", "category", "rule"):
            table.add_column(name)
        for row in rows[:200]:
            table.add_row(str(row.get("id", "")), str(row.get("category", "")), str(row.get("rule", "")))
        console.print(table)
        if proposals:
            console.print_json(data=documents)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command()
def propose(
    rule: str,
    category: str = typer.Option("coding"),
    source: str = typer.Option("human"),
    confidence: float = typer.Option(0.75),
    apply: bool = typer.Option(False, "--apply/--no-apply", help="明确把此提案应用到本地RULES.md"),
    json_output: bool = typer.Option(False, "--json"),
):
    """保存独立提案文档；不会调用远端写入或发送同步。"""
    try:
        config = get_config()
        row = rule_store.create_proposal(config, rule, category, source, confidence, _now())
        target = None
        if apply:
            row, target = rule_store.apply_proposal(config, row["id"], _now())
        result = {"ok": True, "item": row, "applied": bool(target), "queued": False}
        if json_output:
            console.print_json(data=result)
        else:
            ok(f"local rule proposal: {row['id']}")
            if target:
                ok("已明确应用到本地RULES.md；远端尚未提交")
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command()
def apply(rule_id: str = typer.Argument(..., help="当前本地提案ID")):
    """按稳定提案标识应用一次；不会入队或修改远端。"""
    try:
        row, target = rule_store.apply_proposal(get_config(), rule_id, _now())
        console.print_json(
            data={"ok": True, "id": row["id"], "status": row["status"], "path": str(target), "queued": False}
        )
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command()
def flush(
    expected_version: int = typer.Option(..., "--expected-version", min=0),
    key: str = typer.Option(..., "--key"),
    event_time: str = typer.Option(..., "--time"),
    expected_sha256: str = typer.Option(
        ..., "--expected-sha256", help="原远端SHA256；原不存在明确填写absent"
    ),
    local: bool = typer.Option(False, "--local", help="仅持久入队，不尝试送达"),
):
    """固定当前原始文件、原项目版本及原远端摘要后推送。"""
    from ..local_intents import submit_record

    try:
        config = get_config()
        target = _rules_file(config)
        if not target.is_file():
            raise ValueError("RULES.md not found; no remote write was queued")
        basis = None if expected_sha256 == "absent" else expected_sha256
        result = submit_record(
            config,
            "rules",
            {"path": "RULES.md", "content": target.read_bytes().decode("utf-8"), "expected_sha256": basis},
            action="upsert",
            expected_version=expected_version,
            key=key,
            event_time=event_time,
            local=local,
        )
        console.print_json(data=result)
        if not result["ok"]:
            raise typer.Exit(2)
    except typer.Exit:
        raise
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc
