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


class UsageAlertTasksIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=50)
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Ops"
    dev_tool: str = "copilot"


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


def _usage_alerts(summary: dict[str, Any]) -> list[dict[str, Any]]:
    totals = summary.get("totals") if isinstance(summary.get("totals"), dict) else {}
    quota = summary.get("quota") if isinstance(summary.get("quota"), dict) else {}
    limits = quota.get("limits") if isinstance(quota.get("limits"), dict) else {}
    alerts: list[dict[str, Any]] = []
    for metric, limit_raw in limits.items():
        if not isinstance(limit_raw, int | float) or float(limit_raw) <= 0:
            continue
        used = float(totals.get(metric, 0.0))
        limit = float(limit_raw)
        ratio = round((used / limit) * 100, 2)
        remaining = limit - used
        if ratio >= 100:
            level = "critical"
            recommendation = "已超过配额，建议立即扩容、清理异常调用或暂停非关键任务。"
        elif ratio >= 90:
            level = "high"
            recommendation = "配额即将耗尽，建议确认高消耗来源并制定扩容或降载方案。"
        elif ratio >= 75:
            level = "medium"
            recommendation = "配额使用偏高，建议关注趋势并提前规划容量。"
        else:
            continue
        alerts.append({
            "id": f"quota-{metric}",
            "metric": metric,
            "level": level,
            "used": used,
            "limit": limit,
            "remaining": remaining,
            "ratio": ratio,
            "recommendation": recommendation,
        })
    alerts.sort(key=lambda x: ({"critical": 0, "high": 1, "medium": 2}.get(str(x["level"]), 9), -float(x["ratio"])))
    return alerts


def _usage_alert_task_payload(alert: dict[str, Any], body: UsageAlertTasksIn) -> dict[str, Any]:
    metric = str(alert.get("metric") or "usage")
    title = f"用量配额治理：{metric} {alert.get('ratio')}%"
    return {
        "title": title,
        "description": "请处理该用量配额告警，核查高消耗来源、业务影响、是否需要扩容或降载。\n\n"
        + json.dumps(alert, ensure_ascii=False, indent=2),
        "priority": body.priority,
        "estimate": "M",
        "assigned_to": body.assigned_to or "Ops",
        "source": "usage_quota_alert",
        "source_report_id": str(alert.get("id") or metric),
        "source_report_title": title,
        "dev_tool": body.dev_tool or "copilot",
    }


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


def write_quota(limits: dict[str, float]) -> dict[str, Any]:
    payload = {"limits": limits, "updated_at": _now()}
    path = _quota_file()
    with _lock:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def usage_summary_payload(limit: int = 5000, since: str = "", until: str = "") -> dict[str, Any]:
    rows = _read_rows(limit=limit)
    if since:
        rows = [r for r in rows if str(r.get("ts") or "") > since]
    if until:
        rows = [r for r in rows if str(r.get("ts") or "") < until]
    summary = _summarize(rows)
    return {"ok": True, "items": rows, "total": len(rows), **summary}


@router.post("/record")
def record_usage(body: UsageIn) -> dict[str, Any]:
    row = record_usage_event(body)
    return {"ok": True, "record": row}


@router.get("/charts")
def usage_charts(limit: int = Query(5000, ge=1, le=20000)) -> dict[str, Any]:
    """ECharts：按指标汇总、按来源、近 14 日用量趋势。"""
    from collections import defaultdict
    from datetime import datetime, timedelta, timezone

    rows = _read_rows(limit=limit)
    summary = _summarize(rows)
    totals = summary.get("totals") if isinstance(summary.get("totals"), dict) else {}
    by_source = summary.get("by_source") if isinstance(summary.get("by_source"), dict) else {}

    now = datetime.now(timezone.utc)
    day_labels: list[str] = []
    buckets: dict[str, dict[str, float]] = {}
    for offset in range(13, -1, -1):
        d = (now - timedelta(days=offset)).date().isoformat()
        day_labels.append(d)
        buckets[d] = defaultdict(float)

    for row in rows:
        ts = str(row.get("ts") or "")
        if len(ts) < 10:
            continue
        day = ts[:10]
        if day not in buckets:
            continue
        metric = str(row.get("metric") or "unknown")
        buckets[day][metric] += float(row.get("value") or 0)

    top_metrics = sorted(totals.keys(), key=lambda k: -float(totals.get(k, 0)))[:6]
    trend_series = [{"name": m, "data": [buckets[d].get(m, 0) for d in day_labels]} for m in top_metrics]

    source_totals: dict[str, float] = {}
    for src, metrics in by_source.items():
        source_totals[src] = sum(float(v) for v in metrics.values())

    return {
        "ok": True,
        "by_metric": [{"name": k, "value": float(v)} for k, v in totals.items() if float(v) > 0],
        "by_source": [{"name": k, "value": v} for k, v in sorted(source_totals.items(), key=lambda x: -x[1])],
        "activity_trend": {"days": day_labels, "series": trend_series},
    }


@router.get("/summary")
def usage_summary(
    since: str = Query("", description="只统计 ts 大于该值的记录"),
    until: str = Query("", description="只统计 ts 小于该值的记录"),
    limit: int = Query(5000, ge=1, le=20000),
) -> dict[str, Any]:
    if not isinstance(since, str):
        since = ""
    if not isinstance(limit, int):
        limit = 5000
    if not isinstance(until, str):
        until = ""
    return usage_summary_payload(limit=limit, since=since, until=until)


@router.get("/alerts")
def usage_alerts(limit: int = Query(5000, ge=1, le=20000)) -> dict[str, Any]:
    summary = usage_summary_payload(limit=limit)
    alerts = _usage_alerts(summary)
    return {"ok": True, "items": alerts, "total": len(alerts), "summary": {"critical": sum(1 for x in alerts if x["level"] == "critical"), "high": sum(1 for x in alerts if x["level"] == "high"), "medium": sum(1 for x in alerts if x["level"] == "medium")}}


@router.post("/alerts/tasks")
def usage_alert_tasks(body: UsageAlertTasksIn) -> dict[str, Any]:
    summary = usage_summary_payload(limit=20000)
    alerts = _usage_alerts(summary)
    if body.ids:
        wanted = set(body.ids)
        alerts = [x for x in alerts if str(x.get("id") or "") in wanted]
    items = [_usage_alert_task_payload(alert, body) for alert in alerts]
    if body.dry_run:
        return {"ok": True, "dry_run": True, "created": 0, "items": items}
    from .tasks import TaskCreate, create_task

    created: list[dict[str, Any]] = []
    for item in items:
        out = create_task(TaskCreate(**item))
        created.append({**item, "id": out.get("id")})
    return {"ok": True, "dry_run": False, "created": len(created), "items": created}


@router.get("/quota")
def get_quota() -> dict[str, Any]:
    return {"ok": True, **_quota()}


@router.post("/check")
def check_usage(body: UsageCheckIn) -> dict[str, Any]:
    return check_usage_quota(body.metric, body.delta)


@router.put("/quota")
def set_quota(body: QuotaIn) -> dict[str, Any]:
    payload = write_quota(body.limits)
    return {"ok": True, **payload}
