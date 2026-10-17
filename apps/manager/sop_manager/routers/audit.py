"""审计日志：中间件异步写入 + 查询路由"""
from __future__ import annotations
import asyncio
import csv
import io
import json
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
import jwt

from .sql_models import get_session, AuditLog
from .auth_sql import SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])


def _extract_identity(request: Request) -> tuple[str, str, str]:
    """从 JWT 或 X-Api-Key 提取 (user_id, username, tenant_id)"""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            p = jwt.decode(auth[7:], SECRET_KEY, algorithms=[ALGORITHM])
            return p.get("sub", ""), p.get("username", ""), p.get("tid", "")
        except Exception:
            pass
    return "", "", ""


def _write_audit(db: Session, tenant_id: str, user_id: str, username: str,
                 action: str, resource_type: str, resource_id: str,
                 method: str, path: str, status_code: int, ip: str, extra: dict):
    try:
        db.add(AuditLog(
            id=f"al-{uuid.uuid4().hex[:16]}",
            tenant_id=tenant_id or "system",
            user_id=user_id, username=username,
            action=action, resource_type=resource_type, resource_id=resource_id,
            method=method, path=path, status_code=status_code, ip=ip, extra=extra or {},
        ))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _audit_row(a: AuditLog) -> dict[str, Any]:
    return {
        "id": a.id,
        "tenant_id": a.tenant_id,
        "project_id": a.project_id,
        "user_id": a.user_id,
        "username": a.username,
        "action": a.action,
        "resource_type": a.resource_type,
        "resource_id": a.resource_id,
        "method": a.method,
        "path": a.path,
        "status_code": a.status_code,
        "ip": a.ip,
        "extra": a.extra or {},
        "created_at": a.created_at.isoformat() + "Z",
    }


class AuditRecordIn(BaseModel):
    action: str = Field(..., min_length=1, max_length=64)
    resource_type: str = ""
    resource_id: str = ""
    project_id: str = ""
    details: dict[str, Any] = Field(default_factory=dict)


class AuditTaskIn(BaseModel):
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "SecurityOps"
    dev_tool: str = "copilot"


def _audit_task_payload(row: AuditLog, body: AuditTaskIn) -> dict[str, Any]:
    title = f"审计事件治理：{row.action or row.method} {row.resource_type or row.path}"
    detail = {
        "audit_id": row.id,
        "tenant_id": row.tenant_id,
        "project_id": row.project_id,
        "user": row.username or row.user_id,
        "action": row.action,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "method": row.method,
        "path": row.path,
        "status_code": row.status_code,
        "ip": row.ip,
        "created_at": row.created_at.isoformat() + "Z",
        "extra": row.extra or {},
    }
    return {
        "title": title[:120],
        "description": "请核查该审计事件的业务影响、权限边界、异常原因和补救动作。\n\n"
        + json.dumps(detail, ensure_ascii=False, indent=2),
        "priority": body.priority,
        "estimate": "M",
        "assigned_to": body.assigned_to or "SecurityOps",
        "source": "audit_event",
        "source_report_id": row.id,
        "source_report_title": title[:120],
        "dev_tool": body.dev_tool or "copilot",
    }


# ── 审计中间件 ────────────────────────────────────────────────────
_AUDIT_METHODS = {"POST", "PATCH", "PUT", "DELETE"}
# Scheduling previews use a body to describe a pure read, never a mutation.
_READ_ONLY_REQUESTS = {("POST", "/api/v1/delivery/schedule-preview")}
_SKIP_PREFIXES = (
    "/api/v1/health",
    "/metrics",
    "/.well-known",
    "/docs",
    "/openapi.json",
    "/redoc",
)


def _resource_from_path(path: str) -> tuple[str, str]:
    """从路径推断 resource_type 和 resource_id（/api/v1/{resource}/…）。"""
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 4 and parts[0] == "api" and parts[1] == "v1":
        return parts[2], parts[3] if len(parts) > 3 else ""
    if len(parts) >= 3 and parts[0] == "api" and parts[1] == "v1":
        return parts[2], ""
    return "", ""


async def audit_middleware(request: Request, call_next):
    path = request.url.path
    if (request.method not in _AUDIT_METHODS or path.startswith(_SKIP_PREFIXES)
            or (request.method, path) in _READ_ONLY_REQUESTS):
        return await call_next(request)

    response: Response = await call_next(request)

    user_id, username, tenant_id = _extract_identity(request)
    resource_type, resource_id = _resource_from_path(request.url.path)
    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "")
    action = {"POST": "create", "PATCH": "update", "PUT": "update", "DELETE": "delete"}.get(request.method, request.method.lower())

    db = next(get_session())
    asyncio.get_event_loop().run_in_executor(
        None, _write_audit, db, tenant_id, user_id, username,
        action, resource_type, resource_id,
        request.method, request.url.path, response.status_code, ip, {}
    )
    return response


