from __future__ import annotations

import json

import typer
from rich.table import Table

from .._util import console, get_client, kv, warn

app = typer.Typer(help="Graph Loop：summary/runs/detail/events/transition/interrupt/replay/export/doctor/slo")


def _json_or_table(out: dict, json_out: bool, printer) -> None:
    if json_out:
        console.print_json(data=out)
        return
    printer(out)


def _print_graph_payload(out: dict) -> None:
    summary = out.get("summary") or {}
    kv("ok", out.get("ok"))
    kv("run_id", summary.get("run_id", "-"))
    kv("status", summary.get("status", "-"))
    kv("nodes", summary.get("nodes", len(out.get("items") or [])))
    kv("score", (summary.get("slo") or {}).get("score", summary.get("score", "-")))
    kv("trace_id", out.get("trace_id", ""))
    tbl = Table(title="graph loop", show_header=True, header_style="bold")
    for col in ("id", "label", "type", "status", "quality_gate"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("id", ""))[:34],
            str(item.get("label", ""))[:34],
            str(item.get("type", "")),
            str(item.get("status", item.get("state", ""))),
            str(item.get("quality_gate", ""))[:58],
        )
    console.print(tbl)


def _print_runs(out: dict) -> None:
    tbl = Table(title="graph loop runs", show_header=True, header_style="bold")
    for col in ("run_id", "status", "slo", "goal", "owner", "updated_at"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("run_id", "")),
            str(item.get("status", "")),
            str((item.get("slo") or {}).get("status", "")),
            str(item.get("goal", ""))[:48],
            str(item.get("owner", "")),
            str(item.get("updated_at", ""))[:24],
        )
    console.print(tbl)


def _print_events(out: dict) -> None:
    summary = out.get("summary") or {}
    kv("run_id", summary.get("run_id", ""))
    kv("events", summary.get("events", len(out.get("items") or [])))
    tbl = Table(title="graph loop events", show_header=True, header_style="bold")
    for col in ("event", "actor", "node_id", "decision", "at", "trace_id"):
        tbl.add_column(col)
    for item in out.get("items") or []:
        tbl.add_row(
            str(item.get("event", ""))[:28],
            str(item.get("actor", ""))[:20],
            str(item.get("node_id", ""))[:24],
            str(item.get("decision", ""))[:12],
            str(item.get("at", ""))[:24],
            str(item.get("trace_id", ""))[:16],
        )
    console.print(tbl)


def _print_slo(out: dict) -> None:
    summary = out.get("summary") or {}
    kv("ok", out.get("ok"))
    kv("runs", summary.get("runs", len(out.get("items") or [])))
    kv("trace_id", out.get("trace_id", ""))
    tbl = Table(title="graph loop slo", show_header=True, header_style="bold")
    for col in ("run_id", "status", "score", "blocked", "interrupts", "goal"):
        tbl.add_column(col)
    rows = out.get("items") or ([summary] if summary.get("run_id") else [])
    for item in rows:
        tbl.add_row(
            str(item.get("run_id", "")),
            str(item.get("status", "")),
            str(item.get("score", "")),
            str(item.get("blocked_nodes", "")),
            str(item.get("pending_interrupts", "")),
            str(item.get("goal", ""))[:42],
        )
    console.print(tbl)


