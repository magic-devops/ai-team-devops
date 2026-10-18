"""Project event receipts and one shared durable SQLite queue."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from urllib.parse import urlencode, urlparse, urlunparse

import typer

from sop_sdk.event_envelope import FrozenEvent, integer, strict_json
from sop_sdk.event_outbox import EventOutbox
from sop_sdk.event_sender import flush_outbox
from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="事件：持久入队、送达回执、处理记录和明确重试")


def _outbox_path(config=None) -> Path:
    cfg = config or get_config()
    return cfg.project_path / cfg.outbox_path


def queue_health(project_path: Path, outbox_path: str = ".sop-runtime/outbox.sqlite"):
    """Observe current SQL counts without creating, migrating, binding or flushing a queue."""
    path = project_path / outbox_path
    if not path.exists():
        return {"pending": 0, "dead_letter": 0, "acked": 0, "bad": 0, "storage_state": "not_initialized"}
    error = "storage_unavailable"
    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1)) as db:
            db.execute("BEGIN")
            if db.execute("PRAGMA user_version").fetchone()[0] != 1:
                error = "migration_required"
            else:
                counts = dict(db.execute("SELECT state,count(*) FROM events GROUP BY state"))
                return {
                    **{state: counts.get(state, 0) for state in ("pending", "dead_letter", "acked")},
                    "bad": 0,
                    "storage_state": "ready",
                }
    except (sqlite3.Error, OSError, ValueError):
        pass
    return {"pending": None, "dead_letter": None, "acked": None, "bad": 1, "storage_state": error}


def _legacy_files(project_path: Path | None = None):
    root = (project_path or get_config().project_path) / ".sop-runtime"
    names = ("events/outbox.jsonl", "events/sent.jsonl", "sync/push_queue.jsonl", "dlq", "local", "rules/proposals.jsonl", "sync/watch_state.json")
    return [
        {
            "path": str(root / name),
            "kind": "directory" if (root / name).is_dir() else "file",
            "size": (root / name).stat().st_size,
        }
        for name in names
        if (root / name).exists()
    ]


def _flush(limit, *, config=None):
    cfg = config or get_config()
    retries = integer(cfg.outbox_max_retries, "outbox_max_retries", 0, 999)
    with EventOutbox(_outbox_path(cfg)) as box:
        return flush_outbox(
            box,
            get_client(cfg),
            intended_project_id=cfg.project_id,
            manager_url=cfg.manager_url,
            limit=limit,
            max_attempts=retries + 1,
        )


@app.command("emit")
def emit_event(
    event_type: str = typer.Argument(...),
    subject: str = typer.Option("", "--subject"),
    source: str = typer.Option("sop-cli", "--source"),
    data_json: str = typer.Option("{}", "--data-json"),
    data: list[str] = typer.Option([], "--data"),
    event_id: str = typer.Option(..., "--id", help="固定事件 ID；重发须使用原 ID 和原文"),
    time: str = typer.Option(..., "--time", help="原始 RFC3339 时间；重发不可重新取当前时间"),
    local: bool = typer.Option(False, "--local"),
) -> None:
    """始终先写同一 SQLite；送达和业务处理分别确认。"""
    try:
        payload = strict_json(data_json)
        if not isinstance(payload, dict):
            raise ValueError("data must be JSON object")
        for item in data:
            key, sep, value = item.partition("=")
            if not sep or not key:
                raise ValueError("--data requires key=value")
            payload[key] = value
        frozen = FrozenEvent.create(
            event_type, payload, event_id=event_id, time=time, subject=subject, source=source
        )
        with EventOutbox(_outbox_path()) as box:
            queued = box.enqueue(frozen, get_config().project_id)
        console.print_json(data={"queued": queued})
        if not local:
            console.print_json(data=_flush(20))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("enqueue-file")
def enqueue_file(path: Path, local: bool = typer.Option(False, "--local")):
    """从原始完整 CloudEvent UTF-8 文件持久入队；字节内容保持不变。"""
    try:
        frozen = FrozenEvent.from_json(path.read_bytes().decode("utf-8"))
        with EventOutbox(_outbox_path()) as box:
            console.print_json(data=box.enqueue(frozen, get_config().project_id))
        if not local:
            console.print_json(data=_flush(20))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("flush")
def flush_events(limit: int = typer.Option(20, "--limit", "-n", min=1, max=50)):
    try:
        console.print_json(data=_flush(limit))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("list")
def list_events(
    state: str = typer.Option("all", "--state"),
    event_type: str = typer.Option("", "--type"),
    producer_id: str = typer.Option("", "--producer-id"),
    cursor: str = typer.Option("", "--cursor"),
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=50),
    local: bool = typer.Option(False, "--local"),
    json_output: bool = typer.Option(False, "--json"),
):
    """有界查询；远端读取失败明确报错，避免把本地数据当作远端结果。"""
    try:
        if local:
            with EventOutbox(_outbox_path()) as box:
                result = box.list(state=state, limit=limit, cursor=cursor)
        else:
            result = get_client().events_list(
                state=state, event_type=event_type, producer_id=producer_id, cursor=cursor, limit=limit
            )
        console.print_json(data=result)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("show")
def show_event(event_id: str, local: bool = typer.Option(False, "--local")):
    try:
        if local:
            with EventOutbox(_outbox_path()) as box:
                result = box.inspect(event_id)
        else:
            result = get_client().event_receipt(event_id)
        console.print_json(data=result)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("attempts")
def event_attempts(
    receipt_id: str,
    cursor: str = typer.Option("", "--cursor"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
):
    console.print_json(data=get_client().event_attempts(receipt_id, cursor=cursor, limit=limit))


@app.command("retry")
def retry_event(
    receipt_id: str,
    revision: int = typer.Option(..., "--revision", min=1),
    reason: str = typer.Option(..., "--reason"),
    key: str = typer.Option(..., "--key"),
):
    """Manager 原业务操作重试；保留同一键、原修订与原因用于未知结果重放。"""
    console.print_json(
        data=get_client().event_retry(
            receipt_id, expected_revision=revision, reason=reason, idempotency_key=key
        )
    )


@app.command("requeue")
def requeue_event(
    event_id: str,
    revision: int = typer.Option(..., "--revision", min=1),
    reason: str = typer.Option(..., "--reason"),
    key: str = typer.Option(..., "--key"),
):
    """仅将可重试本地死信恢复为待送达，保持原内容与身份。"""
    try:
        with EventOutbox(_outbox_path()) as box:
            console.print_json(data=box.requeue(event_id, revision, reason, key))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("stats")
def queue_stats():
    with EventOutbox(_outbox_path()) as box:
        console.print_json(data={**box.stats(), "legacy_files": _legacy_files()})


@app.command("migrate-v0")
def migrate_v0(project_id: str = typer.Option(..., "--project-id", help="明确选择旧 SQLite 事件的目标项目")):
    console.print_json(data=EventOutbox.migrate_legacy(_outbox_path(), project_id))


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
                    raw = await asyncio.wait_for(
                        ws.recv(), timeout=timeout if timeout > 0 and received == 0 else None
                    )
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
                    console.print(
                        f"[bold]{evt.get('type', '-')}[/bold] {evt.get('id', '-')} {evt.get('subject', '')}"
                    )
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
    list_events(state="all", event_type="", producer_id="", cursor="", limit=20, local=True, json_output=True)
