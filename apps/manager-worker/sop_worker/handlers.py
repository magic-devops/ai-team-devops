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
            result = _run_rag_warmup(payload)
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


def _run_rag_warmup(payload: dict[str, Any]) -> dict[str, Any]:
    collections = payload.get("collections")
    if not isinstance(collections, list) or not collections:
        collections = ["tasks", "knowledge", "rules"]
    collections = [str(item).strip() for item in collections if str(item).strip()][:20]
    queries = payload.get("queries")
    if not isinstance(queries, list) or not queries:
        queries = ["Hermes 平台治理", "SOP 开发规约", "任务执行状态"]
    queries = [str(item).strip() for item in queries if str(item).strip()][:20]
    limit = max(1, min(int(payload.get("limit") or 6), 50))
    docs = payload.get("docs") if isinstance(payload.get("docs"), list) else []
    index_collection = str(payload.get("index_collection") or (collections[0] if collections else "knowledge")).strip()
    fail_on_error = bool(payload.get("fail_on_error"))

    searches: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    indexed: dict[str, Any] | None = None
    with httpx.Client(timeout=float(payload.get("timeout_seconds") or 60.0)) as client:
        health_resp = client.get(f"{_manager_base()}/api/v1/rag/health", headers=_manager_headers())
        health_resp.raise_for_status()
        health = health_resp.json()

        if docs:
            index_resp = client.post(
                f"{_manager_base()}/api/v1/rag/index",
                json={"collection": index_collection, "docs": docs[:100]},
                headers=_manager_headers(),
            )
            index_resp.raise_for_status()
            indexed_data = index_resp.json()
            indexed = indexed_data if isinstance(indexed_data, dict) else {"ok": True}

        for query in queries:
            try:
                resp = client.post(
                    f"{_manager_base()}/api/v1/rag/search",
                    json={"query": query, "collections": collections, "limit": limit, "hybrid": True, "rerank": False},
                    headers=_manager_headers(),
                )
                resp.raise_for_status()
                data = resp.json()
                items = data.get("items") if isinstance(data, dict) else []
                searches.append({"query": query, "hits": len(items or []), "sample_ids": [str(item.get("id") or "") for item in (items or [])[:5] if isinstance(item, dict)]})
            except Exception as exc:
                errors.append({"query": query, "error": str(exc)[:500]})
                if fail_on_error:
                    raise

    hits = sum(int(item.get("hits") or 0) for item in searches)
    return {
        "ok": not errors,
        "health": health if isinstance(health, dict) else {},
        "collections": collections,
        "queries": queries,
        "searches": len(searches),
        "hits": hits,
        "indexed": indexed,
        "errors": errors,
        "warmup_mode": "index_and_search" if docs else "search",
    }
