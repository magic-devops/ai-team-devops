"""标签服务：标签目录、规则、画像本体。"""
from __future__ import annotations
from sop_manager.text_files import read_text_file
import json
from sop_manager.task_owner import TaskOwnerId, TaskOwnerInput

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.scope_guard import attach_scope, scope_matches

from sop_manager.project_write_guard import project_file_write_scope

router = APIRouter(prefix="/api/v1/tag-service", tags=["tag-service"])

def _dir(sub: str):
    d = resolved_ai_memory_root() / "tag_service" / sub
    return d

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _scope() -> dict:
    return {"tenant_code": resolved_tenant_code(), "business_code": resolved_business_code(), "project_id": resolved_project_id()}

def _load_all(sub: str) -> list[dict]:
    items = []
    for f in _dir(sub).glob("*.json"):
        try:
            item = json.loads(read_text_file(f))
            if isinstance(item, dict) and scope_matches(item, require_business=True):
                items.append(item)
        except Exception:
            pass
    return sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)

def _save(sub: str, item: dict):
    with project_file_write_scope():
        _dir(sub).mkdir(parents=True, exist_ok=True)
        attach_scope(item, overwrite=False)
        (_dir(sub) / f"{item['id']}.json").write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")

def _load_item(sub: str, item_id: str, label: str) -> dict:
    p = _dir(sub) / f"{item_id}.json"
    if not p.exists():
        raise HTTPException(404, f"{label} not found")
    try:
        item = json.loads(read_text_file(p))
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


