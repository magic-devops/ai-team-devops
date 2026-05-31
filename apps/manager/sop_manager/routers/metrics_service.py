"""指标语义层服务：指标目录、语义层、API 发布。"""
from __future__ import annotations
import json
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.scope_guard import attach_scope, scope_matches

router = APIRouter(prefix="/api/v1/metrics-service", tags=["metrics-service"])

ALLOWED_FUNCTIONS = {"sum", "count", "avg", "min", "max", "ratio", "distinct_count"}
UNSAFE_FORMULA_PATTERN = re.compile(r"(;|--|/\*|\*/|\bdrop\b|\bdelete\b|\binsert\b|\bupdate\b|\balter\b|\btruncate\b)", re.IGNORECASE)

def _dir(sub: str = "catalog"):
    d = resolved_ai_memory_root() / "metrics_service" / sub
    d.mkdir(parents=True, exist_ok=True)
    return d

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _scope() -> dict:
    return {"tenant_code": resolved_tenant_code(), "business_code": resolved_business_code(), "project_id": resolved_project_id()}

def _load_all(sub: str) -> list[dict]:
    items = []
    for f in _dir(sub).glob("*.json"):
        try:
            item = json.loads(f.read_text())
            if isinstance(item, dict) and scope_matches(item, require_business=True):
                items.append(item)
        except Exception:
            pass
    return sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)

def _save(sub: str, item: dict):
    attach_scope(item, overwrite=False)
    (_dir(sub) / f"{item['id']}.json").write_text(json.dumps(item, ensure_ascii=False, indent=2))

def _load_item(sub: str, item_id: str, label: str) -> dict:
    p = _dir(sub) / f"{item_id}.json"
    if not p.exists():
        raise HTTPException(404, f"{label} not found")
    try:
        item = json.loads(p.read_text())
    except Exception as exc:
        raise HTTPException(500, f"{label} is unreadable") from exc
    if not isinstance(item, dict) or not scope_matches(item, require_business=True):
        raise HTTPException(404, f"{label} not found")
    return item

