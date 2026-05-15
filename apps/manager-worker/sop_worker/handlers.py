"""
@module: sop_worker.handlers
@purpose: Redis Streams 任务类型分发（kb.index 等）
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

_log = logging.getLogger("sop_worker.handlers")


def _manager_base() -> str:
    return (os.environ.get("MANAGER_URL") or "http://127.0.0.1:8765").rstrip("/")


def _manager_headers() -> dict[str, str]:
    h: dict[str, str] = {"Content-Type": "application/json"}
    token = (os.environ.get("MANAGER_BEARER") or os.environ.get("SOP_BEARER_TOKEN") or "").strip()
    if token:
        h["Authorization"] = f"Bearer {token}"
    pid = (os.environ.get("PROJECT_ID") or os.environ.get("X_PROJECT_ID") or "").strip()
    if pid:
        h["X-Project-Id"] = pid
    for key, env in (
        ("X-Tenant-Code", "TENANT_CODE"),
        ("X-Business-Code", "BUSINESS_CODE"),
        ("X-Project-Code", "PROJECT_CODE"),
    ):
        v = (os.environ.get(env) or "").strip()
        if v:
            h[key] = v
    return h


def _patch_job(job_id: str, *, status: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
    body: dict[str, Any] = {"status": status}
    if result is not None:
        body["result"] = result
    if error is not None:
        body["error"] = error
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.patch(
                f"{_manager_base()}/api/v1/worker/jobs/{job_id}",
                json=body,
                headers=_manager_headers(),
            )
            if r.status_code == 404:
                _log.warning("job %s not found on manager", job_id)
    except Exception as e:
        _log.warning("patch job %s failed: %s", job_id, e)


def handle_task(job_id: str, job_type: str, payload: dict[str, Any]) -> None:
    _log.info("handle job_id=%s type=%s", job_id, job_type)
    _patch_job(job_id, status="running")
    try:
        if job_type in ("kb.index", "kb.reindex"):
            result = _run_kb_index()
        elif job_type == "memory.summarize":
            result = _run_memory_summarize(payload)
        elif job_type == "rag.warmup":
            result = {"ok": True, "note": "rag warmup noop"}
        else:
            raise ValueError(f"unknown job type: {job_type}")
        _patch_job(job_id, status="completed", result=result)
    except Exception as e:
        _log.exception("job %s failed", job_id)
        _patch_job(job_id, status="failed", error=str(e))
        raise


def _run_kb_index() -> dict[str, Any]:
    with httpx.Client(timeout=120.0) as client:
        r = client.post(f"{_manager_base()}/api/v1/knowledge/index", headers=_manager_headers())
        r.raise_for_status()
        data = r.json()
    return data if isinstance(data, dict) else {"ok": True}


def _run_memory_summarize(payload: dict[str, Any]) -> dict[str, Any]:
    limit = int(payload.get("limit") or 50)
    with httpx.Client(timeout=60.0) as client:
        r = client.get(
            f"{_manager_base()}/api/v1/memory/recent",
            params={"limit": limit},
            headers=_manager_headers(),
        )
        r.raise_for_status()
        data = r.json()
    items = data.get("items") if isinstance(data, dict) else []
    texts = [str(x.get("content", "")) for x in (items or []) if isinstance(x, dict)]
    summary = "\n".join(texts[:20])[:4000]
    return {"ok": True, "summarized_lines": len(texts), "preview": summary[:500]}