@app.command("summary")
def summary(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    try:
        out = get_client().graph_loop_summary()
    except Exception as e:
        warn(f"Manager graph-loop summary 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_graph_payload)


@app.command("runs")
def runs(
    limit: int = typer.Option(50, "--limit", min=1, max=200),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    try:
        out = get_client().graph_loop_runs(limit=limit)
    except Exception as e:
        warn(f"Manager graph-loop runs 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_runs)


@app.command("detail")
def detail(run_id: str = typer.Argument(...), json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    try:
        out = get_client().graph_loop_detail(run_id)
    except Exception as e:
        warn(f"Manager graph-loop detail 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_graph_payload)


@app.command("events")
def events(run_id: str = typer.Argument(...), json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    try:
        out = get_client().graph_loop_events(run_id)
    except Exception as e:
        warn(f"Manager graph-loop events 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_events)


@app.command("plan")
def plan(
    goal: str = typer.Option("Hermes/SOP AI-native delivery loop", "--goal", help="Graph Loop 目标"),
    mode: str = typer.Option("dry-run", "--mode", help="read|dry-run|apply"),
    include_data: bool = typer.Option(True, "--include-data/--no-include-data"),
    include_agent: bool = typer.Option(True, "--include-agent/--no-include-agent"),
    include_human_review: bool = typer.Option(True, "--include-human-review/--no-include-human-review"),
    quality_bar: str = typer.Option("strict", "--quality-bar", help="standard|strict|release"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    body = {
        "goal": goal,
        "mode": mode,
        "include_data": include_data,
        "include_agent": include_agent,
        "include_human_review": include_human_review,
        "quality_bar": quality_bar,
    }
    try:
        out = get_client().graph_loop_plan(body)
    except Exception as e:
        warn(f"Manager graph-loop plan 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_graph_payload)


@app.command("run")
def run(
    goal: str = typer.Option("Hermes/SOP AI-native delivery loop", "--goal", help="Graph Loop 目标"),
    apply: bool = typer.Option(False, "--apply", help="创建 running 状态；默认 planned"),
    owner: str = typer.Option("GraphLoop Agent", "--owner"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    body = {"goal": goal, "mode": "apply" if apply else "dry-run", "owner": owner}
    try:
        out = get_client().graph_loop_run(body)
    except Exception as e:
        warn(f"Manager graph-loop run 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_graph_payload)


@app.command("transition")
def transition(
    run_id: str = typer.Argument(...),
    action_name: str = typer.Argument(..., help="start|interrupt|resume|retry|rollback|complete|archive|fail"),
    node_id: str = typer.Option("", "--node-id"),
    note: str = typer.Option("", "--note"),
    actor: str = typer.Option("GraphLoop Operator", "--actor"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    body = {"action": action_name, "node_id": node_id, "note": note, "actor": actor, "idempotency_key": idempotency_key}
    try:
        out = get_client().graph_loop_transition(run_id, body)
    except Exception as e:
        warn(f"Manager graph-loop transition 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_graph_payload)


@app.command("action")
def action(
    run_id: str = typer.Argument(..., help="Graph Loop run_id"),
    action_name: str = typer.Argument(..., help="start|interrupt|resume|retry|rollback|complete|archive|fail"),
    note: str = typer.Option("", "--note"),
    actor: str = typer.Option("GraphLoop Operator", "--actor"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    body = {"action": action_name, "note": note, "actor": actor}
    try:
        out = get_client().graph_loop_action(run_id, body)
    except Exception as e:
        warn(f"Manager graph-loop action 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_graph_payload)


@app.command("interrupt")
def interrupt(
    run_id: str = typer.Argument(...),
    interrupt_id: str = typer.Argument(...),
    decision: str = typer.Option("approve", "--decision", help="approve|edit|reject"),
    actor: str = typer.Option("GraphLoop Approver", "--actor"),
    note: str = typer.Option("", "--note"),
    edited_payload: str = typer.Option("{}", "--edited-payload", help="JSON object when decision=edit"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    try:
        payload = json.loads(edited_payload or "{}")
    except json.JSONDecodeError as e:
        warn(f"--edited-payload 不是合法 JSON: {e}")
        raise typer.Exit(2)
    if not isinstance(payload, dict):
        warn("--edited-payload 必须是 JSON object")
        raise typer.Exit(2)
    body = {"decision": decision, "actor": actor, "note": note, "edited_payload": payload, "idempotency_key": idempotency_key}
    try:
        out = get_client().graph_loop_interrupt_decision(run_id, interrupt_id, body)
    except Exception as e:
        warn(f"Manager graph-loop interrupt 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_graph_payload)


@app.command("replay")
def replay(
    run_id: str = typer.Argument(...),
    dry_run: bool = typer.Option(True, "--dry-run/--apply", help="默认 dry-run；--apply 写入 replay 事件"),
    actor: str = typer.Option("GraphLoop Operator", "--actor"),
    note: str = typer.Option("", "--note"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    body = {"mode": "dry-run" if dry_run else "apply", "actor": actor, "note": note, "idempotency_key": idempotency_key}
    try:
        out = get_client().graph_loop_replay(run_id, body)
    except Exception as e:
        warn(f"Manager graph-loop replay 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_events)


@app.command("export")
def export(
    run_id: str = typer.Argument(...),
    include_events: bool = typer.Option(True, "--include-events/--no-include-events"),
    actor: str = typer.Option("GraphLoop Operator", "--actor"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    body = {"format": "json", "include_events": include_events, "actor": actor}
    try:
        out = get_client().graph_loop_export(run_id, body)
    except Exception as e:
        warn(f"Manager graph-loop export 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    kv("run_id", summary.get("run_id", run_id))
    kv("include_events", summary.get("include_events", include_events))
    kv("trace_id", out.get("trace_id", ""))


@app.command("doctor")
def doctor(json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON")) -> None:
    try:
        out = get_client().graph_loop_summary()
    except Exception as e:
        warn(f"Manager graph-loop doctor 不可用: {e}")
        raise typer.Exit(1)
    if json_out:
        console.print_json(data=out)
        return
    summary = out.get("summary") or {}
    store = summary.get("store") or {}
    kv("store", store.get("store", "scoped-jsonl"))
    kv("path", store.get("path", ""))
    kv("projected_runs", store.get("projected_runs", 0))
    kv("bad_lines", store.get("bad_lines", 0))
    kv("trace_id", out.get("trace_id", ""))


@app.command("slo")
def slo(
    run_id: str = typer.Option("", "--run-id"),
    json_out: bool = typer.Option(False, "--json", help="输出机器可读 JSON"),
) -> None:
    try:
        out = get_client().graph_loop_slo(run_id=run_id)
    except Exception as e:
        warn(f"Manager graph-loop slo 不可用: {e}")
        raise typer.Exit(1)
    _json_or_table(out, json_out, _print_slo)
