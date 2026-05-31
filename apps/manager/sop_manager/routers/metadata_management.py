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
            "write_apis": ["/api/v1/metadata/assets/{asset_id}/classify"],
            "recommended_actions": ["complete_owner", "classify_sensitive_fields", "declare_lineage"],
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
