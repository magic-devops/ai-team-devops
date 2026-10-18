"""
@module: routers.sync_api
@purpose: v4 游标拉取同步（任务/需求/缺陷等结构化数据；配合 agent-runtime Outbox）
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime
from sqlalchemy.orm import Session

from sop_manager.path_config import (
    request_scope_active,
    resolved_project_id,
    resolved_project_path,
    resolved_tenant_id,
)
from sop_manager.routers.sql_models import Issue, Requirement, Sprint, Task, get_session
from sop_manager.sync_journal import recent_events

from .auth_sql import current_user_or_apikey
from .event_contract import EventResult
from .sql_models import User

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])

_STRUCTURED_MODULES = frozenset({"tasks", "requirements", "issues", "sprints"})
_ASSET_MODULES = frozenset({"rules", "specs", "templates"})
_SYNC_MODULES = _STRUCTURED_MODULES | _ASSET_MODULES
_MODULE_META: dict[str, dict[str, Any]] = {
    "tasks": {"kind": "structured", "cursor_field": "updated_at", "description": "研发任务与看板状态"},
    "requirements": {"kind": "structured", "cursor_field": "updated_at", "description": "需求、验收标准与优先级"},
    "issues": {"kind": "structured", "cursor_field": "created_at", "description": "缺陷、阻塞与问题闭环"},
    "sprints": {"kind": "structured", "cursor_field": "started_at", "description": "迭代与进度快照"},
    "rules": {"kind": "asset", "cursor_field": "updated_at", "description": "团队规约、AI 行为规则与质量规则"},
    "specs": {"kind": "asset", "cursor_field": "updated_at", "description": "开发规范、架构规范与业务规约"},
    "templates": {"kind": "asset", "cursor_field": "updated_at", "description": "项目模板、提示词模板与初始化资产"},
}

# 游标过滤用的时间列（Issue/Sprint 无 updated_at）
_TIME_COL = {
    "tasks": "updated_at",
    "requirements": "updated_at",
    "issues": "created_at",
    "sprints": "started_at",
}


def _parse_cursor(cursor: str) -> datetime | None:
    c = (cursor or "").strip()
    if not c:
        return None
    s = c.replace("Z", "").split("+")[0].strip()
    try:
        if "T" in s and len(s) >= 19:
            return datetime.fromisoformat(s[:19])
        if len(s) == 10:
            return datetime.fromisoformat(s + "T00:00:00")
    except ValueError:
        pass
    raise HTTPException(400, "cursor 须为 ISO8601 时间戳（如 2026-05-15T12:00:00）")


def _iso(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.replace(microsecond=0).isoformat()


def _row_dict(row: Any) -> dict[str, Any]:
    d: dict[str, Any] = {}
    for col in row.__table__.columns:
        v = getattr(row, col.name)
        if hasattr(v, "isoformat"):
            d[col.name] = v.isoformat()
        else:
            d[col.name] = v
    return d


def _coerce_column_value(col: Any, value: Any) -> Any:
    if value is None:
        return None
    if isinstance(col.type, DateTime) and isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "").split("+")[0][:19])
        except ValueError:
            raise HTTPException(400, f"{col.name} 须为 ISO8601 时间戳") from None
    return value


def _asset_roots(root: Path, module: str) -> list[Path]:
    if module == "rules":
        return [root / ".ai-memory" / "rules", root / "ai-sop" / "agents", root / "ai-sop" / "quality"]
    if module == "specs":
        return [root / "ai-sop" / "specs", root / "sop" / "custom" / "specs"]
    if module == "templates":
        return [root / "ai-sop" / "templates", root / "sop" / "custom"]
    return []


def _asset_write_root(root: Path, module: str) -> Path:
    if module == "rules":
        return root / ".ai-memory" / "rules"
    if module == "specs":
        return root / "sop" / "custom" / "specs"
    if module == "templates":
        return root / "sop" / "custom"
    raise HTTPException(400, f"未知资产模块: {module}")


def _asset_target_path(module: str, rec: dict[str, Any]) -> tuple[Path, str]:
    root = resolved_project_path().resolve()
    raw = str(rec.get("path") or rec.get("id") or "").strip()
    if not raw:
        raise HTTPException(400, "资产 push 需要 record.path 或 record.id")
    if "\x00" in raw:
        raise HTTPException(400, "非法资产路径")
    rel = Path(raw)
    if rel.is_absolute() or ".." in rel.parts:
        raise HTTPException(400, "资产路径必须是项目内相对路径且不能包含 ..")
    if rel.suffix.lower() not in {".md", ".json", ".yaml", ".yml", ".toml"}:
        raise HTTPException(400, "资产仅允许 md/json/yaml/yml/toml")

    allowed = [_asset_write_root(root, module).resolve()]
    candidate = (root / rel).resolve()
    for base in allowed:
        try:
            candidate.relative_to(base)
            return candidate, candidate.relative_to(root).as_posix()
        except ValueError:
            continue

    target = (allowed[0] / rel).resolve()
    try:
        target.relative_to(allowed[0])
    except ValueError as e:
        raise HTTPException(400, "非法资产路径") from e
    return target, target.relative_to(root).as_posix()


def _asset_rows(module: str, since: datetime | None, limit: int) -> list[dict[str, Any]]:
    root = resolved_project_path().resolve()
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for base in _asset_roots(root, module):
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if len(out) >= limit:
                return out
            if not path.is_file() or path.suffix.lower() not in {".md", ".json", ".yaml", ".yml", ".toml"}:
                continue
            try:
                stat = path.stat()
                updated = datetime.fromtimestamp(stat.st_mtime)
                if since is not None and updated <= since:
                    continue
                rel = path.relative_to(root).as_posix()
                if rel in seen:
                    continue
                seen.add(rel)
                content = path.read_text(encoding="utf-8", errors="replace")
                if len(content) > 256_000:
                    content = content[:256_000]
                out.append(
                    {
                        "id": rel,
                        "module": module,
                        "path": rel,
                        "size": stat.st_size,
                        "updated_at": _iso(updated),
                        "content": content,
                    }
                )
            except OSError:
                continue
    return out


def _asset_count(module: str) -> dict[str, Any]:
    root = resolved_project_path().resolve()
    count = 0
    bytes_total = 0
    newest = ""
    for base in _asset_roots(root, module):
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".md", ".json", ".yaml", ".yml", ".toml"}:
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            count += 1
            bytes_total += stat.st_size
            updated = _iso(datetime.fromtimestamp(stat.st_mtime))
            if updated > newest:
                newest = updated
    return {"count": count, "bytes": bytes_total, "newest": newest}


def _require_scope() -> str:
    if not request_scope_active():
        raise HTTPException(
            400,
            detail="需要登录且携带 X-Project-Id 以绑定同步分区",
        )
    pid = resolved_project_id()
    if not pid:
        raise HTTPException(400, detail="未解析到 project_id")
    return pid


def _parse_modules(modules: str) -> list[str]:
    pick = {x.strip() for x in (modules or "").split(",") if x.strip()}
    if not pick:
        return sorted(_SYNC_MODULES)
    bad = pick - _SYNC_MODULES
    if bad:
        raise HTTPException(400, f"未知模块: {', '.join(sorted(bad))}")
    return sorted(pick)


@router.get("/health")
def sync_health() -> dict[str, Any]:
    return {"ok": True, "service": "sync", "modules": sorted(_SYNC_MODULES)}


@router.get("/modules")
def sync_modules() -> dict[str, Any]:
    return {
        "ok": True,
        "items": [
            {"id": name, **_MODULE_META[name]}
            for name in sorted(_SYNC_MODULES)
        ],
    }


@router.get("/summary")
def sync_summary(db: Session = Depends(get_session)) -> dict[str, Any]:
    pid = _require_scope()
    model_map = {
        "tasks": Task,
        "requirements": Requirement,
        "issues": Issue,
        "sprints": Sprint,
    }
    modules: list[dict[str, Any]] = []
    for name in sorted(_SYNC_MODULES):
        meta = dict(_MODULE_META[name])
        if name in _ASSET_MODULES:
            stats = _asset_count(name)
            modules.append({"id": name, **meta, **stats})
            continue
        model = model_map[name]
        newest = ""
        try:
            count = db.query(model).filter_by(project_id=pid).count()
            time_col = getattr(model, _TIME_COL[name])
            row = db.query(model).filter_by(project_id=pid).order_by(time_col.desc()).first()
            if row:
                newest = _iso(getattr(row, _TIME_COL[name], None))
        except Exception:
            count = 0
        modules.append({"id": name, **meta, "count": count, "bytes": 0, "newest": newest})

    journal = recent_events(limit=100)
    by_module = Counter(str(x.get("module") or "unknown") for x in journal)
    by_action = Counter(str(x.get("action") or "unknown") for x in journal)
    return {
        "ok": True,
        "project_id": pid,
        "tenant_id": resolved_tenant_id(),
        "modules": modules,
        "journal": {
            "total": len(journal),
            "by_module": dict(by_module),
            "by_action": dict(by_action),
            "latest": journal[:20],
        },
        "wss": {"path": "/ws/events", "event_prefix": "sop.sync."},
    }


@router.get("/pull")
def sync_pull(
    cursor: str = Query("", description="上次游标（ISO8601）；空则返回最近变更"),
    modules: str = Query("tasks,requirements,issues,sprints,rules,specs,templates", description="逗号分隔模块名"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    pid = _require_scope()
    since = _parse_cursor(cursor)
    names = _parse_modules(modules)
    changes: dict[str, list[dict[str, Any]]] = {}
    max_dt: datetime | None = since

    model_map = {
        "tasks": Task,
        "requirements": Requirement,
        "issues": Issue,
        "sprints": Sprint,
    }
    for name in names:
        if name in _ASSET_MODULES:
            asset_rows = _asset_rows(name, since, limit)
            changes[name] = asset_rows
            for r in asset_rows:
                raw = r.get("updated_at")
                if not raw:
                    continue
                try:
                    dt = datetime.fromisoformat(str(raw).replace("Z", "")[:19])
                except ValueError:
                    continue
                if max_dt is None or dt > max_dt:
                    max_dt = dt
            continue
        model = model_map[name]
        time_col = getattr(model, _TIME_COL[name])
        q = db.query(model).filter_by(project_id=pid)
        if since is not None:
            q = q.filter(time_col > since)
        q = q.order_by(time_col.asc()).limit(limit)
        rows = [_row_dict(r) for r in q.all()]
        changes[name] = rows
        for r in rows:
            raw = r.get(_TIME_COL[name])
            if not raw:
                continue
            try:
                dt = datetime.fromisoformat(str(raw).replace("Z", "")[:19])
            except ValueError:
                continue
            if max_dt is None or dt > max_dt:
                max_dt = dt

    new_cursor = _iso(max_dt) if max_dt else (cursor or _iso(datetime.utcnow()))
    total = sum(len(v) for v in changes.values())
    return {
        "ok": True,
        "cursor": new_cursor,
        "previous_cursor": cursor,
        "project_id": pid,
        "total": total,
        "changes": changes,
    }


class SyncPushIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    module: Literal["tasks", "requirements", "issues", "sprints", "rules", "specs", "templates"]
    action: Literal["upsert", "delete"] = "upsert"
    record: dict[str, Any]
    expected_version: int = Field(ge=0, strict=True)
    idempotency_key: str = Field(min_length=1, max_length=128)


def _ws_sync_event(pid: str, module: str, action: str, record_id: str) -> None:
    try:
        from sop_manager.routers.ws_events import broadcast

        broadcast(
            pid,
            {
                "specversion": "1.0",
                "type": f"sop.sync.{module}.{action}",
                "source": "manager/sync",
                "id": record_id,
                "data": {"module": module, "action": action, "record_id": record_id},
            },
        )
    except Exception:
        pass


@router.get("/journal")
def sync_journal(
    since: str = Query("", description="ISO8601 事件时间下界"),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    _require_scope()
    items = recent_events(since_ts=since, limit=limit)
    return {"ok": True, "items": items, "total": len(items)}


@router.post("/push", response_model=EventResult)
def sync_push(
    body: SyncPushIn,
    request: Request,
    user: Annotated[User, Depends(current_user_or_apikey)],
    db: Session = Depends(get_session),
    project_id: str = Header(default="", alias="X-Project-Id"),
) -> dict[str, Any]:
    """Direct sync shares the original durable inbox and canonical processor."""
    import json

    from sqlalchemy import select

    from .event_common import authorize, date, digest, now, scope_key
    from .event_contract import IngestIn
    from .events_ingest import ingest
    from .sql_models import EventInbox

    project, actor, _, _ = authorize(db, user, project_id, request)
    eid = "sync-" + digest(json.dumps([project.tenant_id, project.id, actor.id, body.idempotency_key]))
    previous = db.scalar(select(EventInbox).where(EventInbox.scope_key == scope_key(project, actor.id, eid)))
    event = {
        "specversion": "1.0", "id": eid, "type": "sop.sync.push", "source": "manager.sync",
        "subject": str(body.record.get("id") or ""),
        "time": previous.event_time if previous else date(now()),
        "datacontenttype": "application/json",
        "data": body.model_dump(exclude={"idempotency_key"}),
    }
    raw = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    incoming = IngestIn(expected_tenant_id=project.tenant_id, expected_project_id=project.id, expected_producer_id=actor.id, events=[{"id":eid,"event_json":raw,"digest":digest(raw)}])
    result = ingest(incoming, actor, db, request, project.id)["results"][0]
    if result["outcome"] == "rejected":
        raise HTTPException(409, result["error"])
    return result
