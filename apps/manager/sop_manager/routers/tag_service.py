"""标签服务：标签目录、规则、画像本体。"""
from __future__ import annotations
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.scope_guard import attach_scope, scope_matches

router = APIRouter(prefix="/api/v1/tag-service", tags=["tag-service"])

def _dir(sub: str):
    d = resolved_ai_memory_root() / "tag_service" / sub
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

def _compare(actual: Any, operator: str, expected: Any) -> bool:
    op = operator.strip().lower()
    if op in {"==", "eq"}:
        return actual == expected
    if op in {"!=", "ne"}:
        return actual != expected
    if op in {">", ">=", "<", "<="}:
        try:
            actual_num = float(actual)
            expected_num = float(expected)
        except (TypeError, ValueError):
            return False
        if op == ">":
            return actual_num > expected_num
        if op == ">=":
            return actual_num >= expected_num
        if op == "<":
            return actual_num < expected_num
        return actual_num <= expected_num
    if op == "contains":
        if isinstance(actual, list):
            return expected in actual
        return str(expected) in str(actual or "")
    if op == "in":
        return actual in expected if isinstance(expected, list) else str(actual) in str(expected)
    if op == "exists":
        return actual is not None and actual != ""
    return False

def _evaluate_rule(rule: dict, sample: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    condition = rule.get("condition") if isinstance(rule.get("condition"), dict) else {}
    field = str(condition.get("field") or "")
    operator = str(condition.get("operator") or "==")
    expected = condition.get("value")
    actual = sample.get(field)
    matched = _compare(actual, operator, expected)
    return matched, {"field": field, "operator": operator, "expected": expected, "actual": actual, "matched": matched}

class TagCreate(BaseModel):
    name: str
    category: str = "general"
    description: str = ""
    value_type: str = "string"
    owner: str = ""
    applies_to: list[str] = Field(default_factory=list)

class RuleCreate(BaseModel):
    tag_id: str
    entity_type: str = ""
    condition: dict = Field(default_factory=dict)
    output_value: Any = True
    priority: int = 0

class EntityCreate(BaseModel):
    entity_type: str
    name: str
    attributes: dict = Field(default_factory=dict)

class TagPatch(BaseModel):
    name: str | None = None
    category: str | None = None
    description: str | None = None
    value_type: str | None = None
    owner: str | None = None
    applies_to: list[str] | None = None
    status: str | None = None

class RuleEvaluateIn(BaseModel):
    entity_type: str
    sample: dict[str, Any] = Field(default_factory=dict)

class ProfileBuildIn(BaseModel):
    entity_type: str
    profile_name: str = "Profile Build"
    records: list[dict[str, Any]] = Field(default_factory=list)
    publish: bool = False

@router.get("/catalog")
def list_tags(category: str = ""):
    items = _load_all("tags")
    if category:
        items = [i for i in items if i.get("category") == category]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/catalog")
def create_tag(body: TagCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "status": "active", "created_at": _now()}
    _save("tags", item)
    return item

@router.put("/catalog/{tag_id}")
def update_tag(tag_id: str, body: TagPatch):
    item = _load_item("tags", tag_id, "tag")
    item.update({k: v for k, v in body.model_dump().items() if v is not None})
    item["updated_at"] = _now()
    _save("tags", item)
    return item

@router.delete("/catalog/{tag_id}")
def delete_tag(tag_id: str):
    _load_item("tags", tag_id, "tag")
    p = _dir("tags") / f"{tag_id}.json"
    if p.exists():
        p.unlink()
    return {**_scope(), "deleted": tag_id}

@router.get("/rules")
def list_rules():
    return {**_scope(), "items": _load_all("rules"), "total": len(_load_all("rules"))}

@router.post("/rules")
def create_rule(body: RuleCreate):
    _load_item("tags", body.tag_id, "tag")
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "status": "active", "created_at": _now()}
    _save("rules", item)
    return item

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str):
    _load_item("rules", rule_id, "rule")
    p = _dir("rules") / f"{rule_id}.json"
    p.unlink()
    return {**_scope(), "deleted": rule_id}

