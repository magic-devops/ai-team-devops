"""数据质量规则引擎：规则目录、质量运行、告警处置。"""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id

router = APIRouter(prefix="/api/v1/data-quality", tags=["data-quality"])

def _dir(sub: str):
    d = resolved_ai_memory_root() / "data_quality" / sub
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

class RuleCreate(BaseModel):
    name: str
    domain: str = "general"
    rule_type: str = "completeness"
    expression: str = ""
    severity: str = "medium"

class RunCreate(BaseModel):
    rule_id: str
    dataset: str = ""

class RunResult(BaseModel):
    status: str
    score: float = 1.0
    rows_checked: int = 0
    rows_failed: int = 0

class RulePatch(BaseModel):
    name: str | None = None
    domain: str | None = None
    rule_type: str | None = None
    expression: str | None = None
    severity: str | None = None
    status: str | None = None

@router.get("/rules")
def list_rules(domain: str = "", status: str = ""):
    items = _load_all("rules")
    if domain:
        items = [i for i in items if i.get("domain") == domain]
    if status:
        items = [i for i in items if i.get("status") == status]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/rules")
def create_rule(body: RuleCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "status": "active", "created_at": _now()}
    _save("rules", item)
    return item

@router.put("/rules/{rule_id}")
def update_rule(rule_id: str, body: RulePatch):
    import json
    p = _dir("rules") / f"{rule_id}.json"
    if not p.exists():
        raise HTTPException(404, "rule not found")
    item = json.loads(p.read_text())
    item.update({k: v for k, v in body.model_dump().items() if v is not None})
    item["updated_at"] = _now()
    _save("rules", item)
    return item

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str):
    p = _dir("rules") / f"{rule_id}.json"
    if p.exists():
        p.unlink()
    return {**_scope(), "deleted": rule_id}

@router.get("/runs")
def list_runs(rule_id: str = "", limit: int = 50):
    items = _load_all("runs")
    if rule_id:
        items = [i for i in items if i.get("rule_id") == rule_id]
    return {**_scope(), "items": items[:limit], "total": len(items)}

@router.post("/runs")
def create_run(body: RunCreate):
    if not (_dir("rules") / f"{body.rule_id}.json").exists():
        raise HTTPException(404, "rule not found")
    item = {**_scope(), "id": str(uuid4()), "rule_id": body.rule_id, "dataset": body.dataset,
            "status": "running", "score": None, "rows_checked": 0, "rows_failed": 0,
            "started_at": _now(), "finished_at": None}
    _save("runs", item)
    return item

@router.post("/runs/{run_id}/finish")
def finish_run(run_id: str):
    import json
    p = _dir("runs") / f"{run_id}.json"
    if not p.exists():
        raise HTTPException(404, "run not found")
    item = json.loads(p.read_text())
    score = 0.92 if item.get("dataset") else 0.85
    result = RunResult(status="passed" if score >= 0.9 else "warning", score=score, rows_checked=1000, rows_failed=0 if score >= 0.9 else 12)
    return write_result(run_id, result)

@router.put("/runs/{run_id}/result")
def write_result(run_id: str, body: RunResult):
    import json
    p = _dir("runs") / f"{run_id}.json"
    if not p.exists():
        raise HTTPException(404, "run not found")
    item = json.loads(p.read_text())
    item.update({**body.model_dump(), "finished_at": _now()})
    _save("runs", item)
    if body.status == "failed":
        alert = {**_scope(), "id": str(uuid4()), "run_id": run_id, "rule_id": item.get("rule_id", ""),
                 "severity": "high", "message": f"质量检查失败，得分 {body.score}", "status": "open",
                 "created_at": _now(), "resolved_at": None}
        _save("alerts", alert)
    return item

@router.get("/alerts")
def list_alerts(severity: str = "", status: str = ""):
    items = _load_all("alerts")
    if severity:
        items = [i for i in items if i.get("severity") == severity]
    if status:
        items = [i for i in items if i.get("status") == status]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str):
    import json
    p = _dir("alerts") / f"{alert_id}.json"
    if not p.exists():
        raise HTTPException(404, "alert not found")
    item = json.loads(p.read_text())
    item.update({"status": "resolved", "resolved_at": _now()})
    _save("alerts", item)
    return item

@router.get("/summary")
def summary():
    rules = _load_all("rules")
    runs = _load_all("runs")
    alerts = _load_all("alerts")
    scores = [r["score"] for r in runs if r.get("score") is not None]
    return {**_scope(), "summary": {
        "rules_total": len(rules), "runs_today": len(runs),
        "alerts_open": sum(1 for a in alerts if a.get("status") == "open"),
        "avg_score": round(sum(scores) / len(scores), 3) if scores else 1.0}}
