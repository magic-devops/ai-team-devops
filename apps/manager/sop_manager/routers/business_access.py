"""Authenticated project scope for legacy business and model endpoints.

An async dependency binds the context before synchronous endpoint workers are
started. This also works when HMAC owner verification follows scope middleware.
"""

import json
import os
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from sop_manager.path_config import reset_request_scope, resolved_project_id

from .auth_sql import _norm_role, check_project_access, current_user_or_apikey
from .project_scope_resolve import resolve_scope_for_authenticated_user
from .sql_models import Project, ProjectMember, User, get_session


def business_project_id(value: str | None = None) -> str:
    """Reject legacy query/body project overrides of the authorized header scope."""
    project_id = resolved_project_id()
    requested = (value or "").strip()
    if requested and requested != project_id:
        raise HTTPException(400, "project_id must match X-Project-Id")
    return project_id


def validate_business_references(db: Session | None = None, **references):
    """Business links must point to rows in the authenticated project and tenant."""
    from sop_manager.path_config import resolved_tenant_id

    from .sql_models import Requirement, SessionLocal, Sprint, Task

    if db is None:
        with SessionLocal() as session:
            return validate_business_references(session, **references)
    for field, model in (("req_id", Requirement), ("task_id", Task), ("sprint_id", Sprint)):
        value = references.get(field)
        if value and not db.query(model).filter_by(
            id=value, project_id=resolved_project_id(), tenant_id=resolved_tenant_id()
        ).first():
            raise HTTPException(404, f"{field} not found in the selected project")


def _authorize(request: Request, user: User, db: Session, permission: str):
    project_id = (request.headers.get("X-Project-Id") or "").strip()
    if not project_id:
        raise HTTPException(400, "Select a project using X-Project-Id")
    # Do not implicitly provision projects from this read/write guard.
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    check_project_access(user, project_id, db)
    member = db.get(ProjectMember, (project_id, user.id))
    role = _norm_role(member.role if member else user.role)
    user_role = _norm_role(user.role)
    admin = user_role == "super_admin" or (
        user_role == "tenant_admin" and user.tenant_id == project.tenant_id
    )
    allowed = {
        "read": True,
        "write": admin or role in {"project_admin", "developer", "devops", "product_manager"},
        "configure": admin or role == "project_admin",
    }
    if not allowed[permission]:
        raise HTTPException(403, f"Project {permission} permission required")
    override = (request.query_params.get("project_id") or "").strip()
    if override and override != project_id:
        raise HTTPException(400, "project_id must match X-Project-Id")

    def error_response(exc):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    tokens = resolve_scope_for_authenticated_user(
        db, user, request,
        admin_mode=(os.getenv("ADMIN_MODE", "single") or "single").strip().lower(),
        check_project_access=check_project_access,
        http_error_response=error_response,
        allow_provision=False,
    )
    if isinstance(tokens, JSONResponse):
        raise HTTPException(tokens.status_code, json.loads(tokens.body)["detail"])
    if tokens is None:
        raise HTTPException(400, "Project scope could not be resolved")
    return tokens


async def require_business_access(
    request: Request,
    user: Annotated[User, Depends(current_user_or_apikey)],
    db: Annotated[Session, Depends(get_session)],
):
    """GET/HEAD read access; mutation methods require project write access."""
    permission = "read" if request.method in {"GET", "HEAD", "OPTIONS"} else "write"
    tokens = _authorize(request, user, db, permission)
    try:
        yield user
    finally:
        reset_request_scope(tokens)


async def read_business_access(
    request: Request,
    user: Annotated[User, Depends(current_user_or_apikey)],
    db: Annotated[Session, Depends(get_session)],
):
    tokens = _authorize(request, user, db, "read")
    try:
        yield user
    finally:
        reset_request_scope(tokens)


async def configure_business_access(
    request: Request,
    user: Annotated[User, Depends(current_user_or_apikey)],
    db: Annotated[Session, Depends(get_session)],
):
    """Provider credentials and routing settings require project administration."""
    tokens = _authorize(request, user, db, "configure")
    try:
        yield user
    finally:
        reset_request_scope(tokens)
