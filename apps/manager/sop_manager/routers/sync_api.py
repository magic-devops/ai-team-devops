"""
@module: routers.sync_api
@purpose: v4 游标拉取同步（任务/需求/缺陷等结构化数据；配合 agent-runtime Outbox）
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sop_manager.path_config import request_scope_active, resolved_project_id, resolved_tenant_id
from sop_manager.routers.sql_models import Issue, Requirement, Sprint, Task, get_session
from sop_manager.sync_journal import append_event, recent_events

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])

_SYNC_MODULES = frozenset({"tasks", "requirements", "issues", "sprints"})

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


@router.get("/pull")
def sync_pull(
    cursor: str = Query("", description="上次游标（ISO8601）；空则返回最近变更"),
    modules: str = Query("tasks,requirements,issues,sprints", description="逗号分隔模块名"),
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
    module: Literal["tasks", "requirements", "issues", "sprints"]
    action: Literal["upsert", "delete"] = "upsert"
    record: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = ""


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


@router.post("/push")
def sync_push(body: SyncPushIn, db: Session = Depends(get_session)) -> dict[str, Any]:
    pid = _require_scope()
    tid = resolved_tenant_id()
    if body.module not in _SYNC_MODULES:
        raise HTTPException(400, f"未知模块: {body.module}")
    rec = dict(body.record or {})
    rid = str(rec.get("id") or "").strip()
    if body.action == "upsert" and not rid:
        raise HTTPException(400, "upsert 需要 record.id")

    model_map = {
        "tasks": Task,
        "requirements": Requirement,
        "issues": Issue,
        "sprints": Sprint,
    }
    model = model_map[body.module]

    if body.action == "delete":
        if not rid:
            raise HTTPException(400, "delete 需要 record.id")
        row = db.query(model).filter_by(id=rid, project_id=pid).first()
        if row:
            db.delete(row)
            db.commit()
        evt = append_event(
            module=body.module,
            action="delete",
            record_id=rid,
            idempotency_key=body.idempotency_key,
        )
        _ws_sync_event(pid, body.module, "delete", rid)
        return {"ok": True, "action": "delete", "id": rid, "event_id": evt["id"]}

    row = db.query(model).filter_by(id=rid, project_id=pid).first()
    allowed = {c.name for c in model.__table__.columns}
    patch = {k: v for k, v in rec.items() if k in allowed and k not in ("id", "tenant_id", "project_id")}
    if row is None:
        row = model(id=rid, tenant_id=tid, project_id=pid)
        db.add(row)
    for k, v in patch.items():
        setattr(row, k, v)
    if hasattr(row, "updated_at"):
        row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    evt = append_event(
        module=body.module,
        action="upsert",
        record_id=rid,
        idempotency_key=body.idempotency_key,
        payload={"keys": list(patch.keys())},
    )
    _ws_sync_event(pid, body.module, "upsert", rid)
    return {"ok": True, "action": "upsert", "id": rid, "event_id": evt["id"], "record": _row_dict(row)}
