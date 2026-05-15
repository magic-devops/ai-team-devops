"""
@module: sop_cli.commands.memory
@purpose: v4 记忆：health / recent / search / add / forget / summarize / attach-run
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

app = typer.Typer(help="v4 记忆：add/search/recent/forget/summarize/attach-run/flush（本地优先，远端增强）")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _memory_dir() -> Path:
    return get_config().project_path / ".sop-runtime" / "memory"


def _local_path() -> Path:
    return _memory_dir() / "local.jsonl"


def _outbox_path() -> Path:
    return _memory_dir() / "outbox.jsonl"


def _sent_path() -> Path:
    return _memory_dir() / "sent.jsonl"


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows),
        encoding="utf-8",
    )


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _parse_meta(meta_json: str) -> dict[str, Any]:
    md = json.loads(meta_json) if meta_json.strip() else {}
    if not isinstance(md, dict):
        raise ValueError("meta 须为 JSON object")
    return md


def _build_local_memory(content: str, kind: str, metadata: dict[str, Any], *, source: str = "sop-cli") -> dict[str, Any]:
    cfg = get_config()
    md = {
        **metadata,
        "source": source,
        "tenant_code": cfg.tenant_code or cfg.tenant_id,
        "business_code": cfg.business_code,
        "project_code": cfg.project_code or cfg.project_id,
        "project_id": cfg.project_id,
        "sync_status": "local",
    }
    return {
        "id": f"mem-local-{uuid.uuid4().hex}",
        "content": content,
        "kind": kind,
        "metadata": md,
        "createdAt": _now(),
    }


def _normalize_remote_item(item: dict[str, Any]) -> dict[str, Any]:
    if "createdAt" not in item and "created_at" in item:
        item["createdAt"] = item.get("created_at")
    return item


def _store_local(row: dict[str, Any], *, queue: bool = True) -> None:
    _append_jsonl(_local_path(), row)
    if queue:
        _append_jsonl(_outbox_path(), row)


def _local_recent(limit: int) -> list[dict[str, Any]]:
    return list(reversed(_read_jsonl(_local_path())[-limit:]))


def _matches(row: dict[str, Any], query: str, kind: str = "") -> bool:
    if kind and str(row.get("kind") or "") != kind:
        return False
    q = query.lower().strip()
    if not q:
        return True
    hay = f"{row.get('content', '')} {json.dumps(row.get('metadata', {}), ensure_ascii=False)}".lower()
    return q in hay


def _local_search(query: str, limit: int, *, kind: str = "") -> list[dict[str, Any]]:
    rows = [r for r in reversed(_read_jsonl(_local_path())) if _matches(r, query, kind)]
    return rows[:limit]


def _render_memory(items: list[dict[str, Any]], title: str) -> None:
    tbl = Table(title=title, show_header=True, header_style="bold")
    tbl.add_column("id")
    tbl.add_column("kind")
    tbl.add_column("created")
    tbl.add_column("content")
    for it in items or []:
        if isinstance(it, dict):
            c = str(it.get("content", ""))[:140]
            tbl.add_row(str(it.get("id", "")), str(it.get("kind", "")), str(it.get("createdAt", "")), c)
    console.print(tbl)


@app.command("health")
def memory_health() -> None:
    try:
        h = get_client(get_config()).memory_health()
        console.print_json(data=h)
    except Exception as e:
        warn(str(e))


@app.command("recent")
def memory_recent(
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=200),
    local: bool = typer.Option(False, "--local", help="只读取本地记忆"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    try:
        if local:
            items = _local_recent(limit)
        else:
            r = get_client(get_config()).memory_recent(limit=limit)
            items = [_normalize_remote_item(x) for x in (r.get("items") if isinstance(r, dict) else [])]
    except Exception as e:
        warn(f"Manager memory 不可用，回退本地: {e}")
        items = _local_recent(limit)
    if json_output:
        console.print_json(data={"ok": True, "items": items, "source": "local" if local else "auto"})
        return
    _render_memory(items, "记忆 recent")


@app.command("search")
def memory_search(
    q: str = typer.Argument(..., help="关键词"),
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=100),
    local: bool = typer.Option(False, "--local", help="只检索本地记忆"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    try:
        if local:
            items = _local_search(q, limit)
        else:
            r = get_client(get_config()).memory_search(q, limit=limit)
            items = [_normalize_remote_item(x) for x in (r.get("items") if isinstance(r, dict) else [])]
    except Exception as e:
        warn(f"Manager memory 不可用，回退本地: {e}")
        items = _local_search(q, limit)
    if json_output:
        console.print_json(data={"ok": True, "items": items, "source": "local" if local else "auto"})
        return
    _render_memory(items, f"记忆 search: {q}")


@app.command("add")
def memory_add(
    content: str = typer.Argument(..., help="记忆正文"),
    kind: str = typer.Option("long", "--kind", "-k", help="short|long|episodic"),
    meta_json: str = typer.Option("{}", "--meta", help="JSON 元数据"),
    local: bool = typer.Option(False, "--local", help="只写本地 memory outbox"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    try:
        md = _parse_meta(meta_json)
        if kind not in ("short", "long", "episodic"):
            warn("kind 应为 short|long|episodic")
            raise typer.Exit(2)
        if not local:
            try:
                r = get_client(get_config()).memory_add({"content": content, "kind": kind, "metadata": md})
                item = _normalize_remote_item(dict(r.get("item") or {})) if isinstance(r, dict) else {}
                if item:
                    item.setdefault("metadata", {}).setdefault("sync_status", "remote")
                    _store_local(item, queue=False)
                if json_output:
                    console.print_json(data=r)
                else:
                    ok(f"memory added {item.get('id', '-')}")
                return
            except Exception as e:
                warn(f"Manager memory 不可用，写入本地 outbox: {e}")
        row = _build_local_memory(content, kind, md)
        _store_local(row, queue=True)
        out = {"ok": True, "item": row, "queued": True}
        if json_output:
            console.print_json(data=out)
        else:
            ok(f"local memory queued {row['id']}")
    except json.JSONDecodeError:
        warn("--meta 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        warn(str(e))


@app.command("forget")
def memory_forget(
    memory_id: list[str] = typer.Option(None, "--id", help="要删除的 memory id，可重复"),
    query: str = typer.Option("", "--query", "-q", help="按内容/metadata 包含关系删除"),
    kind: str = typer.Option("", "--kind", help="限制 kind"),
    yes: bool = typer.Option(False, "--yes", "-y", help="跳过确认"),
) -> None:
    ids = memory_id or []
    if not ids and not query.strip():
        warn("forget 需要 --id 或 --query")
        raise typer.Exit(2)
    if not yes:
        target = ", ".join(ids) if ids else f"query={query!r}"
        typer.confirm(f"确认删除记忆 {target}?", abort=True)
    try:
        r = get_client(get_config()).memory_forget(ids=ids, query=query, kind=kind)
        console.print_json(data=r)
    except Exception as e:
        warn(f"Manager memory 不可用，仅删除本地匹配项: {e}")
        rows = _read_jsonl(_local_path())
        id_set = {str(x).strip() for x in ids if str(x).strip()}
        kept = []
        removed = 0
        for row in rows:
            hit = (id_set and str(row.get("id") or "") in id_set) or (query.strip() and _matches(row, query, kind))
            if hit:
                removed += 1
                continue
            kept.append(row)
        _write_jsonl(_local_path(), kept)
        outbox = _read_jsonl(_outbox_path())
        _write_jsonl(
            _outbox_path(),
            [row for row in outbox if not ((id_set and str(row.get("id") or "") in id_set) or (query.strip() and _matches(row, query, kind)))],
        )
        console.print_json(data={"ok": True, "removed": removed, "source": "local"})


@app.command("summarize")
def memory_summarize(
    query: str = typer.Option("", "--query", "-q", help="仅摘要匹配内容"),
    limit: int = typer.Option(50, "--limit", "-n", min=1, max=200),
    meta_json: str = typer.Option("{}", "--meta", help="JSON 元数据"),
    local: bool = typer.Option(False, "--local", help="只基于本地记忆摘要"),
) -> None:
    try:
        md = _parse_meta(meta_json)
        if local:
            raise RuntimeError("--local")
        r = get_client(get_config()).memory_summarize(query=query, limit=limit, metadata=md)
        console.print_json(data=r)
    except json.JSONDecodeError:
        warn("--meta 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        if str(e) != "--local":
            warn(f"Manager memory summarize 不可用，回退本地摘要: {e}")
        items = _local_search(query, limit) if query.strip() else _local_recent(limit)
        snippets = [str(x.get("content") or "").strip()[:500] for x in reversed(items) if str(x.get("content") or "").strip()]
        summary = "No local memory items available for summary." if not snippets else "Summary of local memory items:\n" + "\n".join(f"- {x}" for x in snippets)
        row = _build_local_memory(
            summary[:8000],
            "long",
            {"query": query, "item_count": len(snippets), **md},
            source="memory.summarize.local",
        )
        _store_local(row, queue=True)
        console.print_json(data={"ok": True, "item": row, "source": "local"})


@app.command("attach-run")
def memory_attach_run(
    memory_id: str = typer.Argument(..., help="memory id"),
    run_id: str = typer.Argument(..., help="Agent run id / workflow run id"),
    meta_json: str = typer.Option("{}", "--meta", help="JSON 元数据"),
) -> None:
    try:
        md = _parse_meta(meta_json)
        r = get_client(get_config()).memory_attach_run(memory_id, run_id=run_id, metadata=md)
        console.print_json(data=r)
        if r.get("updated"):
            ok(f"memory {memory_id} attached to run {run_id}")
    except json.JSONDecodeError:
        warn("--meta 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        warn(f"Manager memory 不可用，尝试更新本地记忆: {e}")
        rows = _read_jsonl(_local_path())
        updated = 0
        for row in rows:
            if str(row.get("id") or "") != memory_id:
                continue
            meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            runs = meta.get("runs") if isinstance(meta.get("runs"), list) else []
            if run_id not in runs:
                runs.append(run_id)
            meta.update(md)
            meta["runs"] = runs[-50:]
            row["metadata"] = meta
            updated += 1
        if updated:
            _write_jsonl(_local_path(), rows)
            outbox = _read_jsonl(_outbox_path())
            for row in outbox:
                if str(row.get("id") or "") == memory_id:
                    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
                    runs = meta.get("runs") if isinstance(meta.get("runs"), list) else []
                    if run_id not in runs:
                        runs.append(run_id)
                    meta.update(md)
                    meta["runs"] = runs[-50:]
                    row["metadata"] = meta
            _write_jsonl(_outbox_path(), outbox)
        console.print_json(data={"ok": True, "updated": updated, "source": "local"})


@app.command("flush")
def memory_flush(limit: int = typer.Option(100, "--limit", "-n", min=1, max=500)) -> None:
    """冲刷本地 memory outbox 到 Manager。"""
    rows = _read_jsonl(_outbox_path())
    if not rows:
        ok("memory outbox empty")
        return
    selected = rows[:limit]
    sent: list[dict[str, Any]] = []
    failed = ""
    for row in selected:
        body = {
            "content": row.get("content", ""),
            "kind": row.get("kind") or "long",
            "metadata": {
                **(row.get("metadata") if isinstance(row.get("metadata"), dict) else {}),
                "local_memory_id": row.get("id"),
                "local_created_at": row.get("createdAt"),
            },
        }
        try:
            out = get_client(get_config()).memory_add(body)
            item = _normalize_remote_item(dict(out.get("item") or {})) if isinstance(out, dict) else {}
            if item:
                item.setdefault("metadata", {}).setdefault("sync_status", "remote")
                _append_jsonl(_sent_path(), {"local": row, "remote": item, "flushed_at": _now()})
            sent.append(row)
        except Exception as e:
            failed = str(e)
            break
    remaining = rows[len(sent):]
    _write_jsonl(_outbox_path(), remaining)
    if failed:
        warn(f"memory flush stopped after sent={len(sent)}: {failed}")
        raise typer.Exit(1)
    ok(f"memory flushed sent={len(sent)} remain={len(remaining)}")


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    cfg = get_config()
    console.print("[dim]子命令：health | recent | search | add | forget | summarize | attach-run | flush[/dim]")
    if not cfg.project_id:
        warn("未配置 project_id：请在 .sop-runtime/agent.toml 设置 manager.project_id")
