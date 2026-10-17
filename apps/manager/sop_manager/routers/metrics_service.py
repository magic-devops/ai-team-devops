"""指标语义层服务：指标目录、语义层、API 发布。"""
from __future__ import annotations
import json
import re
from sop_manager.task_owner import TaskOwnerId, TaskOwnerInput

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.scope_guard import attach_scope, scope_matches

from sop_manager.project_write_guard import project_file_write_scope

router = APIRouter(prefix="/api/v1/metrics-service", tags=["metrics-service"])

ALLOWED_FUNCTIONS = {"sum", "count", "avg", "min", "max", "ratio", "distinct_count"}
UNSAFE_FORMULA_PATTERN = re.compile(r"(;|--|/\*|\*/|\bdrop\b|\bdelete\b|\binsert\b|\bupdate\b|\balter\b|\btruncate\b)", re.IGNORECASE)

def _dir(sub: str = "catalog"):
    d = resolved_ai_memory_root() / "metrics_service" / sub
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
    with project_file_write_scope():
        _dir(sub).mkdir(parents=True, exist_ok=True)
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


class MetricsGovernanceTasksIn(TaskOwnerInput):
    ids: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True
    priority: str = Field(default="P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field(default="codex", max_length=80)


class MetricApprovalCreateIn(BaseModel):
    metric_id: str
    action: str = Field(default="publish_metric", pattern="^(publish_metric|update_formula|deprecate_metric)$")
    reason: str = Field(default="", max_length=800)
    requested_by: str = Field(default="Metrics Agent", max_length=120)
    reviewers: list[str] = Field(default_factory=lambda: ["Data Governance"], max_length=20)
    payload: dict[str, Any] = Field(default_factory=dict)
    auto_apply_on_approval: bool = True


class MetricApprovalReviewIn(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected|cancelled)$")
    reviewer: str = Field(default="Data Governance", max_length=120)
    note: str = Field(default="", max_length=800)


def _formula_warnings(metric: dict) -> list[str]:
    validation = metric.get("formula_validation") or {}
    warnings = validation.get("warnings") or []
    return [str(item) for item in warnings if str(item)]


def _approval_counts(items: list[dict]) -> dict[str, int]:
    counts = {"pending": 0, "approved": 0, "rejected": 0, "cancelled": 0}
    for item in items:
        status = str(item.get("status") or "pending")
        counts[status] = counts.get(status, 0) + 1
    return counts


def _metric_approval_risk(metric: dict) -> dict[str, Any]:
    impact = metric_impact(str(metric.get("id") or ""))
    return {
        "risk_level": impact.get("risk_level", "low"),
        "downstream_metrics": impact.get("downstream_metrics", []),
        "affected_services": impact.get("affected_services", []),
        "recommended_actions": impact.get("recommended_actions", []),
    }


def _metrics_governance_task_items(body: MetricsGovernanceTasksIn) -> list[dict[str, Any]]:
    catalog = _load_all("catalog")
    published = _load_all("published")
    selected = {str(item).strip() for item in body.ids if str(item).strip()}
    published_metric_ids = {str(item.get("metric_id") or "") for item in published}
    aliases = {str(item.get("id") or "") for item in catalog}
    aliases.update(str(item.get("name") or "").lower() for item in catalog if item.get("name"))

    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_task(metric: dict, category: str, title: str, description: str, priority: str, labels: list[str]) -> None:
        key = f"{category}:{metric.get('id')}"
        if key in seen:
            return
        seen.add(key)
        items.append(
            {
                "source": "metrics_governance",
                "source_report_id": str(metric.get("id") or ""),
                "source_report_title": str(metric.get("name") or metric.get("id") or "metric"),
                "title": title,
                "description": description,
                "priority": priority,
                "owner_id": body.owner_id,
                "dev_tool": body.dev_tool,
                "labels": ["metrics", category, str(metric.get("domain") or "general"), *labels[:3]],
            }
        )

    for metric in catalog:
        metric_id = str(metric.get("id") or "")
        if selected and metric_id not in selected:
            continue
        metric_name = str(metric.get("name") or metric_id)
        domain = str(metric.get("domain") or "general")
        validation = metric.get("formula_validation") or {}
        warnings = _formula_warnings(metric)

        if not str(metric.get("owner") or "").strip():
            add_task(
                metric,
                "missing-owner",
                f"[指标] 补齐指标负责人：{metric_name}",
                f"指标 {metric_name} 缺少 owner，无法形成口径评审、版本发布和异常响应责任闭环。请补齐 owner、业务域 {domain} 的责任说明，并同步到指标目录。",
                "P1",
                ["owner"],
            )
        if not str(metric.get("formula") or "").strip() or "formula_empty" in warnings:
            add_task(
                metric,
                "missing-formula",
                f"[指标] 补齐指标公式：{metric_name}",
                f"指标 {metric_name} 尚未配置可解释公式，语义层、样本查询和 API 消费会缺少统一口径。请补齐公式、字段来源和验证样例。",
                body.priority,
                ["formula"],
            )
        if validation and validation.get("valid") is False:
            add_task(
                metric,
                "formula-risk",
                f"[指标] 修复指标公式风险：{metric_name}",
                f"指标 {metric_name} 的公式校验未通过，需修复函数、字段引用和安全表达式后再发布版本。",
                "P0",
                ["formula", "risk"],
            )
        if not metric.get("api_endpoint") and metric_id not in published_metric_ids:
            add_task(
                metric,
                "unpublished-api",
                f"[指标] 发布指标查询 API：{metric_name}",
                f"指标 {metric_name} 尚未发布 API，业务系统和 AI 问数无法通过稳定查询契约消费。请完成语义版本发布并确认 SLA。",
                body.priority,
                ["api", "publish"],
            )
        if not metric.get("semantic_version") or metric.get("semantic_version") == "v0":
            add_task(
                metric,
                "missing-version",
                f"[指标] 发布指标语义版本：{metric_name}",
                f"指标 {metric_name} 仍处于 v0，缺少版本化查询契约。请完成口径评审、版本说明和契约发布。",
                body.priority,
                ["semantic", "version"],
            )

        missing_dependencies = []
        for dep in metric.get("depends_on") or []:
            dep_key = str(dep or "").strip()
            if dep_key and dep_key not in aliases and dep_key.lower() not in aliases:
                missing_dependencies.append(dep_key)
        if missing_dependencies:
            add_task(
                metric,
                "broken-dependency",
                f"[指标] 修复指标依赖断链：{metric_name}",
                f"指标 {metric_name} 依赖 {', '.join(missing_dependencies[:5])}，但当前目录无法匹配到对应指标。请补齐依赖指标或修正依赖引用。",
                "P1",
                ["dependency", "lineage"],
            )
    return items


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
        with project_file_write_scope():
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


@router.post("/governance/tasks")
def metrics_governance_tasks(body: MetricsGovernanceTasksIn) -> dict[str, Any]:
    items = _metrics_governance_task_items(body)
    if body.dry_run:
        return {"ok": True, "scope": _scope(), "dry_run": True, "items": items, "created": [], "planned": len(items)}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = [create_task(TaskCreate(**{key: value for key, value in item.items() if key != "labels"})) for item in items]
    return {"ok": True, "scope": _scope(), "dry_run": False, "items": items, "created": created, "planned": len(items), "created_count": len(created)}


@router.get("/approvals")
def list_metric_approvals(status: str = "", metric_id: str = ""):
    items = _load_all("approvals")
    if status:
        items = [item for item in items if item.get("status") == status]
    if metric_id:
        items = [item for item in items if item.get("metric_id") == metric_id]
    return {**_scope(), "items": items, "total": len(items), "counts": _approval_counts(_load_all("approvals"))}


@router.post("/approvals")
def create_metric_approval(body: MetricApprovalCreateIn):
    metric = _load_item("catalog", body.metric_id, "metric")
    payload = dict(body.payload or {})
    if body.action == "publish_metric":
        payload.setdefault("version_note", f"approve publish for {metric.get('name') or body.metric_id}")
        payload.setdefault("sla", str(metric.get("query_contract", {}).get("sla") or "99.5%"))
    approval = {
        **_scope(),
        "id": str(uuid4()),
        "kind": "metric",
        "metric_id": body.metric_id,
        "target_id": body.metric_id,
        "target_name": metric.get("name", ""),
        "action": body.action,
        "status": "pending",
        "reason": body.reason,
        "requested_by": body.requested_by,
        "reviewers": body.reviewers,
        "payload": payload,
        "auto_apply_on_approval": body.auto_apply_on_approval,
        "risk": _metric_approval_risk(metric),
        "review_events": [],
        "created_at": _now(),
    }
    _save("approvals", approval)
    return approval


@router.post("/approvals/{approval_id}/review")
def review_metric_approval(approval_id: str, body: MetricApprovalReviewIn):
    approval = _load_item("approvals", approval_id, "approval")
    if approval.get("status") != "pending":
        raise HTTPException(409, "approval is already reviewed")
    approval["status"] = body.status
    approval["reviewer"] = body.reviewer
    approval["review_note"] = body.note
    approval["reviewed_at"] = _now()
    approval.setdefault("review_events", []).append({
        "status": body.status,
        "reviewer": body.reviewer,
        "note": body.note,
        "created_at": approval["reviewed_at"],
    })
    if body.status == "approved" and approval.get("auto_apply_on_approval"):
        action = str(approval.get("action") or "")
        if action == "publish_metric":
            payload = approval.get("payload") if isinstance(approval.get("payload"), dict) else {}
            result = publish_metric_version(
                str(approval.get("metric_id") or approval.get("target_id") or ""),
                MetricPublishIn(
                    version_note=str(payload.get("version_note") or "approved metric contract"),
                    sla=str(payload.get("sla") or "99.5%"),
                ),
            )
            approval["applied_result"] = result
            approval["applied_at"] = _now()
        elif action == "deprecate_metric":
            metric = _load_item("catalog", str(approval.get("metric_id") or ""), "metric")
            metric["status"] = "deprecated"
            metric["updated_at"] = _now()
            _save("catalog", metric)
            approval["applied_result"] = {"metric_id": metric.get("id"), "status": metric.get("status")}
            approval["applied_at"] = _now()
    _save("approvals", approval)
    return approval

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
    published_metric_ids = {str(item.get("metric_id") or "") for item in published}
    approvals = _load_all("approvals")
    approval_counts = _approval_counts(approvals)
    formula_issues = sum(1 for item in catalog if (item.get("formula_validation") or {}).get("valid") is False)
    missing_formula = sum(1 for item in catalog if not str(item.get("formula") or "").strip() or "formula_empty" in _formula_warnings(item))
    missing_owner = sum(1 for item in catalog if not str(item.get("owner") or "").strip())
    unpublished = sum(1 for item in catalog if not item.get("api_endpoint") and str(item.get("id") or "") not in published_metric_ids)
    missing_version = sum(1 for item in catalog if not item.get("semantic_version") or item.get("semantic_version") == "v0")
    governance_ids = {
        str(item.get("id") or "")
        for item in catalog
        if not str(item.get("owner") or "").strip()
        or not str(item.get("formula") or "").strip()
        or "formula_empty" in _formula_warnings(item)
        or (item.get("formula_validation") or {}).get("valid") is False
        or (not item.get("api_endpoint") and str(item.get("id") or "") not in published_metric_ids)
        or not item.get("semantic_version")
        or item.get("semantic_version") == "v0"
    }
    return {**_scope(), "summary": {"total": len(catalog), "published": len(published),
            "domains": domains, "api_calls_today": 0,
            "versioned": sum(1 for i in catalog if i.get("semantic_version") and i.get("semantic_version") != "v0"),
            "formula_issues": formula_issues, "missing_formula": missing_formula,
            "missing_owner": missing_owner, "unpublished": unpublished,
            "missing_version": missing_version, "governance_todos": len(governance_ids),
            "pending_approvals": approval_counts.get("pending", 0),
            "approved_approvals": approval_counts.get("approved", 0)}}