# ── 查询路由 ──────────────────────────────────────────────────────
@router.get("")
def list_audit(
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    from_dt: Optional[str] = Query(None, alias="from"),
    to_dt: Optional[str] = Query(None, alias="to"),
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_session),
):
    q = db.query(AuditLog)
    if project_id: q = q.filter(AuditLog.project_id == project_id)
    if user_id: q = q.filter(AuditLog.user_id == user_id)
    if action: q = q.filter(AuditLog.action == action)
    if resource_type: q = q.filter(AuditLog.resource_type == resource_type)
    if from_dt:
        try: q = q.filter(AuditLog.created_at >= datetime.fromisoformat(from_dt))
        except ValueError: pass
    if to_dt:
        try: q = q.filter(AuditLog.created_at <= datetime.fromisoformat(to_dt))
        except ValueError: pass
    total = q.count()
    items = q.order_by(AuditLog.created_at.desc()).offset((page - 1) * size).limit(size).all()
    return {
        "total": total, "page": page, "size": size,
        "items": [_audit_row(a) for a in items]
    }


@router.get("/events")
def list_audit_events(
    q: str = "",
    project_id: Optional[str] = None,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    query = db.query(AuditLog)
    if project_id:
        query = query.filter(AuditLog.project_id == project_id)
    if action:
        query = query.filter(AuditLog.action == action)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    rows = query.order_by(AuditLog.created_at.desc()).all()
    if q:
        ql = q.lower()
        rows = [a for a in rows if ql in (a.action or "").lower() or ql in (a.resource_type or "").lower() or ql in (a.resource_id or "").lower() or ql in (a.path or "").lower() or ql in (a.username or "").lower()]
    total = len(rows)
    page_rows = rows[(page - 1) * size: page * size]
    return {"ok": True, "total": total, "page": page, "size": size, "items": [_audit_row(a) for a in page_rows]}


@router.post("/events/{audit_id}/task")
def audit_event_task(audit_id: str, body: AuditTaskIn, db: Session = Depends(get_session)) -> dict[str, Any]:
    row = db.query(AuditLog).filter(AuditLog.id == audit_id).first()
    if not row:
        raise HTTPException(404, "Audit event not found")
    payload = _audit_task_payload(row, body)
    if body.dry_run:
        return {"ok": True, "dry_run": True, "item": payload}
    from .tasks import TaskCreate, create_task

    out = create_task(TaskCreate(**payload))
    return {"ok": True, "dry_run": False, "id": out.get("id"), "item": payload}


@router.get("/hub")
def audit_hub(db: Session = Depends(get_session)) -> dict[str, Any]:
    summary = audit_summary(db)
    try:
        from sop_manager.routers.audit_chain import verify_chain as _verify_chain

        chain_ok = bool(_verify_chain().get("ok"))
    except Exception:
        chain_ok = False
    return {
        "ok": True,
        "summary": {
            "total": summary.get("total", 0),
            "failures": summary.get("failures", 0),
            "last_24h": summary.get("last_24h", 0),
            "last_7d": summary.get("last_7d", 0),
            "chain_valid": chain_ok,
        },
        "domains": [
            {"id": "chain", "path": "#/audit/chain", "capability": "governance.audit.chain"},
            {"id": "events", "path": "#/audit/events", "capability": "governance.audit.events"},
            {"id": "actions", "path": "#/audit/module-actions", "capability": "governance.audit.module-actions"},
            {"id": "approvals", "path": "#/audit/approvals", "capability": "governance.audit.approvals"},
        ],
    }


@router.get("/summary")
def audit_summary(db: Session = Depends(get_session)) -> dict[str, Any]:
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(5000).all()
    by_action: dict[str, int] = {}
    by_resource: dict[str, int] = {}
    failures = 0
    now = datetime.now(timezone.utc)
    last_24h = 0
    last_7d = 0
    for a in rows:
        by_action[a.action or "unknown"] = by_action.get(a.action or "unknown", 0) + 1
        by_resource[a.resource_type or "unknown"] = by_resource.get(a.resource_type or "unknown", 0) + 1
        if int(a.status_code or 0) >= 400:
            failures += 1
        created = a.created_at
        if created:
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if created >= now - timedelta(hours=24):
                last_24h += 1
            if created >= now - timedelta(days=7):
                last_7d += 1
    return {
        "ok": True,
        "total": len(rows),
        "failures": failures,
        "last_24h": last_24h,
        "last_7d": last_7d,
        "by_action": by_action,
        "by_resource": by_resource,
    }


@router.get("/charts")
def audit_charts(db: Session = Depends(get_session)) -> dict[str, Any]:
    """审计 ECharts 数据：按日趋势、动作/资源分布、失败占比。"""
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(5000).all()
    now = datetime.now(timezone.utc)
    day_labels: list[str] = []
    event_counts: list[int] = []
    failure_counts: list[int] = []
    buckets: dict[str, dict[str, int]] = {}

    for offset in range(13, -1, -1):
        d = (now - timedelta(days=offset)).date().isoformat()
        day_labels.append(d)
        buckets[d] = {"total": 0, "failures": 0}

    by_action: dict[str, int] = {}
    by_resource: dict[str, int] = {}
    for a in rows:
        action = a.action or "unknown"
        by_action[action] = by_action.get(action, 0) + 1
        rtype = a.resource_type or "unknown"
        by_resource[rtype] = by_resource.get(rtype, 0) + 1
        if a.created_at:
            created = a.created_at.replace(tzinfo=timezone.utc) if a.created_at.tzinfo is None else a.created_at
            day = created.date().isoformat()
            if day in buckets:
                buckets[day]["total"] += 1
                if int(a.status_code or 0) >= 400:
                    buckets[day]["failures"] += 1

    for d in day_labels:
        event_counts.append(buckets[d]["total"])
        failure_counts.append(buckets[d]["failures"])

    action_pie = sorted(by_action.items(), key=lambda x: (-x[1], x[0]))[:12]
    resource_pie = sorted(by_resource.items(), key=lambda x: (-x[1], x[0]))[:10]
    failures = sum(1 for a in rows if int(a.status_code or 0) >= 400)
    success = max(0, len(rows) - failures)

    return {
        "ok": True,
        "activity_trend": {
            "days": day_labels,
            "series": [
                {"name": "events", "data": event_counts},
                {"name": "failures", "data": failure_counts},
            ],
        },
        "by_action": [{"name": k, "value": v} for k, v in action_pie],
        "by_resource": [{"name": k, "value": v} for k, v in resource_pie],
        "outcome": [{"name": "success", "value": success}, {"name": "failures", "value": failures}],
    }


@router.get("/timeline")
def audit_timeline(
    limit: int = Query(80, ge=1, le=200),
    project_id: Optional[str] = None,
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    q = db.query(AuditLog)
    if project_id:
        q = q.filter(AuditLog.project_id == project_id)
    rows = q.order_by(AuditLog.created_at.desc()).limit(limit).all()
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for a in rows:
        day = (a.created_at.date().isoformat() if a.created_at else "unknown")
        buckets[day].append(_audit_row(a))
    days = [
        {"date": day, "count": len(items), "items": items[:12]}
        for day, items in sorted(buckets.items(), reverse=True)
    ]
    return {"ok": True, "total": len(rows), "days": days}


@router.post("/record")
def record_audit(body: AuditRecordIn, request: Request, db: Session = Depends(get_session)) -> dict[str, Any]:
    user_id, username, tenant_id = _extract_identity(request)
    row = AuditLog(
        id=f"al-{uuid.uuid4().hex[:16]}",
        tenant_id=tenant_id or "system",
        project_id=body.project_id or request.headers.get("X-Project-Id", ""),
        user_id=user_id,
        username=username,
        action=body.action,
        resource_type=body.resource_type,
        resource_id=body.resource_id,
        method="MANUAL",
        path="/api/v1/audit/record",
        status_code=200,
        ip=request.headers.get("X-Forwarded-For", request.client.host if request.client else ""),
        extra=body.details or {},
    )
    db.add(row)
    db.commit()
    try:
        from sop_manager.routers.audit_chain import append_audit

        chain = append_audit(
            body.action,
            user_id=user_id,
            tenant_id=tenant_id or "system",
            project_id=row.project_id,
            resource_type=body.resource_type,
            resource_id=body.resource_id,
            details=body.details,
        )
    except Exception as e:
        chain = {"error": str(e)}
    return {"ok": True, "item": _audit_row(row), "chain": chain}


@router.get("/export.csv")
def audit_export_csv(limit: int = 5000, db: Session = Depends(get_session)) -> Response:
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "tenant_id", "project_id", "user_id", "username", "action", "resource_type", "resource_id", "method", "path", "status_code", "ip", "created_at"])
    for a in rows:
        writer.writerow([a.id, a.tenant_id, a.project_id, a.user_id, a.username, a.action, a.resource_type, a.resource_id, a.method, a.path, a.status_code, a.ip, a.created_at.isoformat() + "Z"])
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="audit-events.csv"'},
    )
