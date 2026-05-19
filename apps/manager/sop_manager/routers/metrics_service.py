"""指标语义层服务：指标目录、语义层、API 发布。"""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id

router = APIRouter(prefix="/api/v1/metrics-service", tags=["metrics-service"])

def _dir(sub: str = "catalog"):
    d = resolved_ai_memory_root() / "metrics_service" / sub
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

class MetricCreate(BaseModel):
    name: str
    domain: str = "general"
    metric_type: str = "atomic"
    formula: str = ""
    dimensions: list[str] = Field(default_factory=list)
    unit: str = ""
    owner: str = ""

class MetricPatch(BaseModel):
    name: str | None = None
    domain: str | None = None
    metric_type: str | None = None
    formula: str | None = None
    dimensions: list[str] | None = None
    unit: str | None = None
    owner: str | None = None
    status: str | None = None

@router.get("/catalog")
def list_catalog(domain: str = "", metric_type: str = ""):
    items = _load_all("catalog")
    if domain:
        items = [i for i in items if i.get("domain") == domain]
    if metric_type:
        items = [i for i in items if i.get("metric_type") == metric_type]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/catalog")
def create_metric(body: MetricCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(),
            "status": "active", "api_endpoint": None, "created_at": _now()}
    _save("catalog", item)
    return item

@router.put("/catalog/{metric_id}")
def update_metric(metric_id: str, body: MetricPatch):
    import json
    p = _dir("catalog") / f"{metric_id}.json"
    if not p.exists():
        raise HTTPException(404, "metric not found")
    item = json.loads(p.read_text())
    item.update({k: v for k, v in body.model_dump().items() if v is not None})
    item["updated_at"] = _now()
    _save("catalog", item)
    return item

@router.delete("/catalog/{metric_id}")
def delete_metric(metric_id: str):
    p = _dir("catalog") / f"{metric_id}.json"
    if p.exists():
        p.unlink()
    return {**_scope(), "deleted": metric_id}

@router.get("/catalog/{metric_id}/values")
def metric_values(metric_id: str, start: str = "", end: str = "", grain: str = "day"):
    if not (_dir("catalog") / f"{metric_id}.json").exists():
        raise HTTPException(404, "metric not found")
    values = [{"bucket": f"day-{i}", "value": 100 + i * 7} for i in range(1, 8)]
    return {**_scope(), "metric_id": metric_id, "grain": grain, "start": start, "end": end, "values": values}

@router.post("/api-publish")
def publish_api(metric_id: str):
    import json
    p = _dir("catalog") / f"{metric_id}.json"
    if not p.exists():
        raise HTTPException(404, "metric not found")
    item = json.loads(p.read_text())
    if item.get("api_endpoint"):
        return {**_scope(), "metric_id": metric_id, "endpoint": item["api_endpoint"], "published_at": item.get("published_at") or _now(), "already_published": True}
    endpoint = f"/api/v1/metrics-service/query/{metric_id}"
    item["api_endpoint"] = endpoint
    item["published_at"] = _now()
    _save("catalog", item)
    pub = {**_scope(), "id": str(uuid4()), "metric_id": metric_id, "endpoint": endpoint, "published_at": _now()}
    _save("published", pub)
    return pub

@router.get("/query/{metric_id}")
def query_metric(metric_id: str, grain: str = "day"):
    return metric_values(metric_id, grain=grain)

@router.get("/api-publish")
def list_published():
    items = _load_all("published")
    return {**_scope(), "items": items, "total": len(items)}

@router.get("/summary")
def summary():
    catalog = _load_all("catalog")
    published = _load_all("published")
    domains = list({i.get("domain") for i in catalog if i.get("domain")})
    return {**_scope(), "summary": {"total": len(catalog), "published": len(published),
            "domains": domains, "api_calls_today": 0}}
