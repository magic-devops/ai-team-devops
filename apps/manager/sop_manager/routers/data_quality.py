"""数据质量规则引擎：规则目录、质量运行、告警处置。"""
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

def _parse_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

class RuleCreate(BaseModel):
    name: str
    domain: str = "general"
    rule_type: str = "completeness"
    expression: str = ""
    severity: str = "medium"
    config: dict[str, Any] = Field(default_factory=dict)

class RunCreate(BaseModel):
    rule_id: str
    dataset: str = ""
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)
    execute_now: bool = True

class RunResult(BaseModel):
    status: str
    score: float = 1.0
    rows_checked: int = 0
    rows_failed: int = 0
    failed_samples: list[dict[str, Any]] = Field(default_factory=list)
    alert_attribution: dict[str, Any] = Field(default_factory=dict)

class RulePatch(BaseModel):
    name: str | None = None
    domain: str | None = None
    rule_type: str | None = None
    expression: str | None = None
    severity: str | None = None
    status: str | None = None
    config: dict[str, Any] | None = None

class AlertTasksIn(TaskOwnerInput):
    ids: list[str] = Field(default_factory=list)
    dry_run: bool = True
    priority: str = "P1"
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"


class QualityImpactTasksIn(TaskOwnerInput):
    alert_ids: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True
    priority: str = Field(default="P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field(default="codex", max_length=80)


class QualitySubscriptionIn(BaseModel):
    name: str = Field(default="质量告警订阅", max_length=120)
    channel: str = Field(..., min_length=1, max_length=120)
    enabled: bool = True
    schedule: str = Field(default="manual", max_length=40)
    severity_min: str = Field(default="medium", pattern="^(low|medium|high|critical)$")
    min_impact_score: int = Field(default=1, ge=0, le=100)
    include_impact: bool = True
    owner: str = Field(default="Data Governance Agent", max_length=120)
    event_types: list[str] = Field(default_factory=lambda: ["quality_alert_open", "quality_impact_high"], max_length=20)


class QualitySubscriptionPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    channel: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None
    schedule: str | None = Field(default=None, max_length=40)
    severity_min: str | None = Field(default=None, pattern="^(low|medium|high|critical)$")
    min_impact_score: int | None = Field(default=None, ge=0, le=100)
    include_impact: bool | None = None
    owner: str | None = Field(default=None, max_length=120)
    event_types: list[str] | None = Field(default=None, max_length=20)


class QualitySubscriptionRunIn(BaseModel):
    subscription_ids: list[str] = Field(default_factory=list, max_length=100)
    channels: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True
    force: bool = False
    note: str = Field(default="", max_length=1000)


class QualityRcaIn(BaseModel):
    alert_ids: list[str] = Field(default_factory=list, max_length=100)
    persist: bool = True
    include_impact: bool = True


class QualityRcaTasksIn(TaskOwnerInput):
    rca_id: str = Field(default="", max_length=120)
    alert_ids: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True
    priority: str = Field(default="P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field(default="codex", max_length=80)


class QualityForecastIn(BaseModel):
    window_days: int = Field(default=30, ge=3, le=180)
    horizon_days: int = Field(default=7, ge=1, le=60)
    persist: bool = True
    include_rca: bool = True
    include_impact: bool = True


class QualityForecastTasksIn(TaskOwnerInput):
    forecast_id: str = Field(default="", max_length=120)
    window_days: int = Field(default=30, ge=3, le=180)
    horizon_days: int = Field(default=7, ge=1, le=60)
    dry_run: bool = True
    priority: str = Field(default="P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field(default="codex", max_length=80)


def _rule_config(rule: dict) -> dict[str, Any]:
    config = dict(rule.get("config") if isinstance(rule.get("config"), dict) else {})
    expression = str(rule.get("expression") or "").strip()
    if expression:
        try:
            parsed = json.loads(expression)
            if isinstance(parsed, dict):
                config.update(parsed)
        except Exception:
            config.setdefault("field", expression)
    return config

def _empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())

def _root(field: str, suffix: str) -> str:
    return f"{field}_{suffix}" if field else suffix

def _add_failed(failed: list[dict[str, Any]], roots: list[str], *, row_index: int, row: dict[str, Any], field: str, reason: str):
    failed.append({"row_index": row_index, "field": field, "value": row.get(field), "reason": reason, "row": row})
    if reason not in roots:
        roots.append(reason)

def _evaluate_rule(rule: dict, rows: list[dict[str, Any]], dataset: str = "") -> RunResult:
    config = _rule_config(rule)
    rule_type = str(rule.get("rule_type") or "completeness").lower()
    field = str(config.get("field") or config.get("key") or "").strip()
    failed: list[dict[str, Any]] = []
    roots: list[str] = []

    if rule_type in {"not_null", "required", "completeness"}:
        for idx, row in enumerate(rows):
            if _empty(row.get(field)):
                _add_failed(failed, roots, row_index=idx, row=row, field=field, reason=_root(field, "null_or_empty"))
    elif rule_type == "range" or (rule_type == "validity" and ("min" in config or "max" in config)):
        min_v = config.get("min")
        max_v = config.get("max")
        for idx, row in enumerate(rows):
            try:
                value = float(row.get(field))
                below = min_v is not None and value < float(min_v)
                above = max_v is not None and value > float(max_v)
                bad = below or above
            except (TypeError, ValueError):
                bad = True
            if bad:
                _add_failed(failed, roots, row_index=idx, row=row, field=field, reason=_root(field, "out_of_range"))
    elif rule_type == "regex" or (rule_type == "validity" and config.get("pattern")):
        pattern = re.compile(str(config.get("pattern") or ".*"))
        for idx, row in enumerate(rows):
            if not pattern.match(str(row.get(field) or "")):
                _add_failed(failed, roots, row_index=idx, row=row, field=field, reason=_root(field, "regex_mismatch"))
    elif rule_type in {"uniqueness", "unique"}:
        seen: set[str] = set()
        for idx, row in enumerate(rows):
            value = str(row.get(field) or "")
            if value in seen:
                _add_failed(failed, roots, row_index=idx, row=row, field=field, reason=_root(field, "not_unique"))
            seen.add(value)
    elif rule_type == "freshness":
        max_age_hours = float(config.get("max_age_hours") or config.get("maxAgeHours") or 24)
        reference = _parse_time(config.get("reference_time")) or datetime.now(timezone.utc)
        if reference.tzinfo is None:
            reference = reference.replace(tzinfo=timezone.utc)
        for idx, row in enumerate(rows):
            value = _parse_time(row.get(field))
            if value is None:
                _add_failed(failed, roots, row_index=idx, row=row, field=field, reason=_root(field, "stale"))
                continue
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            if (reference - value).total_seconds() > max_age_hours * 3600:
                _add_failed(failed, roots, row_index=idx, row=row, field=field, reason=_root(field, "stale"))
    else:
        for idx, row in enumerate(rows):
            if field and _empty(row.get(field)):
                _add_failed(failed, roots, row_index=idx, row=row, field=field, reason=_root(field, "invalid"))

    rows_checked = len(rows)
    rows_failed = len(failed)
    score = round((rows_checked - rows_failed) / rows_checked, 3) if rows_checked else 1.0
    severity = str(rule.get("severity") or "medium").lower()
    status = "passed" if rows_failed == 0 else ("failed" if severity in {"critical", "high"} else "warning")
    attribution = {
        "rule_id": rule.get("id", ""),
        "rule_name": rule.get("name", ""),
        "rule_type": rule_type,
        "dataset": dataset,
        "field": field,
        "rows_checked": rows_checked,
        "failed_rows": rows_failed,
        "root_causes": roots,
        "failed_fields": sorted({sample.get("field", "") for sample in failed if sample.get("field")}),
        "recommended_actions": [
            f"修复 {field or '目标字段'} 的 {', '.join(roots)} 数据问题",
            "补充上游校验并重新执行质量规则",
        ] if rows_failed else [],
    }
    return RunResult(status=status, score=score, rows_checked=rows_checked, rows_failed=rows_failed, failed_samples=failed[:20], alert_attribution=attribution)

def _save_alert_for_run(run: dict, rule: dict) -> dict | None:
    if int(run.get("rows_failed") or 0) <= 0:
        return None
    attribution = run.get("alert_attribution") if isinstance(run.get("alert_attribution"), dict) else {}
    roots = attribution.get("root_causes") if isinstance(attribution.get("root_causes"), list) else []
    message = f"{rule.get('name', '质量规则')} 命中 {run.get('rows_failed', 0)} 行异常"
    alert = {
        **_scope(),
        "id": str(uuid4()),
        "run_id": run.get("id", ""),
        "rule_id": rule.get("id", ""),
        "dataset": run.get("dataset", ""),
        "severity": rule.get("severity", "medium"),
        "message": message,
        "status": "open",
        "root_causes": roots,
        "alert_attribution": attribution,
        "created_at": _now(),
        "resolved_at": None,
    }
    _save("alerts", alert)
    return alert


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _quality_context(alerts: list[dict]) -> dict[str, Any]:
    datasets = {_norm(alert.get("dataset") or (alert.get("alert_attribution") or {}).get("dataset")) for alert in alerts}
    fields: set[str] = set()
    root_causes: set[str] = set()
    severities: set[str] = set()
    for alert in alerts:
        severities.add(_norm(alert.get("severity") or "medium"))
        attribution = alert.get("alert_attribution") if isinstance(alert.get("alert_attribution"), dict) else {}
        if attribution.get("field"):
            fields.add(_norm(attribution.get("field")))
        for item in attribution.get("failed_fields") or []:
            fields.add(_norm(item))
        for item in attribution.get("root_causes") or alert.get("root_causes") or []:
            root = _norm(item)
            if root:
                root_causes.add(root)
                if "_" in root:
                    fields.add(root.split("_", 1)[0])
    datasets.discard("")
    fields.discard("")
    return {
        "datasets": sorted(datasets),
        "fields": sorted(fields),
        "root_causes": sorted(root_causes),
        "severities": sorted(severities),
    }


def _data_quality_impact(alert_ids: list[str] | None = None) -> dict[str, Any]:
    selected = {str(item).strip() for item in alert_ids or [] if str(item).strip()}
    alerts = [
        alert for alert in _load_all("alerts")
        if alert.get("status") == "open" and (not selected or str(alert.get("id") or "") in selected)
    ]
    context = _quality_context(alerts)
    datasets = set(context["datasets"])
    fields = set(context["fields"])

    impacted_metrics: list[dict[str, Any]] = []
    impacted_tags: list[dict[str, Any]] = []
    impacted_assets: list[dict[str, Any]] = []

    try:
        from sop_manager.routers import metrics_service
        metrics = metrics_service._load_all("catalog")
    except Exception:
        metrics = []
    for metric in metrics:
        source_assets = {_norm(item) for item in metric.get("source_assets") or []}
        formula_fields = {_norm(item) for item in (metric.get("formula_validation") or {}).get("fields") or []}
        dimensions = {_norm(item) for item in metric.get("dimensions") or []}
        matched_datasets = sorted(datasets & source_assets)
        matched_fields = sorted(fields & (formula_fields | dimensions))
        if matched_datasets or matched_fields:
            impacted_metrics.append({
                "id": metric.get("id", ""),
                "name": metric.get("name", ""),
                "domain": metric.get("domain", ""),
                "semantic_version": metric.get("semantic_version", "v0"),
                "api_endpoint": metric.get("api_endpoint") or "",
                "matched_datasets": matched_datasets,
                "matched_fields": matched_fields,
                "risk_level": "high" if metric.get("api_endpoint") else "medium",
            })

    try:
        from sop_manager.routers import tag_service
        tags = tag_service._load_all("tags")
        rules = tag_service._load_all("rules")
        contracts = tag_service._load_all("contracts")
    except Exception:
        tags, rules, contracts = [], [], []
    rules_by_tag: dict[str, list[dict[str, Any]]] = {}
    for rule in rules:
        rules_by_tag.setdefault(str(rule.get("tag_id") or ""), []).append(rule)
    contract_entities = {_norm(item.get("entity_type")) for item in contracts}
    for tag in tags:
        applies_to = {_norm(item) for item in tag.get("applies_to") or []}
        tag_rules = rules_by_tag.get(str(tag.get("id") or ""), [])
        rule_entities = {_norm(rule.get("entity_type")) for rule in tag_rules if rule.get("entity_type")}
        rule_fields = {
            _norm((rule.get("condition") if isinstance(rule.get("condition"), dict) else {}).get("field"))
            for rule in tag_rules
        }
        rule_fields.discard("")
        matched_entities = sorted(datasets & (applies_to | rule_entities | contract_entities))
        matched_fields = sorted(fields & rule_fields)
        if matched_entities or matched_fields:
            impacted_tags.append({
                "id": tag.get("id", ""),
                "name": tag.get("name", ""),
                "category": tag.get("category", ""),
                "owner": tag.get("owner", ""),
                "matched_entities": matched_entities,
                "matched_fields": matched_fields,
                "rules": len(tag_rules),
                "risk_level": "high" if matched_fields else "medium",
            })

    try:
        from sop_manager.routers import metadata_management
        assets, metadata_fields, _data = metadata_management._normalized_catalog()
    except Exception:
        assets, metadata_fields = [], []
    fields_by_asset: dict[str, list[dict[str, Any]]] = {}
    for field in metadata_fields:
        fields_by_asset.setdefault(str(field.get("asset_id") or ""), []).append(field)
    for asset in assets:
        asset_tokens = {_norm(asset.get("id")), _norm(asset.get("name")), _norm(asset.get("source"))}
        asset_fields = {_norm(field.get("name")) for field in fields_by_asset.get(str(asset.get("id") or ""), [])}
        matched_datasets = sorted(datasets & asset_tokens)
        matched_fields = sorted(fields & asset_fields)
        if matched_datasets or matched_fields:
            impacted_assets.append({
                "id": asset.get("id", ""),
                "name": asset.get("name", ""),
                "domain": asset.get("domain", ""),
                "owner": asset.get("owner", ""),
                "quality_score": asset.get("quality_score", 0),
                "lineage_count": asset.get("lineage_count", 0),
                "matched_datasets": matched_datasets,
                "matched_fields": matched_fields,
                "risk_level": "high" if not asset.get("owner") or matched_fields else "medium",
            })

    high_risk = sum(1 for item in [*impacted_metrics, *impacted_tags, *impacted_assets] if item.get("risk_level") == "high")
    impact_score = min(100, len(alerts) * 8 + len(impacted_metrics) * 15 + len(impacted_tags) * 12 + len(impacted_assets) * 10 + high_risk * 10)
    return {
        **_scope(),
        "alerts": alerts,
        "context": context,
        "summary": {
            "alerts": len(alerts),
            "datasets": len(context["datasets"]),
            "fields": len(context["fields"]),
            "impacted_metrics": len(impacted_metrics),
            "impacted_tags": len(impacted_tags),
            "impacted_assets": len(impacted_assets),
            "high_risk": high_risk,
            "impact_score": impact_score,
        },
        "impacted_metrics": impacted_metrics,
        "impacted_tags": impacted_tags,
        "impacted_assets": impacted_assets,
        "recommended_actions": [
            "暂停或复核受影响指标 API 的发布与审批",
            "重新执行受影响标签实体画像构建并复核契约",
            "补齐元数据 owner、字段质量规则和血缘影响说明",
        ] if alerts else [],
    }


def _quality_impact_task_items(body: QualityImpactTasksIn) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    impact = _data_quality_impact(body.alert_ids)
    items: list[dict[str, Any]] = []
    for metric in impact["impacted_metrics"]:
        items.append({
            "source": "data_quality_impact",
            "source_report_id": str(metric.get("id") or ""),
            "source_report_title": str(metric.get("name") or metric.get("id") or "metric"),
            "title": f"[数据质量] 复核受影响指标：{metric.get('name') or metric.get('id')}",
            "description": f"质量告警影响指标 {metric.get('name') or metric.get('id')}，匹配数据集 {', '.join(metric.get('matched_datasets') or []) or '-'}，字段 {', '.join(metric.get('matched_fields') or []) or '-'}。请复核口径、API 发布状态和下游消费者。",
            "priority": "P0" if metric.get("risk_level") == "high" else body.priority,
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "labels": ["data-quality", "metric-impact", str(metric.get("risk_level") or "medium")],
        })
    for tag in impact["impacted_tags"]:
        items.append({
            "source": "data_quality_impact",
            "source_report_id": str(tag.get("id") or ""),
            "source_report_title": str(tag.get("name") or tag.get("id") or "tag"),
            "title": f"[数据质量] 复核受影响标签：{tag.get('name') or tag.get('id')}",
            "description": f"质量告警影响标签 {tag.get('name') or tag.get('id')}，匹配实体 {', '.join(tag.get('matched_entities') or []) or '-'}，字段 {', '.join(tag.get('matched_fields') or []) or '-'}。请重新试算规则、复核画像覆盖率并确认标签契约。",
            "priority": "P0" if tag.get("risk_level") == "high" else body.priority,
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "labels": ["data-quality", "tag-impact", str(tag.get("risk_level") or "medium")],
        })
    for asset in impact["impacted_assets"]:
        items.append({
            "source": "data_quality_impact",
            "source_report_id": str(asset.get("id") or ""),
            "source_report_title": str(asset.get("name") or asset.get("id") or "asset"),
            "title": f"[数据质量] 修复受影响元数据资产：{asset.get('name') or asset.get('id')}",
            "description": f"质量告警影响元数据资产 {asset.get('name') or asset.get('id')}，匹配数据集 {', '.join(asset.get('matched_datasets') or []) or '-'}，字段 {', '.join(asset.get('matched_fields') or []) or '-'}。请补齐 owner、质量规则绑定与血缘影响说明。",
            "priority": "P0" if asset.get("risk_level") == "high" else body.priority,
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "labels": ["data-quality", "metadata-impact", str(asset.get("risk_level") or "medium")],
        })
    return impact, items


_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}


def _severity_rank(value: Any) -> int:
    return _SEVERITY_RANK.get(_norm(value) or "medium", 2)


def _subscription_matches(subscription: dict[str, Any], alerts: list[dict], impact: dict[str, Any], body: QualitySubscriptionRunIn) -> bool:
    if not body.force and not bool(subscription.get("enabled", True)):
        return False
    wanted_ids = {str(item).strip() for item in body.subscription_ids if str(item).strip()}
    wanted_channels = {str(item).strip() for item in body.channels if str(item).strip()}
    if wanted_ids and str(subscription.get("id") or "") not in wanted_ids:
        return False
    if wanted_channels and str(subscription.get("channel") or "") not in wanted_channels:
        return False
    severity_min = _severity_rank(subscription.get("severity_min") or "medium")
    matched_alerts = [alert for alert in alerts if _severity_rank(alert.get("severity")) >= severity_min]
    impact_score = int((impact.get("summary") or {}).get("impact_score") or 0)
    return bool(matched_alerts) or impact_score >= int(subscription.get("min_impact_score") or 0)


def _quality_subscription_briefing(subscription: dict[str, Any], alerts: list[dict], impact: dict[str, Any]) -> dict[str, Any]:
    severity_min = _severity_rank(subscription.get("severity_min") or "medium")
    matched_alerts = [alert for alert in alerts if _severity_rank(alert.get("severity")) >= severity_min]
    impact_summary = impact.get("summary") if isinstance(impact.get("summary"), dict) else {}
    roots: list[str] = []
    for alert in matched_alerts:
        attribution = alert.get("alert_attribution") if isinstance(alert.get("alert_attribution"), dict) else {}
        for root in attribution.get("root_causes") or alert.get("root_causes") or []:
            if str(root) not in roots:
                roots.append(str(root))
    title = f"数据质量告警：{len(matched_alerts)} 个开放告警，影响分 {impact_summary.get('impact_score', 0)}"
    lines = [
        f"订阅：{subscription.get('name') or subscription.get('id')}",
        f"开放告警：{len(matched_alerts)} / 全部 {len(alerts)}",
        f"影响指标：{impact_summary.get('impacted_metrics', 0)}，影响标签：{impact_summary.get('impacted_tags', 0)}，影响资产：{impact_summary.get('impacted_assets', 0)}",
    ]
    if roots:
        lines.append(f"根因：{', '.join(roots[:6])}")
    return {
        "title": title,
        "content": "\n".join(lines),
        "level": "error" if impact_summary.get("high_risk", 0) or any(_severity_rank(alert.get("severity")) >= 4 for alert in matched_alerts) else "warning",
        "summary": {
            "alerts": len(matched_alerts),
            "impact_score": impact_summary.get("impact_score", 0),
            "impacted_metrics": impact_summary.get("impacted_metrics", 0),
            "impacted_tags": impact_summary.get("impacted_tags", 0),
            "impacted_assets": impact_summary.get("impacted_assets", 0),
            "high_risk": impact_summary.get("high_risk", 0),
        },
        "risks": [
            {"level": alert.get("severity") or "medium", "title": alert.get("message") or "数据质量告警", "dataset": alert.get("dataset")}
            for alert in matched_alerts[:8]
        ],
        "recommendations": impact.get("recommended_actions") or ["复核开放质量告警并生成治理任务"],
        "actions": [
            {"label": "查看质量告警", "href": "#/data/quality/alerts"},
            {"label": "查看影响分析", "href": "#/data/quality/impact"},
        ],
    }


def _append_subscription_run(row: dict[str, Any]) -> dict[str, Any]:
    row.setdefault("id", f"dq-sub-run-{uuid4().hex[:12]}")
    row.setdefault("created_at", _now())
    _save("subscription_runs", row)
    return row


def _select_open_alerts(alert_ids: list[str] | None = None) -> list[dict[str, Any]]:
    selected = {str(item).strip() for item in alert_ids or [] if str(item).strip()}
    return [
        alert for alert in _load_all("alerts")
        if alert.get("status") == "open" and (not selected or str(alert.get("id") or "") in selected)
    ]


def _rca_template(root: str) -> dict[str, Any]:
    root_l = _norm(root)
    if "null_or_empty" in root_l:
        return {
            "category": "completeness",
            "title": "上游字段空值或缺填充",
            "confidence": 0.84,
            "risk_level": "high",
            "actions": ["补齐源端必填校验", "回补历史空值", "在接入层增加字段完整性卡点"],
        }
    if "out_of_range" in root_l:
        return {
            "category": "validity",
            "title": "字段取值越界或单位口径变化",
            "confidence": 0.82,
            "risk_level": "high",
            "actions": ["核对上游单位和枚举口径", "修复异常批次数据", "增加范围阈值和发布前抽样校验"],
        }
    if "regex_mismatch" in root_l:
        return {
            "category": "format",
            "title": "字段格式不符合契约",
            "confidence": 0.8,
            "risk_level": "medium",
            "actions": ["修正字段格式化逻辑", "同步数据契约样例", "增加格式规则回归测试"],
        }
    if "not_unique" in root_l:
        return {
            "category": "uniqueness",
            "title": "主键或业务键重复写入",
            "confidence": 0.83,
            "risk_level": "high",
            "actions": ["排查重复写入链路", "补齐幂等键和唯一约束", "清理重复记录并重算下游"],
        }
    if "stale" in root_l:
        return {
            "category": "freshness",
            "title": "数据刷新延迟或调度中断",
            "confidence": 0.81,
            "risk_level": "high",
            "actions": ["检查调度实例和上游依赖", "补跑失败分区", "设置刷新延迟告警订阅"],
        }
    return {
        "category": "consistency",
        "title": "规则异常需人工复核",
        "confidence": 0.68,
        "risk_level": "medium",
        "actions": ["复核质量规则配置", "补充异常样本", "建立针对性修复任务"],
    }


def _quality_rca(alert_ids: list[str] | None = None, *, persist: bool = True, include_impact: bool = True) -> dict[str, Any]:
    alerts = _select_open_alerts(alert_ids)
    context = _quality_context(alerts)
    runs_by_id = {str(run.get("id") or ""): run for run in _load_all("runs")}
    failed_rows = 0
    root_stats: dict[str, dict[str, Any]] = {}
    severity_weight = 0
    for alert in alerts:
        attribution = alert.get("alert_attribution") if isinstance(alert.get("alert_attribution"), dict) else {}
        run = runs_by_id.get(str(alert.get("run_id") or ""))
        row_count = int(attribution.get("failed_rows") or (run or {}).get("rows_failed") or 0)
        failed_rows += row_count
        severity_weight += max(0, _severity_rank(alert.get("severity")) - 1) * 6
        roots = attribution.get("root_causes") or alert.get("root_causes") or ["unknown_quality_failure"]
        dataset = str(alert.get("dataset") or attribution.get("dataset") or "unknown_dataset")
        field = str(attribution.get("field") or "")
        for root in roots:
            key = str(root or "unknown_quality_failure")
            bucket = root_stats.setdefault(key, {"root_cause": key, "alerts": 0, "failed_rows": 0, "datasets": set(), "fields": set(), "severities": set(), "samples": []})
            bucket["alerts"] += 1
            bucket["failed_rows"] += row_count
            bucket["datasets"].add(dataset)
            if field:
                bucket["fields"].add(field)
            bucket["severities"].add(str(alert.get("severity") or "medium"))
            samples = (run or {}).get("failed_samples") if isinstance((run or {}).get("failed_samples"), list) else []
            bucket["samples"].extend(samples[:2])

    impact = _data_quality_impact(alert_ids or []) if include_impact else {**_scope(), "summary": {}, "recommended_actions": []}
    impact_summary = impact.get("summary") if isinstance(impact.get("summary"), dict) else {}
    hypotheses: list[dict[str, Any]] = []
    for idx, bucket in enumerate(sorted(root_stats.values(), key=lambda item: (item["alerts"], item["failed_rows"]), reverse=True), start=1):
        template = _rca_template(str(bucket["root_cause"]))
        severity_top = max((_severity_rank(item) for item in bucket["severities"]), default=2)
        confidence = min(0.96, float(template["confidence"]) + min(0.08, bucket["alerts"] * 0.02))
        risk_level = "critical" if severity_top >= 4 and bucket["failed_rows"] >= 10 else template["risk_level"]
        hypotheses.append({
            "id": f"hyp-{idx}",
            "category": template["category"],
            "title": template["title"],
            "root_cause": bucket["root_cause"],
            "risk_level": risk_level,
            "confidence": round(confidence, 2),
            "alert_count": bucket["alerts"],
            "failed_rows": bucket["failed_rows"],
            "datasets": sorted(bucket["datasets"]),
            "fields": sorted(bucket["fields"]),
            "severities": sorted(bucket["severities"], key=_severity_rank, reverse=True),
            "evidence": [
                f"开放告警 {bucket['alerts']} 个",
                f"失败样本行 {bucket['failed_rows']} 行",
                f"影响数据集：{', '.join(sorted(bucket['datasets'])) or '-'}",
                f"影响字段：{', '.join(sorted(bucket['fields'])) or '-'}",
            ],
            "sample_rows": bucket["samples"][:5],
            "actions": template["actions"],
        })

    impact_score = int(impact_summary.get("impact_score") or 0)
    risk_score = min(100, len(alerts) * 10 + failed_rows * 2 + impact_score + severity_weight)
    confidence_avg = round(sum(item["confidence"] for item in hypotheses) / len(hypotheses), 2) if hypotheses else 0
    rca_id = f"dq-rca-{uuid4().hex[:12]}"
    report = {
        **_scope(),
        "id": rca_id,
        "created_at": _now(),
        "status": "ready" if alerts else "empty",
        "alert_ids": [str(alert.get("id") or "") for alert in alerts],
        "context": context,
        "summary": {
            "alerts": len(alerts),
            "datasets": len(context["datasets"]),
            "fields": len(context["fields"]),
            "root_causes": len(context["root_causes"]),
            "failed_rows": failed_rows,
            "impact_score": impact_score,
            "risk_score": risk_score,
            "confidence_avg": confidence_avg,
        },
        "hypotheses": hypotheses,
        "impact": impact,
        "recommendations": {
            "containment_actions": [
                "暂停受影响指标、标签或资产的自动发布",
                "通知数据 Owner 和下游消费方关注异常窗口",
                "按失败样本快速回补或隔离异常批次",
            ] if alerts else [],
            "permanent_fixes": [
                "把根因规则固化到接入、开发、发布三层质量卡点",
                "为高风险数据集补齐 owner、血缘、指标和标签影响关系",
                "将 RCA 结果转为治理任务并纳入任务依赖调度",
            ] if alerts else [],
            "validation_plan": [
                "重新执行命中规则并确认 rows_failed 归零",
                "复跑受影响指标和标签试算",
                "复核订阅通知和修复任务交付证据",
            ] if alerts else [],
        },
        "agent_consumption": {
            "module": "data-quality-rca",
            "route": "#/data/quality/rca",
            "apis": ["/api/v1/data-quality/rca", "/api/v1/data-quality/rca/tasks"],
            "suggested_commands": ["sop pages manifest --write", "sop task list --source data_quality_rca"],
            "next_action": "将高风险 RCA 假设生成治理任务并跟踪修复验证",
        },
    }
    if persist:
        _save("rca_reports", report)
    return report


def _quality_rca_task_items(body: QualityRcaTasksIn) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if body.rca_id:
        rca = _load_item("rca_reports", body.rca_id, "rca report")
    else:
        rca = _quality_rca(body.alert_ids, persist=False, include_impact=True)
    items: list[dict[str, Any]] = []
    for hypothesis in rca.get("hypotheses") or []:
        priority = "P0" if hypothesis.get("risk_level") in {"critical", "high"} else body.priority
        items.append({
            "source": "data_quality_rca",
            "source_report_id": str(rca.get("id") or ""),
            "source_report_title": str(hypothesis.get("title") or "数据质量 RCA"),
            "title": f"[数据质量 RCA] {hypothesis.get('title') or hypothesis.get('root_cause')}",
            "description": (
                f"根因假设：{hypothesis.get('root_cause')}；"
                f"置信度：{hypothesis.get('confidence')}；"
                f"数据集：{', '.join(hypothesis.get('datasets') or []) or '-'}；"
                f"字段：{', '.join(hypothesis.get('fields') or []) or '-'}；"
                f"建议动作：{'; '.join(hypothesis.get('actions') or [])}"
            ),
            "priority": priority,
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "labels": ["data-quality", "rca", str(hypothesis.get("category") or "quality"), str(hypothesis.get("risk_level") or "medium")],
        })
    return rca, items


def _item_datetime(item: dict[str, Any]) -> datetime | None:
    for key in ("finished_at", "started_at", "created_at", "updated_at"):
        parsed = _parse_time(item.get(key))
        if parsed:
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
    return None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _quality_forecast(*, window_days: int = 30, horizon_days: int = 7, persist: bool = True, include_rca: bool = True, include_impact: bool = True) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    start_at = now.timestamp() - window_days * 86400
    runs = []
    for run in _load_all("runs"):
        ts = _item_datetime(run)
        if ts is None or ts.timestamp() >= start_at:
            runs.append(run)
    alerts = []
    for alert in _load_all("alerts"):
        ts = _item_datetime(alert)
        if ts is None or ts.timestamp() >= start_at:
            alerts.append(alert)
    rca_reports = _load_all("rca_reports") if include_rca else []
    impact = _data_quality_impact([]) if include_impact else {**_scope(), "summary": {}}

    buckets: dict[str, dict[str, Any]] = {}
    for run in runs:
        ts = _item_datetime(run) or now
        day = ts.date().isoformat()
        bucket = buckets.setdefault(day, {"date": day, "runs": 0, "scores": [], "failed_rows": 0, "checked_rows": 0, "alerts": 0})
        bucket["runs"] += 1
        if run.get("score") is not None:
            bucket["scores"].append(float(run.get("score") or 0))
        bucket["failed_rows"] += int(run.get("rows_failed") or 0)
        bucket["checked_rows"] += int(run.get("rows_checked") or 0)
    for alert in alerts:
        ts = _item_datetime(alert) or now
        day = ts.date().isoformat()
        bucket = buckets.setdefault(day, {"date": day, "runs": 0, "scores": [], "failed_rows": 0, "checked_rows": 0, "alerts": 0})
        bucket["alerts"] += 1

    series = []
    for key in sorted(buckets):
        bucket = buckets[key]
        avg_score = round(sum(bucket["scores"]) / len(bucket["scores"]), 3) if bucket["scores"] else None
        failure_rate = round(bucket["failed_rows"] / bucket["checked_rows"], 3) if bucket["checked_rows"] else 0
        series.append({
            "date": key,
            "runs": bucket["runs"],
            "avg_score": avg_score,
            "failed_rows": bucket["failed_rows"],
            "checked_rows": bucket["checked_rows"],
            "failure_rate": failure_rate,
            "alerts": bucket["alerts"],
        })

    scored = [point for point in series if point["avg_score"] is not None]
    if scored:
        split = max(1, len(scored) // 2)
        early = scored[:split]
        late = scored[split:] or scored[-split:]
        early_avg = sum(float(point["avg_score"]) for point in early) / len(early)
        late_avg = sum(float(point["avg_score"]) for point in late) / len(late)
        slope = (late_avg - early_avg) / max(1, len(scored) - 1)
        current_score = float(scored[-1]["avg_score"])
    else:
        early_avg = late_avg = current_score = 1.0
        slope = 0.0

    avg_failed_rows = round(sum(point["failed_rows"] for point in series) / max(1, len(series)), 2) if series else 0
    open_alerts = [alert for alert in _load_all("alerts") if alert.get("status") == "open"]
    critical_alerts = [alert for alert in open_alerts if _severity_rank(alert.get("severity")) >= 4]
    impact_score = int((impact.get("summary") or {}).get("impact_score") or 0)
    last_rca_score = int(((rca_reports[0].get("summary") or {}).get("risk_score") if rca_reports else 0) or 0)
    predicted_score = round(_clamp(current_score + slope * horizon_days, 0, 1), 3)
    forecast_delta = round(predicted_score - current_score, 3)
    risk_score = min(
        100,
        int((1 - predicted_score) * 45)
        + max(0, int(-forecast_delta * 100))
        + len(open_alerts) * 5
        + len(critical_alerts) * 10
        + int(avg_failed_rows * 4)
        + int(impact_score * 0.25)
        + int(last_rca_score * 0.2),
    )
    trend_direction = "improving" if forecast_delta > 0.02 else "declining" if forecast_delta < -0.02 else "stable"

    risk_signals: list[dict[str, Any]] = []
    if trend_direction == "declining":
        risk_signals.append({
            "id": "quality-score-decline",
            "level": "high" if risk_score >= 70 else "medium",
            "title": "质量分存在下降趋势",
            "evidence": [f"当前质量分 {current_score:.3f}", f"{horizon_days} 天预测 {predicted_score:.3f}", f"预测变化 {forecast_delta:.3f}"],
            "recommended_actions": ["复核最近失败运行", "提高高风险规则执行频率", "将下降数据集纳入 RCA 和订阅通知"],
        })
    if avg_failed_rows >= 1:
        risk_signals.append({
            "id": "failed-row-pressure",
            "level": "medium" if avg_failed_rows < 5 else "high",
            "title": "失败行数持续存在",
            "evidence": [f"窗口内日均失败行 {avg_failed_rows}", f"运行记录 {len(runs)} 条"],
            "recommended_actions": ["定位失败字段", "回补异常样本", "对重复根因生成治理任务"],
        })
    if open_alerts:
        risk_signals.append({
            "id": "open-alert-backlog",
            "level": "critical" if critical_alerts else "high",
            "title": "开放质量告警待处置",
            "evidence": [f"开放告警 {len(open_alerts)} 个", f"Critical 告警 {len(critical_alerts)} 个"],
            "recommended_actions": ["优先处置 critical/high 告警", "运行 RCA 形成修复计划", "触发质量订阅通知"],
        })
    if impact_score >= 50:
        risk_signals.append({
            "id": "downstream-impact-risk",
            "level": "high",
            "title": "下游指标/标签/资产影响较高",
            "evidence": [f"影响分 {impact_score}", f"高风险对象 {(impact.get('summary') or {}).get('high_risk', 0)} 个"],
            "recommended_actions": ["冻结受影响对象发布", "通知下游消费者", "创建影响修复任务"],
        })
    if not risk_signals and series:
        risk_signals.append({
            "id": "quality-stable-watch",
            "level": "low",
            "title": "质量趋势整体稳定",
            "evidence": [f"当前质量分 {current_score:.3f}", f"{horizon_days} 天预测 {predicted_score:.3f}"],
            "recommended_actions": ["保持现有规则执行频率", "持续观察异常样本和告警积压"],
        })

    forecast_id = f"dq-forecast-{uuid4().hex[:12]}"
    report = {
        **_scope(),
        "id": forecast_id,
        "created_at": _now(),
        "status": "ready" if series or open_alerts else "empty",
        "window_days": window_days,
        "horizon_days": horizon_days,
        "summary": {
            "runs": len(runs),
            "alerts": len(alerts),
            "open_alerts": len(open_alerts),
            "critical_alerts": len(critical_alerts),
            "current_score": round(current_score, 3),
            "predicted_score": predicted_score,
            "forecast_delta": forecast_delta,
            "trend_direction": trend_direction,
            "risk_score": risk_score,
            "avg_failed_rows": avg_failed_rows,
            "impact_score": impact_score,
            "last_rca_risk_score": last_rca_score,
        },
        "series": series[-window_days:],
        "risk_signals": risk_signals,
        "recommendations": [
            "将高风险预测信号生成治理任务并纳入任务依赖调度",
            "对下降趋势数据集运行 RCA 并触发质量订阅",
            "把高频根因固化为接入、开发、发布三层质量卡点",
        ] if risk_signals else [],
        "agent_consumption": {
            "module": "data-quality-forecast",
            "route": "#/data/quality/forecast",
            "apis": ["/api/v1/data-quality/forecast", "/api/v1/data-quality/forecast/tasks"],
            "suggested_commands": ["sop pages manifest --write", "sop task list --source data_quality_forecast"],
            "next_action": "按风险信号生成治理任务并复核质量趋势",
        },
    }
    if persist:
        _save("forecast_reports", report)
    return report


def _quality_forecast_task_items(body: QualityForecastTasksIn) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if body.forecast_id:
        forecast = _load_item("forecast_reports", body.forecast_id, "forecast report")
    else:
        forecast = _quality_forecast(window_days=body.window_days, horizon_days=body.horizon_days, persist=False)
    items: list[dict[str, Any]] = []
    for signal in forecast.get("risk_signals") or []:
        level = str(signal.get("level") or "medium")
        priority = "P0" if level in {"critical", "high"} else body.priority
        items.append({
            "source": "data_quality_forecast",
            "source_report_id": str(forecast.get("id") or ""),
            "source_report_title": str(signal.get("title") or "数据质量趋势预测"),
            "title": f"[数据质量预测] {signal.get('title')}",
            "description": (
                f"质量趋势预测风险：{signal.get('title')}；"
                f"证据：{'; '.join(signal.get('evidence') or [])}；"
                f"建议动作：{'; '.join(signal.get('recommended_actions') or [])}"
            ),
            "priority": priority,
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "labels": ["data-quality", "forecast", level, str(signal.get("id") or "signal")],
        })
    return forecast, items

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
    item = _load_item("rules", rule_id, "rule")
    item.update({k: v for k, v in body.model_dump().items() if v is not None})
    item["updated_at"] = _now()
    _save("rules", item)
    return item

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str):
    _load_item("rules", rule_id, "rule")
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
    rule = _load_item("rules", body.rule_id, "rule")
    item = {**_scope(), "id": str(uuid4()), "rule_id": body.rule_id, "dataset": body.dataset,
            "status": "running", "score": None, "rows_checked": 0, "rows_failed": 0,
            "sample_rows": body.sample_rows[:50], "failed_samples": [], "alert_attribution": {},
            "started_at": _now(), "finished_at": None}
    if body.execute_now:
        result = _evaluate_rule(rule, body.sample_rows, body.dataset)
        item.update({**result.model_dump(), "finished_at": _now()})
    _save("runs", item)
    if body.execute_now:
        _save_alert_for_run(item, rule)
    return item

@router.post("/runs/{run_id}/finish")
def finish_run(run_id: str):
    item = _load_item("runs", run_id, "run")
    rule = _load_item("rules", item.get("rule_id", ""), "rule")
    rows = item.get("sample_rows") if isinstance(item.get("sample_rows"), list) else []
    result = _evaluate_rule(rule, rows, item.get("dataset", ""))
    return write_result(run_id, result)

@router.put("/runs/{run_id}/result")
def write_result(run_id: str, body: RunResult):
    item = _load_item("runs", run_id, "run")
    item.update({**body.model_dump(), "finished_at": _now()})
    _save("runs", item)
    if body.status in {"failed", "warning"} and body.rows_failed > 0:
        rule = _load_item("rules", item.get("rule_id", ""), "rule")
        _save_alert_for_run(item, rule)
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
    item = _load_item("alerts", alert_id, "alert")
    item.update({"status": "resolved", "resolved_at": _now()})
    _save("alerts", item)
    return item

@router.post("/alerts/tasks")
def alert_tasks(body: AlertTasksIn):
    selected = set(body.ids)
    alerts = [a for a in _load_all("alerts") if a.get("status") == "open" and (not selected or a.get("id") in selected)]
    items = []
    for alert in alerts:
        attribution = alert.get("alert_attribution") if isinstance(alert.get("alert_attribution"), dict) else {}
        root_causes = attribution.get("root_causes") if isinstance(attribution.get("root_causes"), list) else []
        dataset = alert.get("dataset") or attribution.get("dataset") or "unknown_dataset"
        severity = str(alert.get("severity") or "medium").lower()
        priority = "P0" if severity == "critical" else body.priority
        description = (
            f"数据集 {dataset} 的质量规则 {alert.get('rule_id', '')} 发现异常；"
            f"根因：{', '.join(root_causes) or '待分析'}；"
            f"失败行数：{attribution.get('failed_rows', alert.get('rows_failed', 0))}。"
        )
        items.append({
            "source": "data_quality_runtime_alert",
            "source_report_id": alert.get("id", ""),
            "source_report_title": alert.get("message", "数据质量告警"),
            "title": f"[数据质量] {alert.get('message', '质量告警处置')}",
            "description": description,
            "priority": priority,
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "labels": ["data-quality", dataset, *root_causes[:3]],
        })
    return {**_scope(), "dry_run": body.dry_run, "items": items, "created": [] if body.dry_run else items}


@router.get("/impact")
def quality_impact(alert_ids: str = ""):
    ids = [item.strip() for item in str(alert_ids or "").split(",") if item.strip()]
    return _data_quality_impact(ids)


@router.post("/impact/tasks")
def quality_impact_tasks(body: QualityImpactTasksIn):
    impact, items = _quality_impact_task_items(body)
    if body.dry_run:
        return {**_scope(), "dry_run": True, "impact": impact, "items": items, "created": [], "planned": len(items)}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = [create_task(TaskCreate(**item)) for item in items]
    return {**_scope(), "dry_run": False, "impact": impact, "items": items, "created": created, "planned": len(items), "created_count": len(created)}


@router.get("/subscriptions")
def quality_subscriptions():
    items = _load_all("subscriptions")
    return {**_scope(), "items": items, "total": len(items)}


@router.post("/subscriptions")
def upsert_quality_subscription(body: QualitySubscriptionIn):
    rows = _load_all("subscriptions")
    existing = next((item for item in rows if item.get("channel") == body.channel), None)
    item = {
        **(existing or {}),
        **_scope(),
        **body.model_dump(),
        "id": (existing or {}).get("id") or f"dq-sub-{uuid4().hex[:12]}",
        "created_at": (existing or {}).get("created_at") or _now(),
        "updated_at": _now(),
    }
    _save("subscriptions", item)
    return {**_scope(), "ok": True, "item": item}


@router.patch("/subscriptions/{subscription_id}")
def update_quality_subscription(subscription_id: str, body: QualitySubscriptionPatch):
    item = _load_item("subscriptions", subscription_id, "subscription")
    patch = body.model_dump(exclude_none=True)
    item.update(patch)
    item["updated_at"] = _now()
    _save("subscriptions", item)
    return {**_scope(), "ok": True, "item": item}


@router.delete("/subscriptions/{subscription_id}")
def delete_quality_subscription(subscription_id: str):
    _load_item("subscriptions", subscription_id, "subscription")
    p = _dir("subscriptions") / f"{subscription_id}.json"
    if p.exists():
        p.unlink()
    return {**_scope(), "ok": True, "deleted": subscription_id}


@router.get("/subscriptions/runs")
def quality_subscription_runs(limit: int = 50):
    items = _load_all("subscription_runs")[: max(1, min(limit, 200))]
    return {**_scope(), "items": items, "total": len(items)}


@router.post("/subscriptions/run")
def run_quality_subscriptions(body: QualitySubscriptionRunIn):
    subscriptions = _load_all("subscriptions")
    alerts = [alert for alert in _load_all("alerts") if alert.get("status") == "open"]
    impact = _data_quality_impact([])
    selected = [item for item in subscriptions if _subscription_matches(item, alerts, impact, body)]
    delivery_plans: list[dict[str, Any]] = []
    sent: list[dict[str, Any]] = []
    for item in selected:
        briefing = _quality_subscription_briefing(item, alerts, impact)
        plan = {
            "subscription_id": item.get("id"),
            "channel": item.get("channel"),
            "ready": bool(item.get("channel")) and (body.force or bool(item.get("enabled", True))),
            "message": {
                "channel": item.get("channel"),
                "title": briefing["title"],
                "content": briefing["content"],
                "level": briefing["level"],
            },
            "briefing": briefing,
        }
        delivery_plans.append(plan)
        if not body.dry_run and plan["ready"]:
            try:
                from sop_manager.routers.notify import NotifyMsg, send_msg

                msg = plan["message"]
                sent.append(send_msg(NotifyMsg(channel=str(msg["channel"]), title=str(msg["title"]), content=str(msg["content"]), level=str(msg["level"]))))
            except Exception as exc:
                sent.append({"ok": False, "channel": item.get("channel"), "error": str(exc)})
    run = _append_subscription_run({
        **_scope(),
        "event": "data_quality_subscription_run",
        "status": "dry_run" if body.dry_run else "sent",
        "dry_run": body.dry_run,
        "force": body.force,
        "filters": {
            "subscription_ids": [str(item).strip() for item in body.subscription_ids if str(item).strip()],
            "channels": [str(item).strip() for item in body.channels if str(item).strip()],
        },
        "note": body.note,
        "selected_count": len(selected),
        "messages_planned": len(delivery_plans),
        "sent_count": len(sent),
        "impact_summary": impact.get("summary") or {},
        "delivery_plans": delivery_plans,
        "sent": sent,
        "ok": bool(selected),
    })
    return {**_scope(), "ok": bool(selected), "dry_run": body.dry_run, "selected": selected, "delivery_plans": delivery_plans, "sent": sent, "run": run}


@router.get("/rca")
def quality_rca(alert_ids: str = ""):
    ids = [item.strip() for item in str(alert_ids or "").split(",") if item.strip()]
    return _quality_rca(ids, persist=False, include_impact=True)


@router.post("/rca")
def create_quality_rca(body: QualityRcaIn):
    return _quality_rca(body.alert_ids, persist=body.persist, include_impact=body.include_impact)


@router.get("/rca/history")
def quality_rca_history(limit: int = 50):
    safe_limit = max(1, min(int(limit or 50), 200))
    items = _load_all("rca_reports")[:safe_limit]
    return {**_scope(), "items": items, "total": len(items)}


@router.post("/rca/tasks")
def quality_rca_tasks(body: QualityRcaTasksIn):
    rca, items = _quality_rca_task_items(body)
    if body.dry_run:
        return {**_scope(), "dry_run": True, "rca": rca, "items": items, "created": [], "planned": len(items)}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = [create_task(TaskCreate(**item)) for item in items]
    return {**_scope(), "dry_run": False, "rca": rca, "items": items, "created": created, "planned": len(items), "created_count": len(created)}


@router.get("/forecast")
def quality_forecast(window_days: int = 30, horizon_days: int = 7):
    return _quality_forecast(window_days=max(3, min(int(window_days or 30), 180)), horizon_days=max(1, min(int(horizon_days or 7), 60)), persist=False)


@router.post("/forecast")
def create_quality_forecast(body: QualityForecastIn):
    return _quality_forecast(window_days=body.window_days, horizon_days=body.horizon_days, persist=body.persist, include_rca=body.include_rca, include_impact=body.include_impact)


@router.get("/forecast/history")
def quality_forecast_history(limit: int = 50):
    safe_limit = max(1, min(int(limit or 50), 200))
    items = _load_all("forecast_reports")[:safe_limit]
    return {**_scope(), "items": items, "total": len(items)}


@router.post("/forecast/tasks")
def quality_forecast_tasks(body: QualityForecastTasksIn):
    forecast, items = _quality_forecast_task_items(body)
    if body.dry_run:
        return {**_scope(), "dry_run": True, "forecast": forecast, "items": items, "created": [], "planned": len(items)}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = [create_task(TaskCreate(**item)) for item in items]
    return {**_scope(), "dry_run": False, "forecast": forecast, "items": items, "created": created, "planned": len(items), "created_count": len(created)}


@router.get("/summary")
def summary():
    rules = _load_all("rules")
    runs = _load_all("runs")
    alerts = _load_all("alerts")
    subscriptions = _load_all("subscriptions")
    subscription_runs = _load_all("subscription_runs")
    rca_reports = _load_all("rca_reports")
    forecast_reports = _load_all("forecast_reports")
    scores = [r["score"] for r in runs if r.get("score") is not None]
    impact = _data_quality_impact([])
    impact_summary = impact.get("summary") or {}
    return {**_scope(), "summary": {
        "rules_total": len(rules), "runs_today": len(runs),
        "alerts_open": sum(1 for a in alerts if a.get("status") == "open"),
        "avg_score": round(sum(scores) / len(scores), 3) if scores else 1.0,
        "last_run_status": runs[0].get("status", "") if runs else "",
        "impact_score": impact_summary.get("impact_score", 0),
        "impacted_metrics": impact_summary.get("impacted_metrics", 0),
        "impacted_tags": impact_summary.get("impacted_tags", 0),
        "impacted_assets": impact_summary.get("impacted_assets", 0),
        "subscriptions": len(subscriptions),
        "enabled_subscriptions": sum(1 for item in subscriptions if item.get("enabled", True)),
        "subscription_runs": len(subscription_runs),
        "last_subscription_status": subscription_runs[0].get("status", "") if subscription_runs else "",
        "rca_reports": len(rca_reports),
        "last_rca_risk_score": ((rca_reports[0].get("summary") or {}).get("risk_score", 0) if rca_reports else 0),
        "forecast_reports": len(forecast_reports),
        "last_forecast_risk_score": ((forecast_reports[0].get("summary") or {}).get("risk_score", 0) if forecast_reports else 0),
        "last_forecast_score": ((forecast_reports[0].get("summary") or {}).get("predicted_score", 0) if forecast_reports else 0)}}
