"""JWT + X-Project-Id → path_config 请求级作用域（single / saas 共用）。

无需项目作用域解析的「公开路径」使用前缀白名单，与 /api/v1 单一 API 面对齐。
"""
from __future__ import annotations

import os
from collections.abc import Callable
from contextvars import Token

import jwt
from fastapi import HTTPException, Request
from starlette.responses import JSONResponse, Response

from sop_manager.path_config import reset_request_scope
from sop_manager.routers import project_scope_resolve as psr


def _http_error_response(exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if not isinstance(detail, str):
        detail = str(detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": detail})


def _admin_mode() -> str:
    return (os.getenv("ADMIN_MODE", "single") or "single").strip().lower()


async def project_scope_middleware(request: Request, call_next: Callable) -> Response:
    from sop_manager.routers.auth_sql import ALGORITHM, SECRET_KEY, check_project_access
    from sop_manager.routers.sql_models import SessionLocal, User

    path = request.url.path
    if request.method == "OPTIONS" or psr.skip_scope(path):
        return await call_next(request)

    scope_tokens: tuple[Token, Token, Token, Token, Token, Token] | None = None
    auth = request.headers.get("Authorization") or ""

    try:
        if auth.startswith("Bearer "):
            raw = auth[7:].strip()
            if raw:
                payload = jwt.decode(raw, SECRET_KEY, algorithms=[ALGORITHM])
                request.state.jwt_payload = payload
                uid = payload.get("sub")
                if uid:
                    db = SessionLocal()
                    try:
                        user = db.get(User, uid)
                        if user and user.status == "active":
                            result = psr.resolve_scope_for_authenticated_user(
                                db,
                                user,
                                request,
                                admin_mode=_admin_mode(),
                                check_project_access=check_project_access,
                                http_error_response=_http_error_response,
                            )
                            if isinstance(result, JSONResponse):
                                return result
                            scope_tokens = result
                    finally:
                        db.close()
    except jwt.ExpiredSignatureError:
        pass
    except jwt.InvalidTokenError:
        pass
    except Exception:  # noqa: S110 — 与旧版一致：非法 JWT / DB 异常不阻塞无鉴权请求
        pass

    # API Key + HMAC（sop login --pair / agentd）：与 Bearer 同样注入项目作用域
    if scope_tokens is None:
        owner = getattr(request.state, "api_key_owner", None)
        if isinstance(owner, dict) and owner.get("user_id"):
            db = SessionLocal()
            try:
                user = db.get(User, owner["user_id"])
                if user and user.status == "active":
                    result = psr.resolve_scope_for_authenticated_user(
                        db,
                        user,
                        request,
                        admin_mode=_admin_mode(),
                        check_project_access=check_project_access,
                        http_error_response=_http_error_response,
                    )
                    if isinstance(result, JSONResponse):
                        return result
                    scope_tokens = result
            finally:
                db.close()

    try:
        return await call_next(request)
    finally:
        if scope_tokens is not None:
            reset_request_scope(scope_tokens)
