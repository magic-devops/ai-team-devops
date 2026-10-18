"""
@module: sop_manager.sync_journal
@purpose: SQL 收件事实有界读取；旧内部 append 为独立日志，非送达权威
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_tenant_code,
)

_lock = threading.Lock()


def _journal_file() -> Path:
    base = resolved_ai_memory_root() / "sync-v4"
    base.mkdir(parents=True, exist_ok=True)
    t = resolved_tenant_code().replace("/", "_")[:80]
    b = (resolved_business_code() or "_").replace("/", "_")[:80]
    p = resolved_project_code().replace("/", "_")[:80]
    return base / f"{t}__{b}__{p}.jsonl"


def append_event(
    *,
    module: str,
    action: str,
    record_id: str,
    idempotency_key: str = "",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    evt = {
        "id": str(uuid.uuid4()),
        "ts": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "module": module,
        "action": action,
        "record_id": record_id,
        "idempotency_key": idempotency_key or None,
        "payload": payload or {},
    }
    line = json.dumps(evt, ensure_ascii=False) + "\n"
    path = _journal_file()
    with _lock:
        with path.open("a", encoding="utf-8") as f:
            f.write(line)
    return evt


def recent_events(*, since_ts: str = "", limit: int = 100) -> list[dict[str, Any]]:
    """Bounded current-scope SQL receipt projection; never imports legacy JSONL."""
    from sqlalchemy import select

    from sop_manager.path_config import resolved_project_id, resolved_tenant_id
    from sop_manager.routers.sql_models import EventInbox, SessionLocal

    with SessionLocal() as db:
        query = select(EventInbox).where(
            EventInbox.tenant_id == resolved_tenant_id(),
            EventInbox.project_id == resolved_project_id(),
        )
        if since_ts:
            try:
                lower = datetime.fromisoformat(since_ts.replace("Z", "+00:00"))
                if lower.tzinfo is not None:
                    lower = lower.astimezone(timezone.utc).replace(tzinfo=None)
            except ValueError:
                return []
            query = query.where(EventInbox.stored_at > lower)
        rows = db.scalars(query.order_by(EventInbox.seq.desc()).limit(max(1, min(limit, 500)))).all()
        return [{
            "id": row.id, "ts": row.stored_at.isoformat() + "Z", "module": "events",
            "action": row.event_type, "record_id": row.subject or row.event_id,
            "idempotency_key": row.event_id, "payload": json.loads(row.event_json),
        } for row in reversed(rows)]
