"""
@module: routers.events_ingest
@purpose: 接收 sop-agentd outbox 推送的事件，统一进 audit + 触发内部 EventBus
@stable: POST /api/v1/events:ingest 路径稳定；幂等键 = event_id
@ai_safe_edit:
  - 新增 event.type 处理：在 _HANDLERS 注册
  - 改 EventBus：替换 _publish 实现（Redis Streams / NATS）
"""
from __future__ import annotations

import logging
import time
from threading import RLock
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sop_manager.sync_journal import append_event, recent_events

router = APIRouter(prefix="/api/v1/events", tags=["events"])
_log = logging.getLogger("sop.events")

# 进程级幂等表（30 分钟窗口）；M9 改 Redis SETNX EX
_IDEMP: dict[str, float] = {}
_IDEMP_LOCK = RLock()
_IDEMP_TTL = 1800


def _idempotent(event_id: str) -> bool:
    """返回 True 表示首次见到；False 表示重复。"""
    now = time.time()
    with _IDEMP_LOCK:
        # 顺便清理过期
        if len(_IDEMP) > 10000:
            for k in list(_IDEMP.keys()):
                if _IDEMP[k] < now:
                    _IDEMP.pop(k, None)
        if event_id in _IDEMP and _IDEMP[event_id] > now:
            return False
        _IDEMP[event_id] = now + _IDEMP_TTL
        return True


class CloudEvent(BaseModel):
    specversion: str = "1.0"
    id: str
    type: str
    source: str = ""
    subject: str = ""
    time: str | None = None
    datacontenttype: str | None = "application/json"
    data: dict[str, Any] = Field(default_factory=dict)


class IngestIn(BaseModel):
    events: list[CloudEvent]


class IngestOut(BaseModel):
    accepted: list[str] = Field(default_factory=list)
    duplicated: list[str] = Field(default_factory=list)
    journal_ids: list[str] = Field(default_factory=list)


# ── 事件类型处理表 ───────────────────────────────────────────────
Handler = Callable[[CloudEvent], None]
_HANDLERS: dict[str, Handler] = {}


def register_handler(event_type: str) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        _HANDLERS[event_type] = fn
        return fn
    return deco


@register_handler("sop.agent.heartbeat")
def _on_heartbeat(e: CloudEvent) -> None:
    _log.info("heartbeat agent_id=%s outbox_depth=%s",
              e.data.get("agent_id"), (e.data.get("telemetry") or {}).get("outbox_depth"))


@register_handler("sop.tool.blocked")
def _on_blocked(e: CloudEvent) -> None:
    _log.warning("tool blocked: tool=%s reason=%s", e.data.get("tool"), e.data.get("reason"))


@register_handler("sop.reflection.added")
def _on_reflection(e: CloudEvent) -> None:
    """转写到 LanceDB rules / 反思表（沿用现有 db.py）。"""
    try:
        from sop_manager.routers.db import LanceOps  # type: ignore[import-not-found]
        LanceOps().add_rule(  # 暂复用 add_rule，M11 单独建 reflections 流
            rule=e.data.get("content", ""),
            category=e.data.get("category", "reflection"),
            source="agentd",
            confidence=float(e.data.get("confidence", 0.7)),
        )
    except Exception as err:  # pragma: no cover
        _log.warning("write reflection: %s", err)


@router.post(":ingest", response_model=IngestOut)
def ingest(body: IngestIn) -> IngestOut:
    if not body.events:
        raise HTTPException(400, "events 不能为空")
    out = IngestOut()
    for e in body.events:
        if not _idempotent(e.id):
            out.duplicated.append(e.id)
            continue
        try:
            handler = _HANDLERS.get(e.type)
            if handler:
                handler(e)
            journal = _publish(e)
            out.accepted.append(e.id)
            if journal.get("id"):
                out.journal_ids.append(str(journal["id"]))
        except Exception as err:  # pragma: no cover
            _log.warning("event %s handle failed: %s", e.id, err)
    return out


@router.get("")
def list_events(
    since: str = Query("", description="只返回 ts 大于该值的事件"),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    """查询统一事件流水，供 Web/CLI/Agent 断点续读。"""
    if not isinstance(since, str):
        since = ""
    if not isinstance(limit, int):
        limit = 100
    items = recent_events(since_ts=since, limit=limit)
    return {"items": items, "total": len(items), "cursor": items[-1]["ts"] if items else since}


def _event_payload(e: CloudEvent) -> dict[str, Any]:
    if hasattr(e, "model_dump"):
        return e.model_dump()  # pydantic v2
    return e.dict()  # pydantic v1


def _publish(e: CloudEvent) -> dict[str, Any]:
    """落入同步事件日志并转发给 WSS 订阅端。"""
    payload = _event_payload(e)
    evt = append_event(
        module="events",
        action=e.type,
        record_id=e.subject or e.id,
        idempotency_key=e.id,
        payload=payload,
    )
    try:
        from sop_manager.routers.ws_events import broadcast

        project_id = str(e.data.get("project_id") or e.data.get("project_code") or "")
        broadcast(project_id, {"type": e.type, "id": e.id, "subject": e.subject, "data": e.data, "journal": evt})
    except Exception as err:  # pragma: no cover
        _log.debug("ws broadcast skipped type=%s id=%s err=%s", e.type, e.id, err)
    _log.debug("event published type=%s id=%s subject=%s journal=%s", e.type, e.id, e.subject, evt.get("id"))
    return evt
