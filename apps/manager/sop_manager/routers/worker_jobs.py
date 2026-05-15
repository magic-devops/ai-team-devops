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

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from sop_manager.path_config import request_scope_active, resolved_ai_memory_root

router = APIRouter(prefix="/api/v1/worker", tags=["worker"])

JobType = Literal["kb.index", "kb.reindex", "memory.summarize", "rag.warmup"]


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
    return {
        "ok": True,
        "service": "worker-jobs",
        "redis": redis_on,
        "stream": (os.environ.get("WORKER_TASK_STREAM") or "sop:tasks").strip(),
    }


@router.post("/jobs")
def enqueue_job(body: JobEnqueue) -> dict[str, Any]:
    if not request_scope_active():
        raise HTTPException(400, detail="需要登录且携带 X-Project-Id")
    job_id = f"job-{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    record: dict[str, Any] = {
        "id": job_id,
        "type": body.type,
        "payload": body.payload,
        "status": "queued",
        "created_at": now,
        "updated_at": now,
        "result": None,
        "error": None,
        "idempotency_key": body.idempotency_key or None,
    }
    _write_job(job_id, record)
    queued = _enqueue_redis(job_id, body.type, body.payload)
    if not queued:
        record["status"] = "pending_local"
        record["note"] = "REDIS_URL 未配置；请本地运行 sop-worker 或配置 Redis"
        _write_job(job_id, record)
    return {"ok": True, "job_id": job_id, "status": record["status"], "queued": queued}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    rec = _read_job(job_id)
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
    rec = _read_job(job_id)
    if not rec:
        raise HTTPException(404, "任务不存在")
    update_job_status(job_id, status=body.status, result=body.result, error=body.error)
    return {"ok": True}


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
    rec["updated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    if result is not None:
        rec["result"] = result
    if error is not None:
        rec["error"] = error
    _write_job(job_id, rec)
    if status in ("completed", "failed"):
        try:
            from sop_manager.path_config import resolved_project_id
            from sop_manager.routers.ws_events import broadcast

            pid = resolved_project_id()
            if pid:
                broadcast(
                    pid,
                    {
                        "specversion": "1.0",
                        "type": f"sop.worker.job.{status}",
                        "source": "manager/worker",
                        "id": job_id,
                        "data": {"job_id": job_id, "status": status, "type": rec.get("type")},
                    },
                )
        except Exception:
            pass
