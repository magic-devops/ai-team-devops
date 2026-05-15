"""
@module: routers.context_api
@purpose: v4 请求上下文回显（三码 + 用户 + 路径摘要）
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from sop_manager.path_config import (
    request_scope_active,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
    resolved_tenant_id,
    runtime_paths_summary,
)
from sop_manager.routers.auth_sql import User, current_user

router = APIRouter(prefix="/api/v1/context", tags=["context"])


@router.get("/health")
def context_health() -> dict[str, Any]:
    return {"ok": True, "service": "context"}


@router.get("/me")
def context_me(user: User = Depends(current_user)) -> dict[str, Any]:
    if not request_scope_active():
        raise HTTPException(
            400,
            detail="需要 X-Project-Id 以绑定项目作用域；请在顶栏选择项目或在设置页登录后绑定",
        )
    return {
        "ok": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "tenant_id": user.tenant_id,
        },
        "scope": {
            "tenant_id": resolved_tenant_id(),
            "project_id": resolved_project_id(),
            "tenant_code": resolved_tenant_code(),
            "business_code": resolved_business_code(),
            "project_code": resolved_project_code(),
        },
        "paths": runtime_paths_summary(),
    }
