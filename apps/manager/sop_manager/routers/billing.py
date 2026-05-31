"""
@module: routers.billing
@purpose: 租户商业化订阅、计划、配额与用量概览（文件型底座，可替换为 SQL/计费网关）
"""
from __future__ import annotations

import json
import threading
import uuid
from csv import DictWriter
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
    resolved_tenant_id,
)
from sop_manager.routers.scope_guard import attach_scope, scope_matches
from sop_manager.routers.usage import check_usage_quota, usage_summary_payload, write_quota

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])
_lock = threading.Lock()


PLAN_CATALOG: dict[str, dict[str, Any]] = {
    "starter": {
        "name": "Starter",
        "price_monthly_usd": 0,
        "limits": {
            "llm_tokens": 200_000,
            "event_count": 20_000,
            "worker_seconds": 3_600,
            "storage_bytes": 1_073_741_824,
        },
        "features": ["single_project", "basic_sync", "local_memory", "community_support"],
    },
    "team": {
        "name": "Team",
        "price_monthly_usd": 99,
        "limits": {
            "llm_tokens": 2_000_000,
            "event_count": 200_000,
            "worker_seconds": 36_000,
            "storage_bytes": 10_737_418_240,
        },
        "features": ["multi_project", "wss_sync", "shared_kb", "team_rbac", "usage_alerts"],
    },
    "enterprise": {
        "name": "Enterprise",
        "price_monthly_usd": None,
        "limits": {
            "llm_tokens": 20_000_000,
            "event_count": 2_000_000,
            "worker_seconds": 360_000,
            "storage_bytes": 107_374_182_400,
        },
        "features": ["sso", "audit_chain", "private_deploy", "dedicated_support", "custom_quota"],
    },
}

OVERAGE_RATES_USD: dict[str, dict[str, float]] = {
    "llm_tokens": {"unit_size": 1000, "unit_price": 0.01},
    "event_count": {"unit_size": 10000, "unit_price": 0.05},
    "worker_seconds": {"unit_size": 3600, "unit_price": 1.0},
    "storage_bytes": {"unit_size": 1_073_741_824, "unit_price": 0.25},
}


class SubscriptionIn(BaseModel):
    plan: str = Field(..., min_length=1)
    status: str = "active"
    billing_email: str = ""
    renewal_at: str = ""
    auto_apply_quota: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class InvoiceStatusIn(BaseModel):
    status: str = Field(..., min_length=1)
    note: str = ""


class PaymentIn(BaseModel):
    invoice_id: str = Field(..., min_length=1)
    amount_usd: float = Field(..., ge=0)
    method: str = "manual"
    external_ref: str = ""
    note: str = ""


