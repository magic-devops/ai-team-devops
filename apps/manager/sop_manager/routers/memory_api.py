"""
@module: routers.memory_api
@purpose: v4 记忆 REST（与 path_config 三码作用域对齐；可换后端）
"""
from __future__ import annotations

import os
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sop_manager.memory_store import get_memory_store
from sop_manager.path_config import request_scope_active

router = APIRouter(prefix="/api/v1/memory", tags=["memory"])


class MemoryCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=32000)
    kind: Literal["short", "long", "episodic"] = "long"
    metadata: dict[str, Any] = Field(default_factory=dict)


def _require_scope() -> None:
    if not request_scope_active():
        raise HTTPException(
            status_code=400,
            detail="需要登录且携带 X-Project-Id 以绑定记忆分区（tenant/business/project）",
        )


@router.get("/health")
def memory_health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "memory",
        "backend": (os.getenv("MEMORY_BACKEND") or "file").strip().lower() or "file",
        "scoped": request_scope_active(),
    }


@router.post("")
def memory_create(body: MemoryCreate) -> dict[str, Any]:
    _require_scope()
    try:
        store = get_memory_store()
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    rec = store.append(body.content, body.kind, body.metadata)
    return {"ok": True, "item": rec.to_json()}


@router.get("/search")
def memory_search(q: str = Query(..., min_length=1), limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    _require_scope()
    try:
        store = get_memory_store()
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    return {"ok": True, "items": store.search(q, limit=limit)}


@router.get("/recent")
def memory_recent(limit: int = Query(30, ge=1, le=200)) -> dict[str, Any]:
    _require_scope()
    try:
        store = get_memory_store()
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    return {"ok": True, "items": store.recent(limit=limit)}
