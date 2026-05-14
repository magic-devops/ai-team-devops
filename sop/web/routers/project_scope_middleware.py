"""JWT + X-Project-Id → path_config 请求级作用域（single / saas 共用）。"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Callable, Optional, Tuple

import jwt
from fastapi import HTTPException, Request
from starlette.responses import JSONResponse, Response

from path_config import project_path, reset_request_scope, set_request_scope

# 无需解析项目上下文的 API（探活、OpenAPI 等）。/api/auth/* 一律走前缀跳过。
_NO_SCOPE_PATHS: frozenset[str] = frozenset(
    {
        "/api/health",
        "/health",
        "/openapi.json",
        "/docs",
        "/redoc",
    }
)


def _admin_mode() -> str:
    return (os.getenv("ADMIN_MODE", "single") or "single").strip().lower()


def _http_error_response(exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if not isinstance(detail, str):
        detail = str(detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": detail})


async def project_scope_middleware(request: Request, call_next: Callable) -> Response:
    from routers.auth_sql import ALGORITHM, SECRET_KEY, check_project_access
    from routers.sql_models import Project, ProjectMember, SessionLocal, User

    path = request.url.path
    if request.method == "OPTIONS" or path.startswith("/docs/"):
        return await call_next(request)
    if path in _NO_SCOPE_PATHS or path.startswith("/api/auth"):
        return await call_next(request)

    scope_tokens: Optional[Tuple[object, object, object]] = None
    auth = request.headers.get("Authorization") or ""

    try:
        if auth.startswith("Bearer "):
            raw = auth[7:].strip()
            if raw:
                payload = jwt.decode(raw, SECRET_KEY, algorithms=[ALGORITHM])
                uid = payload.get("sub")
                if uid:
                    db = SessionLocal()
                    try:
                        user = db.get(User, uid)
                        if user and user.status == "active":
                            x_pid = (request.headers.get("X-Project-Id") or "").strip()
                            mode = _admin_mode()
                            if not x_pid:
                                if mode != "saas":
                                    x_pid = (os.getenv("PROJECT_ID", "default") or "default").strip()
                                else:
                                    m = (
                                        db.query(ProjectMember)
                                        .filter_by(user_id=user.id)
                                        .order_by(ProjectMember.project_id)
                                        .first()
                                    )
                                    if m:
                                        x_pid = m.project_id
                                    elif user.role in ("tenant_admin", "super_admin"):
                                        first = (
                                            db.query(Project)
                                            .filter_by(tenant_id=user.tenant_id)
                                            .order_by(Project.created_at.asc())
                                            .first()
                                        )
                                        x_pid = first.id if first else ""
                                    else:
                                        x_pid = ""
                            if not x_pid:
                                return await call_next(request)

                            proj = db.query(Project).filter_by(id=x_pid).first()
                            if not proj:
                                if mode != "saas":
                                    return await call_next(request)
                                return JSONResponse(status_code=404, content={"detail": "项目不存在"})
                            if user.role != "super_admin" and proj.tenant_id != user.tenant_id:
                                return JSONResponse(status_code=403, content={"detail": "无项目访问权限"})
                            if user.role not in ("super_admin", "tenant_admin"):
                                try:
                                    check_project_access(user, x_pid, db, "viewer")
                                except HTTPException as he:
                                    return _http_error_response(he)

                            pp_str = (proj.project_path or "").strip()
                            if pp_str:
                                pp = Path(pp_str).expanduser().resolve()
                            else:
                                pp = project_path()
                            scope_tokens = set_request_scope(proj.tenant_id, x_pid, pp)
                    finally:
                        db.close()
    except jwt.ExpiredSignatureError:
        pass
    except jwt.InvalidTokenError:
        pass
    except Exception:
        # 不因作用域解析失败阻断请求（回退到进程级 PROJECT_PATH）
        pass

    try:
        return await call_next(request)
    finally:
        if scope_tokens is not None:
            reset_request_scope(scope_tokens)
