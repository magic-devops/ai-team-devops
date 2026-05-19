"""Agent 运行生命周期管理：run 表、心跳、状态机、能力画像。"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id

router = APIRouter(prefix="/api/v1/agent-runs", tags=["agent-runs"])

def _runs_dir():
    d = resolved_ai_memory_root() / "agent_runs"
    d.mkdir(parents=True, exist_ok=True)
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
            runs.append(json.loads(f.read_text()))
        except Exception:
            pass
    return sorted(runs, key=lambda x: x.get("started_at", ""), reverse=True)

def _save_run(run: dict):
    import json
    (_runs_dir() / f"run_{run['id']}.json").write_text(json.dumps(run, ensure_ascii=False, indent=2))

class RunCreate(BaseModel):
    agent_id: str
    task_id: str = ""
    meta: dict = Field(default_factory=dict)

class StatusUpdate(BaseModel):
    status: str
    error_msg: str = ""
    retry_count: int = 0

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
    run = {**_scope(), "id": str(uuid4()), "agent_id": body.agent_id, "task_id": body.task_id,
           "status": "pending", "started_at": _now(), "finished_at": None,
           "heartbeat_at": _now(), "confidence": None, "artifact": {}, "gate_results": {},
           "error_msg": "", "retry_count": 0, "meta": body.meta}
    _save_run(run)
    return run

@router.get("/summary")
def runs_summary():
    runs = _all_runs()
    total = len(runs)
    running = sum(1 for r in runs if r.get("status") == "running")
    success = sum(1 for r in runs if r.get("status") == "success")
    failed = sum(1 for r in runs if r.get("status") == "failed")
    durations = [
        (datetime.fromisoformat(r["finished_at"]) - datetime.fromisoformat(r["started_at"])).total_seconds()
        for r in runs if r.get("finished_at") and r.get("started_at")
    ]
    return {**_scope(), "summary": {"total": total, "running": running, "success": success, "failed": failed,
            "success_rate": round(success / total * 100, 1) if total else 0,
            "avg_duration_s": round(sum(durations) / len(durations), 1) if durations else 0}}

@router.put("/{run_id}/heartbeat")
def heartbeat(run_id: str):
    import json
    p = _runs_dir() / f"run_{run_id}.json"
    if not p.exists():
        raise HTTPException(404, "run not found")
    run = json.loads(p.read_text())
    run["heartbeat_at"] = _now()
    _save_run(run)
    return {**_scope(), "id": run_id, "heartbeat_at": run["heartbeat_at"]}

@router.put("/{run_id}/status")
def update_status(run_id: str, body: StatusUpdate):
    import json
    p = _runs_dir() / f"run_{run_id}.json"
    if not p.exists():
        raise HTTPException(404, "run not found")
    run = json.loads(p.read_text())
    run["status"] = body.status
    run["error_msg"] = body.error_msg
    run["retry_count"] = body.retry_count
    if body.status in ("success", "failed"):
        run["finished_at"] = _now()
    if body.status == "retrying":
        run["finished_at"] = None
        run["retry_count"] = body.retry_count or (int(run.get("retry_count") or 0) + 1)
    _save_run(run)
    return run

@router.delete("/{run_id}")
def delete_run(run_id: str):
    p = _runs_dir() / f"run_{run_id}.json"
    if not p.exists():
        raise HTTPException(404, "run not found")
    p.unlink()
    return {**_scope(), "deleted": run_id}

@router.post("/{run_id}/evidence")
def write_evidence(run_id: str, body: EvidenceIn):
    import json
    p = _runs_dir() / f"run_{run_id}.json"
    if not p.exists():
        raise HTTPException(404, "run not found")
    run = json.loads(p.read_text())
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
