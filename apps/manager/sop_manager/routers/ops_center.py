"""智能运维中心：部署流水线、根因分析、Runbook、自愈策略。"""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.ops_center_core import build_self_heal_tasks, evaluate_self_heal, summarize_ops_health

router = APIRouter(prefix="/api/v1/ops-center", tags=["ops-center"])

def _dir(sub: str):
    d = resolved_ai_memory_root() / "ops_center" / sub
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

class PipelineCreate(BaseModel):
    name: str
    environment: str = "staging"
    steps: list[str] = Field(default_factory=list)

class RcaCreate(BaseModel):
    incident_id: str
    root_cause: str
    impact: str = ""
    resolution: str = ""

class RunbookCreate(BaseModel):
    name: str
    steps: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)

class SelfHealCreate(BaseModel):
    trigger_condition: str
    action: str
    enabled: bool = True

class SelfHealEvaluateIn(BaseModel):
    signals: dict = Field(default_factory=dict)
    persist: bool = True

class SelfHealTasksIn(BaseModel):
    signals: dict = Field(default_factory=dict)
    dry_run: bool = True
    priority: str = "P1"
    assigned_to: str = "Ops Agent"
    dev_tool: str = "codex"

class PipelineStatus(BaseModel):
    status: str
    duration_s: int | None = None
    error_msg: str = ""

@router.get("/pipelines")
def list_pipelines():
    return {**_scope(), "items": _load_all("pipelines"), "total": len(_load_all("pipelines"))}

@router.post("/pipelines")
def create_pipeline(body: PipelineCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(),
            "status": "idle", "last_triggered_at": None, "duration_s": None, "created_at": _now()}
    _save("pipelines", item)
    return item

@router.put("/pipelines/{pipeline_id}/trigger")
def trigger_pipeline(pipeline_id: str):
    import json
    p = _dir("pipelines") / f"{pipeline_id}.json"
    if not p.exists():
        raise HTTPException(404, "pipeline not found")
    item = json.loads(p.read_text())
    item.update({"status": "running", "last_triggered_at": _now()})
    _save("pipelines", item)
    return item

@router.put("/pipelines/{pipeline_id}/status")
def update_pipeline_status(pipeline_id: str, body: PipelineStatus):
    import json
    p = _dir("pipelines") / f"{pipeline_id}.json"
    if not p.exists():
        raise HTTPException(404, "pipeline not found")
    item = json.loads(p.read_text())
    item.update({"status": body.status, "duration_s": body.duration_s, "error_msg": body.error_msg, "updated_at": _now()})
    _save("pipelines", item)
    return item

@router.delete("/pipelines/{pipeline_id}")
def delete_pipeline(pipeline_id: str):
    p = _dir("pipelines") / f"{pipeline_id}.json"
    if not p.exists():
        raise HTTPException(404, "pipeline not found")
    p.unlink()
    return {**_scope(), "deleted": pipeline_id}

@router.get("/rca")
def list_rca():
    return {**_scope(), "items": _load_all("rca"), "total": len(_load_all("rca"))}

@router.post("/rca")
def create_rca(body: RcaCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "status": "open", "created_at": _now()}
    _save("rca", item)
    return item

@router.put("/rca/{rca_id}/resolve")
def resolve_rca(rca_id: str):
    import json
    p = _dir("rca") / f"{rca_id}.json"
    if not p.exists():
        raise HTTPException(404, "rca not found")
    item = json.loads(p.read_text())
    item.update({"status": "resolved", "resolved_at": _now()})
    _save("rca", item)
    return item

@router.get("/runbooks")
def list_runbooks():
    return {**_scope(), "items": _load_all("runbooks"), "total": len(_load_all("runbooks"))}

@router.post("/runbooks")
def create_runbook(body: RunbookCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "status": "active", "created_at": _now()}
    _save("runbooks", item)
    return item

@router.put("/runbooks/{runbook_id}")
def update_runbook(runbook_id: str, body: RunbookCreate):
    import json
    p = _dir("runbooks") / f"{runbook_id}.json"
    if not p.exists():
        raise HTTPException(404, "runbook not found")
    item = json.loads(p.read_text())
    item.update(body.model_dump())
    _save("runbooks", item)
    return item