class OveragePolicyIn(BaseModel):
    mode: str = Field("approval_required", min_length=1)
    grace_percent: float = Field(5, ge=0)
    approval_threshold_percent: float = Field(100, ge=0)
    invoice_due_days: int = Field(14, ge=0)
    suspend_after_days: int = Field(30, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EntitlementCheckIn(BaseModel):
    feature: str = ""
    metric: str = ""
    delta: float = Field(0, ge=0)
    subject: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _billing_dir() -> Path:
    p = resolved_ai_memory_root() / "billing-v1"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _tenant_file() -> Path:
    safe = resolved_tenant_code().replace("/", "_")[:80] or resolved_tenant_id()
    return _billing_dir() / f"{safe}.subscription.json"


def _invoice_dir() -> Path:
    p = _billing_dir() / "invoices"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _invoice_safe_name(invoice_id: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in invoice_id)[:180]
    if not safe.endswith(".invoice.json"):
        safe = f"{safe}.invoice.json"
    return safe


def _invoice_path(invoice_id: str) -> Path:
    return _invoice_dir() / _invoice_safe_name(invoice_id)


def _payments_file() -> Path:
    return _billing_dir() / "payments.jsonl"


def _overage_policy_file() -> Path:
    safe = resolved_tenant_code().replace("/", "_")[:80] or resolved_tenant_id()
    return _billing_dir() / f"{safe}.overage-policy.json"


def _audit_dir() -> Path:
    p = _billing_dir() / "invoice-audit"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _invoice_audit_file(invoice_id: str) -> Path:
    return _audit_dir() / _invoice_safe_name(invoice_id).replace(".invoice.json", ".audit.jsonl")


def _default_subscription() -> dict[str, Any]:
    return {
        "plan": "starter",
        "status": "active",
        "billing_email": "",
        "renewal_at": "",
        "metadata": {},
        "created_at": None,
        "updated_at": None,
    }


def _default_overage_policy() -> dict[str, Any]:
    return {
        "mode": "approval_required",
        "grace_percent": 5,
        "approval_threshold_percent": 100,
        "invoice_due_days": 14,
        "suspend_after_days": 30,
        "metadata": {},
        "updated_at": None,
    }


def _read_subscription() -> dict[str, Any]:
    path = _tenant_file()
    if not path.is_file():
        return _default_subscription()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_subscription()
    return data if isinstance(data, dict) else _default_subscription()


def _write_subscription(data: dict[str, Any]) -> dict[str, Any]:
    payload = {**_default_subscription(), **data, "updated_at": _now()}
    if not payload.get("created_at"):
        payload["created_at"] = payload["updated_at"]
    path = _tenant_file()
    with _lock:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def _read_overage_policy() -> dict[str, Any]:
    path = _overage_policy_file()
    if not path.is_file():
        return _default_overage_policy()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_overage_policy()
    return {**_default_overage_policy(), **data} if isinstance(data, dict) else _default_overage_policy()


def _write_overage_policy(data: dict[str, Any]) -> dict[str, Any]:
    payload = {**_default_overage_policy(), **data, "updated_at": _now()}
    attach_scope(payload, overwrite=True)
    with _lock:
        _overage_policy_file().write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def _read_invoice(invoice_id: str) -> dict[str, Any]:
    path = _invoice_path(invoice_id)
    if not path.is_file():
        raise HTTPException(404, "invoice snapshot not found")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"invoice snapshot is broken: {e}") from e
    if not isinstance(data, dict):
        raise HTTPException(500, "invoice snapshot is not an object")
    if not scope_matches(data):
        raise HTTPException(404, "invoice snapshot not found")
    return data


def _write_invoice(invoice_id: str, data: dict[str, Any]) -> Path:
    path = _invoice_path(invoice_id)
    attach_scope(data, overwrite=True)
    with _lock:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _append_invoice_audit(invoice_id: str, event_type: str, invoice: dict[str, Any], **extra: Any) -> dict[str, Any]:
    row = {
        "id": f"aud-{uuid.uuid4().hex}",
        "ts": _now(),
        "type": event_type,
        "invoice_id": invoice_id,
        "invoice_status": invoice.get("status") or "draft",
        "period": invoice.get("period") or "",
        "total_due_usd": invoice.get("total_due_usd") or 0,
        **extra,
    }
    attach_scope(row, overwrite=True)
    with _lock:
        with _invoice_audit_file(invoice_id).open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    return row


def _read_invoice_audit(invoice_id: str) -> list[dict[str, Any]]:
    path = _invoice_audit_file(invoice_id)
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and scope_matches(row):
            rows.append(row)
    return rows


def _entitlements(plan_id: str) -> dict[str, Any]:
    plan = PLAN_CATALOG.get(plan_id) or PLAN_CATALOG["starter"]
    return {
        "plan": plan_id if plan_id in PLAN_CATALOG else "starter",
        "limits": dict(plan.get("limits") or {}),
        "features": list(plan.get("features") or []),
    }


