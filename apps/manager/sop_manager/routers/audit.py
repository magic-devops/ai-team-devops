"""审计日志：中间件异步写入 + 查询路由"""
from __future__ import annotations
import uuid, asyncio
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
import jwt

from .sql_models import get_session, AuditLog
from .auth_sql import SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/api/v1/audit-legacy", tags=["audit"])


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


# ── 审计中间件 ────────────────────────────────────────────────────
_AUDIT_METHODS = {"POST", "PATCH", "PUT", "DELETE"}
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
    if request.method not in _AUDIT_METHODS or path.startswith(_SKIP_PREFIXES):
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
    page: int = 1, size: int = 50,
    db: Session = Depends(get_session),
):
    from .auth_sql import require_role
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
        "items": [{"id": a.id, "user_id": a.user_id, "username": a.username,
                   "action": a.action, "resource_type": a.resource_type,
                   "resource_id": a.resource_id, "method": a.method, "path": a.path,
                   "status_code": a.status_code, "ip": a.ip,
                   "created_at": a.created_at.isoformat() + "Z"} for a in items]
    }
