"""标签服务：标签目录、规则、画像本体。"""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id

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

class TagCreate(BaseModel):
    name: str
    category: str = "general"
    description: str = ""
    value_type: str = "string"
    owner: str = ""

class RuleCreate(BaseModel):
    tag_id: str
    condition: dict = Field(default_factory=dict)
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
    status: str | None = None

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
    import json
    p = _dir("tags") / f"{tag_id}.json"
    if not p.exists():
        raise HTTPException(404, "tag not found")
    item = json.loads(p.read_text())
    item.update({k: v for k, v in body.model_dump().items() if v is not None})
    item["updated_at"] = _now()
    _save("tags", item)
    return item

@router.delete("/catalog/{tag_id}")
def delete_tag(tag_id: str):
    p = _dir("tags") / f"{tag_id}.json"
    if p.exists():
        p.unlink()
    return {**_scope(), "deleted": tag_id}

@router.get("/rules")
def list_rules():
    return {**_scope(), "items": _load_all("rules"), "total": len(_load_all("rules"))}

@router.post("/rules")
def create_rule(body: RuleCreate):
    if not (_dir("tags") / f"{body.tag_id}.json").exists():
        raise HTTPException(404, "tag not found")
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "status": "active", "created_at": _now()}
    _save("rules", item)
    return item

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str):
    p = _dir("rules") / f"{rule_id}.json"
    if not p.exists():
        raise HTTPException(404, "rule not found")
    p.unlink()
    return {**_scope(), "deleted": rule_id}

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
    p = _dir("ontology_entities") / f"{entity_id}.json"
    if not p.exists():
        raise HTTPException(404, "entity not found")
    p.unlink()
    return {**_scope(), "deleted": entity_id}

@router.get("/summary")
def summary():
    tags = _load_all("tags")
    rules = _load_all("rules")
    entities = _load_all("ontology_entities")
    return {**_scope(), "summary": {"tags_total": len(tags),
            "rules_active": sum(1 for r in rules if r.get("status") == "active"),
            "entities": len(entities), "profiles_built": 0}}