@router.delete("/runbooks/{runbook_id}")
def delete_runbook(runbook_id: str):
    p = _dir("runbooks") / f"{runbook_id}.json"
    if not p.exists():
        raise HTTPException(404, "runbook not found")
    p.unlink()
    return {**_scope(), "deleted": runbook_id}

@router.get("/self-heal")
def list_self_heal():
    return {**_scope(), "items": _load_all("self_heal"), "total": len(_load_all("self_heal"))}

@router.post("/self-heal")
def create_self_heal(body: SelfHealCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "last_applied_at": None, "created_at": _now()}
    _save("self_heal", item)
    return item

@router.put("/self-heal/{policy_id}")
def update_self_heal(policy_id: str, body: SelfHealCreate):
    import json
    p = _dir("self_heal") / f"{policy_id}.json"
    if not p.exists():
        raise HTTPException(404, "policy not found")
    item = json.loads(p.read_text())
    item.update(body.model_dump())
    item["updated_at"] = _now()
    _save("self_heal", item)
    return item

@router.post("/self-heal/{policy_id}/apply")
def apply_self_heal(policy_id: str):
    import json
    p = _dir("self_heal") / f"{policy_id}.json"
    if not p.exists():
        raise HTTPException(404, "policy not found")
    item = json.loads(p.read_text())
    item["last_applied_at"] = _now()
    _save("self_heal", item)
    return {**_scope(), "policy_id": policy_id, "applied_at": item["last_applied_at"], "action": item.get("action")}

@router.post("/self-heal/evaluate")
def evaluate_self_heal_policies(body: SelfHealEvaluateIn):
    policies = _load_all("self_heal")
    pipelines = _load_all("pipelines")
    rca = _load_all("rca")
    runbooks = _load_all("runbooks")
    result = evaluate_self_heal(policies, body.signals or {}, rca, pipelines, runbooks)
    item = {**_scope(), "id": str(uuid4()), **result, "created_at": _now()}
    if body.persist:
        _save("self_heal_evaluations", item)
    return {**_scope(), **item}

@router.get("/self-heal/evaluations")
def list_self_heal_evaluations(limit: int = 30):
    items = _load_all("self_heal_evaluations")[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/self-heal/tasks")
def self_heal_tasks(body: SelfHealTasksIn):
    policies = _load_all("self_heal")
    pipelines = _load_all("pipelines")
    rca = _load_all("rca")
    runbooks = _load_all("runbooks")
    evaluation = evaluate_self_heal(policies, body.signals or {}, rca, pipelines, runbooks)
    planned = build_self_heal_tasks(
        evaluation,
        dry_run=body.dry_run,
        priority=body.priority,
        assigned_to=body.assigned_to,
        dev_tool=body.dev_tool,
    )
    if body.dry_run:
        return {**_scope(), "evaluation": evaluation, **planned}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = []
    for task in planned.get("tasks") or []:
        created.append(create_task(TaskCreate(**task)))
    out = {**planned, "dry_run": False, "summary": {**planned.get("summary", {}), "created": len(created)}, "items": created, "tasks": created}
    history = {**_scope(), "id": str(uuid4()), "evaluation": evaluation, "created_task_ids": [x.get("id") for x in created if x.get("id")], "created_at": _now()}
    _save("self_heal_task_runs", history)
    return {**_scope(), **out, "evaluation": evaluation}

@router.delete("/self-heal/{policy_id}")
def delete_self_heal(policy_id: str):
    p = _dir("self_heal") / f"{policy_id}.json"
    if not p.exists():
        raise HTTPException(404, "policy not found")
    p.unlink()
    return {**_scope(), "deleted": policy_id}

@router.get("/summary")
def summary():
    pipelines = _load_all("pipelines")
    rca = _load_all("rca")
    runbooks = _load_all("runbooks")
    self_heal = _load_all("self_heal")
    evaluations = _load_all("self_heal_evaluations")[:10]
    return {**_scope(), "summary": summarize_ops_health(
        pipelines=pipelines,
        rca=rca,
        runbooks=runbooks,
        self_heal=self_heal,
        evaluations=evaluations,
    )}
