"""元数据管理中心：资产目录、字段目录、分类治理与血缘影响。"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_business_code, resolved_project_id, resolved_tenant_code
from sop_manager.routers import data_ingest
from sop_manager.routers.data_analytics import (
    analytics_lineage,
    analytics_lineage_impact,
    _asset_quality,
    _load_governance,
    _save_governance,
)

router = APIRouter(prefix="/api/v1/metadata", tags=["metadata-management"])

SENSITIVE_HINTS = ("phone", "mobile", "email", "name", "id_card", "address", "secret", "token", "password", "customer")


class MetadataAssetClassifyIn(BaseModel):
    owner: str | None = Field(default=None, max_length=80)
    security_level: str | None = Field(default=None, max_length=40)
    status: str | None = Field(default=None, pattern="^(active|planned|deprecated|paused)$")
    tags: list[str] | None = Field(default=None, max_length=30)
    quality_rules: list[str] | None = Field(default=None, max_length=30)
    lineage_upstream: list[str] | None = Field(default=None, max_length=60)
    lineage_downstream: list[str] | None = Field(default=None, max_length=60)
    note: str = Field(default="", max_length=500)


class MetadataGovernanceTasksIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True
    priority: str = Field(default="P1", pattern="^P[0-3]$")
    assigned_to: str = Field(default="Data Governance Agent", max_length=120)
    dev_tool: str = Field(default="codex", max_length=80)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _scope() -> dict[str, str]:
    return {
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
    }


def _schema_registry_items(connector_id: str = "") -> list[dict[str, Any]]:
    payload = data_ingest.schema_registry(connector_id=connector_id)
    return list(payload.get("items") or [])


def _is_sensitive(name: str, type_name: str = "") -> bool:
    text = f"{name} {type_name}".lower()
    return any(hint in text for hint in SENSITIVE_HINTS)


def _normalize_asset(asset: dict[str, Any], rules: list[dict[str, Any]]) -> dict[str, Any]:
    quality = _asset_quality(asset, rules)
    upstream = list(asset.get("lineage_upstream") or [])
    downstream = list(asset.get("lineage_downstream") or [])
    return {
        "id": str(asset.get("id") or ""),
        "name": asset.get("name") or asset.get("id") or "",
        "type": asset.get("type") or "table",
        "domain": asset.get("domain") or "unknown",
        "source": asset.get("source") or "",
        "owner": asset.get("owner") or "",
        "status": asset.get("status") or "planned",
        "security_level": asset.get("security_level") or "internal",
        "description": asset.get("description") or "",
        "tags": list(asset.get("tags") or []),
        "metrics": list(asset.get("metrics") or []),
        "quality_rules": list(asset.get("quality_rules") or []),
        "ai_surfaces": list(asset.get("ai_surfaces") or []),
        "lineage_upstream": upstream,
        "lineage_downstream": downstream,
        "lineage_count": len(upstream) + len(downstream),
        "quality": quality,
        "quality_score": quality.get("score", 0),
        "quality_decision": quality.get("decision", "warn"),
        "updated_at": asset.get("updated_at") or "",
    }


def _asset_fields(asset: dict[str, Any]) -> list[dict[str, Any]]:
    fields = asset.get("fields") or asset.get("schema") or asset.get("columns") or []
    if not isinstance(fields, list):
        return []
    rows: list[dict[str, Any]] = []
    for idx, field in enumerate(fields):
        if isinstance(field, dict):
            name = str(field.get("name") or field.get("field") or field.get("column") or "")
            type_name = str(field.get("type") or field.get("data_type") or field.get("dtype") or "unknown")
            nullable = bool(field.get("nullable", True))
            description = str(field.get("description") or field.get("comment") or "")
        else:
            name = str(field)
            type_name = "unknown"
            nullable = True
            description = ""
        if not name:
            continue
        sensitive = _is_sensitive(name, type_name)
        rows.append(
            {
                "id": f"{asset.get('id') or 'asset'}:{name}",
                "asset_id": asset.get("id") or "",
                "asset_name": asset.get("name") or asset.get("id") or "",
                "name": name,
                "type": type_name,
                "nullable": nullable,
                "description": description,
                "source": asset.get("source") or "asset_catalog",
                "ordinal": idx + 1,
                "sensitivity": "sensitive" if sensitive else "normal",
                "classification": "pii_candidate" if sensitive else "standard",
                "quality_flags": ["sensitive_without_policy"] if sensitive and "pii_redaction" not in (asset.get("quality_rules") or []) else [],
            }
        )
    return rows


def _registry_fields() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in _schema_registry_items():
        table_name = str(item.get("table_name") or item.get("id") or "")
        asset_id = f"schema:{item.get('connector_id') or 'connector'}:{table_name}"
        for idx, column in enumerate(item.get("columns") or []):
            if isinstance(column, dict):
                name = str(column.get("name") or column.get("field") or column.get("column") or "")
                type_name = str(column.get("type") or column.get("data_type") or "unknown")
                nullable = bool(column.get("nullable", True))
                description = str(column.get("description") or column.get("comment") or "")
            else:
                name = str(column)
                type_name = "unknown"
                nullable = True
                description = ""
            if not name:
                continue
            sensitive = _is_sensitive(name, type_name)
            rows.append(
                {
                    "id": f"{asset_id}:{name}",
                    "asset_id": asset_id,
                    "asset_name": table_name,
                    "name": name,
                    "type": type_name,
                    "nullable": nullable,
                    "description": description,
                    "source": item.get("connector_name") or item.get("connector_id") or "schema_registry",
                    "connector_id": item.get("connector_id") or "",
                    "database": item.get("database") or "",
                    "table_name": table_name,
                    "ordinal": idx + 1,
                    "sensitivity": "sensitive" if sensitive else "normal",
                    "classification": "pii_candidate" if sensitive else "standard",
                    "quality_flags": ["needs_classification"] if sensitive else [],
                    "discovered_at": item.get("discovered_at") or item.get("created_at") or "",
                }
            )
    return rows


def _normalized_catalog() -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    data = _load_governance()
    rules = list(data.get("quality_rules") or [])
    assets = [_normalize_asset(asset, rules) for asset in data.get("assets") or []]
    fields = []
    for asset in data.get("assets") or []:
        fields.extend(_asset_fields(asset))
    fields.extend(_registry_fields())
    return assets, fields, data


def _metadata_governance_task_items(body: MetadataGovernanceTasksIn) -> list[dict[str, Any]]:
    assets, fields, _data = _normalized_catalog()
    selected = {str(item).strip() for item in body.ids if str(item).strip()}
    fields_by_asset: dict[str, list[dict[str, Any]]] = {}
    for field in fields:
        fields_by_asset.setdefault(str(field.get("asset_id") or ""), []).append(field)

    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_task(asset: dict[str, Any], category: str, title: str, description: str, priority: str, labels: list[str]) -> None:
        key = f"{category}:{asset.get('id')}"
        if key in seen:
            return
        seen.add(key)
        items.append(
            {
                "source": "metadata_governance",
                "source_report_id": str(asset.get("id") or ""),
                "source_report_title": str(asset.get("name") or asset.get("id") or "metadata asset"),
                "title": title,
                "description": description,
                "priority": priority,
                "assigned_to": body.assigned_to,
                "dev_tool": body.dev_tool,
                "labels": ["metadata", category, str(asset.get("domain") or "unknown"), *labels[:3]],
            }
        )

    for asset in assets:
        asset_id = str(asset.get("id") or "")
        if selected and asset_id not in selected:
            continue
        asset_name = str(asset.get("name") or asset_id)
        domain = str(asset.get("domain") or "unknown")
        if not str(asset.get("owner") or "").strip():
            add_task(
                asset,
                "missing-owner",
                f"[元数据] 补齐资产负责人：{asset_name}",
                f"资产 {asset_name}（{asset_id}）所属领域 {domain} 缺少负责人。请确认业务 Owner、Data Owner 和维护责任边界，并回写元数据资产目录。",
                "P1",
                [asset_name],
            )
        if not int(asset.get("lineage_count") or 0):
            add_task(
                asset,
                "missing-lineage",
                f"[元数据] 声明资产血缘：{asset_name}",
                f"资产 {asset_name}（{asset_id}）缺少上游或下游血缘声明。请补齐来源、消费方、变更影响范围和回滚检查点。",
                body.priority,
                [asset_name],
            )
        if str(asset.get("quality_decision") or "warn") != "pass":
            add_task(
                asset,
                "quality-watch",
                f"[元数据] 处理质量观察资产：{asset_name}",
                f"资产 {asset_name}（{asset_id}）质量分 {asset.get('quality_score', 0)}，决策为 {asset.get('quality_decision') or 'warn'}。请绑定必要质量规则并补齐质量门禁证据。",
                body.priority,
                [asset_name],
            )
        sensitive_without_policy = [
            field for field in fields_by_asset.get(asset_id, [])
            if field.get("sensitivity") == "sensitive" and "pii_redaction" not in (asset.get("quality_rules") or [])
        ]
        if sensitive_without_policy:
            sample = ", ".join(str(field.get("name") or "") for field in sensitive_without_policy[:5])
            add_task(
                asset,
                "sensitive-policy",
                f"[元数据] 补齐敏感字段策略：{asset_name}",
                f"资产 {asset_name}（{asset_id}）存在敏感字段候选：{sample}。请确认分类、脱敏策略、访问边界和审计要求，并将 pii_redaction 等规则写回资产治理配置。",
                "P0",
                [asset_name, "pii"],
            )
    return items


@router.get("/summary")
def metadata_summary() -> dict[str, Any]:
    assets, fields, data = _normalized_catalog()
    schema_items = _schema_registry_items()
    missing_owner = [asset for asset in assets if not asset.get("owner")]
    missing_lineage = [asset for asset in assets if not asset.get("lineage_count")]
    quality_watch = [asset for asset in assets if asset.get("quality_decision") != "pass"]
    domain_counter = Counter(str(asset.get("domain") or "unknown") for asset in assets)
    source_counter = Counter(str(asset.get("source") or "unknown") for asset in assets)
    sensitive_fields = [field for field in fields if field.get("sensitivity") == "sensitive"]
    linked_assets = [asset for asset in assets if asset.get("lineage_count")]
    score = max(0, 100 - len(missing_owner) * 8 - len(missing_lineage) * 5 - len(quality_watch) * 4)
    return {
        "ok": True,
        "scope": _scope(),
        "summary": {
            "assets": len(assets),
            "fields": len(fields),
            "schema_tables": len(schema_items),
            "sensitive_fields": len(sensitive_fields),
            "linked_assets": len(linked_assets),
            "missing_owner": len(missing_owner),
            "missing_lineage": len(missing_lineage),
            "quality_watch": len(quality_watch),
            "metadata_score": score,
        },
        "domains": [{"name": key, "count": value} for key, value in sorted(domain_counter.items())],
        "sources": [{"name": key, "count": value} for key, value in sorted(source_counter.items())],
        "quality_watch": quality_watch[:10],
        "agent_consumption": {
            "module": "metadata-management",
            "read_apis": ["/api/v1/metadata/assets", "/api/v1/metadata/fields", "/api/v1/metadata/lineage/impact"],
            "write_apis": ["/api/v1/metadata/assets/{asset_id}/classify", "/api/v1/metadata/governance/tasks"],
            "recommended_actions": ["complete_owner", "classify_sensitive_fields", "declare_lineage", "create_governance_tasks"],
        },
        "updated_at": data.get("updated_at") or _now(),
    }


@router.get("/assets")
def metadata_assets(
    domain: str = Query("", max_length=80),
    status: str = Query("", max_length=40),
    q: str = Query("", max_length=200),
) -> dict[str, Any]:
    assets, _fields, _data = _normalized_catalog()
    q_norm = q.strip().lower()
    rows: list[dict[str, Any]] = []
    for asset in assets:
        if domain and str(asset.get("domain") or "") != domain:
            continue
        if status and str(asset.get("status") or "") != status:
            continue
        if q_norm and q_norm not in " ".join(str(v) for v in [asset.get("id"), asset.get("name"), asset.get("source"), asset.get("owner"), asset.get("domain"), " ".join(asset.get("tags") or [])]).lower():
            continue
        rows.append(asset)
    return {"ok": True, "scope": _scope(), "items": rows, "total": len(rows)}


@router.get("/fields")
def metadata_fields(
    asset_id: str = Query("", max_length=160),
    q: str = Query("", max_length=200),
    sensitive: bool | None = Query(default=None),
) -> dict[str, Any]:
    _assets, fields, _data = _normalized_catalog()
    q_norm = q.strip().lower()
    rows: list[dict[str, Any]] = []
    for field in fields:
        if asset_id and str(field.get("asset_id") or "") != asset_id:
            continue
        if sensitive is not None and (field.get("sensitivity") == "sensitive") != sensitive:
            continue
        if q_norm and q_norm not in " ".join(str(v) for v in [field.get("name"), field.get("asset_name"), field.get("type"), field.get("source"), field.get("description")]).lower():
            continue
        rows.append(field)
    return {"ok": True, "scope": _scope(), "items": rows, "total": len(rows)}


@router.get("/lineage/impact")
def metadata_lineage_impact(asset_id: str = Query("", max_length=160)) -> dict[str, Any]:
    if not asset_id.strip():
        raise HTTPException(400, "asset_id required")
    assets, _fields, _data = _normalized_catalog()
    asset = next((item for item in assets if item.get("id") == asset_id), None)
    if not asset:
        raise HTTPException(404, "metadata asset not found")
    source_node = str(asset.get("source") or asset_id)
    payload = analytics_lineage_impact(node_id=source_node)
    return {
        "ok": True,
        "scope": _scope(),
        "asset": asset,
        "node_id": source_node,
        "node": payload.get("node"),
        "upstream": payload.get("upstream") or [],
        "downstream": payload.get("downstream") or [],
        "upstream_count": payload.get("upstream_count", 0),
        "downstream_count": payload.get("downstream_count", 0),
    }


@router.get("/lineage")
def metadata_lineage() -> dict[str, Any]:
    payload = analytics_lineage()
    return {"ok": True, "scope": _scope(), "nodes": payload.get("nodes") or [], "edges": payload.get("edges") or [], "summary": payload.get("summary") or {}}


@router.post("/governance/tasks")
def metadata_governance_tasks(body: MetadataGovernanceTasksIn) -> dict[str, Any]:
    items = _metadata_governance_task_items(body)
    if body.dry_run:
        return {"ok": True, "scope": _scope(), "dry_run": True, "items": items, "created": [], "planned": len(items)}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = [create_task(TaskCreate(**item)) for item in items]
    return {"ok": True, "scope": _scope(), "dry_run": False, "items": items, "created": created, "planned": len(items), "created_count": len(created)}


@router.post("/assets/{asset_id}/classify")
def metadata_classify_asset(asset_id: str, body: MetadataAssetClassifyIn) -> dict[str, Any]:
    data = _load_governance()
    patch = body.model_dump(exclude_none=True)
    note = str(patch.pop("note", "") or "").strip()
    for asset in data.get("assets") or []:
        if str(asset.get("id") or "") == asset_id:
            asset.update(patch)
            audit = list(asset.get("metadata_classification_history") or [])
            audit.append({"at": _now(), "note": note, "patch": patch})
            asset["metadata_classification_history"] = audit[-20:]
            asset["updated_at"] = _now()
            saved = _save_governance(data)
            rules = list(saved.get("quality_rules") or [])
            return {"ok": True, "scope": _scope(), "item": _normalize_asset(asset, rules)}
    raise HTTPException(404, "metadata asset not found")