def _usage_ratio(totals: dict[str, float], limits: dict[str, float]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for metric, limit in limits.items():
        used = float(totals.get(metric, 0.0))
        lim = float(limit)
        out[metric] = {
            "used": used,
            "limit": lim,
            "remaining": lim - used,
            "percent": 0 if lim <= 0 else round(min(used / lim * 100, 999), 2),
        }
    return out


def _period_bounds(period: str) -> tuple[str, str, str]:
    p = (period or "").strip()
    if not p:
        now = datetime.now(timezone.utc)
        p = f"{now.year:04d}-{now.month:02d}"
    try:
        start = datetime.strptime(p, "%Y-%m").replace(tzinfo=timezone.utc)
    except ValueError as e:
        raise HTTPException(400, "period must be YYYY-MM") from e
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return (
        p,
        start.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        end.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    )


def invoice_payload(period: str = "") -> dict[str, Any]:
    period, since, until = _period_bounds(period)
    sub = _read_subscription()
    plan_id = str(sub.get("plan") or "starter")
    plan = PLAN_CATALOG.get(plan_id) or PLAN_CATALOG["starter"]
    usage = usage_summary_payload(limit=20_000, since=since, until=until)
    ent = _entitlements(plan_id)
    limits = usage.get("quota", {}).get("limits") or ent["limits"]
    totals = usage.get("totals") or {}
    lines: list[dict[str, Any]] = []
    plan_fee = plan.get("price_monthly_usd")
    if isinstance(plan_fee, int | float):
        lines.append(
            {
                "type": "plan_fee",
                "metric": "subscription",
                "description": f"{plan.get('name', plan_id)} monthly platform fee",
                "quantity": 1,
                "unit_price_usd": float(plan_fee),
                "amount_usd": float(plan_fee),
            }
        )
    for metric, rate in OVERAGE_RATES_USD.items():
        used = float(totals.get(metric, 0.0))
        included = float(limits.get(metric, 0.0))
        overage = max(0.0, used - included)
        unit_size = float(rate["unit_size"])
        units = 0.0 if unit_size <= 0 else overage / unit_size
        amount = round(units * float(rate["unit_price"]), 6)
        lines.append(
            {
                "type": "usage_overage",
                "metric": metric,
                "description": f"{metric} over included quota",
                "used": used,
                "included": included,
                "overage": overage,
                "unit_size": unit_size,
                "unit_price_usd": float(rate["unit_price"]),
                "quantity": round(units, 6),
                "amount_usd": amount,
            }
        )
    total = round(sum(float(x.get("amount_usd") or 0.0) for x in lines), 6)
    invoice_id = f"inv-{resolved_tenant_code()}-{resolved_business_code()}-{resolved_project_code()}-{period}".replace("/", "_")
    payload = {
        "ok": True,
        "id": invoice_id,
        "status": "draft",
        "period": period,
        "since": since,
        "until": until,
        "currency": "USD",
        "tenant_id": resolved_tenant_id(),
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
        "subscription": sub,
        "lines": lines,
        "subtotal_usd": total,
        "tax_usd": 0.0,
        "total_due_usd": total,
        "usage": usage,
        "generated_at": _now(),
    }
    attach_scope(payload, overwrite=True)
    return payload


def subscription_payload() -> dict[str, Any]:
    sub = _read_subscription()
    ent = _entitlements(str(sub.get("plan") or "starter"))
    usage = usage_summary_payload(limit=20_000)
    limits = usage.get("quota", {}).get("limits") or ent["limits"]
    return {
        "ok": True,
        "tenant_id": resolved_tenant_id(),
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
        "subscription": sub,
        "catalog": PLAN_CATALOG,
        "entitlements": ent,
        "usage": usage,
        "quota_effective": {"limits": limits},
        "usage_ratio": _usage_ratio(usage.get("totals") or {}, limits),
    }


def alerts_payload() -> dict[str, Any]:
    sub_payload = subscription_payload()
    sub = sub_payload["subscription"]
    alerts: list[dict[str, Any]] = []
    for metric, row in (sub_payload.get("usage_ratio") or {}).items():
        pct = float(row.get("percent") or 0)
        if pct >= 100:
            severity = "critical"
            message = f"{metric} usage is over quota"
        elif pct >= 80:
            severity = "warning"
            message = f"{metric} usage is close to quota"
        else:
            continue
        alerts.append(
            {
                "id": f"quota-{metric}",
                "type": "quota",
                "severity": severity,
                "metric": metric,
                "percent": pct,
                "message": message,
                "action": "upgrade_plan_or_increase_quota",
            }
        )
    invoices = list_invoices(limit=50).get("items", [])
    unpaid = [x for x in invoices if str(x.get("status") or "draft") in {"issued"}]
    if unpaid:
        alerts.append(
            {
                "id": "invoice-unpaid",
                "type": "invoice",
                "severity": "warning",
                "count": len(unpaid),
                "message": f"{len(unpaid)} issued invoice(s) are not paid",
                "action": "follow_up_payment",
            }
        )
    if str(sub.get("plan") or "") == "enterprise" and not sub.get("billing_email"):
        alerts.append(
            {
                "id": "enterprise-billing-contact",
                "type": "subscription",
                "severity": "info",
                "message": "enterprise plan should set a billing contact",
                "action": "set_billing_email",
            }
        )
    return {"ok": True, "items": alerts, "total": len(alerts)}


def _dunning_stage(days_open: int, policy: dict[str, Any]) -> str:
    due_days = int(policy.get("invoice_due_days") or 0)
    suspend_days = int(policy.get("suspend_after_days") or 0)
    if suspend_days and days_open >= suspend_days:
        return "final_notice"
    if due_days and days_open >= due_days:
        return "reminder"
    return "notice"


def _days_between(start: str) -> int:
    if not start:
        return 0
    try:
        dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    except ValueError:
        return 0
    return max(0, (datetime.now(timezone.utc) - dt).days)


def entitlement_check_payload(body: EntitlementCheckIn) -> dict[str, Any]:
    sub = _read_subscription()
    if str(sub.get("status") or "active") not in {"active", "trialing"}:
        return {
            "ok": True,
            "allowed": False,
            "decision": "subscription_inactive",
            "subscription": sub,
            "feature_allowed": False,
            "quota_allowed": False,
        }
    plan_id = str(sub.get("plan") or "starter")
    ent = _entitlements(plan_id)
    feature = body.feature.strip()
    metric = body.metric.strip()
    feature_allowed = True if not feature else feature in set(ent.get("features") or [])
    quota: dict[str, Any] = {}
    quota_allowed = True
    decision = "allowed"
    policy = _read_overage_policy()

    if not feature_allowed:
        decision = "feature_not_entitled"
    if metric:
        quota = check_usage_quota(metric, body.delta)
        quota_allowed = bool(quota.get("allowed"))
        if not quota_allowed:
            limit = float(quota.get("limit") or 0)
            current = float(quota.get("current") or 0)
            delta = float(quota.get("delta") or 0)
            pct = 999.0 if limit <= 0 else ((current + delta) / limit) * 100
            mode = str(policy.get("mode") or "approval_required")
            grace = float(policy.get("grace_percent") or 0)
            if mode == "allow" or pct <= 100 + grace:
                decision = "overage_allowed"
                quota_allowed = True
            elif mode == "block":
                decision = "blocked_overage"
            else:
                decision = "approval_required"

    allowed = feature_allowed and quota_allowed and decision not in {"feature_not_entitled", "blocked_overage", "approval_required"}
    return {
        "ok": True,
        "allowed": allowed,
        "decision": decision,
        "feature_allowed": feature_allowed,
        "quota_allowed": quota_allowed,
        "subscription": sub,
        "entitlements": ent,
        "quota": quota,
        "overage_policy": policy,
    }


@router.get("/plans")
def list_plans() -> dict[str, Any]:
    return {"ok": True, "items": [{"id": k, **v} for k, v in PLAN_CATALOG.items()]}


@router.get("/subscription")
def get_subscription() -> dict[str, Any]:
    return subscription_payload()


@router.get("/alerts")
def get_alerts() -> dict[str, Any]:
    return alerts_payload()


@router.get("/overage-policy")
def get_overage_policy() -> dict[str, Any]:
    return {"ok": True, "policy": _read_overage_policy()}


@router.put("/overage-policy")
def upsert_overage_policy(body: OveragePolicyIn) -> dict[str, Any]:
    mode = body.mode.strip().lower()
    if mode not in {"allow", "block", "approval_required"}:
        raise HTTPException(400, "mode must be allow, block, or approval_required")
    policy = _write_overage_policy(
        {
            "mode": mode,
            "grace_percent": body.grace_percent,
            "approval_threshold_percent": body.approval_threshold_percent,
            "invoice_due_days": body.invoice_due_days,
            "suspend_after_days": body.suspend_after_days,
            "metadata": body.metadata,
        }
    )
    return {"ok": True, "policy": policy}


@router.post("/entitlements/check")
def entitlement_check(body: EntitlementCheckIn) -> dict[str, Any]:
    return entitlement_check_payload(body)


@router.get("/dunning")
def dunning_state() -> dict[str, Any]:
    policy = _read_overage_policy()
    items: list[dict[str, Any]] = []
    for row in list_invoices(limit=100).get("items", []):
        if str(row.get("status") or "") != "issued":
            continue
        try:
            invoice = _read_invoice(str(row.get("id") or ""))
        except HTTPException:
            continue
        opened_at = str(invoice.get("issued_at") or invoice.get("updated_at") or invoice.get("generated_at") or "")
        days_open = _days_between(opened_at)
        items.append(
            {
                "invoice_id": invoice.get("id"),
                "period": invoice.get("period"),
                "status": invoice.get("status"),
                "total_due_usd": invoice.get("total_due_usd") or 0,
                "billing_email": (invoice.get("subscription") or {}).get("billing_email") or "",
                "days_open": days_open,
                "stage": _dunning_stage(days_open, policy),
                "next_action": "send_payment_reminder",
            }
        )
    return {
        "ok": True,
        "policy": policy,
        "items": items,
        "summary": {
            "open_invoices": len(items),
            "total_outstanding_usd": round(sum(float(x.get("total_due_usd") or 0) for x in items), 6),
            "final_notice": sum(1 for x in items if x.get("stage") == "final_notice"),
        },
    }


@router.get("/invoice")
def get_invoice(period: str = Query("", description="账期 YYYY-MM；空则当前 UTC 月")) -> dict[str, Any]:
    return invoice_payload(period)


@router.get("/invoice/export.csv")
def export_invoice_csv(period: str = Query("", description="账期 YYYY-MM；空则当前 UTC 月")) -> Response:
    invoice = invoice_payload(period)
    fields = [
        "invoice_id",
        "period",
        "tenant_code",
        "project_code",
        "status",
        "line_type",
        "metric",
        "description",
        "quantity",
        "unit_price_usd",
        "amount_usd",
        "currency",
    ]
    buf = StringIO()
    writer = DictWriter(buf, fieldnames=fields)
    writer.writeheader()
    for line in invoice.get("lines") or []:
        writer.writerow(
            {
                "invoice_id": invoice.get("id"),
                "period": invoice.get("period"),
                "tenant_code": invoice.get("tenant_code"),
                "project_code": invoice.get("project_code"),
                "status": invoice.get("status"),
                "line_type": line.get("type"),
                "metric": line.get("metric"),
                "description": line.get("description"),
                "quantity": line.get("quantity"),
                "unit_price_usd": line.get("unit_price_usd"),
                "amount_usd": line.get("amount_usd"),
                "currency": invoice.get("currency"),
            }
        )
    filename = f"{invoice.get('id')}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/invoices")
