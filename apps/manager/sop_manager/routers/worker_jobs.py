"""
@module: routers.worker_jobs
@purpose: 异步任务投递（Redis Streams）与状态查询；KB 索引等长任务走 Worker
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sop_manager.path_config import (
    request_scope_active,
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
    resolved_tenant_id,
)

router = APIRouter(prefix="/api/v1/worker", tags=["worker"])

JobType = Literal["kb.index", "kb.reindex", "memory.summarize", "rag.warmup"]

JOB_TYPES: dict[str, dict[str, Any]] = {
    "kb.index": {
        "name": "Knowledge index",
        "description": "增量索引知识库、规约和项目文档。",
        "queue": "knowledge",
        "payload_schema": {"paths": "list[str] optional", "category": "string optional"},
    },
    "kb.reindex": {
        "name": "Knowledge full reindex",
        "description": "重建知识库索引，适合迁移或向量库切换后执行。",
        "queue": "knowledge",
        "payload_schema": {"force": "boolean optional"},
    },
    "memory.summarize": {
        "name": "Memory summarize",
        "description": "压缩项目记忆，沉淀长期摘要。",
        "queue": "memory",
        "payload_schema": {"days": "number optional", "limit": "number optional"},
    },
    "rag.warmup": {
        "name": "RAG warmup",
        "description": "预热 RAG 检索缓存和热门集合。",
        "queue": "rag",
        "payload_schema": {"collections": "list[str] optional"},
    },
}

TERMINAL_STATUSES = {"completed", "failed", "canceled"}
MUTABLE_STATUSES = {"queued", "pending_local", "running"}


class JobEnqueue(BaseModel):
    type: JobType
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = ""


def _jobs_dir() -> Path:
    d = resolved_ai_memory_root() / "worker-jobs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _job_path(job_id: str) -> Path:
    return _jobs_dir() / f"{job_id}.json"


def _write_job(job_id: str, data: dict[str, Any]) -> None:
    _job_path(job_id).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_job(job_id: str) -> dict[str, Any] | None:
    p = _job_path(job_id)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _safe_job_id(job_id: str) -> str:
    value = "".join(c for c in job_id.strip() if c.isalnum() or c in "-_")[:80]
    if not value:
        raise HTTPException(400, "job_id 不能为空")
    return value


def _list_jobs(
    *,
    status: str = "",
    job_type: str = "",
    limit: int = 100,
    include_all_projects: bool = False,
) -> list[dict[str, Any]]:
    tenant_id = resolved_tenant_id()
    project_id = resolved_project_id()
    rows: list[dict[str, Any]] = []
    for path in _jobs_dir().glob("*.json"):
        rec = _read_job(path.stem)
        if not rec:
            continue
        if rec.get("tenant_id") and rec.get("tenant_id") != tenant_id:
            continue
        if not include_all_projects and rec.get("project_id") and rec.get("project_id") != project_id:
            continue
        if status and rec.get("status") != status:
            continue
        if job_type and rec.get("type") != job_type:
            continue
        rows.append(rec)
    rows.sort(key=lambda x: str(x.get("updated_at") or x.get("created_at") or ""), reverse=True)
    return rows[: max(1, min(int(limit), 500))]


def _find_idempotent_job(job_type: str, key: str) -> dict[str, Any] | None:
    if not key:
        return None
    for rec in _list_jobs(job_type=job_type, limit=500, include_all_projects=False):
        if rec.get("idempotency_key") == key and rec.get("status") not in TERMINAL_STATUSES:
            return rec
    return None


def _emit_job_event(job_id: str, status: str, rec: dict[str, Any]) -> None:
    try:
        from sop_manager.routers.ws_events import broadcast

        pid = str(rec.get("project_id") or resolved_project_id())
        if pid:
            broadcast(
                pid,
                {
                    "specversion": "1.0",
                    "type": f"sop.worker.job.{status}",
                    "source": "manager/worker",
                    "id": job_id,
                    "data": {
                        "job_id": job_id,
                        "status": status,
                        "type": rec.get("type"),
                        "tenant_id": rec.get("tenant_id"),
                        "project_id": rec.get("project_id"),
                    },
                },
            )
    except Exception:
        pass


def _enqueue_redis(job_id: str, job_type: str, payload: dict[str, Any]) -> bool:
    url = (os.environ.get("REDIS_URL") or "").strip()
    if not url:
        return False
    try:
        import redis
    except ImportError:
        return False
    stream = (os.environ.get("WORKER_TASK_STREAM") or "sop:tasks").strip()
    client = redis.from_url(url, decode_responses=True)
    client.xadd(
        stream,
        {
            "job_id": job_id,
            "type": job_type,
            "payload": json.dumps(payload, ensure_ascii=False),
        },
    )
    return True


@router.get("/health")
def worker_health() -> dict[str, Any]:
    redis_on = bool((os.environ.get("REDIS_URL") or "").strip())
    summary = _summary()
    return {
        "ok": True,
        "service": "worker-jobs",
        "redis": redis_on,
        "stream": (os.environ.get("WORKER_TASK_STREAM") or "sop:tasks").strip(),
        "fallback": "file",
        "supported_types": list(JOB_TYPES.keys()),
        "summary": summary,
    }


@router.get("/types")
def worker_types() -> dict[str, Any]:
    return {"ok": True, "items": [{"id": k, **v} for k, v in JOB_TYPES.items()]}


def _summary() -> dict[str, Any]:
    rows = _list_jobs(limit=500, include_all_projects=False)
    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for rec in rows:
        status = str(rec.get("status") or "unknown")
        job_type = str(rec.get("type") or "unknown")
        by_status[status] = by_status.get(status, 0) + 1
        by_type[job_type] = by_type.get(job_type, 0) + 1
    active = sum(by_status.get(s, 0) for s in ("queued", "pending_local", "running"))
    terminal = sum(by_status.get(s, 0) for s in TERMINAL_STATUSES)
    return {
        "total": len(rows),
        "active": active,
        "terminal": terminal,
        "by_status": by_status,
        "by_type": by_type,
    }


@router.get("/summary")
def worker_summary() -> dict[str, Any]:
    return {"ok": True, **_summary()}


@router.get("/jobs")
def list_jobs(
    status: str = "",
    type: str = "",
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    return {"ok": True, "items": _list_jobs(status=status, job_type=type, limit=limit), "summary": _summary()}


@router.post("/jobs")
def enqueue_job(body: JobEnqueue) -> dict[str, Any]:
    if not request_scope_active():
        raise HTTPException(400, detail="需要登录且携带 X-Project-Id")
    if body.type not in JOB_TYPES:
        raise HTTPException(400, f"不支持的任务类型: {body.type}")
    existing = _find_idempotent_job(body.type, body.idempotency_key)
    if existing:
        return {
            "ok": True,
            "job_id": existing["id"],
            "status": existing.get("status"),
            "queued": existing.get("status") == "queued",
            "idempotent": True,
        }
    job_id = f"job-{uuid.uuid4().hex[:16]}"
    now = _now()
    record: dict[str, Any] = {
        "id": job_id,
        "type": body.type,
        "payload": body.payload,
        "status": "queued",
        "created_at": now,
        "updated_at": now,
        "tenant_id": resolved_tenant_id(),
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
        "result": None,
        "error": None,
        "idempotency_key": body.idempotency_key or None,
        "attempt": 1,
        "retry_of": None,
    }
    _write_job(job_id, record)
    queued = _enqueue_redis(job_id, body.type, body.payload)
    if not queued:
        record["status"] = "pending_local"
        record["note"] = "REDIS_URL 未配置；请本地运行 sop-worker 或配置 Redis"
        _write_job(job_id, record)
    _emit_job_event(job_id, record["status"], record)
    return {"ok": True, "job_id": job_id, "status": record["status"], "queued": queued}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    rec = _read_job(_safe_job_id(job_id))
    if not rec:
        raise HTTPException(404, "任务不存在")
    return {"ok": True, "job": rec}


class JobPatch(BaseModel):
    status: str
    result: dict[str, Any] | None = None
    error: str | None = None


@router.patch("/jobs/{job_id}")
def patch_job(job_id: str, body: JobPatch) -> dict[str, Any]:
    """Worker 回写任务状态（内网 / 带 Bearer）。"""
    job_id = _safe_job_id(job_id)
    rec = _read_job(job_id)
    if not rec:
        raise HTTPException(404, "任务不存在")
    update_job_status(job_id, status=body.status, result=body.result, error=body.error)
    return {"ok": True}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict[str, Any]:
    job_id = _safe_job_id(job_id)
    rec = _read_job(job_id)
    if not rec:
        raise HTTPException(404, "任务不存在")
    if rec.get("status") in TERMINAL_STATUSES:
        return {"ok": True, "job": rec, "changed": False}
    update_job_status(job_id, status="canceled", result={"reason": "manual_cancel"})
    return {"ok": True, "job": _read_job(job_id), "changed": True}


@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: str) -> dict[str, Any]:
    job_id = _safe_job_id(job_id)
    rec = _read_job(job_id)
    if not rec:
        raise HTTPException(404, "任务不存在")
    if not request_scope_active():
        raise HTTPException(400, detail="需要登录且携带 X-Project-Id")
    new_id = f"job-{uuid.uuid4().hex[:16]}"
    now = _now()
    attempt = int(rec.get("attempt") or 1) + 1
    new_rec = {
        **rec,
        "id": new_id,
        "status": "queued",
        "created_at": now,
        "updated_at": now,
        "result": None,
        "error": None,
        "attempt": attempt,
        "retry_of": rec.get("retry_of") or job_id,
        "idempotency_key": None,
        "tenant_id": resolved_tenant_id(),
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
    }
    _write_job(new_id, new_rec)
    queued = _enqueue_redis(new_id, str(new_rec["type"]), dict(new_rec.get("payload") or {}))
    if not queued:
        new_rec["status"] = "pending_local"
        new_rec["note"] = "REDIS_URL 未配置；请本地运行 sop-worker 或配置 Redis"
        _write_job(new_id, new_rec)
    _emit_job_event(new_id, str(new_rec["status"]), new_rec)
    return {"ok": True, "job_id": new_id, "status": new_rec["status"], "queued": queued, "retry_of": job_id}


def update_job_status(
    job_id: str,
    *,
    status: str,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    rec = _read_job(job_id)
    if not rec:
        return
    rec["status"] = status
    rec["updated_at"] = _now()
    if result is not None:
        rec["result"] = result
    if error is not None:
        rec["error"] = error
    _write_job(job_id, rec)
    _emit_job_event(job_id, status, rec)
