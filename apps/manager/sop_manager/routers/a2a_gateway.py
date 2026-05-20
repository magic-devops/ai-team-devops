"""A2A 协议网关：外部 Agent 注册、能力协商、任务分发、执行证据回写。"""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.a2a_gateway_core import (
    build_a2a_governance_tasks,
    build_protocol_packet,
    evaluate_evidence_quality,
    normalize_capabilities,
    score_agent_match,
    summarize_a2a_health,
)

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
    priority: str = "P1"

class DispatchIn(BaseModel):
    agent_id: str
    task_id: str
    payload: dict = Field(default_factory=dict)

class EvidenceIn(BaseModel):
    dispatch_id: str
    status: str
    artifact: dict = Field(default_factory=dict)
    confidence: float = 1.0
    quality_gate_results: list[dict] = Field(default_factory=list)

class AgentStatus(BaseModel):
    status: str

class GovernanceTasksIn(BaseModel):
    dry_run: bool = True
    assigned_to: str = "Agent Platform"
    dev_tool: str = "codex"

@router.get("/registry")
def list_registry(agent_type: str = ""):
    items = _load_all("registry")
    if agent_type:
        items = [i for i in items if i.get("agent_type") == agent_type]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/registry")
def register_agent(body: AgentRegister):
    payload = body.model_dump()
    payload["capabilities"] = normalize_capabilities(payload.get("capabilities") or [])
    item = {**_scope(), "id": str(uuid4()), **payload,
            "status": "active", "success_rate": 0.8, "load": 0,
            "last_heartbeat_at": _now(), "created_at": _now()}
    _save("registry", item)
    return item

@router.put("/registry/{agent_id}")
def update_agent(agent_id: str, body: AgentRegister):
    import json
    p = _dir("registry") / f"{agent_id}.json"
    if not p.exists():
        raise HTTPException(404, "agent not found")
    item = json.loads(p.read_text())
    payload = body.model_dump()
    payload["capabilities"] = normalize_capabilities(payload.get("capabilities") or [])
    item.update(payload)
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
    task = body.model_dump()
    for a in agents:
        result = score_agent_match(a, task)
        if result["confidence"] > 0.05:
            matches.append(result)
    matches.sort(key=lambda x: x["confidence"], reverse=True)
    return {
        **_scope(),
        "task_type": body.task_type,
        "required_capabilities": normalize_capabilities(body.required_capabilities),
        "matches": matches[:5],
        "best_match": matches[0] if matches else None,
        "recommendation": "可直接分发给推荐 Agent" if matches and matches[0].get("decision") == "recommended" else "建议人工复核能力缺口后再分发",
    }

@router.post("/dispatch")
def dispatch_task(body: DispatchIn):
    import json
    p = _dir("registry") / f"{body.agent_id}.json"
    if not p.exists():
        raise HTTPException(404, "agent not found")
    agent = json.loads(p.read_text())
    item = {**_scope(), "id": str(uuid4()), "agent_id": body.agent_id, "task_id": body.task_id,
            "payload": body.payload, "status": "dispatched", "dispatched_at": _now()}
    item["protocol_packet"] = build_protocol_packet(item, agent, _scope())
    _save("dispatches", item)
    return item

@router.get("/dispatch/{dispatch_id}/packet")
def dispatch_packet(dispatch_id: str):
    import json
    p = _dir("dispatches") / f"{dispatch_id}.json"
    if not p.exists():
        raise HTTPException(404, "dispatch not found")
    dispatch = json.loads(p.read_text())
    agent_path = _dir("registry") / f"{dispatch.get('agent_id')}.json"
    agent = json.loads(agent_path.read_text()) if agent_path.exists() else {"id": dispatch.get("agent_id")}
    packet = dispatch.get("protocol_packet") or build_protocol_packet(dispatch, agent, _scope())
    return {**_scope(), "packet": packet}

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
    evidence = body.model_dump()
    quality = evaluate_evidence_quality(evidence)
    dispatch.update({"status": body.status, "artifact": body.artifact,
                     "confidence": body.confidence, "quality_gate_results": body.quality_gate_results,
                     "evidence_quality": quality, "evidence_at": _now()})
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
    return {**_scope(), "summary": summarize_a2a_health(registry, dispatches)}

@router.get("/health")
def health():
    registry = _load_all("registry")
    dispatches = _load_all("dispatches")
    summary = summarize_a2a_health(registry, dispatches)
    return {
        **_scope(),
        "summary": summary,
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 判断 A2A 网关是否适合接入、协商和分发任务",
            "apis": ["/api/v1/a2a/registry", "/api/v1/a2a/negotiate", "/api/v1/a2a/dispatch", "/api/v1/a2a/evidence"],
            "task_source": "a2a_protocol_governance",
        },
    }

@router.post("/governance-tasks")
def governance_tasks(body: GovernanceTasksIn):
    summary = summarize_a2a_health(_load_all("registry"), _load_all("dispatches"))
    drafts = build_a2a_governance_tasks(summary)
    for draft in drafts:
        draft["assigned_to"] = body.assigned_to or draft["assigned_to"]
        draft["dev_tool"] = body.dev_tool or draft["dev_tool"]
    if body.dry_run:
        return {**_scope(), "dry_run": True, "items": drafts, "created": []}
    from sop_manager.routers.tasks import TaskCreate, create_task
    created = []
    for draft in drafts:
        created.append(create_task(TaskCreate(**draft)))
    return {**_scope(), "dry_run": False, "items": drafts, "created": created}
