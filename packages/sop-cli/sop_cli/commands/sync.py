"""
@module: sop_cli.commands.sync
@purpose: 明确原意图入队、只读资产发现和远端缓存拉取
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer
from sop_sdk import AgentdIpcClient

from .._util import err, ok, warn

app = typer.Typer(help="一次性同步（规约/规则/知识）")


def _sync_root(config=None) -> Path:
    from .._util import get_config
    from ..asset_plans import safe_project_path

    return safe_project_path((config or get_config()).project_path, ".sop-runtime/sync")


def _safe_asset_target(module: str, rel: str, *, config=None) -> Path | None:
    from .._util import get_config
    from ..asset_plans import asset_target

    try:
        return asset_target((config or get_config()).project_path, module, rel)
    except (OSError, ValueError, TypeError):
        return None


def _prepare_pull_module(cfg, module, rows, entities, *, write_assets):
    import json

    from ..asset_plans import safe_project_path

    if not isinstance(rows, list):
        raise ValueError("Pull module must contain a list")
    cache = safe_project_path(cfg.project_path, entities / (module + ".json"))
    current = json.loads(cache.read_bytes().decode("utf-8")) if cache.is_file() else {}
    if not isinstance(current, dict):
        raise ValueError("Pulled entity cache is not an object")
    assets = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Pull record must be an object")
        identity = row.get("id") or row.get("path")
        if not isinstance(identity, str) or not identity or identity != identity.strip():
            raise ValueError("Pull record requires an explicit id or path")
        if write_assets and module in {"rules", "specs", "templates"} and "content" in row:
            target = _safe_asset_target(module, row.get("path") or row.get("id"), config=cfg)
            if target is None or not isinstance(row["content"], str):
                raise ValueError("Pull result contains an unsafe asset target or content")
            assets.append((target, row["content"].encode("utf-8", errors="strict")))
        current[identity] = row
    return module, cache, current, assets, len(rows)


def _materialize_pull_result(result: dict, *, write_assets: bool = True, config=None) -> dict[str, int]:
    """Write only explicit module caches and safe project-local asset targets."""
    import json
    from datetime import datetime, timezone

    from .._util import get_config
    from ..asset_plans import replace_project_bytes, safe_project_path

    cfg = config or get_config()
    changes = result.get("changes") if isinstance(result, dict) else None
    if not isinstance(changes, dict):
        return {}
    if result.get("project_id", cfg.project_id) != cfg.project_id:
        raise ValueError("Pull result does not match the configured project")
    allowed = {"tasks", "requirements", "issues", "sprints", "rules", "specs", "templates"}
    if not set(changes) <= allowed:
        raise ValueError("Pull result contains an unsupported module")
    root = _sync_root(cfg)
    entities = safe_project_path(cfg.project_path, root / "entities")
    prepared = [
        _prepare_pull_module(cfg, module, rows, entities, write_assets=write_assets)
        for module, rows in changes.items()
    ]
    state_path = safe_project_path(cfg.project_path, ".sop-runtime/sync_state.json")
    counts = {}
    entities.mkdir(parents=True, exist_ok=True)
    for module, cache, current, assets, count in prepared:
        for target, content in assets:
            replace_project_bytes(cfg.project_path, target, content)
        replace_project_bytes(
            cfg.project_path,
            cache,
            (json.dumps(current, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        )
        counts[module] = count
    state = {
        "cursor": result.get("cursor") or "",
        "last_pull_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "last_total": result.get("total", sum(counts.values())),
        "project_id": cfg.project_id,
    }
    replace_project_bytes(
        cfg.project_path, state_path, (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    )
    return counts


def _scan_watch_files(
    modules: set[str], *, include: list[str] | None = None, allow_missing: bool = False, config=None
) -> dict[str, dict]:
    from .._util import get_config
    from ..asset_plans import scan_assets

    return scan_assets(
        (config or get_config()).project_path, modules, include=include, allow_missing=allow_missing
    )


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
    materialize: bool = typer.Option(
        False, "--materialize", help="把 pull 结果物化到 .sop-runtime/sync/entities"
    ),
    write_assets: bool = typer.Option(
        True, "--write-assets/--no-write-assets", help="materialize 时同步写回规则/规约/模板文件"
    ),
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
        counts = _materialize_pull_result(r, write_assets=write_assets, config=cfg)
        ok(f"已物化 pull 结果: {counts}")
    else:
        console.print_json(data=r)


def _sync_read_status() -> dict:
    import json

    from .._util import get_config
    from ..asset_plans import safe_project_path
    from .event import _legacy_files, queue_health

    cfg = get_config()
    state_path = safe_project_path(cfg.project_path, ".sop-runtime/sync_state.json")
    state = json.loads(state_path.read_bytes().decode("utf-8")) if state_path.is_file() else None
    entities = safe_project_path(cfg.project_path, ".sop-runtime/sync/entities")
    caches = {}
    for module in ("tasks", "requirements", "issues", "sprints", "rules", "specs", "templates"):
        path = safe_project_path(cfg.project_path, entities / (module + ".json"))
        if path.is_file():
            try:
                data = json.loads(path.read_bytes().decode("utf-8"))
                caches[module] = {
                    "count": len(data) if isinstance(data, dict) else None,
                    "kind": "read_only_remote_cache",
                }
            except (ValueError, UnicodeError):
                caches[module] = {"count": None, "error": "invalid_cache", "kind": "read_only_remote_cache"}
    return {
        "project_id": cfg.project_id,
        "pull_state": state,
        "caches": caches,
        "outbox": queue_health(cfg.project_path, cfg.outbox_path),
        "legacy_files": _legacy_files(cfg.project_path),
        "legacy_auto_flush": False,
    }


@app.command("status")
def sync_status() -> None:
    """Read current queue health, remote caches and untouched historical files."""
    from .._util import console

    try:
        console.print_json(data=_sync_read_status())
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("doctor")
def sync_doctor() -> None:
    """Inspect current storage; never rewrite original intents or historical files."""
    sync_status()


@app.command("flush")
def sync_flush(
    limit: int = typer.Option(20, "--limit", min=1, max=50),
    dry_run: bool = typer.Option(False, "--dry-run"),
) -> None:
    """冲刷唯一 SQLite 队列；旧 JSONL 仅保留待人工检查。"""
    from sop_sdk.event_outbox import EventOutbox

    from .._util import console
    from .event import _flush, _legacy_files, _outbox_path

    try:
        if dry_run:
            with EventOutbox(_outbox_path()) as box:
                console.print_json(
                    data={"queue": box.list(state="pending", limit=limit), "legacy_files": _legacy_files()}
                )
        else:
            console.print_json(data=_flush(limit))
        if _legacy_files():
            warn("发现旧文件；不会自动发送、改写或绑定。请检查原意和版本后以 event enqueue-file 明确入队。")
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


def _submit_sync(module, record, action, key, event_time, expected_version, *, local, config=None, **basis):
    from .._util import get_config
    from ..local_intents import submit_record

    return submit_record(
        config or get_config(),
        module,
        record,
        action=action,
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        local=local,
        **basis,
    )


@app.command("push")
def sync_push_cmd(
    module: str,
    record_json: str,
    expected_version: int = typer.Option(..., "--expected-version", min=0),
    idempotency_key: str = typer.Option(..., "--key", "--idempotency-key"),
    event_time: str = typer.Option(..., "--time"),
    action: str = typer.Option("upsert", "--action"),
    task_basis: str | None = typer.Option(None, "--task-basis"),
    requirement_basis: str | None = typer.Option(None, "--requirement-basis"),
    change_preview_basis: str | None = typer.Option(None, "--change-preview-basis"),
) -> None:
    """Persist the explicit original intent, then report actual delivery/processing."""
    from sop_sdk.event_envelope import strict_json

    from .._util import console

    try:
        record = strict_json(record_json)
        result = _submit_sync(
            module,
            record,
            action,
            idempotency_key,
            event_time,
            expected_version,
            local=False,
            task_basis=task_basis,
            requirement_basis=requirement_basis,
            change_preview_basis=change_preview_basis,
        )
        console.print_json(data=result)
        if not result["ok"]:
            raise typer.Exit(2)
    except typer.Exit:
        raise
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("enqueue")
def sync_enqueue_cmd(
    module: str,
    record_json: str,
    expected_version: int = typer.Option(..., "--expected-version", min=0),
    idempotency_key: str = typer.Option(..., "--key", "--idempotency-key"),
    event_time: str = typer.Option(..., "--time"),
    action: str = typer.Option("upsert", "--action"),
    task_basis: str | None = typer.Option(None, "--task-basis"),
    requirement_basis: str | None = typer.Option(None, "--requirement-basis"),
    change_preview_basis: str | None = typer.Option(None, "--change-preview-basis"),
) -> None:
    """Queue one explicit original operation without sending it."""
    from sop_sdk.event_envelope import strict_json

    from .._util import console

    try:
        console.print_json(
            data=_frozen_sync(
                module,
                strict_json(record_json),
                action,
                idempotency_key,
                event_time,
                expected_version,
                task_basis=task_basis,
                requirement_basis=requirement_basis,
                change_preview_basis=change_preview_basis,
            )
        )
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("push-file")
def sync_push_file(
    module: str,
    path: str,
    expected_version: int = typer.Option(..., "--expected-version", min=0),
    idempotency_key: str = typer.Option(..., "--key", "--idempotency-key"),
    event_time: str = typer.Option(..., "--time"),
    expected_sha256: str = typer.Option(..., "--expected-sha256"),
    remote_path: str = typer.Option("", "--remote-path"),
) -> None:
    """Push exact UTF-8 file bytes against an explicit original remote digest."""
    from .._util import console, get_config
    from ..asset_plans import parse_expected_sha256

    try:
        cfg = get_config()
        record = {
            **_sync_file_record(module, path, remote_path, config=cfg),
            "expected_sha256": parse_expected_sha256(expected_sha256),
        }
        result = _submit_sync(
            module, record, "upsert", idempotency_key, event_time, expected_version, local=False, config=cfg
        )
        console.print_json(data=result)
        if not result["ok"]:
            raise typer.Exit(2)
    except typer.Exit:
        raise
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("enqueue-file")
def sync_enqueue_file(
    module: str,
    path: str,
    expected_version: int = typer.Option(..., "--expected-version", min=0),
    idempotency_key: str = typer.Option(..., "--key", "--idempotency-key"),
    event_time: str = typer.Option(..., "--time"),
    expected_sha256: str = typer.Option(..., "--expected-sha256"),
    remote_path: str = typer.Option("", "--remote-path"),
) -> None:
    from .._util import console, get_config
    from ..asset_plans import parse_expected_sha256

    try:
        cfg = get_config()
        record = {
            **_sync_file_record(module, path, remote_path, config=cfg),
            "expected_sha256": parse_expected_sha256(expected_sha256),
        }
        console.print_json(
            data=_frozen_sync(
                module, record, "upsert", idempotency_key, event_time, expected_version, config=cfg
            )
        )
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("enqueue-plan")
def sync_enqueue_plan(
    file: str,
    entry: str = typer.Option(..., "--entry"),
    expected_version: int = typer.Option(..., "--expected-version", min=0),
    key: str = typer.Option(..., "--key"),
    event_time: str = typer.Option(..., "--time"),
    expected_sha256: str = typer.Option(..., "--expected-sha256"),
) -> None:
    """Queue exactly one reviewed original snapshot; never reread its source file."""
    from .._util import console, get_config
    from ..asset_plans import load_plan, parse_expected_sha256, selector

    try:
        cfg = get_config()
        plan = load_plan(cfg.project_path, cfg.project_id, file)
        module, relative = selector(entry)
        chosen = next(
            (row for row in plan["entries"] if row["module"] == module and row["path"] == relative), None
        )
        if chosen is None:
            raise ValueError("Selected module:path was not present in the complete reviewed plan")
        record = {"path": relative, "expected_sha256": parse_expected_sha256(expected_sha256)}
        if chosen["action"] == "upsert":
            record["content"] = chosen["content"]
        console.print_json(
            data=_frozen_sync(module, record, chosen["action"], key, event_time, expected_version, config=cfg)
        )
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


@app.command("watch")
def sync_watch(
    modules: str = typer.Option("rules,specs,templates", "--modules", "-m"),
    once: bool = typer.Option(False, "--once"),
    interval: float = typer.Option(2.0, "--interval", min=0.5),
    include: Annotated[
        list[str] | None,
        typer.Option("--include", help="Exact module:path to include; repeat for multiple files"),
    ] = None,
    out_dir: str = typer.Option(
        "", "--out-dir", help="Explicit project-local directory for new reviewed snapshot files"
    ),
) -> None:
    """Discover byte-preserving review snapshots; never enqueue or send changes."""
    import time

    from .._util import console, get_config
    from ..asset_plans import make_plan, plan_directory, save_plan

    selected = {value.strip() for value in modules.split(",") if value.strip()}
    previous = None
    try:
        cfg = get_config()
        if out_dir:
            plan_directory(cfg.project_path, out_dir)
        while True:
            current = _scan_watch_files(
                selected, include=include, allow_missing=previous is not None, config=cfg
            )
            plan = make_plan(cfg.project_path, cfg.project_id, current, previous)
            if out_dir:
                saved = save_plan(cfg.project_path, cfg.project_id, plan, out_dir)
                typer.echo("Snapshot saved: " + str(saved), err=True)
            console.print_json(data=plan)
            previous = current
            if once:
                return
            time.sleep(interval)
    except KeyboardInterrupt:
        return
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(2) from exc


def _direct_sync_cycle() -> dict | None:
    """Read remote data and flush only frozen SQLite intents; never replay legacy JSONL."""
    from .._util import get_client, get_config
    from .event import _flush, _legacy_files

    cfg = get_config()
    if not cfg.project_id:
        warn("请先明确项目")
        return None
    flushed = _flush(20, config=cfg)
    pull = get_client(cfg).sync_pull(
        cursor="", modules="tasks,requirements,issues,sprints,rules,specs,templates"
    )
    materialized = _materialize_pull_result(pull, write_assets=True, config=cfg)
    return {
        "pull": pull,
        "project_id": cfg.project_id,
        "flushed": flushed,
        "materialized": materialized,
        "legacy_files": _legacy_files(cfg.project_path),
    }


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


def _frozen_sync(module, record, action, key, event_time, expected_version, *, config=None, **basis):
    from sop_sdk.event_outbox import EventOutbox
    from sop_sdk.record_intents import freeze_record_intent

    from .._util import get_config

    cfg = config or get_config()
    frozen = freeze_record_intent(
        module,
        record,
        action=action,
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        **basis,
    )
    with EventOutbox(cfg.project_path / cfg.outbox_path) as box:
        return box.enqueue(frozen, cfg.project_id)


def _sync_file_record(module, path, remote_path, *, config=None):
    from .._util import get_config
    from ..asset_plans import file_record

    return file_record((config or get_config()).project_path, module, path, remote_path)
