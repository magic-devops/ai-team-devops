"""LLM 网关 v2：模型路由、成本统计、限流策略。"""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.llm_gateway_core import (
    build_gateway_governance_tasks,
    select_llm_route,
    summarize_gateway_health,
)

router = APIRouter(prefix="/api/v1/llm-gateway", tags=["llm-gateway"])

def _dir(sub: str):
    d = resolved_ai_memory_root() / "llm_gateway" / sub
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

class RouteCreate(BaseModel):
    name: str
    task_type: str = "general"
    model_id: str
    priority: int = 0
    fallback_model_id: str = ""
    enabled: bool = True

class ThrottleCreate(BaseModel):
    model_id: str
    rpm_limit: int = 60
    tpm_limit: int = 100000
    enabled: bool = True

class UsageRecord(BaseModel):
    model_id: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    task_type: str = "general"

class DecisionIn(BaseModel):
    task_type: str = "general"
    estimated_prompt_tokens: int = 0
    estimated_completion_tokens: int = 0
    required_quality: str = "balanced"
    allow_fallback: bool = True

class GovernanceTasksIn(BaseModel):
    dry_run: bool = True
    assigned_to: str = "AI Platform"
    dev_tool: str = "codex"

@router.get("/routes")
def list_routes():
    return {**_scope(), "items": _load_all("routes"), "total": len(_load_all("routes"))}

@router.post("/routes")
def create_route(body: RouteCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "created_at": _now()}
    _save("routes", item)
    return item

@router.put("/routes/{route_id}")
def update_route(route_id: str, body: RouteCreate):
    import json
    p = _dir("routes") / f"{route_id}.json"
    if not p.exists():
        raise HTTPException(404, "route not found")
    item = json.loads(p.read_text())
    item.update(body.model_dump())
    _save("routes", item)
    return item

@router.delete("/routes/{route_id}")
def delete_route(route_id: str):
    p = _dir("routes") / f"{route_id}.json"
    if not p.exists():
        raise HTTPException(404, "route not found")
    p.unlink()
    return {**_scope(), "deleted": route_id}

@router.post("/resolve")
def resolve_route(task_type: str = "general"):
    routes = [r for r in _load_all("routes") if r.get("enabled")]
    exact = [r for r in routes if r.get("task_type") == task_type]
    candidates = exact or [r for r in routes if r.get("task_type") == "general"] or routes
    candidates.sort(key=lambda r: int(r.get("priority") or 0), reverse=True)
    if not candidates:
        raise HTTPException(404, "no enabled route")
    return {**_scope(), "task_type": task_type, "route": candidates[0]}

@router.post("/decision")
def route_decision(body: DecisionIn):
    decision = select_llm_route(body.model_dump(), _load_all("routes"), _load_all("throttle"), _load_all("usage"))
    return {
        **_scope(),
        "decision": decision,
        "agent_consumption": {
            "purpose": "供 Copilot/Agent 调用模型前选择路由、评估成本、判断 fallback 和限流风险",
            "selected_model_id": decision.get("selected_model_id"),
            "status": decision.get("status"),
            "risk_level": decision.get("risk_level"),
        },
    }

@router.get("/cost")
def cost_stats(model_id: str = "", period: str = "7d"):
    records = _load_all("usage")
    if model_id:
        records = [r for r in records if r.get("model_id") == model_id]
    total_tokens = sum(int(r.get("prompt_tokens") or 0) + int(r.get("completion_tokens") or 0) for r in records)
    total_cost = round(sum(float(r.get("cost_usd") or 0) for r in records), 6)
    breakdown = {}
    for r in records:
        m = r.get("model_id") or "unknown"
        b = breakdown.setdefault(m, {"model_id": m, "requests": 0, "tokens": 0, "cost_usd": 0.0})
        b["requests"] += 1
        b["tokens"] += int(r.get("prompt_tokens") or 0) + int(r.get("completion_tokens") or 0)
        b["cost_usd"] = round(b["cost_usd"] + float(r.get("cost_usd") or 0), 6)
    return {**_scope(), "model_id": model_id, "period": period,
            "breakdown": list(breakdown.values()), "total_cost_usd": total_cost, "total_tokens": total_tokens}

@router.post("/cost")
def record_usage(body: UsageRecord):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "created_at": _now()}
    _save("usage", item)
    return item

@router.get("/throttle")
def list_throttle():
    return {**_scope(), "items": _load_all("throttle"), "total": len(_load_all("throttle"))}

@router.post("/throttle")
def create_throttle(body: ThrottleCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "created_at": _now()}
    _save("throttle", item)
    return item

@router.put("/throttle/{rule_id}")
def update_throttle(rule_id: str, body: ThrottleCreate):
    import json
    p = _dir("throttle") / f"{rule_id}.json"
    if not p.exists():
        raise HTTPException(404, "throttle not found")
    item = json.loads(p.read_text())
    item.update(body.model_dump())
    item["updated_at"] = _now()
    _save("throttle", item)
    return item

@router.delete("/throttle/{rule_id}")
def delete_throttle(rule_id: str):
    p = _dir("throttle") / f"{rule_id}.json"
    if not p.exists():
        raise HTTPException(404, "throttle not found")
    p.unlink()
    return {**_scope(), "deleted": rule_id}

@router.get("/summary")
def summary():
    routes = _load_all("routes")
    throttle = _load_all("throttle")
    usage = _load_all("usage")
    return {**_scope(), "summary": summarize_gateway_health(routes, throttle, usage)}

@router.get("/health")
def health():
    summary_payload = summarize_gateway_health(_load_all("routes"), _load_all("throttle"), _load_all("usage"))
    return {
        **_scope(),
        "summary": summary_payload,
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 判断模型网关路由、成本、fallback 和限流健康状态",
            "apis": ["/api/v1/llm-gateway/decision", "/api/v1/llm-gateway/cost", "/api/v1/llm-gateway/throttle"],
            "task_source": "llm_gateway_governance",
        },
    }

@router.post("/governance-tasks")
def governance_tasks(body: GovernanceTasksIn):
    summary_payload = summarize_gateway_health(_load_all("routes"), _load_all("throttle"), _load_all("usage"))
    drafts = build_gateway_governance_tasks(summary_payload)
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
