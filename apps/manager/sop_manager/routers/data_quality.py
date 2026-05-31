"""数据质量规则引擎：规则目录、质量运行、告警处置。"""
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

class AlertTasksIn(BaseModel):
    ids: list[str] = Field(default_factory=list)
    dry_run: bool = True
    priority: str = "P1"
    assigned_to: str = "Data Governance Agent"
    dev_tool: str = "codex"

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
            "assigned_to": body.assigned_to,
            "dev_tool": body.dev_tool,
            "labels": ["data-quality", dataset, *root_causes[:3]],
        })
    return {**_scope(), "dry_run": body.dry_run, "items": items, "created": [] if body.dry_run else items}

@router.get("/summary")
def summary():
    rules = _load_all("rules")
    runs = _load_all("runs")
    alerts = _load_all("alerts")
    scores = [r["score"] for r in runs if r.get("score") is not None]
    return {**_scope(), "summary": {
        "rules_total": len(rules), "runs_today": len(runs),
        "alerts_open": sum(1 for a in alerts if a.get("status") == "open"),
        "avg_score": round(sum(scores) / len(scores), 3) if scores else 1.0,
        "last_run_status": runs[0].get("status", "") if runs else ""}}