@router.post("/rules/evaluate")
def evaluate_rules(body: RuleEvaluateIn):
    tags = {tag["id"]: tag for tag in _load_all("tags")}
    rules = sorted(
        [rule for rule in _load_all("rules") if rule.get("status") == "active" and (not rule.get("entity_type") or rule.get("entity_type") == body.entity_type)],
        key=lambda row: int(row.get("priority") or 0),
        reverse=True,
    )
    matches = []
    for rule in rules:
        tag = tags.get(str(rule.get("tag_id") or ""))
        if not tag:
            continue
        applies_to = tag.get("applies_to") if isinstance(tag.get("applies_to"), list) else []
        if applies_to and body.entity_type not in applies_to:
            continue
        matched, trace = _evaluate_rule(rule, body.sample)
        if not matched:
            continue
        matches.append({
            "rule_id": rule.get("id", ""),
            "tag_id": tag.get("id", ""),
            "tag_name": tag.get("name", ""),
            "assigned_value": rule.get("output_value", True),
            "priority": rule.get("priority", 0),
            "trace": trace,
        })
    return {**_scope(), "entity_type": body.entity_type, "sample": body.sample, "matches": matches, "matched_count": len(matches)}

@router.get("/ontology")
def get_ontology():
    entities = _load_all("ontology_entities")
    return {**_scope(), "entities": entities, "entity_count": len(entities)}

@router.post("/ontology/entities")
def create_entity(body: EntityCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "created_at": _now()}
    _save("ontology_entities", item)
    return item

@router.delete("/ontology/entities/{entity_id}")
def delete_entity(entity_id: str):
    _load_item("ontology_entities", entity_id, "entity")
    p = _dir("ontology_entities") / f"{entity_id}.json"
    p.unlink()
    return {**_scope(), "deleted": entity_id}

@router.get("/profiles/builds")
def list_profile_builds(entity_type: str = ""):
    items = _load_all("profile_builds")
    if entity_type:
        items = [item for item in items if item.get("entity_type") == entity_type]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/profiles/build")
def profile_build(body: ProfileBuildIn):
    evaluated_records = []
    tagged_records = 0
    for idx, record in enumerate(body.records):
        evaluation = evaluate_rules(RuleEvaluateIn(entity_type=body.entity_type, sample=record))
        if evaluation["matched_count"]:
            tagged_records += 1
        evaluated_records.append({"index": idx, "record": record, "matches": evaluation["matches"]})
    item = {
        **_scope(),
        "id": str(uuid4()),
        "entity_type": body.entity_type,
        "profile_name": body.profile_name,
        "records_total": len(body.records),
        "tagged_records": tagged_records,
        "coverage": round(tagged_records / len(body.records), 3) if body.records else 0,
        "status": "published" if body.publish else "built",
        "records_sample": evaluated_records[:20],
        "created_at": _now(),
        "published_at": _now() if body.publish else None,
    }
    _save("profile_builds", item)
    return item

@router.post("/ontology/entities/{entity_id}/publish")
def publish_contract(entity_id: str):
    entity = _load_item("ontology_entities", entity_id, "entity")
    entity_type = str(entity.get("entity_type") or "")
    tags = [
        tag for tag in _load_all("tags")
        if not tag.get("applies_to") or entity_type in (tag.get("applies_to") if isinstance(tag.get("applies_to"), list) else [])
    ]
    rules = [rule for rule in _load_all("rules") if not rule.get("entity_type") or rule.get("entity_type") == entity_type]
    contract = {
        **_scope(),
        "id": f"contract-{entity_id}",
        "entity_id": entity_id,
        "entity_type": entity_type,
        "entity_name": entity.get("name", ""),
        "endpoint": f"/api/v1/tag-service/profiles/{entity_type}",
        "method": "GET",
        "tags": [tag.get("name", "") for tag in tags],
        "tag_ids": [tag.get("id", "") for tag in tags],
        "rules": len(rules),
        "scope_required": ["tenant_code", "business_code", "project_id"],
        "published_at": _now(),
    }
    _save("contracts", contract)
    return contract

@router.get("/summary")
def summary():
    tags = _load_all("tags")
    rules = _load_all("rules")
    entities = _load_all("ontology_entities")
    builds = _load_all("profile_builds")
    return {**_scope(), "summary": {"tags_total": len(tags),
            "rules_active": sum(1 for r in rules if r.get("status") == "active"),
            "entities": len(entities), "profiles_built": len(builds),
            "profiles_published": sum(1 for b in builds if b.get("status") == "published")}}
