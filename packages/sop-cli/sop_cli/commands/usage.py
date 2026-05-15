"""
@module: sop_cli.commands.usage
@purpose: 用量计量与配额 CLI：本地 outbox + Manager usage API
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="用量：record/flush/summary/quota（商业化与企业配额底座）")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _outbox_path() -> Path:
    return get_config().project_path / ".sop-runtime" / "usage" / "outbox.jsonl"


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows), encoding="utf-8")


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _parse_metadata(items: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for item in items:
        k, sep, v = item.partition("=")
        if not sep or not k.strip():
            raise typer.BadParameter("--meta 需使用 key=value")
        out[k.strip()] = v
    return out


def _build_record(metric: str, value: float, *, unit: str, source: str, subject: str, meta: list[str]) -> dict[str, Any]:
    cfg = get_config()
    return {
        "metric": metric,
        "value": value,
        "unit": unit,
        "source": source,
        "subject": subject,
        "metadata": {
            **_parse_metadata(meta),
            "tenant_code": cfg.tenant_code or cfg.tenant_id,
            "business_code": cfg.business_code,
            "project_code": cfg.project_code or cfg.project_id,
            "project_id": cfg.project_id,
        },
        "idempotency_key": f"usage-cli-{uuid.uuid4().hex}",
        "created_at": _now(),
    }


@app.command("record")
def record_usage(
    metric: str = typer.Argument(..., help="llm_tokens|llm_cost_usd|storage_bytes|worker_seconds|event_count|..."),
    value: float = typer.Argument(..., help="用量值"),
    unit: str = typer.Option("", "--unit", help="tokens/usd/bytes/seconds/count"),
    source: str = typer.Option("sop-cli", "--source"),
    subject: str = typer.Option("", "--subject"),
    meta: list[str] = typer.Option([], "--meta", help="metadata key=value，可重复"),
    local: bool = typer.Option(False, "--local", help="只写本地 outbox"),
) -> None:
    """记录用量事件；远端不可用时自动写本地 outbox。"""
    row = _build_record(metric, value, unit=unit, source=source, subject=subject, meta=meta)
    if not local:
        try:
            out = get_client().usage_record(row)
            ok(f"usage recorded {out.get('record', {}).get('id', '-')}")
            return
        except Exception as e:
            warn(f"Manager usage 不可用，写入本地 outbox: {e}")
    _append_jsonl(_outbox_path(), row)
    ok(f"local usage queued {row['idempotency_key']}")


@app.command("flush")
def flush_usage(limit: int = typer.Option(100, "--limit", "-n", help="本次最多发送数量")) -> None:
    """冲刷本地 usage outbox。"""
    rows = _read_jsonl(_outbox_path())
    if not rows:
        ok("usage outbox empty")
        return
    selected = rows[: max(1, limit)]
    sent = 0
    for row in selected:
        get_client().usage_record(row)
        sent += 1
    _write_jsonl(_outbox_path(), rows[sent:])
    ok(f"usage flushed sent={sent} remain={len(rows) - sent}")


@app.command("summary")
def usage_summary(
    since: str = typer.Option("", "--since", help="只统计 ts 大于该值的记录"),
    limit: int = typer.Option(5000, "--limit", "-n", help="最多读取记录数"),
    local: bool = typer.Option(False, "--local", help="只汇总本地 outbox"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    """查看用量汇总。"""
    if not local:
        try:
            out = get_client().usage_summary(since=since, limit=limit)
            if json_output:
                console.print_json(data=out)
                return
            _render_summary(out)
            return
        except Exception as e:
            warn(f"Manager usage 不可用，回退本地 outbox: {e}")
    rows = _read_jsonl(_outbox_path())
    totals: dict[str, float] = {}
    for row in rows:
        metric = str(row.get("metric") or "")
        totals[metric] = totals.get(metric, 0.0) + float(row.get("value") or 0)
    out = {"ok": True, "items": rows[-limit:], "total": len(rows), "totals": totals, "by_source": {}, "quota": {}, "remaining": {}}
    if json_output:
        console.print_json(data=out)
        return
    _render_summary(out, title="local usage summary")


@app.command("quota")
def usage_quota(
    set_limit: list[str] = typer.Option([], "--set", help="设置配额 metric=value，可重复"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    """查看或设置配额。"""
    if set_limit:
        limits: dict[str, float] = {}
        for item in set_limit:
            k, sep, v = item.partition("=")
            if not sep or not k.strip():
                raise typer.BadParameter("--set 需使用 metric=value")
            limits[k.strip()] = float(v)
        out = get_client().usage_set_quota(limits)
    else:
        out = get_client().usage_quota()
    if json_output:
        console.print_json(data=out)
        return
    tbl = Table(title="usage quota", show_header=True, header_style="bold")
    tbl.add_column("metric")
    tbl.add_column("limit")
    for k, v in (out.get("limits") or {}).items():
        tbl.add_row(str(k), str(v))
    console.print(tbl)


@app.command("check")
def usage_check(
    metric: str = typer.Argument(..., help="要检查的指标，如 llm_tokens"),
    delta: float = typer.Argument(..., help="预计新增用量"),
    source: str = typer.Option("sop-cli", "--source"),
    subject: str = typer.Option("", "--subject"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    """检查预计用量是否会超过远端配额。"""
    out = get_client().usage_check(metric, delta, source=source, subject=subject)
    if json_output:
        console.print_json(data=out)
        return
    status = "allowed" if out.get("allowed") else "blocked"
    tbl = Table(title=f"usage check: {status}", show_header=True, header_style="bold")
    tbl.add_column("metric")
    tbl.add_column("current")
    tbl.add_column("delta")
    tbl.add_column("limit")
    tbl.add_column("would_remaining")
    tbl.add_row(
        str(out.get("metric", metric)),
        str(out.get("current", "")),
        str(out.get("delta", delta)),
        str(out.get("limit", "unlimited")),
        str(out.get("would_remaining", "")),
    )
    console.print(tbl)


def _render_summary(out: dict[str, Any], title: str = "usage summary") -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    tbl.add_column("metric")
    tbl.add_column("total")
    tbl.add_column("remaining")
    remaining = out.get("remaining") if isinstance(out.get("remaining"), dict) else {}
    for k, v in (out.get("totals") or {}).items():
        tbl.add_row(str(k), str(v), str(remaining.get(k, "")))
    console.print(tbl)


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    usage_summary(local=True)
