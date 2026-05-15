"""
@module: sop_manager.memory_adapters.http
@purpose: MEMORY_BACKEND=http 时转发至 mem0 或兼容 HTTP 记忆服务
@env:
  MEMORY_HTTP_URL — 基址，如 https://mem0.example/api/v1
  MEMORY_HTTP_API_KEY — 可选 Bearer
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from sop_manager.memory_store import MemoryRecord, MemoryStore
from sop_manager.path_config import (
    resolved_business_code,
    resolved_project_code,
    resolved_tenant_code,
)


class HttpMemoryStore(MemoryStore):
    """将记忆操作代理到外部 HTTP API（mem0 风格契约）。"""

    def __init__(self) -> None:
        base = (os.getenv("MEMORY_HTTP_URL") or "").strip().rstrip("/")
        if not base:
            raise RuntimeError("MEMORY_BACKEND=http 需要设置 MEMORY_HTTP_URL")
        self._base = base
        self._key = (os.getenv("MEMORY_HTTP_API_KEY") or "").strip()
        self._timeout = float(os.getenv("MEMORY_HTTP_TIMEOUT", "30"))

    def _headers(self) -> dict[str, str]:
        h = {
            "Content-Type": "application/json",
            "X-Tenant-Code": resolved_tenant_code(),
            "X-Business-Code": resolved_business_code() or "",
            "X-Project-Code": resolved_project_code(),
        }
        if self._key:
            h["Authorization"] = f"Bearer {self._key}"
        return h

    def _scope_body(self) -> dict[str, str]:
        return {
            "tenant_code": resolved_tenant_code(),
            "business_code": resolved_business_code() or "",
            "project_code": resolved_project_code(),
        }

    def append(self, content: str, kind: str, metadata: dict[str, Any]) -> MemoryRecord:
        body = {
            **self._scope_body(),
            "content": content,
            "kind": kind,
            "metadata": metadata,
        }
        with httpx.Client(timeout=self._timeout) as client:
            r = client.post(f"{self._base}/memories", json=body, headers=self._headers())
            r.raise_for_status()
            data = r.json()
        item = data.get("item") if isinstance(data, dict) else data
        if isinstance(item, dict) and item.get("id"):
            return MemoryRecord(
                id=str(item["id"]),
                content=str(item.get("content", content)),
                kind=str(item.get("kind", kind)),
                metadata=item.get("metadata") if isinstance(item.get("metadata"), dict) else metadata,
                created_at=str(item.get("createdAt") or item.get("created_at") or ""),
            )
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        return MemoryRecord(id=str(uuid.uuid4()), content=content, kind=kind, metadata=metadata, created_at=now)

    def search(self, query: str, *, limit: int) -> list[dict[str, Any]]:
        params = {**self._scope_body(), "q": query, "limit": limit}
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(f"{self._base}/memories/search", params=params, headers=self._headers())
            r.raise_for_status()
            data = r.json()
        if isinstance(data, dict):
            items = data.get("items")
            if isinstance(items, list):
                return [x for x in items if isinstance(x, dict)]
        return []

    def recent(self, *, limit: int) -> list[dict[str, Any]]:
        params = {**self._scope_body(), "limit": limit}
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(f"{self._base}/memories/recent", params=params, headers=self._headers())
            r.raise_for_status()
            data = r.json()
        if isinstance(data, dict):
            items = data.get("items")
            if isinstance(items, list):
                return [x for x in items if isinstance(x, dict)]
        return []

    def forget(self, *, ids: list[str] | None = None, query: str = "", kind: str = "") -> dict[str, Any]:
        body = {**self._scope_body(), "ids": ids or [], "query": query, "kind": kind}
        with httpx.Client(timeout=self._timeout) as client:
            r = client.post(f"{self._base}/memories/forget", json=body, headers=self._headers())
            r.raise_for_status()
            data = r.json()
        return data if isinstance(data, dict) else {"ok": True}

    def summarize(self, *, query: str = "", limit: int = 50, metadata: dict[str, Any] | None = None) -> MemoryRecord:
        body = {**self._scope_body(), "query": query, "limit": limit, "metadata": metadata or {}}
        with httpx.Client(timeout=self._timeout) as client:
            r = client.post(f"{self._base}/memories/summarize", json=body, headers=self._headers())
            r.raise_for_status()
            data = r.json()
        item = data.get("item") if isinstance(data, dict) else data
        if isinstance(item, dict) and item.get("id"):
            return MemoryRecord(
                id=str(item["id"]),
                content=str(item.get("content", "")),
                kind=str(item.get("kind", "long")),
                metadata=item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
                created_at=str(item.get("createdAt") or item.get("created_at") or ""),
            )
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        return MemoryRecord(id=str(uuid.uuid4()), content=str(data), kind="long", metadata=metadata or {}, created_at=now)

    def attach_run(self, memory_id: str, run_id: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        body = {**self._scope_body(), "run_id": run_id, "metadata": metadata or {}}
        with httpx.Client(timeout=self._timeout) as client:
            r = client.post(f"{self._base}/memories/{memory_id}/attach-run", json=body, headers=self._headers())
            r.raise_for_status()
            data = r.json()
        return data if isinstance(data, dict) else {"ok": True}
