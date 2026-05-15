"""
@module: sop_cli.commands.kb
@purpose: 知识库：search / rag / add / index / job
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="知识库检索、写入与索引（本地优先，远端 Manager/RAG 增强）")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _kb_runtime_dir() -> Path:
    return get_config().project_path / ".sop-runtime" / "kb"


def _outbox_path() -> Path:
    return _kb_runtime_dir() / "outbox.jsonl"


def _sent_path() -> Path:
    return _kb_runtime_dir() / "sent.jsonl"


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


def _local_kb_roots() -> list[Path]:
    root = get_config().project_path
    return [
        root / "sop" / "custom",
        root / "ai-sop",
        root / ".ai-memory" / "rules",
        root / "memory",
    ]


def _local_search(q: str, *, category: str = "", limit: int = 50) -> list[dict]:
    needle = q.lower().strip()
    rows: list[dict] = []
    for base in _local_kb_roots():
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if len(rows) >= limit:
                return rows
            if not path.is_file() or path.suffix.lower() not in {".md", ".json", ".yaml", ".yml", ".toml"}:
                continue
            if category and category not in path.parts and category not in path.as_posix():
                continue
            try:
                content = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            hay = f"{path.as_posix()} {content}".lower()
            if not needle or needle in hay:
                rel = path.relative_to(get_config().project_path).as_posix()
                rows.append({"id": rel, "category": category or _guess_category(path), "path": rel, "content": content[:800]})
    return rows


def _queued_search(q: str, *, category: str = "", limit: int = 50) -> list[dict]:
    needle = q.lower().strip()
    rows: list[dict] = []
    for item in reversed(_read_jsonl(_outbox_path())):
        if len(rows) >= limit:
            break
        if category and str(item.get("category") or "") != category:
            continue
        hay = f"{item.get('title', '')} {item.get('content', '')} {json.dumps(item.get('tags', []), ensure_ascii=False)}".lower()
        if not needle or needle in hay:
            rows.append({
                "id": item.get("id"),
                "category": item.get("category"),
                "path": item.get("path") or "",
                "content": str(item.get("content") or "")[:800],
                "queued": True,
            })
    return rows


def _guess_category(path: Path) -> str:
    parts = set(path.parts)
    for c in ("specs", "examples", "design", "interaction", "daily", "rules", "templates"):
        if c in parts:
            return c
    return "general"


def _slug(title: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", title.strip().lower()).strip("-")
    return s[:80] or datetime.utcnow().strftime("kb-%Y%m%d%H%M%S")


def _write_local_knowledge(title: str, content: str, category: str, tags: list[str]) -> Path:
    root = get_config().project_path
    cat = category if category in {"specs", "examples", "design", "interaction", "daily", "rules"} else "daily"
    out = root / "sop" / "custom" / cat / f"{_slug(title)}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    front = "\n".join(
        [
            "---",
            f"title: {title}",
            f"category: {category}",
            f"tags: {', '.join(tags)}",
            f"created_at: {datetime.utcnow().replace(microsecond=0).isoformat()}Z",
            "---",
            "",
        ]
    )
    out.write_text(front + content.strip() + "\n", encoding="utf-8")
    return out


def _build_kb_item(title: str, content: str, category: str, tags: list[str], path: Path) -> dict[str, Any]:
    cfg = get_config()
    return {
        "id": f"kb-local-{uuid.uuid4().hex}",
        "title": title,
        "content": content,
        "category": category,
        "tags": tags,
        "path": path.relative_to(cfg.project_path).as_posix(),
        "created_at": _now(),
        "tenant_code": cfg.tenant_code or cfg.tenant_id,
        "business_code": cfg.business_code,
        "project_code": cfg.project_code or cfg.project_id,
        "project_id": cfg.project_id,
    }


@app.command("search")
def kb_search(
    q: str = typer.Argument(..., help="关键词"),
    category: str = typer.Option("", "--category", "-c", help="分类过滤"),
    local: bool = typer.Option(False, "--local", help="只搜索本地文件与本地 outbox"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    try:
        if local:
            raise RuntimeError("--local")
        rows = get_client(get_config()).knowledge_search_workspace(q, category=category or None)
        source = "Manager"
    except Exception as e:
        if str(e) != "--local":
            warn(f"Manager 知识库不可用，回退本地搜索：{e}")
        rows = _queued_search(q, category=category) + _local_search(q, category=category)
        source = "local"
    if json_output:
        console.print_json(data={"ok": True, "items": rows or [], "source": source})
        return
    try:
        tbl = Table(title=f"知识库: {q}", show_header=True, header_style="bold")
        tbl.add_column("id")
        tbl.add_column("category")
        tbl.add_column("path")
        tbl.add_column("content")
        for row in rows or []:
            if isinstance(row, dict):
                tbl.add_row(
                    str(row.get("id", "")),
                    str(row.get("category", "")),
                    str(row.get("path", "")),
                    str(row.get("content", ""))[:120],
                )
        console.print(tbl)
        if source == "local":
            warn("本地结果未进入远端索引；连接 Manager 后可执行 sop kb index 或 sop sync push-file")
    except Exception as e:
        warn(str(e))


@app.command("rag")
def kb_rag(
    q: str = typer.Argument(..., help="语义检索"),
    limit: int = typer.Option(8, "--limit", "-n", min=1, max=50),
) -> None:
    try:
        r = get_client(get_config()).rag_search(q, limit=limit)
        items = r.get("items") if isinstance(r, dict) else []
        tbl = Table(title=f"RAG: {q}", show_header=True, header_style="bold")
        tbl.add_column("collection")
        tbl.add_column("score")
        tbl.add_column("title")
        tbl.add_column("snippet")
        for it in items or []:
            if isinstance(it, dict):
                tbl.add_row(
                    str(it.get("collection", "")),
                    f"{it.get('score', 0):.3f}" if isinstance(it.get("score"), (int, float)) else "",
                    str(it.get("title", ""))[:40],
                    str(it.get("snippet", ""))[:100],
                )
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("add")
def kb_add(
    title: str = typer.Argument(..., help="标题"),
    content: str = typer.Argument(..., help="正文（Markdown）"),
    category: str = typer.Option("general", "--category", "-c"),
    tags: str = typer.Option("", "--tags", help="逗号分隔标签"),
    local: bool = typer.Option(False, "--local", help="只写本地知识文件与 kb outbox"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    if not local:
        try:
            r = get_client(get_config()).knowledge_create(
                {"title": title, "content": content, "category": category, "tags": tag_list}
            )
            if json_output:
                console.print_json(data=r)
            else:
                ok("知识条目已写入")
            return
        except Exception as e:
            warn(f"Manager 知识写入失败，落本地知识文件与 outbox：{e}")
    p = _write_local_knowledge(title, content, category, tag_list)
    item = _build_kb_item(title, content, category, tag_list, p)
    _append_jsonl(_outbox_path(), item)
    if json_output:
        console.print_json(data={"ok": True, "item": item, "queued": True})
    else:
        ok(f"知识条目已写入本地 {p.relative_to(get_config().project_path)}")
        warn("连接 Manager 后可执行 sop kb flush 或 sop context prepare --flush")


@app.command("flush")
def kb_flush(limit: int = typer.Option(100, "--limit", "-n", min=1, max=500)) -> None:
    """冲刷本地 kb outbox 到 Manager 知识库。"""
    rows = _read_jsonl(_outbox_path())
    if not rows:
        ok("kb outbox empty")
        return
    sent: list[dict[str, Any]] = []
    failed = ""
    for row in rows[:limit]:
        body = {
            "title": row.get("title") or row.get("path") or row.get("id"),
            "content": row.get("content") or "",
            "category": row.get("category") or "general",
            "tags": row.get("tags") if isinstance(row.get("tags"), list) else [],
        }
        try:
            out = get_client(get_config()).knowledge_create(body)
            _append_jsonl(_sent_path(), {"local": row, "remote": out, "flushed_at": _now()})
            sent.append(row)
        except Exception as e:
            failed = str(e)
            break
    remaining = rows[len(sent):]
    _write_jsonl(_outbox_path(), remaining)
    if failed:
        warn(f"kb flush stopped after sent={len(sent)}: {failed}")
        raise typer.Exit(1)
    ok(f"kb flushed sent={len(sent)} remain={len(remaining)}")


@app.command("index")
def kb_index(async_job: bool = typer.Option(False, "--async", help="投递 Worker 异步索引")) -> None:
    try:
        client = get_client(get_config())
        if async_job:
            r = client.worker_enqueue("kb.index", {})
            console.print_json(data=r)
            ok(f"索引任务已投递: {r.get('job_id', '-')}")
        else:
            r = client.knowledge_index()
            console.print_json(data=r)
            ok(f"索引完成 count={r.get('count', '-')}")
    except Exception as e:
        warn(str(e))


@app.command("job")
def kb_job_status(job_id: str = typer.Argument(..., help="Worker job_id")) -> None:
    try:
        r = get_client(get_config()).worker_job_status(job_id)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print("[dim]子命令：search | rag | add | flush | index | job[/dim]")
    if not get_config().project_id:
        warn("未配置 project_id：请在 .sop-runtime/agent.toml 设置 manager.project_id")