class TagGovernanceTasksIn(TaskOwnerInput):
    ids: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True
    priority: str = Field(default="P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field(default="codex", max_length=80)
    min_coverage: float = Field(default=0.8, ge=0, le=1)


class TagApprovalCreateIn(BaseModel):
    target_type: str = Field(default="entity", pattern="^(tag|rule|entity|profile)$")
    target_id: str
    action: str = Field(default="publish_contract", pattern="^(publish_contract|activate_rule|deprecate_tag)$")
    reason: str = Field(default="", max_length=800)
    requested_by: str = Field(default="TagOps Agent", max_length=120)
    reviewers: list[str] = Field(default_factory=lambda: ["Data Governance"], max_length=20)
    payload: dict[str, Any] = Field(default_factory=dict)
    auto_apply_on_approval: bool = True


class TagApprovalReviewIn(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected|cancelled)$")
    reviewer: str = Field(default="Data Governance", max_length=120)
    note: str = Field(default="", max_length=800)


def _approval_counts(items: list[dict]) -> dict[str, int]:
    counts = {"pending": 0, "approved": 0, "rejected": 0, "cancelled": 0}
    for item in items:
        status = str(item.get("status") or "pending")
        counts[status] = counts.get(status, 0) + 1
    return counts


def _target_collection(target_type: str) -> tuple[str, str]:
    if target_type == "tag":
        return "tags", "tag"
    if target_type == "rule":
        return "rules", "rule"
    if target_type == "profile":
        return "profile_builds", "profile"
    return "ontology_entities", "entity"


def _target_name(target_type: str, item: dict) -> str:
    if target_type == "tag":
        return str(item.get("name") or item.get("id") or "")
    if target_type == "rule":
        return str(item.get("entity_type") or item.get("tag_id") or item.get("id") or "")
    if target_type == "profile":
        return str(item.get("profile_name") or item.get("entity_type") or item.get("id") or "")
    return str(item.get("name") or item.get("entity_type") or item.get("id") or "")


def _tag_governance_task_items(body: TagGovernanceTasksIn) -> list[dict[str, Any]]:
    tags = _load_all("tags")
    rules = _load_all("rules")
    entities = _load_all("ontology_entities")
    builds = _load_all("profile_builds")
    contracts = _load_all("contracts")
    selected = {str(item).strip() for item in body.ids if str(item).strip()}
    tag_ids = {str(tag.get("id") or "") for tag in tags}
    rules_by_tag: dict[str, list[dict[str, Any]]] = {}
    rules_by_entity: dict[str, list[dict[str, Any]]] = {}
    for rule in rules:
        rules_by_tag.setdefault(str(rule.get("tag_id") or ""), []).append(rule)
        entity_type = str(rule.get("entity_type") or "")
        if entity_type:
            rules_by_entity.setdefault(entity_type, []).append(rule)
    builds_by_entity: dict[str, list[dict[str, Any]]] = {}
    for build in builds:
        builds_by_entity.setdefault(str(build.get("entity_type") or ""), []).append(build)
    contract_entity_ids = {str(item.get("entity_id") or "") for item in contracts}

    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_task(source_id: str, source_title: str, category: str, title: str, description: str, priority: str, labels: list[str]) -> None:
        key = f"{category}:{source_id}"
        if key in seen:
            return
        seen.add(key)
        items.append(
            {
                "source": "tag_governance",
                "source_report_id": source_id,
                "source_report_title": source_title,
                "title": title,
                "description": description,
                "priority": priority,
                "owner_id": body.owner_id,
                "dev_tool": body.dev_tool,
                "labels": ["tags", category, *labels[:4]],
            }
        )

    for tag in tags:
        tag_id = str(tag.get("id") or "")
        if selected and tag_id not in selected:
            continue
        tag_name = str(tag.get("name") or tag_id)
        applies_to = tag.get("applies_to") if isinstance(tag.get("applies_to"), list) else []
        tag_rules = rules_by_tag.get(tag_id, [])
        if not str(tag.get("owner") or "").strip():
            add_task(
                tag_id,
                tag_name,
                "missing-owner",
                f"[标签] 补齐标签负责人：{tag_name}",
                f"标签 {tag_name} 缺少 owner，无法形成口径维护、规则变更、画像发布和异常响应责任闭环。请补齐负责人和治理说明。",
                "P1",
                ["owner", str(tag.get("category") or "general")],
            )
        if not applies_to:
            add_task(
                tag_id,
                tag_name,
                "missing-entity-scope",
                f"[标签] 明确标签适用实体：{tag_name}",
                f"标签 {tag_name} 未声明适用实体，规则试算、画像构建和契约发布无法判断消费边界。请补齐 applies_to 并确认实体本体。",
                body.priority,
                ["entity", "scope"],
            )
        if not tag_rules:
            add_task(
                tag_id,
                tag_name,
                "missing-rule",
                f"[标签] 配置标签打标规则：{tag_name}",
                f"标签 {tag_name} 尚未配置打标规则，画像构建无法自动产出该标签。请补齐条件字段、操作符、输出值和优先级。",
                body.priority,
                ["rule", "automation"],
            )

    for rule in rules:
        rule_id = str(rule.get("id") or "")
        if selected and rule_id not in selected:
            continue
        condition = rule.get("condition") if isinstance(rule.get("condition"), dict) else {}
        if not str(rule.get("tag_id") or "") or str(rule.get("tag_id") or "") not in tag_ids:
            add_task(
                rule_id,
                f"rule {rule_id}",
                "orphan-rule",
                f"[标签] 修复孤立打标规则：{rule_id[:8]}",
                "该打标规则无法匹配有效标签，可能导致规则试算和画像构建结果不完整。请重新绑定标签或清理规则。",
                "P1",
                ["rule", "orphan"],
            )
        if not str(condition.get("field") or "").strip():
            add_task(
                rule_id,
                f"rule {rule_id}",
                "invalid-condition",
                f"[标签] 补齐打标规则条件字段：{rule_id[:8]}",
                "该打标规则缺少 condition.field，规则试算无法获得可解释 trace。请补齐字段、操作符和期望值。",
                "P1",
                ["rule", "condition"],
            )

    for entity in entities:
        entity_id = str(entity.get("id") or "")
        if selected and entity_id not in selected:
            continue
        entity_type = str(entity.get("entity_type") or "")
        entity_name = str(entity.get("name") or entity_type or entity_id)
        entity_builds = builds_by_entity.get(entity_type, [])
        if entity_type and not rules_by_entity.get(entity_type):
            add_task(
                entity_id,
                entity_name,
                "entity-without-rules",
                f"[标签] 补齐实体打标规则：{entity_name}",
                f"实体 {entity_name} 暂无匹配的打标规则，画像构建无法形成稳定标签输出。请为该实体补齐至少一条规则并完成样本试算。",
                body.priority,
                ["entity", "rule"],
            )
        if not entity_builds:
            add_task(
                entity_id,
                entity_name,
                "missing-profile-build",
                f"[标签] 构建实体画像：{entity_name}",
                f"实体 {entity_name} 尚无画像构建记录，标签 API 发布前缺少覆盖率和命中样本证据。请执行画像构建并保存结果。",
                body.priority,
                ["profile", "build"],
            )
        if entity_id not in contract_entity_ids:
            add_task(
                entity_id,
                entity_name,
                "missing-contract",
                f"[标签] 发布标签 API 契约：{entity_name}",
                f"实体 {entity_name} 尚未发布标签 API 契约，业务系统和 Agent 无法稳定消费画像标签。请发布契约并确认 scope_required。",
                body.priority,
                ["api", "contract"],
            )

    for build in builds:
        build_id = str(build.get("id") or "")
        if selected and build_id not in selected:
            continue
        coverage = float(build.get("coverage") or 0)
        if coverage < body.min_coverage:
            add_task(
                build_id,
                str(build.get("profile_name") or build.get("entity_type") or build_id),
                "low-coverage",
                f"[标签] 提升画像覆盖率：{build.get('profile_name') or build.get('entity_type') or build_id}",
                f"画像构建覆盖率为 {coverage:.1%}，低于目标 {body.min_coverage:.0%}。请补充规则、样本或实体字段映射，并重新构建画像。",
                body.priority,
                ["profile", "coverage"],
            )
    return items


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
        with project_file_write_scope():
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
    with project_file_write_scope():
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
    with project_file_write_scope():
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


@router.post("/governance/tasks")
def tag_governance_tasks(body: TagGovernanceTasksIn) -> dict[str, Any]:
    items = _tag_governance_task_items(body)
    if body.dry_run:
        return {"ok": True, "scope": _scope(), "dry_run": True, "items": items, "created": [], "planned": len(items)}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = [create_task(TaskCreate(**{key: value for key, value in item.items() if key != "labels"})) for item in items]
    return {"ok": True, "scope": _scope(), "dry_run": False, "items": items, "created": created, "planned": len(items), "created_count": len(created)}


@router.get("/approvals")
def list_tag_approvals(status: str = "", target_id: str = ""):
    items = _load_all("approvals")
    if status:
        items = [item for item in items if item.get("status") == status]
    if target_id:
        items = [item for item in items if item.get("target_id") == target_id]
    return {**_scope(), "items": items, "total": len(items), "counts": _approval_counts(_load_all("approvals"))}


@router.post("/approvals")
def create_tag_approval(body: TagApprovalCreateIn):
    collection, label = _target_collection(body.target_type)
    target = _load_item(collection, body.target_id, label)
    if body.action == "publish_contract" and body.target_type != "entity":
        raise HTTPException(400, "publish_contract approval requires entity target_type")
    if body.action == "activate_rule" and body.target_type != "rule":
        raise HTTPException(400, "activate_rule approval requires rule target_type")
    if body.action == "deprecate_tag" and body.target_type != "tag":
        raise HTTPException(400, "deprecate_tag approval requires tag target_type")
    approval = {
        **_scope(),
        "id": str(uuid4()),
        "kind": "tag",
        "target_type": body.target_type,
        "target_id": body.target_id,
        "target_name": _target_name(body.target_type, target),
        "action": body.action,
        "status": "pending",
        "reason": body.reason,
        "requested_by": body.requested_by,
        "reviewers": body.reviewers,
        "payload": body.payload,
        "auto_apply_on_approval": body.auto_apply_on_approval,
        "risk": {
            "risk_level": "medium" if body.action in {"publish_contract", "activate_rule"} else "high",
            "scope_required": ["tenant_code", "business_code", "project_id"],
            "recommended_actions": ["审核标签消费边界、规则试算样本和契约消费者后再批准"],
        },
        "review_events": [],
        "created_at": _now(),
    }
    _save("approvals", approval)
    return approval


@router.post("/approvals/{approval_id}/review")
def review_tag_approval(approval_id: str, body: TagApprovalReviewIn):
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
        target_id = str(approval.get("target_id") or "")
        if action == "publish_contract":
            approval["applied_result"] = publish_contract(target_id)
            approval["applied_at"] = _now()
        elif action == "activate_rule":
            rule = _load_item("rules", target_id, "rule")
            rule["status"] = "active"
            rule["updated_at"] = _now()
            _save("rules", rule)
            approval["applied_result"] = {"rule_id": target_id, "status": rule.get("status")}
            approval["applied_at"] = _now()
        elif action == "deprecate_tag":
            tag = _load_item("tags", target_id, "tag")
            tag["status"] = "deprecated"
            tag["updated_at"] = _now()
            _save("tags", tag)
            approval["applied_result"] = {"tag_id": target_id, "status": tag.get("status")}
            approval["applied_at"] = _now()
    _save("approvals", approval)
    return approval


@router.get("/summary")
def summary():
    tags = _load_all("tags")
    rules = _load_all("rules")
    entities = _load_all("ontology_entities")
    builds = _load_all("profile_builds")
    contracts = _load_all("contracts")
    approval_counts = _approval_counts(_load_all("approvals"))
    tag_ids_with_rules = {str(rule.get("tag_id") or "") for rule in rules}
    entity_types_with_rules = {str(rule.get("entity_type") or "") for rule in rules if rule.get("entity_type")}
    entity_types_with_builds = {str(build.get("entity_type") or "") for build in builds}
    contract_entity_ids = {str(contract.get("entity_id") or "") for contract in contracts}
    governance_ids = {
        str(tag.get("id") or "")
        for tag in tags
        if not str(tag.get("owner") or "").strip()
        or not (tag.get("applies_to") if isinstance(tag.get("applies_to"), list) else [])
        or str(tag.get("id") or "") not in tag_ids_with_rules
    }
    governance_ids.update(
        str(rule.get("id") or "")
        for rule in rules
        if not ((rule.get("condition") if isinstance(rule.get("condition"), dict) else {}).get("field"))
    )
    governance_ids.update(
        str(entity.get("id") or "")
        for entity in entities
        if str(entity.get("entity_type") or "") not in entity_types_with_rules
        or str(entity.get("entity_type") or "") not in entity_types_with_builds
        or str(entity.get("id") or "") not in contract_entity_ids
    )
    return {**_scope(), "summary": {"tags_total": len(tags),
            "rules_active": sum(1 for r in rules if r.get("status") == "active"),
            "entities": len(entities), "profiles_built": len(builds),
            "profiles_published": sum(1 for b in builds if b.get("status") == "published"),
            "contracts": len(contracts),
            "missing_owner": sum(1 for tag in tags if not str(tag.get("owner") or "").strip()),
            "tags_without_rules": sum(1 for tag in tags if str(tag.get("id") or "") not in tag_ids_with_rules),
            "entities_without_contract": sum(1 for entity in entities if str(entity.get("id") or "") not in contract_entity_ids),
            "low_coverage_profiles": sum(1 for build in builds if float(build.get("coverage") or 0) < 0.8),
            "governance_todos": len(governance_ids),
            "pending_approvals": approval_counts.get("pending", 0),
            "approved_approvals": approval_counts.get("approved", 0)}}