def _parse_dimensions(raw: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for part in str(raw or "").split(","):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        if key:
            out[key] = value.strip()
    return out

def _validate_formula(formula: str) -> dict[str, Any]:
    expression = str(formula or "").strip()
    if not expression:
        return {"valid": True, "functions": [], "fields": [], "warnings": ["formula_empty"], "normalized": ""}
    if UNSAFE_FORMULA_PATTERN.search(expression):
        raise HTTPException(400, "formula contains unsafe SQL/control tokens")
    functions = [f.lower() for f in re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", expression)]
    unknown = [f for f in functions if f not in ALLOWED_FUNCTIONS]
    if unknown:
        raise HTTPException(400, f"formula contains unsupported functions: {', '.join(sorted(set(unknown)))}")
    identifiers = re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", expression)
    fields: list[str] = []
    for ident in identifiers:
        ident_lower = ident.lower()
        if ident_lower in ALLOWED_FUNCTIONS:
            continue
        if ident_lower not in fields:
            fields.append(ident_lower)
    if not fields and functions:
        raise HTTPException(400, "formula must reference at least one field")
    return {
        "valid": True,
        "functions": sorted(set(functions), key=functions.index),
        "fields": fields,
        "warnings": [],
        "normalized": expression,
    }

def _query_contract(metric: dict, *, sla: str = "") -> dict[str, Any]:
    endpoint = f"/api/v1/metrics-service/query/{metric['id']}"
    return {
        "endpoint": endpoint,
        "method": "GET",
        "parameters": ["start", "end", "grain", "dimensions"],
        "dimensions": list(metric.get("dimensions") or []),
        "unit": metric.get("unit") or "",
        "formula": metric.get("formula") or "",
        "sla": sla or str(metric.get("query_contract", {}).get("sla") or "99.5%"),
        "scope_required": ["tenant_code", "business_code", "project_id"],
    }

class MetricCreate(BaseModel):
    name: str
    domain: str = "general"
    metric_type: str = "atomic"
    formula: str = ""
    dimensions: list[str] = Field(default_factory=list)
    source_assets: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    description: str = ""
    unit: str = ""
    owner: str = ""

class MetricPatch(BaseModel):
    name: str | None = None
    domain: str | None = None
    metric_type: str | None = None
    formula: str | None = None
    dimensions: list[str] | None = None
    source_assets: list[str] | None = None
    depends_on: list[str] | None = None
    description: str | None = None
    unit: str | None = None
    owner: str | None = None
    status: str | None = None

class MetricPublishIn(BaseModel):
    version_note: str = "publish semantic metric contract"
    sla: str = "99.5%"

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
    formula_validation = _validate_formula(body.formula)
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(),
            "status": "active", "api_endpoint": None, "semantic_version": "v0",
            "version_count": 0, "formula_validation": formula_validation,
            "query_contract": _query_contract({"id": "draft", **body.model_dump()}),
            "created_at": _now()}
    _save("catalog", item)
    return item

@router.put("/catalog/{metric_id}")
def update_metric(metric_id: str, body: MetricPatch):
    item = _load_item("catalog", metric_id, "metric")
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    item.update(patch)
    if "formula" in patch:
        item["formula_validation"] = _validate_formula(str(item.get("formula") or ""))
    item["query_contract"] = _query_contract(item)
    item["updated_at"] = _now()
    _save("catalog", item)
    return item

@router.delete("/catalog/{metric_id}")
def delete_metric(metric_id: str):
    _load_item("catalog", metric_id, "metric")
    p = _dir("catalog") / f"{metric_id}.json"
    if p.exists():
        p.unlink()
    return {**_scope(), "deleted": metric_id}

@router.get("/catalog/{metric_id}/versions")
def metric_versions(metric_id: str):
    _load_item("catalog", metric_id, "metric")
    items = [i for i in _load_all("versions") if i.get("metric_id") == metric_id]
    return {**_scope(), "metric_id": metric_id, "items": items, "total": len(items)}

@router.post("/catalog/{metric_id}/publish")
def publish_metric_version(metric_id: str, body: MetricPublishIn = MetricPublishIn()):
    item = _load_item("catalog", metric_id, "metric")
    validation = _validate_formula(str(item.get("formula") or ""))
    item["formula_validation"] = validation
    next_version = int(item.get("version_count") or 0) + 1
    semantic_version = f"v{next_version}"
    contract = _query_contract(item, sla=body.sla)
    endpoint = contract["endpoint"]
    version = {
        **_scope(),
        "id": f"{metric_id}-{semantic_version}",
        "metric_id": metric_id,
        "metric_name": item.get("name", ""),
        "semantic_version": semantic_version,
        "version_note": body.version_note,
        "formula": item.get("formula", ""),
        "formula_validation": validation,
        "query_contract": contract,
        "published_at": _now(),
    }
    item.update({
        "status": "published",
        "api_endpoint": endpoint,
        "published_at": version["published_at"],
        "semantic_version": semantic_version,
        "version_count": next_version,
        "query_contract": contract,
    })
    _save("catalog", item)
    _save("versions", version)
    pub = {
        **_scope(),
        "id": str(uuid4()),
        "metric_id": metric_id,
        "metric_name": item.get("name", ""),
        "semantic_version": semantic_version,
        "endpoint": endpoint,
        "query_contract": contract,
        "published_at": version["published_at"],
    }
    _save("published", pub)
    return pub

@router.get("/catalog/{metric_id}/values")
def metric_values(metric_id: str, start: str = "", end: str = "", grain: str = "day"):
    item = _load_item("catalog", metric_id, "metric")
    values = [{"bucket": f"day-{i}", "value": 100 + i * 7} for i in range(1, 8)]
    return {**_scope(), "metric_id": metric_id, "semantic_version": item.get("semantic_version", "v0"), "grain": grain, "start": start, "end": end, "values": values}

@router.post("/api-publish")
def publish_api(metric_id: str):
    item = _load_item("catalog", metric_id, "metric")
    if item.get("api_endpoint") and item.get("semantic_version") != "v0":
        return {**_scope(), "metric_id": metric_id, "endpoint": item["api_endpoint"], "semantic_version": item.get("semantic_version", "v1"), "query_contract": item.get("query_contract", {}), "published_at": item.get("published_at") or _now(), "already_published": True}
    return publish_metric_version(metric_id, MetricPublishIn())

@router.get("/query/{metric_id}")
def query_metric(metric_id: str, grain: str = "day", start: str = "", end: str = "", dimensions: str = ""):
    item = _load_item("catalog", metric_id, "metric")
    values = metric_values(metric_id, start=start, end=end, grain=grain)["values"]
    return {
        **_scope(),
        "metric_id": metric_id,
        "metric_name": item.get("name", ""),
        "semantic_version": item.get("semantic_version", "v0"),
        "query": {"grain": grain, "start": start, "end": end, "dimensions": _parse_dimensions(dimensions)},
        "contract": item.get("query_contract") or _query_contract(item),
        "values": values,
    }

@router.get("/api-publish")
def list_published():
    items = _load_all("published")
    return {**_scope(), "items": items, "total": len(items)}

@router.get("/catalog/{metric_id}/impact")
def metric_impact(metric_id: str):
    metric = _load_item("catalog", metric_id, "metric")
    catalog = _load_all("catalog")
    published = _load_all("published")
    published_metric_ids = {p.get("metric_id") for p in published}
    aliases = {metric_id, str(metric.get("name") or ""), str(metric.get("key") or "")}
    downstream = []
    for item in catalog:
        if item.get("id") == metric_id:
            continue
        depends = {str(x) for x in item.get("depends_on") or []}
        formula_fields = set((item.get("formula_validation") or {}).get("fields") or [])
        if aliases & depends or aliases & formula_fields:
            downstream.append({
                "id": item.get("id", ""),
                "name": item.get("name", ""),
                "semantic_version": item.get("semantic_version", "v0"),
                "status": item.get("status", ""),
                "published": item.get("id") in published_metric_ids,
            })
    affected_services = []
    for item in [metric, *[row for row in catalog if row.get("id") in {d["id"] for d in downstream}]]:
        if item.get("api_endpoint") or item.get("id") in published_metric_ids:
            affected_services.append({
                "type": "metric_api",
                "metric_id": item.get("id", ""),
                "endpoint": item.get("api_endpoint") or f"/api/v1/metrics-service/query/{item.get('id', '')}",
                "semantic_version": item.get("semantic_version", "v0"),
            })
    risk_level = "high" if affected_services and downstream else ("medium" if downstream else "low")
    return {
        **_scope(),
        "metric_id": metric_id,
        "metric_name": metric.get("name", ""),
        "upstream_assets": list(metric.get("source_assets") or []),
        "upstream_metrics": list(metric.get("depends_on") or []),
        "downstream_metrics": downstream,
        "affected_services": affected_services,
        "risk_level": risk_level,
        "recommended_actions": [
            "发布前刷新下游指标版本并通知服务消费者",
            "对受影响指标执行样本查询和口径评审",
        ] if risk_level != "low" else [],
    }

@router.get("/summary")
def summary():
    catalog = _load_all("catalog")
    published = _load_all("published")
    domains = list({i.get("domain") for i in catalog if i.get("domain")})
    return {**_scope(), "summary": {"total": len(catalog), "published": len(published),
            "domains": domains, "api_calls_today": 0,
            "versioned": sum(1 for i in catalog if i.get("semantic_version") and i.get("semantic_version") != "v0")}}