def list_invoices(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for path in sorted(_invoice_dir().glob("*.invoice.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        if not scope_matches(data):
            continue
        rows.append(
            {
                "id": data.get("id") or path.stem,
                "period": data.get("period") or "",
                "status": data.get("status") or "draft",
                "total_due_usd": data.get("total_due_usd") or 0,
                "currency": data.get("currency") or "USD",
                "generated_at": data.get("generated_at") or "",
                "updated_at": data.get("updated_at") or data.get("generated_at") or "",
                "path": str(path),
            }
        )
        if len(rows) >= limit:
            break
    return {"ok": True, "items": rows, "total": len(rows)}


@router.get("/invoices/{invoice_id}/audit")
def invoice_audit(invoice_id: str) -> dict[str, Any]:
    _read_invoice(invoice_id)
    rows = _read_invoice_audit(invoice_id)
    return {"ok": True, "items": rows, "total": len(rows)}


@router.get("/payments")
def list_payments(invoice_id: str = Query("", description="可选账单 ID"), limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    path = _payments_file()
    if not path.is_file():
        return {"ok": True, "items": [], "total": 0}
    rows: list[dict[str, Any]] = []
    for line in reversed(path.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        if not scope_matches(row):
            continue
        if invoice_id and row.get("invoice_id") != invoice_id:
            continue
        rows.append(row)
        if len(rows) >= limit:
            break
    return {"ok": True, "items": rows, "total": len(rows)}


@router.get("/summary")
def billing_summary() -> dict[str, Any]:
    invoices = list_invoices(limit=100).get("items", [])
    payments = list_payments(limit=200).get("items", [])
    invoice_total = round(sum(float(x.get("total_due_usd") or 0) for x in invoices), 6)
    paid_total = round(sum(float(x.get("amount_usd") or 0) for x in payments), 6)
    by_status: dict[str, int] = {}
    for row in invoices:
        status = str(row.get("status") or "draft")
        by_status[status] = by_status.get(status, 0) + 1
    return {
        "ok": True,
        "currency": "USD",
        "invoice_count": len(invoices),
        "payment_count": len(payments),
        "invoice_total_usd": invoice_total,
        "paid_total_usd": paid_total,
        "outstanding_usd": round(max(0.0, invoice_total - paid_total), 6),
        "by_status": by_status,
    }


@router.post("/invoice/snapshot")
def snapshot_invoice(period: str = Query("", description="账期 YYYY-MM；空则当前 UTC 月")) -> dict[str, Any]:
    payload = invoice_payload(period)
    payload["status"] = "draft"
    payload["updated_at"] = _now()
    path = _write_invoice(str(payload["id"]), payload)
    _append_invoice_audit(str(payload["id"]), "invoice_snapshot_created", payload)
    return {"ok": True, "path": str(path), "invoice": payload}


@router.patch("/invoices/{invoice_id}/status")
def update_invoice_status(invoice_id: str, body: InvoiceStatusIn) -> dict[str, Any]:
    allowed = {"draft", "issued", "paid", "void"}
    status = body.status.strip().lower()
    if status not in allowed:
        raise HTTPException(400, f"status must be one of {sorted(allowed)}")
    data = _read_invoice(invoice_id)
    before = str(data.get("status") or "draft")
    data["status"] = status
    data["status_note"] = body.note
    data["updated_at"] = _now()
    if status == "issued" and not data.get("issued_at"):
        data["issued_at"] = data["updated_at"]
    if status == "paid" and not data.get("paid_at"):
        data["paid_at"] = data["updated_at"]
    path = _write_invoice(invoice_id, data)
    _append_invoice_audit(
        invoice_id,
        "invoice_status_changed",
        data,
        from_status=before,
        to_status=status,
        note=body.note,
    )
    return {"ok": True, "invoice": data, "path": str(path)}


@router.post("/payments")
def record_payment(body: PaymentIn) -> dict[str, Any]:
    invoice = _read_invoice(body.invoice_id)
    payment = {
        "id": f"pay-{uuid.uuid4().hex}",
        "ts": _now(),
        "invoice_id": body.invoice_id,
        "amount_usd": float(body.amount_usd),
        "method": body.method,
        "external_ref": body.external_ref,
        "note": body.note,
    }
    attach_scope(payment, overwrite=True)
    path = _payments_file()
    with _lock:
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payment, ensure_ascii=False, separators=(",", ":")) + "\n")
    invoice["status"] = "paid"
    invoice["paid_at"] = payment["ts"]
    invoice["paid_amount_usd"] = float(invoice.get("paid_amount_usd") or 0) + float(body.amount_usd)
    invoice["updated_at"] = payment["ts"]
    _write_invoice(body.invoice_id, invoice)
    _append_invoice_audit(
        body.invoice_id,
        "payment_recorded",
        invoice,
        payment_id=payment["id"],
        amount_usd=payment["amount_usd"],
        method=payment["method"],
        external_ref=payment["external_ref"],
    )
    return {"ok": True, "payment": payment, "invoice": invoice}


@router.put("/subscription")
def update_subscription(body: SubscriptionIn) -> dict[str, Any]:
    if body.plan not in PLAN_CATALOG:
        raise HTTPException(400, f"unknown plan: {body.plan}")
    payload = _write_subscription(
        {
            "plan": body.plan,
            "status": body.status,
            "billing_email": body.billing_email,
            "renewal_at": body.renewal_at,
            "metadata": body.metadata,
        }
    )
    if body.auto_apply_quota:
        write_quota(dict(PLAN_CATALOG[body.plan].get("limits") or {}))
    return {"ok": True, "subscription": payload, **subscription_payload()}
