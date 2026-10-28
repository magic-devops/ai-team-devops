"""项目作用域解析逻辑（JWT 已校验后）：供 ``project_scope_middleware`` 调用，降低中间件圈复杂度。"""
from __future__ import annotations

import os
from collections.abc import Callable
from contextvars import Token
from pathlib import Path

from fastapi import HTTPException, Request
from starlette.responses import JSONResponse

from sop_manager.path_config import project_path, set_request_scope

# 静态资源与公开 API 前缀（与 middleware 白名单同步演进）
_SKIP_EXACT_PATHS = frozenset(
    {
        "/",
        "/index.html",
        "/login.html",
        "/console.html",
        "/favicon.ico",
        "/vite.svg",
        "/openapi.json",
        "/redoc",
        "/docs",
        "/api/v1/health",
        "/api/v1/health/counters",
        "/api/v1/memory/health",
        "/api/v1/sync/health",
        "/api/v1/worker/health",
        "/api/v1/analytics/health",
        "/api/v1/context/health",
        "/api/v1/platforms/health",
    }
)
_SKIP_PREFIXES = (
    "/assets/",
    "/pages/",
    "/.well-known",
    "/ws",
    "/api/v1/auth",
    "/metrics",
    "/api/v1/llm/health",
    "/api/v1/rag/health",
    "/api/v1/copilot/health",
    "/api/v1/workflows/_health",
    "/api/v1/marketplace/registries",
)

_EXISTING_PROJECT_PREFIXES = (
    "/api/v1/projects", "/api/v1/design-docs",
    "/api/v1/requirements", "/api/v1/tasks", "/api/v1/issues",
    "/api/v1/sprints", "/api/v1/models", "/api/v1/llm",
    "/api/v1/events", "/api/v1/reflections", "/api/v1/sync",
    "/api/v1/delivery", "/api/v1/dev-flow", "/api/v1/analytics/nlq", "/api/v1/workflows",
    "/api/v1/search", "/api/v1/semantic-search", "/api/v1/state",
    "/api/v1/custom", "/api/v1/agent-reflections", "/api/v1/rules", "/api/v1/knowledge",
    "/api/v1/data-exchange", "/api/v1/knowledge-graph",
)

_EXISTING_PROJECT_EXACT_PATHS = frozenset({
    "/api/v1/system/pages/capabilities/me", "/api/v1/system/pages/capabilities/check",
    "/api/v1/dashboard", "/api/v1/analytics",
    "/api/v1/pages/interaction-ops",
    "/api/v1/system/pages/governance-tasks",
})


def existing_project_required(path: str) -> bool:
    """Protected business routes must never bootstrap projects from request headers."""
    return (
        path in _EXISTING_PROJECT_EXACT_PATHS
        or path in {"/api/v1/events:ingest", "/api/v1/events:identity"}
        or any(path == p or path.startswith(p + "/") for p in _EXISTING_PROJECT_PREFIXES)
    )


def skip_scope(path: str) -> bool:
    """无需绑定项目根路径的请求。"""
    if path in _SKIP_EXACT_PATHS:
        return True
    if path.startswith("/docs"):
        return True
    if path.startswith("/metrics"):
        return True
    if path.startswith("/api/v1/sso/") and (
        "/login" in path or "/callback" in path or "/saml/" in path
    ):
        return True
    return any(path.startswith(p) for p in _SKIP_PREFIXES)


def _derive_v4_codes(db: object, proj: object) -> tuple[str, str | None, str]:
    """从 Tenant.slug / Business.id / Project.id 推导 v4 三码。"""
    from sop_manager.routers.sql_models import Business, Tenant

    tenant_code = str(getattr(proj, "tenant_id", "") or "")
    business_code: str | None = None
    project_code = str(getattr(proj, "id", "") or "")
    trow = db.get(Tenant, getattr(proj, "tenant_id", "") or "")
    if trow is not None:
        slug = (getattr(trow, "slug", None) or "").strip()
        tenant_code = slug or str(trow.id)
    bid = getattr(proj, "business_id", None)
    if bid:
        brow = db.get(Business, bid)
        if brow is not None:
            business_code = str(brow.id)
    return tenant_code, business_code, project_code


def _v4_optional_headers_consistent(
    request: Request,
    *,
    tenant_code: str,
    business_code: str | None,
    project_code: str,
    admin_mode: str,
) -> str | None:
    """SaaS 下若客户端显式传三码头，须与 DB 推导一致；否则返回错误文案。"""
    if admin_mode != "saas":
        return None
    h_t = (request.headers.get("X-Tenant-Code") or "").strip()
    h_b = (request.headers.get("X-Business-Code") or "").strip()
    h_p = (request.headers.get("X-Project-Code") or "").strip()
    if not (h_t or h_b or h_p):
        return None
    if h_t and h_t != tenant_code:
        return "X-Tenant-Code 与令牌解析的租户码不一致"
    if h_p and h_p != project_code:
        return "X-Project-Code 与当前项目解析不一致"
    if h_b:
        expect = (business_code or "").strip()
        if expect != h_b:
            return "X-Business-Code 与项目绑定业务不一致"
    return None


def resolve_scope_for_authenticated_user(
    db: object,
    user: object,
    request: Request,
    *,
    admin_mode: str,
    check_project_access: Callable[..., None],
    http_error_response: Callable[[HTTPException], JSONResponse],
    allow_provision: bool = True,
) -> tuple[Token, Token, Token, Token, Token, Token] | JSONResponse | None:
    """成功返回 ``set_request_scope`` 的 token 元组；错误返回 ``JSONResponse``；无需绑定时返回 ``None``。"""
    from sop_manager.routers.sql_models import Project, ProjectMember

    x_pid = (request.headers.get("X-Project-Id") or "").strip()
    if not x_pid and not allow_provision:
        # The route dependency supplies the explicit-project error after authentication.
        return None
    if not x_pid:
        if admin_mode != "saas":
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
        return None

    proj = db.query(Project).filter_by(id=x_pid).first()
    if not proj and admin_mode != "saas" and allow_provision:
        from sop_manager.project_provision import ensure_project

        proj = ensure_project(db, x_pid, owner_user=user)
        if proj:
            db.flush()
    if not proj:
        if admin_mode != "saas" and allow_provision:
            return None
        return JSONResponse(status_code=404, content={"detail": "项目不存在"})
    if user.role != "super_admin" and proj.tenant_id != user.tenant_id:
        return JSONResponse(status_code=403, content={"detail": "无项目访问权限"})
    if user.role not in ("super_admin", "tenant_admin"):
        try:
            check_project_access(user, x_pid, db, "viewer")
        except HTTPException as he:
            return http_error_response(he)

    pp_str = (proj.project_path or "").strip()
    pp = Path(pp_str).expanduser().resolve() if pp_str else project_path()
    tenant_code, business_code, project_code = _derive_v4_codes(db, proj)
    drift = _v4_optional_headers_consistent(
        request,
        tenant_code=tenant_code,
        business_code=business_code,
        project_code=project_code,
        admin_mode=admin_mode,
    )
    if drift:
        return JSONResponse(status_code=400, content={"detail": drift})
    return set_request_scope(
        proj.tenant_id,
        x_pid,
        pp,
        tenant_code=tenant_code,
        business_code=business_code,
        project_code=project_code,
    )
