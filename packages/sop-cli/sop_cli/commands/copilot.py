"""
@module: sop_cli.commands.copilot
@purpose: 对接 Manager Copilot API（ask / classify / summarize / suggest）
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

app = typer.Typer(help="AI Copilot：ask / sessions / show / classify / summarize / suggest")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _copilot_dir() -> Path:
    return get_config().project_path / ".sop-runtime" / "copilot"


def _sessions_path() -> Path:
    return _copilot_dir() / "sessions.jsonl"


def _session_path(session_id: str) -> Path:
    safe = "".join(c for c in session_id if c.isalnum() or c in "-_.")[:120] or "default"
    return _copilot_dir() / "sessions" / f"{safe}.jsonl"


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


def _latest_session_id() -> str:
    rows = _read_jsonl(_sessions_path())
    if rows:
        return str(rows[-1].get("session_id") or "").strip()
    return ""


def _ensure_session(session_id: str, title: str = "") -> str:
    sid = session_id.strip() or _latest_session_id() or f"cp-{uuid.uuid4().hex[:12]}"
    rows = _read_jsonl(_sessions_path())
    if not any(str(r.get("session_id") or "") == sid for r in rows):
        _append_jsonl(_sessions_path(), {"session_id": sid, "title": title or sid, "created_at": _now(), "updated_at": _now()})
    else:
        for row in rows:
            if str(row.get("session_id") or "") == sid:
                row["updated_at"] = _now()
        _sessions_path().write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows), encoding="utf-8")
    return sid


def _read_json_file(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _project_context() -> dict[str, Any]:
    cfg = get_config()
    rt = cfg.project_path / ".sop-runtime"
    return {
        "project": {
            "path": str(cfg.project_path),
            "id": cfg.project_id,
            "code": cfg.project_code or cfg.project_id,
            "tenant_code": cfg.tenant_code or cfg.tenant_id,
            "business_code": cfg.business_code,
        },
        "agent_context": _read_json_file(rt / "agent_context.json"),
        "work_snapshot": _read_json_file(rt / "work_snapshot.json"),
        "db_connections": _read_json_file(rt / "db_connections.json"),
    }


def _record_turn(session_id: str, row: dict[str, Any]) -> None:
    _append_jsonl(_session_path(session_id), row)


def _save_to_local_memory(content: str, *, session_id: str, run_id: str) -> None:
    try:
        from .memory import _build_local_memory, _store_local

        row = _build_local_memory(
            content[:12000],
            "episodic",
            {"source": "copilot.ask", "session_id": session_id, "run_id": run_id},
            source="sop-copilot",
        )
        _store_local(row, queue=True)
    except Exception as e:
        warn(f"Copilot 结果未能写入本地 memory: {e}")


@app.command("ask")
def copilot_ask(
    query: str = typer.Argument(..., help="自然语言问题"),
    context_json: str = typer.Option("{}", "--context", help="JSON 上下文"),
    session: str = typer.Option("", "--session", "-s", help="会话 ID；留空复用最近会话或创建新会话"),
    new: bool = typer.Option(False, "--new", help="创建新会话"),
    run_id: str = typer.Option("", "--run-id", help="Agent/Copilot run id；留空自动生成"),
    with_project_context: bool = typer.Option(True, "--project-context/--no-project-context", help="自动注入 agent/work/db 上下文"),
    remember: bool = typer.Option(False, "--remember", help="把本次问答写入本地 memory outbox"),
    local: bool = typer.Option(False, "--local", help="只记录本地 Copilot 会话，不调用远端 Manager/LLM"),
    json_output: bool = typer.Option(True, "--json/--no-json", help="输出 JSON"),
) -> None:
    rid = run_id.strip() or f"run-{uuid.uuid4().hex[:12]}"
    sid = _ensure_session("" if new else session, title=query[:80])
    try:
        ctx = json.loads(context_json) if context_json.strip() else {}
        if not isinstance(ctx, dict):
            raise ValueError("context 须为 JSON object")
        if with_project_context:
            ctx = {**_project_context(), **ctx}
        ctx["session_id"] = sid
        ctx["run_id"] = rid
        if local:
            turn = {
                "ts": _now(),
                "session_id": sid,
                "run_id": rid,
                "query": query,
                "context": ctx,
                "response": {"intent": "local-note", "summary": "已记录本地 Copilot 会话，待远端可用后继续处理。"},
                "ok": True,
                "local_only": True,
            }
            _record_turn(sid, turn)
            if remember:
                _save_to_local_memory(f"Copilot local note: {query}", session_id=sid, run_id=rid)
            if json_output:
                console.print_json(data={"ok": True, "session_id": sid, "run_id": rid, "local": True})
            else:
                ok(f"copilot local note session={sid} run={rid}")
            return
        r = get_client(get_config()).copilot_ask(query, context=ctx, session_id=sid, run_id=rid)
        turn = {"ts": _now(), "session_id": sid, "run_id": rid, "query": query, "context": ctx, "response": r, "ok": True}
        _record_turn(sid, turn)
        if remember:
            _save_to_local_memory(f"Copilot Q: {query}\n\nA: {json.dumps(r, ensure_ascii=False)}", session_id=sid, run_id=rid)
        if json_output:
            console.print_json(data={"ok": True, "session_id": sid, "run_id": rid, "response": r})
        else:
            ok(f"copilot answered session={sid} run={rid}")
    except json.JSONDecodeError:
        warn("--context 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        turn = {"ts": _now(), "session_id": sid, "run_id": rid, "query": query, "error": str(e), "ok": False}
        _record_turn(sid, turn)
        warn(str(e))
        if json_output:
            console.print_json(data={"ok": False, "session_id": sid, "run_id": rid, "error": str(e)})


@app.command("sessions")
def copilot_sessions(json_output: bool = typer.Option(False, "--json", help="输出 JSON")) -> None:
    """列出本地 Copilot 会话。"""
    try:
        remote = get_client(get_config()).copilot_sessions(limit=100)
        rows = remote.get("items") if isinstance(remote, dict) else []
        source = "Manager"
    except Exception as e:
        warn(f"Manager copilot sessions 不可用，回退本地: {e}")
        rows = _read_jsonl(_sessions_path())
        source = "local"
    if json_output:
        console.print_json(data={"ok": True, "items": rows, "source": source})
        return
    tbl = Table(title=f"copilot sessions total={len(rows)} source={source}", show_header=True, header_style="bold")
    for col in ("session_id", "title", "created_at", "updated_at"):
        tbl.add_column(col)
    for row in rows[-100:]:
        tbl.add_row(str(row.get("session_id", "")), str(row.get("title", ""))[:60], str(row.get("created_at", "")), str(row.get("updated_at", "")))
    console.print(tbl)


@app.command("show")
def copilot_show(
    session_id: str = typer.Argument("", help="会话 ID；留空使用最近会话"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    """查看本地 Copilot 会话 transcript。"""
    sid = session_id.strip() or _latest_session_id()
    if not sid:
        warn("暂无 Copilot 会话")
        return
    try:
        remote = get_client(get_config()).copilot_session(sid, limit=100)
        rows = remote.get("items") if isinstance(remote, dict) else []
        source = "Manager"
    except Exception as e:
        warn(f"Manager copilot session 不可用，回退本地: {e}")
        rows = _read_jsonl(_session_path(sid))
        source = "local"
    if json_output:
        console.print_json(data={"ok": True, "session_id": sid, "items": rows, "source": source})
        return
    tbl = Table(title=f"copilot transcript {sid} source={source}", show_header=True, header_style="bold")
    for col in ("ts", "run_id", "ok", "query", "result"):
        tbl.add_column(col)
    for row in rows[-50:]:
        result = row.get("response") if row.get("ok") else row.get("error")
        tbl.add_row(str(row.get("ts", "")), str(row.get("run_id", "")), str(row.get("ok", "")), str(row.get("query", ""))[:80], json.dumps(result, ensure_ascii=False)[:120])
    console.print(tbl)


@app.command("classify")
def copilot_classify(text: str = typer.Argument(..., help="需求/任务文本")) -> None:
    try:
        r = get_client(get_config()).copilot_classify(text)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("summarize")
def copilot_summarize(items: list[str] = typer.Argument(..., help="多条事项")) -> None:
    try:
        r = get_client(get_config()).copilot_summarize(items)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("suggest")
def copilot_suggest(
    context: str = typer.Argument(..., help="上下文"),
    goal: str = typer.Option("", "--goal", "-g"),
) -> None:
    try:
        r = get_client(get_config()).copilot_suggest(context, goal=goal)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print("[dim]子命令：ask | sessions | show | classify | summarize | suggest[/dim]")
