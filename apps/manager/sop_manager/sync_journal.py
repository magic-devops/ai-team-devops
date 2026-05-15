"""
@module: sop_manager.sync_journal
@purpose: v4 同步事件日志（Outbox 对账、WSS 补发）
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
    path = _journal_file()
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if since_ts and str(obj.get("ts", "")) <= since_ts:
            continue
        out.append(obj)
        if len(out) >= limit:
            break
    return list(reversed(out))
