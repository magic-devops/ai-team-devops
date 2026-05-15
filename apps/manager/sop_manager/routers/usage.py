"""
@module: routers.usage
@purpose: 租户/项目用量计量与配额底座（本地 ledger，可演进为 SQL/ClickHouse）
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
    resolved_tenant_id,
)

router = APIRouter(prefix="/api/v1/usage", tags=["usage"])
_lock = threading.Lock()


class UsageIn(BaseModel):
    metric: str = Field(..., min_length=1, description="tokens|cost_usd|storage_bytes|worker_seconds|event_count|...")
    value: float = Field(..., ge=0)
    unit: str = ""
    source: str = "manager"
    subject: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = ""


class QuotaIn(BaseModel):
    limits: dict[str, float] = Field(default_factory=dict)


class UsageCheckIn(BaseModel):
    metric: str = Field(..., min_length=1)
    delta: float = Field(..., ge=0)
    source: str = "manager"
    subject: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


def _usage_dir() -> Path:
    base = resolved_ai_memory_root() / "usage-v1"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _scope_key() -> str:
    t = resolved_tenant_code().replace("/", "_")[:80]
    b = (resolved_business_code() or "_").replace("/", "_")[:80]
    p = resolved_project_code().replace("/", "_")[:80]
    return f"{t}__{b}__{p}"


def _ledger_file() -> Path:
    return _usage_dir() / f"{_scope_key()}.jsonl"


def _quota_file() -> Path:
    return _usage_dir() / f"{_scope_key()}.quota.json"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_rows(limit: int = 5000) -> list[dict[str, Any]]:
    path = _ledger_file()
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
        if len(rows) >= limit:
            break
    return list(reversed(rows))


def record_usage_event(body: UsageIn | dict[str, Any]) -> dict[str, Any]:
    data = body.model_dump() if hasattr(body, "model_dump") else dict(body)
    row = {
        "id": f"use-{uuid.uuid4().hex}",
        "ts": _now(),
        "tenant_id": resolved_tenant_id(),
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
        "metric": str(data.get("metric") or ""),
        "value": float(data.get("value") or 0),
        "unit": str(data.get("unit") or ""),
        "source": str(data.get("source") or "manager"),
        "subject": str(data.get("subject") or ""),
        "metadata": data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
        "idempotency_key": str(data.get("idempotency_key") or ""),
    }
    path = _ledger_file()
    line = json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
    with _lock:
        with path.open("a", encoding="utf-8") as f:
            f.write(line)
    return row


def _quota() -> dict[str, Any]:
    path = _quota_file()
    if not path.is_file():
        return {"limits": {}, "updated_at": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"limits": {}, "updated_at": None}
    return data if isinstance(data, dict) else {"limits": {}, "updated_at": None}


def _summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    totals: dict[str, float] = {}
    by_source: dict[str, dict[str, float]] = {}
    for row in rows:
        metric = str(row.get("metric") or "")
        value = float(row.get("value") or 0)
        source = str(row.get("source") or "-")
        totals[metric] = totals.get(metric, 0.0) + value
        by_source.setdefault(source, {})
        by_source[source][metric] = by_source[source].get(metric, 0.0) + value
    quota = _quota()
    limits = quota.get("limits") if isinstance(quota.get("limits"), dict) else {}
    remaining = {
        k: float(v) - float(totals.get(k, 0.0))
        for k, v in limits.items()
        if isinstance(v, int | float)
    }
    return {"totals": totals, "by_source": by_source, "quota": quota, "remaining": remaining}


def check_usage_quota(metric: str, delta: float = 0.0, *, limit_rows: int = 20000) -> dict[str, Any]:
    rows = _read_rows(limit=limit_rows)
    summary = _summarize(rows)
    totals = summary["totals"]
    quota = summary["quota"]
    limits = quota.get("limits") if isinstance(quota.get("limits"), dict) else {}
    current = float(totals.get(metric, 0.0))
    limit = limits.get(metric)
    unlimited = limit is None
    remaining = None if unlimited else float(limit) - current
    allowed = True if unlimited else current + float(delta) <= float(limit)
    return {
        "ok": True,
        "allowed": allowed,
        "metric": metric,
        "current": current,
        "delta": float(delta),
        "limit": None if unlimited else float(limit),
        "remaining": remaining,
        "would_remaining": None if unlimited else float(limit) - current - float(delta),
        "quota": quota,
    }


@router.post("/record")
def record_usage(body: UsageIn) -> dict[str, Any]:
    row = record_usage_event(body)
    return {"ok": True, "record": row}


@router.get("/summary")
def usage_summary(
    since: str = Query("", description="只统计 ts 大于该值的记录"),
    limit: int = Query(5000, ge=1, le=20000),
) -> dict[str, Any]:
    if not isinstance(since, str):
        since = ""
    if not isinstance(limit, int):
        limit = 5000
    rows = _read_rows(limit=limit)
    if since:
        rows = [r for r in rows if str(r.get("ts") or "") > since]
    summary = _summarize(rows)
    return {"ok": True, "items": rows, "total": len(rows), **summary}


@router.get("/quota")
def get_quota() -> dict[str, Any]:
    return {"ok": True, **_quota()}


@router.post("/check")
def check_usage(body: UsageCheckIn) -> dict[str, Any]:
    return check_usage_quota(body.metric, body.delta)


@router.put("/quota")
def set_quota(body: QuotaIn) -> dict[str, Any]:
    payload = {"limits": body.limits, "updated_at": _now()}
    path = _quota_file()
    with _lock:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, **payload}
