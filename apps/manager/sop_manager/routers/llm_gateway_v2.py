"""LLM 网关 v2：模型路由、成本统计、限流策略。"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.llm_gateway_core import (
    build_prompt_audit,
    build_cost_attribution,
    build_cost_anomaly_tasks,
    build_fallback_drill,
    build_gateway_governance_tasks,
    build_model_evaluation,
    evaluate_policy_decision,
    select_llm_route,
    summarize_gateway_health,
    summarize_prompt_audits,
)
from sop_manager.routers.im_integration_core import build_im_briefing, build_im_delivery_plan
from sop_manager.routers.metrics import current_trace_context

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
    trace_id: str = ""
    correlation_id: str = ""
    agent_run_id: str = ""
    task_id: str = ""

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

class GatewayPolicyIn(BaseModel):
    enabled: bool = True
    daily_budget_usd: float = 100.0
    block_on_budget: bool = True
    require_provider_health: bool = True
    max_provider_latency_ms: int = 5000
    max_provider_error_rate: float = 0.5
    cost_anomaly_threshold_usd: float = 1.0

class ProviderHealthIn(BaseModel):
    model_id: str
    status: str = "healthy"
    latency_ms: int = 0
    error_rate: float = 0.0
    note: str = ""

class ImBriefingIn(BaseModel):
    channels: list[str] = Field(default_factory=list)
    dry_run: bool = True

class PromptAuditIn(BaseModel):
    prompt: str = Field("", max_length=120000)
    task_type: str = "general"
    model_id: str = ""
    user_role: str = "agent"
    max_prompt_tokens: int = Field(8000, ge=100, le=200000)
    allow_pii: bool = False
    allow_secrets: bool = False
    actions: list[str] = Field(default_factory=lambda: ["create_task"])
    dry_run: bool = True
    persist: bool = True
    assigned_to: str = "AI Platform"
    dev_tool: str = "codex"
    note: str = ""

class CostAttributionIn(BaseModel):
    min_cost_usd: float = 0.0
    dry_run: bool = True
    persist: bool = True
    create_tasks: bool = False
    assigned_to: str = "AI Platform"
    dev_tool: str = "codex"
    note: str = ""

class ModelEvalCaseIn(BaseModel):
    id: str = ""
    name: str = ""
    task_type: str = "general"
    prompt: str = Field("", max_length=120000)
    expected_keywords: list[str] = Field(default_factory=list)
    expected_output: str = ""
    actual_output: str = ""
    weight: float = 1.0
    max_prompt_tokens: int = 8000
    completion_tokens: int = 600
    latency_slo_ms: int = 3000
    budget_usd: float = 0.05
    allow_pii: bool = False
    allow_secrets: bool = False

class ModelEvalIn(BaseModel):
    model_ids: list[str] = Field(default_factory=list)
    cases: list[ModelEvalCaseIn] = Field(default_factory=list)
    actual_outputs: dict[str, Any] = Field(default_factory=dict)
    min_score: float = Field(75.0, ge=0, le=100)
    dry_run: bool = True
    persist: bool = True
    create_tasks: bool = False
    assigned_to: str = "AI Platform"
    dev_tool: str = "codex"
    note: str = ""

def _default_policy() -> dict:
    return {
        **_scope(),
        "id": "default",
        "enabled": True,
        "daily_budget_usd": 100.0,
        "block_on_budget": True,
        "require_provider_health": True,
        "max_provider_latency_ms": 5000,
        "max_provider_error_rate": 0.5,
        "cost_anomaly_threshold_usd": 1.0,
        "created_at": "",
        "updated_at": "",
    }

def _load_policy() -> dict:
    items = _load_all("policies")
    if not items:
        return _default_policy()
    policy = {**_default_policy(), **items[0]}
    policy["id"] = "default"
    return policy

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

@router.get("/policies")
def get_policies():
    policy = _load_policy()
    return {
        **_scope(),
        "policy": policy,
        "items": [policy],
        "total": 1,
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 在模型调用前读取预算、provider 健康和成本异常策略。",
            "evaluate_api": "/api/v1/llm-gateway/policy-evaluate",
            "fallback_drill_api": "/api/v1/llm-gateway/fallback-drill",
        },
    }

@router.put("/policies")
def update_policies(body: GatewayPolicyIn):
    item = {**_scope(), "id": "default", **body.model_dump(), "updated_at": _now(), "created_at": _load_policy().get("created_at") or _now()}
    _save("policies", item)
    return {**_scope(), "policy": item, "items": [item], "total": 1}

@router.get("/provider-health")
def list_provider_health():
    items = _load_all("provider_health")
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/provider-health")
def record_provider_health(body: ProviderHealthIn):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "checked_at": _now(), "created_at": _now()}
    _save("provider_health", item)
    return item

@router.post("/policy-evaluate")
def policy_evaluate(body: DecisionIn):
    decision = evaluate_policy_decision(
        body.model_dump(),
        _load_all("routes"),
        _load_all("throttle"),
        _load_all("usage"),
        [_load_policy()],
        _load_all("provider_health"),
    )
    return {
        **_scope(),
        "decision": decision,
        "agent_consumption": {
            "purpose": "供 Copilot/Agent 调用模型前执行策略化路由、预算护栏、provider 健康和 fallback 评估。",
            "selected_model_id": decision.get("selected_model_id"),
            "status": decision.get("status"),
            "policy_decision": decision.get("policy_decision"),
        },
    }

@router.post("/fallback-drill")
def fallback_drill():
    drill = build_fallback_drill(_load_all("routes"), _load_all("provider_health"), _load_all("throttle"), _load_all("usage"))
    return {
        **_scope(),
        **drill,
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 演练主模型不可用时 fallback 是否具备健康和限流接管能力。",
            "policy_api": "/api/v1/llm-gateway/policies",
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
    trace = current_trace_context()
    data = body.model_dump()
    data["trace_id"] = data.get("trace_id") or trace["trace_id"]
    data["correlation_id"] = data.get("correlation_id") or trace["correlation_id"]
    data["agent_run_id"] = data.get("agent_run_id") or trace.get("agent_run_id", "")
    item = {**_scope(), "id": str(uuid4()), **data, "created_at": _now()}
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

@router.post("/cost-anomalies/tasks")
def cost_anomaly_tasks(body: GovernanceTasksIn):
    result = build_cost_anomaly_tasks(_load_all("usage"), [_load_policy()], assigned_to=body.assigned_to or "AI Platform", dev_tool=body.dev_tool or "codex")
    if body.dry_run:
        return {**_scope(), "dry_run": True, **result, "created": []}
    from sop_manager.routers.tasks import TaskCreate, create_task
    created = []
    for draft in result["items"]:
        created.append(create_task(TaskCreate(**draft)))
    return {**_scope(), "dry_run": False, **result, "created": created}

@router.get("/cost-attribution/runs")
def list_cost_attribution_runs(limit: int = 30):
    items = _load_all("cost_attribution")[: max(1, min(limit, 100))]
    latest = items[0] if items else {}
    latest_summary = latest.get("summary") if isinstance(latest.get("summary"), dict) else {}
    return {
        **_scope(),
        "items": items,
        "total": len(items),
        "summary": {
            "runs": len(items),
            "latest_at": latest.get("created_at") or "",
            "latest_total_cost_usd": latest_summary.get("total_cost_usd", 0),
            "latest_budget_ratio": latest_summary.get("budget_ratio", 0),
            "latest_top_provider": latest_summary.get("top_provider", ""),
            "latest_findings": latest_summary.get("findings", 0),
        },
    }

@router.post("/cost-attribution/run")
def cost_attribution_run(body: CostAttributionIn):
    result = build_cost_attribution(
        _load_all("usage"),
        [_load_policy()],
        min_cost_usd=body.min_cost_usd,
        assigned_to=body.assigned_to,
        dev_tool=body.dev_tool,
    )
    created = []
    if not body.dry_run and body.create_tasks:
        from sop_manager.routers.tasks import TaskCreate, create_task

        for draft in result.get("tasks") or []:
            created.append(create_task(TaskCreate(**draft)))
    run = {
        **_scope(),
        "id": str(uuid4()),
        "dry_run": body.dry_run,
        "persisted": False,
        "created": len(created),
        "created_task_ids": [item.get("id") for item in created if item.get("id")],
        "filters": {"min_cost_usd": body.min_cost_usd},
        "note": body.note,
        "created_at": _now(),
        **result,
        "tasks": created if created else result.get("tasks", []),
    }
    if body.persist and not body.dry_run:
        run["persisted"] = True
        _save("cost_attribution", run)
    return {
        **_scope(),
        **result,
        "tasks": run["tasks"],
        "created_tasks": created,
        "created": len(created),
        "run_id": run["id"] if run["persisted"] else "",
        "persisted": run["persisted"],
        "history_summary": list_cost_attribution_runs(limit=30)["summary"],
    }

@router.post("/cost-attribution/tasks")
def cost_attribution_tasks(body: CostAttributionIn):
    body.create_tasks = True
    return cost_attribution_run(body)

@router.get("/model-evals/runs")
def list_model_eval_runs(limit: int = 30):
    items = _load_all("model_evals")[: max(1, min(limit, 100))]
    latest = items[0] if items else {}
    latest_summary = latest.get("summary") if isinstance(latest.get("summary"), dict) else {}
    return {
        **_scope(),
        "items": items,
        "total": len(items),
        "summary": {
            "runs": len(items),
            "latest_at": latest.get("created_at") or "",
            "latest_best_model": latest_summary.get("best_model", ""),
            "latest_best_score": latest_summary.get("best_score", 0),
            "latest_avg_score": latest_summary.get("avg_score", 0),
            "latest_findings": latest_summary.get("findings", 0),
        },
    }

@router.post("/model-evals/run")
def model_eval_run(body: ModelEvalIn):
    result = build_model_evaluation(
        _load_all("routes"),
        [_load_policy()],
        _load_all("provider_health"),
        _load_all("throttle"),
        _load_all("usage"),
        model_ids=body.model_ids,
        cases=[case.model_dump() for case in body.cases],
        actual_outputs=body.actual_outputs,
        min_score=body.min_score,
        assigned_to=body.assigned_to,
        dev_tool=body.dev_tool,
    )
    created = []
    if not body.dry_run and body.create_tasks:
        from sop_manager.routers.tasks import TaskCreate, create_task

        for draft in result.get("tasks") or []:
            created.append(create_task(TaskCreate(**draft)))
    run = {
        **_scope(),
        "id": str(uuid4()),
        "dry_run": body.dry_run,
        "persisted": False,
        "created": len(created),
        "created_task_ids": [item.get("id") for item in created if item.get("id")],
        "filters": {"model_ids": body.model_ids, "min_score": body.min_score, "cases": len(body.cases)},
        "note": body.note,
        "created_at": _now(),
        **result,
        "tasks": created if created else result.get("tasks", []),
    }
    if body.persist and not body.dry_run:
        run["persisted"] = True
        _save("model_evals", run)
    return {
        **_scope(),
        **result,
        "tasks": run["tasks"],
        "created_tasks": created,
        "created": len(created),
        "run_id": run["id"] if run["persisted"] else "",
        "persisted": run["persisted"],
        "history_summary": list_model_eval_runs(limit=30)["summary"],
    }

@router.post("/model-evals/tasks")
def model_eval_tasks(body: ModelEvalIn):
    body.create_tasks = True
    return model_eval_run(body)

@router.get("/prompt-audit/runs")
def list_prompt_audit_runs(limit: int = 30):
    items = _load_all("prompt_audits")[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_prompt_audits(items)}

@router.post("/prompt-audit/run")
def prompt_audit_run(body: PromptAuditIn):
    result = build_prompt_audit(
        prompt=body.prompt,
        task_type=body.task_type,
        model_id=body.model_id,
        user_role=body.user_role,
        max_prompt_tokens=body.max_prompt_tokens,
        allow_pii=body.allow_pii,
        allow_secrets=body.allow_secrets,
        actions=body.actions,
        assigned_to=body.assigned_to,
        dev_tool=body.dev_tool,
        now_iso=_now(),
    )
    created = []
    if not body.dry_run and "create_task" in result.get("actions", []):
        from sop_manager.routers.tasks import TaskCreate, create_task

        for draft in result.get("tasks") or []:
            created.append(create_task(TaskCreate(**draft)))
    run = {
        **_scope(),
        "id": str(uuid4()),
        "dry_run": body.dry_run,
        "persisted": False,
        "note": body.note,
        "created_task_ids": [item.get("id") for item in created if item.get("id")],
        "created": len(created),
        "created_at": _now(),
        **{key: value for key, value in result.items() if key != "tasks"},
        "tasks": created if created else result.get("tasks", []),
    }
    if body.persist and not body.dry_run:
        run["persisted"] = True
        _save("prompt_audits", run)
    return {
        **_scope(),
        **result,
        "tasks": run["tasks"],
        "created_tasks": created,
        "created": len(created),
        "run_id": run["id"] if run["persisted"] else "",
        "persisted": run["persisted"],
        "history_summary": summarize_prompt_audits(_load_all("prompt_audits")),
    }

@router.post("/prompt-audit/tasks")
def prompt_audit_tasks(body: PromptAuditIn):
    body.actions = ["create_task"]
    return prompt_audit_run(body)

@router.post("/im-briefing")
def im_briefing(body: ImBriefingIn):
    summary_payload = summarize_gateway_health(_load_all("routes"), _load_all("throttle"), _load_all("usage"))
    briefing = build_im_briefing(
        module="llm_gateway",
        title="LLM Gateway 模型网关运行简报",
        summary=summary_payload,
        risks=list(summary_payload.get("risks") or []),
        recommendations=list(summary_payload.get("recommendations") or []),
        scope=_scope(),
        actions=[
            {"label": "查看模型网关", "href": "#/llm-gateway"},
            {"label": "生成模型网关治理任务", "api": "/api/v1/llm-gateway/governance-tasks"},
            {"label": "执行模型路由决策", "api": "/api/v1/llm-gateway/decision"},
        ],
    )
    from sop_manager.routers.notify import NotifyMsg, list_channels, send_msg

    plan = build_im_delivery_plan(briefing, list_channels(), requested_channels=body.channels, event="llm_gateway_risk")
    if body.dry_run or not plan.get("ready"):
        return {**_scope(), "dry_run": True, "briefing": briefing, "delivery_plan": plan, "sent": []}
    sent = [send_msg(NotifyMsg(**message)) for message in plan.get("messages") or []]
    return {**_scope(), "dry_run": False, "briefing": briefing, "delivery_plan": plan, "sent": sent}
