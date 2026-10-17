"""Agent 运行生命周期管理：run 表、心跳、状态机、能力画像。"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.metrics import current_trace_context, trace_context
from sop_manager.routers.scope_guard import attach_scope, scope_matches

from sop_manager.project_write_guard import project_file_write_scope

router = APIRouter(prefix="/api/v1/agent-runs", tags=["agent-runs"])
TERMINAL_STATUSES = {"success", "failed", "cancelled"}

def _runs_dir():
    d = resolved_ai_memory_root() / "agent_runs"
    return d

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _scope() -> dict:
    return {"tenant_code": resolved_tenant_code(), "business_code": resolved_business_code(), "project_id": resolved_project_id()}

def _all_runs() -> list[dict]:
    import json
    runs = []
    for f in _runs_dir().glob("run_*.json"):
        try:
            run = json.loads(f.read_text())
        except Exception:
            continue
        if isinstance(run, dict) and scope_matches(run, require_business=True):
            runs.append(run)
    return sorted(runs, key=lambda x: x.get("started_at", ""), reverse=True)

def _save_run(run: dict):
    with project_file_write_scope():
        _runs_dir().mkdir(parents=True, exist_ok=True)
        import json
        attach_scope(run)
        (_runs_dir() / f"run_{run['id']}.json").write_text(json.dumps(run, ensure_ascii=False, indent=2))

def _load_run(run_id: str) -> dict[str, Any]:
    import json
    p = _runs_dir() / f"run_{run_id}.json"
    if not p.exists():
        raise HTTPException(404, "run not found")
    try:
        run = json.loads(p.read_text())
    except Exception as exc:
        raise HTTPException(404, "run not found") from exc
    if not isinstance(run, dict) or not scope_matches(run, require_business=True):
        raise HTTPException(404, "run not found")
    return run

class RunCreate(BaseModel):
    agent_id: str
    task_id: str = ""
    meta: dict = Field(default_factory=dict)

class StatusUpdate(BaseModel):
    status: str
    error_msg: str = ""
    retry_count: int = 0

class CancelIn(BaseModel):
    reason: str = Field("manual", max_length=1000)

class EvidenceIn(BaseModel):
    artifact: dict = Field(default_factory=dict)
    gate_results: dict = Field(default_factory=dict)
    confidence: float = 1.0

@router.get("")
def list_runs(agent_id: str = "", status: str = "", limit: int = 100):
    runs = _all_runs()
    if agent_id:
        runs = [r for r in runs if r.get("agent_id") == agent_id]
    if status:
        runs = [r for r in runs if r.get("status") == status]
    return {**_scope(), "items": runs[:limit], "total": len(runs)}

@router.post("")
def create_run(body: RunCreate):
    trace = current_trace_context()
    run = {**_scope(), "id": str(uuid4()), "agent_id": body.agent_id, "task_id": body.task_id,
           "status": "pending", "started_at": _now(), "finished_at": None,
           "heartbeat_at": _now(), "confidence": None, "artifact": {}, "gate_results": {},
           "error_msg": "", "retry_count": 0, "retry_of": None, "cancel_reason": "",
           "trace_id": trace["trace_id"], "correlation_id": trace["correlation_id"],
           "meta": {**body.meta, "trace_id": body.meta.get("trace_id") or trace["trace_id"], "correlation_id": body.meta.get("correlation_id") or trace["correlation_id"]}}
    attach_scope(run, overwrite=True)
    _save_run(run)
    return run

@router.get("/summary")
def runs_summary():
    runs = _all_runs()
    total = len(runs)
    running = sum(1 for r in runs if r.get("status") == "running")
    success = sum(1 for r in runs if r.get("status") == "success")
    failed = sum(1 for r in runs if r.get("status") == "failed")
    retrying = sum(1 for r in runs if r.get("status") == "retrying")
    cancelled = sum(1 for r in runs if r.get("status") == "cancelled")
    durations = [
        (datetime.fromisoformat(r["finished_at"]) - datetime.fromisoformat(r["started_at"])).total_seconds()
        for r in runs if r.get("finished_at") and r.get("started_at")
    ]
    return {**_scope(), "summary": {"total": total, "running": running, "success": success, "failed": failed, "retrying": retrying, "cancelled": cancelled,
            "success_rate": round(success / total * 100, 1) if total else 0,
            "avg_duration_s": round(sum(durations) / len(durations), 1) if durations else 0}}

@router.put("/{run_id}/heartbeat")
def heartbeat(run_id: str):
    run = _load_run(run_id)
    run["heartbeat_at"] = _now()
    run["last_heartbeat_at"] = run["heartbeat_at"]
    _save_run(run)
    return {**_scope(), "id": run_id, "heartbeat_at": run["heartbeat_at"]}

@router.put("/{run_id}/status")
def update_status(run_id: str, body: StatusUpdate):
    run = _load_run(run_id)
    trace = current_trace_context()
    run.setdefault("trace_id", trace["trace_id"])
    run.setdefault("correlation_id", trace["correlation_id"])
    run["status"] = body.status
    run["error_msg"] = body.error_msg
    if body.retry_count:
        run["retry_count"] = body.retry_count
    if body.status in TERMINAL_STATUSES:
        run["finished_at"] = _now()
    if body.status == "retrying":
        run["finished_at"] = None
        run["retry_count"] = body.retry_count or (int(run.get("retry_count") or 0) + 1)
    _save_run(run)
    return run

@router.post("/{run_id}/retry")
def retry_run(run_id: str):
    run = _load_run(run_id)
    trace = current_trace_context()
    status = str(run.get("status") or "")
    if status not in {"failed", "cancelled", "retrying"}:
        raise HTTPException(400, "only failed/cancelled/retrying runs can be retried")
    now = _now()
    retry_count = int(run.get("retry_count") or 0) + 1
    run["status"] = "retrying"
    run["retry_count"] = retry_count
    run["retry_requested_at"] = now
    _save_run(run)
    retry = {
        **_scope(),
        "id": str(uuid4()),
        "agent_id": run.get("agent_id") or "",
        "task_id": run.get("task_id") or "",
        "status": "pending",
        "started_at": now,
        "finished_at": None,
        "heartbeat_at": now,
        "last_heartbeat_at": now,
        "confidence": run.get("confidence"),
        "artifact": run.get("artifact") if isinstance(run.get("artifact"), dict) else {},
        "gate_results": run.get("gate_results") if isinstance(run.get("gate_results"), dict) else {},
        "error_msg": "",
        "previous_error_msg": run.get("error_msg") or "",
        "retry_count": retry_count,
        "retry_of": run.get("retry_of") or run.get("id"),
        "cancel_reason": "",
        "trace_id": run.get("trace_id") or trace["trace_id"],
        "correlation_id": run.get("correlation_id") or trace["correlation_id"],
        "meta": {**(run.get("meta") if isinstance(run.get("meta"), dict) else {}), "retry_of": run.get("id"), "source": "retry"},
    }
    attach_scope(retry, overwrite=True)
    _save_run(retry)
    return retry

@router.post("/{run_id}/cancel")
def cancel_run(run_id: str, body: CancelIn = CancelIn()):
    run = _load_run(run_id)
    if str(run.get("status") or "") in TERMINAL_STATUSES:
        raise HTTPException(400, "terminal run cannot be cancelled")
    run["status"] = "cancelled"
    run["cancel_reason"] = body.reason
    run["finished_at"] = _now()
    _save_run(run)
    return run

@router.delete("/{run_id}")
def delete_run(run_id: str):
    p = _runs_dir() / f"run_{run_id}.json"
    _load_run(run_id)
    with project_file_write_scope():
        p.unlink()
    return {**_scope(), "deleted": run_id}

@router.post("/{run_id}/evidence")
def write_evidence(run_id: str, body: EvidenceIn):
    run = _load_run(run_id)
    run.update({"artifact": body.artifact, "gate_results": body.gate_results, "confidence": body.confidence})
    _save_run(run)
    return run

@router.get("/profiles")
def agent_profiles():
    from collections import defaultdict
    runs = _all_runs()
    profiles: dict[str, Any] = defaultdict(lambda: {"total": 0, "success": 0, "durations": []})
    for r in runs:
        aid = r.get("agent_id", "unknown")
        profiles[aid]["total"] += 1
        if r.get("status") == "success":
            profiles[aid]["success"] += 1
        if r.get("finished_at") and r.get("started_at"):
            try:
                d = (datetime.fromisoformat(r["finished_at"]) - datetime.fromisoformat(r["started_at"])).total_seconds()
                profiles[aid]["durations"].append(d)
            except Exception:
                pass
    result = []
    for aid, p in profiles.items():
        durs = p["durations"]
        result.append({"agent_id": aid, "total_runs": p["total"],
                        "success_rate": round(p["success"] / p["total"] * 100, 1) if p["total"] else 0,
                        "avg_duration_s": round(sum(durs) / len(durs), 1) if durs else 0})
    return {**_scope(), "profiles": result}
