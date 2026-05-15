"""
@module: sop_cli.commands.event
@purpose: CloudEvent 事件上报/查询：本地 outbox 优先，远端 Manager 增强
"""
from __future__ import annotations

import json
import uuid
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="事件：emit/flush/list（CloudEvents + 本地 outbox）")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _outbox_path() -> Path:
    return get_config().project_path / ".sop-runtime" / "events" / "outbox.jsonl"


def _sent_path() -> Path:
    return get_config().project_path / ".sop-runtime" / "events" / "sent.jsonl"


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows)
    path.write_text(text, encoding="utf-8")


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _parse_data(data_json: str, data: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if data_json:
        try:
            parsed = json.loads(data_json)
        except json.JSONDecodeError as e:
            raise typer.BadParameter(f"--data-json 不是合法 JSON: {e}") from e
        if not isinstance(parsed, dict):
            raise typer.BadParameter("--data-json 必须是 JSON object")
        out.update(parsed)
    for item in data:
        k, sep, v = item.partition("=")
        if not sep or not k.strip():
            raise typer.BadParameter("--data 需使用 key=value")
        out[k.strip()] = v
    return out


def _build_event(event_type: str, *, subject: str, source: str, data: dict[str, Any]) -> dict[str, Any]:
    cfg = get_config()
    data = {
        **data,
        "tenant_code": cfg.tenant_code or cfg.tenant_id,
        "business_code": cfg.business_code,
        "project_code": cfg.project_code or cfg.project_id,
        "project_id": cfg.project_id,
    }
    return {
        "specversion": "1.0",
        "id": f"evt-{uuid.uuid4().hex}",
        "type": event_type,
        "source": source or "sop-cli",
        "subject": subject,
        "time": _now(),
        "datacontenttype": "application/json",
        "data": data,
    }


def _render(rows: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    for col in ("time", "type", "id", "subject", "source"):
        tbl.add_column(col)
    for row in rows:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else row
        tbl.add_row(
            str(payload.get("time") or row.get("ts") or ""),
            str(payload.get("type") or row.get("action") or ""),
            str(payload.get("id") or row.get("id") or ""),
            str(payload.get("subject") or row.get("record_id") or ""),
            str(payload.get("source") or ""),
        )
    console.print(tbl)


@app.command("emit")
def emit_event(
    event_type: str = typer.Argument(..., help="CloudEvent type，例如 sop.agent.run.completed"),
    subject: str = typer.Option("", "--subject", help="事件主题/资源 ID"),
    source: str = typer.Option("sop-cli", "--source", help="事件来源"),
    data_json: str = typer.Option("", "--data-json", help="事件 data JSON object"),
    data: list[str] = typer.Option([], "--data", help="追加 data key=value，可重复"),
    local: bool = typer.Option(False, "--local", help="只写本地 outbox"),
) -> None:
    """上报单个 CloudEvent；远端不可用时自动落本地 outbox。"""
    event = _build_event(event_type, subject=subject, source=source, data=_parse_data(data_json, data))
    if not local:
        try:
            out = get_client().events_ingest([event])
            ok(f"event ingested {event['id']} accepted={len(out.get('accepted', []))}")
            return
        except Exception as e:
            warn(f"Manager events ingest 不可用，写入本地 outbox: {e}")
    _append_jsonl(_outbox_path(), event)
    ok(f"local event queued {event['id']}")


@app.command("flush")
def flush_events(limit: int = typer.Option(100, "--limit", "-n", help="本次最多发送数量")) -> None:
    """冲刷本地事件 outbox 到 Manager。"""
    rows = _read_jsonl(_outbox_path())
    if not rows:
        ok("event outbox empty")
        return
    batch = rows[: max(1, limit)]
    out = get_client().events_ingest(batch)
    done = set(out.get("accepted", []) or []) | set(out.get("duplicated", []) or [])
    remain = [r for r in rows if str(r.get("id")) not in done]
    sent = [r for r in batch if str(r.get("id")) in done]
    _write_jsonl(_outbox_path(), remain)
    for row in sent:
        _append_jsonl(_sent_path(), row)
    ok(f"events flushed accepted={len(out.get('accepted', []))} duplicated={len(out.get('duplicated', []))} remain={len(remain)}")


@app.command("list")
def list_events(
    since: str = typer.Option("", "--since", help="远端事件 ts 游标"),
    limit: int = typer.Option(50, "--limit", "-n", help="返回数量"),
    local: bool = typer.Option(False, "--local", help="只查看本地 outbox/sent"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    """查看远端事件流水；Manager 不可用时回退本地。"""
    rows: list[dict[str, Any]]
    title = "events"
    if not local:
        try:
            out = get_client().events_list(since=since, limit=limit)
            rows = list(out.get("items", []))
            if json_output:
                console.print_json(data={"items": rows, "total": len(rows), "cursor": out.get("cursor", since)})
                return
            _render(rows, f"remote events total={len(rows)}")
            return
        except Exception as e:
            warn(f"Manager events 不可用，回退本地: {e}")
    rows = (_read_jsonl(_outbox_path()) + _read_jsonl(_sent_path()))[-max(1, limit):]
    title = f"local events total={len(rows)}"
    if json_output:
        console.print_json(data={"items": rows, "total": len(rows)})
        return
    _render(rows, title)


def _ws_url(manager_url: str, *, project_id: str, token: str) -> str:
    parsed = urlparse(manager_url.rstrip("/"))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    query = urlencode({"project_id": project_id, "token": token})
    return urlunparse((scheme, parsed.netloc, "/ws/events", "", query, ""))


@app.command("subscribe")
def subscribe_events(
    project_id: str = typer.Option("", "--project-id", help="项目 ID；默认读取 agent.toml"),
    token: str = typer.Option("", "--token", help="Bearer token；默认读取 sop login 凭据"),
    event_type: str = typer.Option("", "--type", help="只显示指定事件类型"),
    limit: int = typer.Option(0, "--limit", "-n", help="收到 N 条后退出；0 表示持续订阅"),
    timeout: int = typer.Option(0, "--timeout", help="最多订阅秒数；0 表示不限制"),
    json_output: bool = typer.Option(False, "--json", help="逐行输出原始 JSON"),
) -> None:
    """订阅 Manager /ws/events 实时事件。"""
    cfg = get_config()
    pid = project_id or cfg.project_id
    tok = token or cfg.bearer_token
    if not pid:
        warn("缺少 project_id；请先 sop login --pair 或传 --project-id")
        raise typer.Exit(2)
    if not tok:
        warn("缺少 Bearer token；WSS 当前需要 sop login -u 或传 --token")
        raise typer.Exit(2)

    async def _run() -> None:
        try:
            import websockets  # type: ignore[import-not-found]
        except ImportError as e:
            warn("缺少 websockets 依赖；请安装 `pip install websockets` 或 `pip install 'sop-cli[all]'`")
            raise typer.Exit(2) from e

        url = _ws_url(cfg.manager_url, project_id=pid, token=tok)
        received = 0
        async with websockets.connect(url) as ws:  # type: ignore[attr-defined]
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=timeout if timeout > 0 and received == 0 else None)
                except asyncio.TimeoutError:
                    ok("event subscribe timeout")
                    return
                try:
                    evt = json.loads(raw)
                except Exception:
                    evt = {"raw": raw}
                if event_type and evt.get("type") != event_type:
                    continue
                received += 1
                if json_output:
                    console.print_json(data=evt)
                else:
                    console.print(f"[bold]{evt.get('type', '-')}[/bold] {evt.get('id', '-')} {evt.get('subject', '')}")
                if limit and received >= limit:
                    return

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        ok("event subscribe stopped")
    except typer.Exit:
        raise
    except Exception as e:
        warn(f"event subscribe failed: {e}")
        raise typer.Exit(2) from e


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    list_events(local=True)
