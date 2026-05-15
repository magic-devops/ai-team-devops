"""
@module: sop_cli.commands.sync
@purpose: 双向同步规约/规则/知识（项目侧 ↔ Manager）
@ai_safe_edit:
  - 实际同步实现在 sop-agentd Reporter/Puller（M4）；本命令仅触发一次性同步
"""
from __future__ import annotations

import typer

from .._util import err, ok, warn
from sop_sdk import AgentdIpcClient

app = typer.Typer(help="一次性同步（规约/规则/知识）")


def _queue_path() -> "Path":
    from pathlib import Path

    from .._util import get_config

    return Path(get_config().project_path) / ".sop-runtime" / "sync" / "push_queue.jsonl"


def _sync_root() -> "Path":
    from pathlib import Path

    from .._util import get_config

    return Path(get_config().project_path) / ".sop-runtime" / "sync"


def _safe_asset_target(module: str, rel: str) -> "Path | None":
    from pathlib import Path

    from .._util import get_config

    rel = (rel or "").strip().replace("\\", "/")
    if not rel or rel.startswith("/") or ".." in Path(rel).parts:
        return None
    root = Path(get_config().project_path)
    if module == "rules":
        base = root / ".ai-memory" / "rules"
    elif module == "specs":
        base = root / "sop" / "custom" / "specs"
    elif module == "templates":
        base = root / "sop" / "custom"
    else:
        return None
    return (base / rel).resolve()


