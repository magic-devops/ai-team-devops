"""A2A 协议网关：外部 Agent 注册、能力协商、任务分发、执行证据回写。"""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id

router = APIRouter(prefix="/api/v1/a2a", tags=["a2a"])

def _dir(sub: str):
    d = resolved_ai_memory_root() / "a2a" / sub
    d.mkdir(parents=True, exist_ok=True)
    return d

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _scope() -> dict:
    return {"tenant_code": resolved_tenant_code(), "business_code": resolved_business_code(), "project_id": resolved_project_id()}

def _load_all(sub: str) -> list[dict]:
    import json
    items = []
    for f in _dir(sub).glob("*.json"):
        try:
            items.append(json.loads(f.read_text()))
        except Exception:
            pass
    return sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)

def _save(sub: str, item: dict):
    import json
    (_dir(sub) / f"{item['id']}.json").write_text(json.dumps(item, ensure_ascii=False, indent=2))

class AgentRegister(BaseModel):
    name: str
    agent_type: str = "custom"
    endpoint: str = ""
    capabilities: list[str] = Field(default_factory=list)

class NegotiateIn(BaseModel):
    task_type: str
    task_description: str = ""
    required_capabilities: list[str] = Field(default_factory=list)

class DispatchIn(BaseModel):
    agent_id: str
    task_id: str
    payload: dict = Field(default_factory=dict)

class EvidenceIn(BaseModel):
    dispatch_id: str
    status: str
    artifact: dict = Field(default_factory=dict)
    confidence: float = 1.0

class AgentStatus(BaseModel):
    status: str

@router.get("/registry")
def list_registry(agent_type: str = ""):
    items = _load_all("registry")
    if agent_type:
        items = [i for i in items if i.get("agent_type") == agent_type]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/registry")
def register_agent(body: AgentRegister):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(),
            "status": "active", "last_heartbeat_at": _now(), "created_at": _now()}
    _save("registry", item)
    return item

@router.put("/registry/{agent_id}")
def update_agent(agent_id: str, body: AgentRegister):
    import json
    p = _dir("registry") / f"{agent_id}.json"
    if not p.exists():
        raise HTTPException(404, "agent not found")
    item = json.loads(p.read_text())
    item.update(body.model_dump())
    _save("registry", item)
    return item

@router.delete("/registry/{agent_id}")
def deregister_agent(agent_id: str):
    p = _dir("registry") / f"{agent_id}.json"
    if not p.exists():
        raise HTTPException(404, "agent not found")
    p.unlink()
    return {**_scope(), "deleted": agent_id}

@router.put("/registry/{agent_id}/status")
def update_agent_status(agent_id: str, body: AgentStatus):
    import json
    p = _dir("registry") / f"{agent_id}.json"
    if not p.exists():
        raise HTTPException(404, "agent not found")
    item = json.loads(p.read_text())
    item.update({"status": body.status, "last_heartbeat_at": _now() if body.status == "active" else item.get("last_heartbeat_at")})
    _save("registry", item)
    return item

@router.post("/negotiate")
def negotiate(body: NegotiateIn):
    agents = _load_all("registry")
    matches = []
    for a in agents:
        if a.get("status") != "active":
            continue
        caps = set(a.get("capabilities", []))
        required = set(body.required_capabilities)
        overlap = len(caps & required)
        confidence = overlap / len(required) if required else 0.5
        if confidence > 0 or not required:
            matches.append({"agent_id": a["id"], "name": a["name"], "confidence": round(confidence, 2)})
    matches.sort(key=lambda x: x["confidence"], reverse=True)
    return {**_scope(), "task_type": body.task_type, "matches": matches[:5]}

@router.post("/dispatch")
def dispatch_task(body: DispatchIn):
    if not (_dir("registry") / f"{body.agent_id}.json").exists():
        raise HTTPException(404, "agent not found")
    item = {**_scope(), "id": str(uuid4()), "agent_id": body.agent_id, "task_id": body.task_id,
            "payload": body.payload, "status": "dispatched", "dispatched_at": _now()}
    _save("dispatches", item)
    return item

@router.get("/dispatch")
def list_dispatches(agent_id: str = "", status: str = ""):
    items = _load_all("dispatches")
    if agent_id:
        items = [i for i in items if i.get("agent_id") == agent_id]
    if status:
        items = [i for i in items if i.get("status") == status]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/evidence")
def receive_evidence(body: EvidenceIn):
    import json
    p = _dir("dispatches") / f"{body.dispatch_id}.json"
    if not p.exists():
        raise HTTPException(404, "dispatch not found")
    dispatch = json.loads(p.read_text())
    dispatch.update({"status": body.status, "artifact": body.artifact,
                     "confidence": body.confidence, "evidence_at": _now()})
    _save("dispatches", dispatch)
    return dispatch

@router.get("/evidence")
def list_evidence(agent_id: str = ""):
    items = [d for d in _load_all("dispatches") if d.get("evidence_at")]
    if agent_id:
        items = [i for i in items if i.get("agent_id") == agent_id]
    return {**_scope(), "items": items, "total": len(items)}

@router.get("/summary")
def summary():
    registry = _load_all("registry")
    dispatches = _load_all("dispatches")
    evidence = [d for d in dispatches if d.get("evidence_at")]
    return {**_scope(), "summary": {
        "registered_agents": len(registry),
        "active": sum(1 for a in registry if a.get("status") == "active"),
        "dispatched_tasks": len(dispatches),
        "evidence_received": len(evidence)}}