def _materialize_pull_result(result: dict, *, write_assets: bool = True) -> dict[str, int]:
    """Merge sync/pull changes into .sop-runtime and optional local asset files."""
    import json
    from datetime import datetime, timezone

    from .._util import get_config, warn

    changes = result.get("changes") if isinstance(result, dict) else None
    if not isinstance(changes, dict):
        return {}
    root = _sync_root()
    entities = root / "entities"
    entities.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    asset_modules = {"rules", "specs", "templates"}
    for module, rows in changes.items():
        if not isinstance(rows, list):
            continue
        cur_path = entities / f"{module}.json"
        try:
            cur = json.loads(cur_path.read_text(encoding="utf-8")) if cur_path.is_file() else {}
        except Exception:
            cur = {}
        if not isinstance(cur, dict):
            cur = {}
        n = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            rid = str(row.get("id") or row.get("path") or "").strip()
            if not rid:
                continue
            cur[rid] = row
            n += 1
            if write_assets and module in asset_modules and "content" in row:
                rel = str(row.get("path") or row.get("id") or "")
                target = _safe_asset_target(module, rel)
                if target is None:
                    warn(f"跳过不安全资产路径: {module}/{rel}")
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(str(row.get("content") or ""), encoding="utf-8")
        cur_path.write_text(json.dumps(cur, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        counts[str(module)] = n
    state = {
        "cursor": result.get("cursor") or "",
        "last_pull_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "last_total": result.get("total", sum(counts.values())),
        "project_id": result.get("project_id") or get_config().project_id,
    }
    (get_config().project_path / ".sop-runtime" / "sync_state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return counts


def _queue_key(item: dict) -> str:
    record = item.get("record") if isinstance(item.get("record"), dict) else {}
    rid = str(record.get("id") or record.get("path") or "").strip()
    return f"{item.get('module')}:{rid}"


def _load_queue_items() -> tuple[list[dict], int]:
    import json

    q = _queue_path()
    if not q.is_file():
        return [], 0
    items: list[dict] = []
    bad = 0
    for line in [ln for ln in q.read_text(encoding="utf-8").splitlines() if ln.strip()]:
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            bad += 1
            continue
        if not isinstance(item, dict) or not item.get("module") or not isinstance(item.get("record"), dict):
            bad += 1
            continue
        if not _queue_key(item).split(":", 1)[1]:
            bad += 1
            continue
        items.append(item)
    return items, bad


def _compact_queue_items(items: list[dict]) -> list[dict]:
    latest: dict[str, dict] = {}
    order: list[str] = []
    for item in items:
        key = _queue_key(item)
        if key not in latest:
            order.append(key)
        latest[key] = item
    return [latest[k] for k in order if k in latest]


def _write_queue_items(items: list[dict]) -> None:
    import json

    q = _queue_path()
    if not items:
        q.unlink(missing_ok=True)
        return
    q.parent.mkdir(parents=True, exist_ok=True)
    q.write_text(
        "".join(json.dumps(it, ensure_ascii=False, separators=(",", ":")) + "\n" for it in items),
        encoding="utf-8",
    )


def _enqueue_item(module: str, record: dict, *, action: str = "upsert", idempotency_key: str = "") -> dict:
    import json
    import uuid

    rid = str(record.get("id") or record.get("path") or "").strip()
    if not rid:
        raise typer.BadParameter("record 必须包含 id 或 path")
    item = {
        "module": module,
        "action": action or "upsert",
        "record": record,
        "idempotency_key": idempotency_key or f"cli-{module}-{action or 'upsert'}-{rid}-{uuid.uuid4().hex[:8]}",
    }
    q = _queue_path()
    q.parent.mkdir(parents=True, exist_ok=True)
    with q.open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
    return item


def _pull_result_payload(r: dict) -> dict:
    """Normalize agentd IPC result vs Manager HTTP body."""
    if not isinstance(r, dict):
        return {}
    if "total" in r or "cursor" in r:
        return r
    inner = r.get("result")
    return inner if isinstance(inner, dict) else r


@app.command("pull")
def sync_pull(
    cursor: str = typer.Option("", "--cursor", help="ISO8601 游标"),
    modules: str = typer.Option("tasks,requirements,issues,sprints,rules,specs,templates", "--modules", "-m"),
    out: str = typer.Option("", "--out", "-o", help="写入 JSON 文件"),
    materialize: bool = typer.Option(False, "--materialize", help="把 pull 结果物化到 .sop-runtime/sync/entities"),
    write_assets: bool = typer.Option(True, "--write-assets/--no-write-assets", help="materialize 时同步写回规则/规约/模板文件"),
    direct: bool = typer.Option(
        False,
        "--direct",
        help="跳过 agentd，直连 Manager",
    ),
) -> None:
    """从 Manager 拉取结构化变更（游标同步）。"""
    import json

    from .._util import console, get_client, get_config, ok, warn

    cfg = get_config()
    r: dict | None = None
    if not direct:
        ipc = AgentdIpcClient()
        if ipc.available():
            try:
                data: dict = {"modules": modules}
                if cursor:
                    data["cursor"] = cursor
                out_ipc = ipc.send("sync.pull", data=data)
                if out_ipc.get("ok"):
                    r = _pull_result_payload(out_ipc)
                    ok("已通过 sop-agentd 拉取")
                else:
                    warn(f"agentd pull 失败: {out_ipc.get('error', '-')}")
            except Exception as e:
                warn(f"agentd pull 异常: {e}")
        else:
            warn("sop-agentd 未运行")

    if r is None:
        if not direct:
            warn("回退直连 Manager（不更新本地 sync_state / entities）")
        try:
            r = get_client(cfg).sync_pull(cursor=cursor, modules=modules)
        except Exception as e:
            warn(str(e))
            raise typer.Exit(2) from e

    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(r, f, ensure_ascii=False, indent=2)
        ok(f"已写入 {out}")
    if materialize or direct:
        counts = _materialize_pull_result(r, write_assets=write_assets)
        ok(f"已物化 pull 结果: {counts}")
    else:
        console.print_json(data=r)


@app.command("status")
def sync_status() -> None:
    """查看本地同步游标与物化实体统计。"""
    import json

    from .._util import console, get_config, kv, ok, warn

    cfg = get_config()
    rt = cfg.project_path / ".sop-runtime" / "sync"
    state_path = cfg.project_path / ".sop-runtime" / "sync_state.json"
    if state_path.is_file():
        st = json.loads(state_path.read_text(encoding="utf-8"))
        kv("cursor", st.get("cursor") or "(空)")
        kv("last_pull_at", st.get("last_pull_at") or "-")
        kv("last_total", st.get("last_total", 0))
    else:
        kv("cursor", "(未拉取)")
    entities = rt / "entities"
    if entities.is_dir():
        for f in sorted(entities.glob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                console.print(f"  {f.stem}: {len(data)} 条")
            except Exception:
                console.print(f"  {f.stem}: (解析失败)")
    queue = rt / "push_queue.jsonl"
    if queue.is_file():
        lines = [ln for ln in queue.read_text(encoding="utf-8").splitlines() if ln.strip()]
        kv("push_queue_pending", len(lines))
    else:
        kv("push_queue_pending", 0)
    ipc = AgentdIpcClient()
    if ipc.available():
        h = ipc.send("health")
        if h.get("ok"):
            ok(f"agentd 在线 outbox_depth={((h.get('result') or {}).get('outbox_depth'))}")
    else:
        warn("sop-agentd 未运行 → sop agentd start")


@app.command("doctor")
def sync_doctor() -> None:
    """本地同步健康检查：队列、物化实体、manifest、agentd。"""
    import json

    from rich.table import Table

    from .._util import console, get_config, ok, warn

    cfg = get_config()
    items, bad = _load_queue_items()
    compacted = _compact_queue_items(items)
    duplicate_count = max(0, len(items) - len(compacted))
    rt = _sync_root()
    entities = rt / "entities"
    entity_ok = 0
    entity_bad: list[str] = []
    if entities.is_dir():
        for f in sorted(entities.glob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    entity_ok += 1
                else:
                    entity_bad.append(f.name)
            except Exception:
                entity_bad.append(f.name)

    tbl = Table(title="sop sync doctor", show_header=True, header_style="bold")
    tbl.add_column("check")
    tbl.add_column("status")
    tbl.add_column("detail")
    tbl.add_row("project_id", "ok" if cfg.project_id else "warn", cfg.project_id or "未配置")
    tbl.add_row("manifest", "ok" if (cfg.project_path / ".sop-runtime" / "project_manifest.json").is_file() else "warn", ".sop-runtime/project_manifest.json")
    tbl.add_row("push_queue", "ok" if bad == 0 else "warn", f"valid={len(items)} bad={bad} duplicates={duplicate_count}")
    tbl.add_row("entities", "ok" if not entity_bad else "warn", f"ok_files={entity_ok} bad={','.join(entity_bad) or '-'}")
    tbl.add_row("sync_state", "ok" if (cfg.project_path / ".sop-runtime" / "sync_state.json").is_file() else "warn", ".sop-runtime/sync_state.json")
    ipc = AgentdIpcClient()
    if ipc.available():
        h = ipc.send("health")
        tbl.add_row("agentd", "ok" if h.get("ok") else "warn", str((h.get("result") or h.get("error") or "-"))[:120])
    else:
        tbl.add_row("agentd", "offline", "可用 sop sync flush / pull --direct 或 sop agentd start")
    console.print(tbl)
    if bad or duplicate_count or entity_bad:
        warn("可执行 sop sync repair --dry-run 预览修复；确认后执行 sop sync repair")
    else:
        ok("本地同步状态看起来正常")


@app.command("repair")
def sync_repair(
    dry_run: bool = typer.Option(False, "--dry-run", help="只预览修复，不改写文件"),
    compact: bool = typer.Option(True, "--compact/--no-compact", help="修复时压缩重复队列项"),
    archive_bad: bool = typer.Option(True, "--archive-bad/--drop-bad", help="坏队列行归档到 .bad 文件；关闭则直接丢弃"),
) -> None:
    """温和修复本地 push_queue：移除坏行、可选压缩重复项。"""
    import json
    from datetime import datetime

    from .._util import console, kv, ok, warn

    q = _queue_path()
    if not q.is_file():
        ok("push_queue 为空，无需修复")
        return
    valid: list[dict] = []
    bad_lines: list[str] = []
    for line in [ln for ln in q.read_text(encoding="utf-8").splitlines() if ln.strip()]:
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            bad_lines.append(line)
            continue
        if not isinstance(item, dict) or not item.get("module") or not isinstance(item.get("record"), dict):
            bad_lines.append(line)
            continue
        if not _queue_key(item).split(":", 1)[1]:
            bad_lines.append(line)
            continue
        valid.append(item)
    repaired = _compact_queue_items(valid) if compact else valid
    kv("valid_before", len(valid))
    kv("bad_lines", len(bad_lines))
    kv("valid_after", len(repaired))
    if dry_run:
        console.print_json(
            data={
                "dry_run": True,
                "bad_lines": len(bad_lines),
                "before": len(valid),
                "after": len(repaired),
                "compact": compact,
            }
        )
        return
    if bad_lines and archive_bad:
        stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        bad_path = q.with_name(f"{q.name}.bad.{stamp}.jsonl")
        bad_path.write_text("\n".join(bad_lines) + "\n", encoding="utf-8")
        warn(f"坏队列行已归档: {bad_path}")
    _write_queue_items(repaired)
    ok(f"push_queue 已修复 bad={len(bad_lines)} remaining={len(repaired)}")


@app.command("compact")
def sync_compact(
    dry_run: bool = typer.Option(False, "--dry-run", help="只显示压缩结果，不改写队列"),
) -> None:
    """压缩本地 push_queue：同一 module/id 仅保留最后一条变更。"""
    from .._util import console, kv, ok, warn

    items, bad = _load_queue_items()
    compacted = _compact_queue_items(items)
    kv("queue_before", len(items))
    kv("queue_after", len(compacted))
    kv("reduced", max(0, len(items) - len(compacted)))
    if bad:
        warn(f"跳过无法解析/缺少 id 的队列行: {bad}")
    if dry_run:
        console.print_json(
            data={
                "dry_run": True,
                "before": len(items),
                "after": len(compacted),
                "items": [
                    {
                        "module": it.get("module"),
                        "action": it.get("action") or "upsert",
                        "id": (it.get("record") or {}).get("id") or (it.get("record") or {}).get("path"),
                    }
                    for it in compacted[:80]
                ],
            }
        )
        return
    _write_queue_items(compacted)
    ok("push_queue 已压缩")


@app.command("flush")
def sync_flush(
    limit: int = typer.Option(0, "--limit", help="最多推送 N 条；0 表示全部"),
    compact: bool = typer.Option(True, "--compact/--no-compact", help="推送前先压缩同一对象的重复变更"),
    dry_run: bool = typer.Option(False, "--dry-run", help="只预览队列，不实际推送"),
) -> None:
    """直连 Manager 冲刷本地 push_queue，不依赖 sop-agentd。"""
    import json

    from .._util import console, get_client, get_config, kv, ok, warn

    q = _queue_path()
    if not q.is_file():
        ok("push_queue 为空")
        return
    items, bad = _load_queue_items()
    if not items:
        ok("push_queue 为空")
        return
    if compact:
        before = len(items)
        items = _compact_queue_items(items)
        if before != len(items) and not dry_run:
            _write_queue_items(items)
            ok(f"push_queue 已预压缩 {before} → {len(items)}")
    selected = items[:limit] if limit and limit > 0 else items
    remaining_unselected = items[len(selected) :]

    kv("queue_total", len(items))
    kv("selected", len(selected))
    if bad:
        warn(f"跳过无法解析/缺少 id 的队列行: {bad}")
    if dry_run:
        preview = [
            {
                "module": it.get("module"),
                "action": it.get("action") or "upsert",
                "id": (it.get("record") or {}).get("id") or (it.get("record") or {}).get("path"),
            }
            for it in selected[:50]
        ]
        console.print_json(data={"dry_run": True, "items": preview, "omitted": max(0, len(selected) - len(preview))})
        return

    cli = get_client(get_config())
    sent = 0
    failed = 0
    pending: list[dict] = []
    for it in selected:
        module = str(it.get("module") or "")
        action = str(it.get("action") or "upsert")
        record = dict(it.get("record") or {})
        idem = str(it.get("idempotency_key") or "")
        try:
            cli.sync_push(module, record, action=action, idempotency_key=idem)
            sent += 1
        except Exception as e:
            failed += 1
            pending.append(it)
            warn(f"push 失败，保留队列: {module}/{record.get('id') or record.get('path') or '-'}: {e}")
    pending.extend(remaining_unselected)
    if pending:
        _write_queue_items(pending)
    else:
        _write_queue_items([])
    ok(f"sync flush 完成 sent={sent} failed={failed} pending={len(pending)}")


@app.command("push")
def sync_push_cmd(
    module: str = typer.Argument(..., help="tasks|requirements|issues|sprints|rules|specs|templates"),
    record_json: str = typer.Argument(..., help="JSON 记录；结构化须含 id，资产须含 path/content"),
    action: str = typer.Option("upsert", "--action", help="upsert|delete"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
) -> None:
    """向 Manager 推送单条结构化变更或规约资产（幂等键可选）。"""
    import json

    from .._util import console, get_client, get_config, ok, warn

    try:
        rec = json.loads(record_json)
        if not isinstance(rec, dict):
            raise ValueError("record 须为 JSON object")
        r = get_client(get_config()).sync_push(
            module, rec, action=action, idempotency_key=idempotency_key
        )
        console.print_json(data=r)
        ok(f"sync push {action} {module}/{rec.get('id', '-')}")
    except json.JSONDecodeError:
        warn("record 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        warn(str(e))
        raise typer.Exit(2) from e


@app.command("enqueue")
def sync_enqueue_cmd(
    module: str = typer.Argument(..., help="tasks|requirements|issues|sprints|rules|specs|templates"),
    record_json: str = typer.Argument(..., help="JSON 记录；结构化须含 id，资产须含 path/content"),
    action: str = typer.Option("upsert", "--action", help="upsert|delete"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
) -> None:
    """把单条变更写入本地 push_queue，不访问 Manager。"""
    import json

    from .._util import console, ok, warn

    if module not in {"tasks", "requirements", "issues", "sprints", "rules", "specs", "templates"}:
        warn("未知模块")
        raise typer.Exit(2)
    if action not in {"upsert", "delete"}:
        warn("action 须为 upsert|delete")
        raise typer.Exit(2)
    try:
        rec = json.loads(record_json)
        if not isinstance(rec, dict):
            raise ValueError("record 须为 JSON object")
        item = _enqueue_item(module, rec, action=action, idempotency_key=idempotency_key)
        console.print_json(data=item)
        ok(f"sync enqueue {action} {module}/{rec.get('id') or rec.get('path')}")
    except json.JSONDecodeError:
        warn("record 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        warn(str(e))
        raise typer.Exit(2) from e


@app.command("push-file")
def sync_push_file(
    module: str = typer.Argument(..., help="rules|specs|templates"),
    path: str = typer.Argument(..., help="本地文件路径"),
    remote_path: str = typer.Option("", "--remote-path", help="写入 Manager 的相对路径；默认使用本地相对路径"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
) -> None:
    """推送单个规约/规则/模板文件，不需要手写 JSON。"""
    from pathlib import Path

    from .._util import console, get_client, get_config, ok, warn

    if module not in {"rules", "specs", "templates"}:
        warn("push-file 仅支持 rules|specs|templates")
        raise typer.Exit(2)
    cfg = get_config()
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = (cfg.project_path / p).resolve()
    if not p.is_file():
        warn(f"文件不存在: {p}")
        raise typer.Exit(2)
    try:
        rel = remote_path.strip() or p.relative_to(cfg.project_path).as_posix()
    except ValueError:
        rel = remote_path.strip() or p.name
    content = p.read_text(encoding="utf-8")
    try:
        r = get_client(cfg).sync_push(
            module,
            {"path": rel, "content": content},
            action="upsert",
            idempotency_key=idempotency_key,
        )
        console.print_json(data=r)
        ok(f"sync push-file {module}/{rel}")
    except Exception as e:
        warn(str(e))
        raise typer.Exit(2) from e


@app.command("enqueue-file")
def sync_enqueue_file(
    module: str = typer.Argument(..., help="rules|specs|templates"),
    path: str = typer.Argument(..., help="本地文件路径"),
    remote_path: str = typer.Option("", "--remote-path", help="写入 Manager 的相对路径；默认使用本地相对路径"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
) -> None:
    """把单个规则/规约/模板文件写入本地 push_queue，不访问 Manager。"""
    from pathlib import Path

    from .._util import console, get_config, ok, warn

    if module not in {"rules", "specs", "templates"}:
        warn("enqueue-file 仅支持 rules|specs|templates")
        raise typer.Exit(2)
    cfg = get_config()
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = (cfg.project_path / p).resolve()
    if not p.is_file():
        warn(f"文件不存在: {p}")
        raise typer.Exit(2)
    try:
        rel = remote_path.strip() or p.relative_to(cfg.project_path).as_posix()
    except ValueError:
        rel = remote_path.strip() or p.name
    if rel.startswith("/") or ".." in Path(rel).parts:
        warn("remote-path 必须是安全相对路径")
        raise typer.Exit(2)
    rec = {"path": rel, "content": p.read_text(encoding="utf-8")}
    try:
        item = _enqueue_item(module, rec, action="upsert", idempotency_key=idempotency_key)
        console.print_json(data={"module": item["module"], "action": item["action"], "path": rel})
        ok(f"sync enqueue-file {module}/{rel}")
    except Exception as e:
        warn(str(e))
        raise typer.Exit(2) from e


def _direct_sync_cycle() -> dict | None:
    """直连 Manager 执行 pull+push（login 后立即可用，不依赖 agentd 内存中的旧 token）。"""
    import json

    from .._util import get_client, get_config

    cfg = get_config()
    if not cfg.project_id:
        warn("agent.toml 未配置 project_id；可执行 sop login 或编辑 .sop-runtime/agent.toml")
        return None
    cli = get_client(cfg)
    q = _queue_path()
    flushed = {"sent": 0, "failed": 0}
    if q.is_file():
        raw_items, _bad = _load_queue_items()
        raw_items = _compact_queue_items(raw_items)
        pending: list[dict] = []
        for raw_item in raw_items:
            it: dict | None = raw_item
            try:
                if not isinstance(it, dict):
                    raise ValueError("bad queue item")
                cli.sync_push(
                    str(it.get("module") or ""),
                    dict(it.get("record") or {}),
                    action=str(it.get("action") or "upsert"),
                    idempotency_key=str(it.get("idempotency_key") or ""),
                )
                flushed["sent"] += 1
            except Exception:
                flushed["failed"] += 1
                if it is not None:
                    pending.append(it)
        _write_queue_items(pending)
    pull = cli.sync_pull(cursor="", modules="tasks,requirements,issues,sprints,rules,specs,templates")
    materialized = _materialize_pull_result(pull, write_assets=True)
    return {"pull": pull, "project_id": cfg.project_id, "flushed": flushed, "materialized": materialized}


@app.callback(invoke_without_command=True)
def sync(
    ctx: typer.Context,
    rules: bool = typer.Option(True, "--rules/--no-rules", help="同步规则库"),
    specs: bool = typer.Option(True, "--specs/--no-specs", help="同步规约文档"),
    knowledge: bool = typer.Option(False, "--knowledge", help="同步知识库（默认关闭，体量大）"),
    direct: bool = typer.Option(False, "--direct", help="跳过 agentd，直连 Manager"),
) -> None:
    if ctx.invoked_subcommand is not None:
        return

    if direct:
        r = _direct_sync_cycle()
        if r is None:
            raise typer.Exit(2)
        f = r.get("flushed") or {}
        ok(
            f"直连同步完成 project_id={r.get('project_id')} flushed={f.get('sent', 0)} "
            f"materialized={r.get('materialized', {})} total={r.get('pull', {}).get('total', 0)}"
        )
        return

    ipc = AgentdIpcClient()
    if not ipc.available():
        warn("sop-agentd 未运行，尝试直连 Manager…")
        r = _direct_sync_cycle()
        if r is not None:
            f = r.get("flushed") or {}
            ok(
                f"直连同步完成 project_id={r.get('project_id')} flushed={f.get('sent', 0)} "
                f"materialized={r.get('materialized', {})} total={r.get('pull', {}).get('total', 0)}"
            )
            return
        warn("启动 agentd：sop agentd start")
        raise typer.Exit(1)

    out = ipc.send("sync.trigger", data={"rules": rules, "specs": specs, "knowledge": knowledge})
    if out.get("ok"):
        summary = (out.get("result") or {}).get("summary") or out.get("summary", "-")
        ok(f"sync 已触发：{summary}")
        return

    err_msg = str(out.get("error", "-"))
    if "X-Project-Id" in err_msg or "绑定同步分区" in err_msg or "project_id" in err_msg.lower():
        warn("agentd 鉴权/项目作用域未就绪，尝试直连 Manager（已读取最新 login token）…")
        r = _direct_sync_cycle()
        if r is not None:
            f = r.get("flushed") or {}
            ok(
                f"直连同步完成 project_id={r.get('project_id')} flushed={f.get('sent', 0)} "
                f"materialized={r.get('materialized', {})} total={r.get('pull', {}).get('total', 0)}"
            )
            warn("建议重建 agentd 以使用 IPC 同步：sop agentd stop && sop agentd start")
            return

    err(f"sync 失败：{err_msg}")
    warn("若刚 sop login：sop agentd stop && sop agentd start，或 sop sync --direct")
    raise typer.Exit(2)
