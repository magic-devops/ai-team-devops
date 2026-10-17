"""智能运维中心：部署流水线、根因分析、Runbook、自愈策略。"""
from __future__ import annotations
import hashlib
from sop_manager.task_owner import TaskOwnerId, TaskOwnerInput

from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.im_integration_core import build_im_briefing, build_im_delivery_plan
from sop_manager.routers.ops_center_core import (
    apply_self_heal_guarded_action,
    approve_self_heal_guarded_action,
    build_self_heal_guarded_actions,
    build_self_heal_tasks,
    build_alert_slo_escalation,
    build_alert_strategy_canary_audit,
    build_ops_strategy_linkage,
    compare_alert_strategy_variants,
    build_ops_rca_insight_tasks,
    build_ops_rca_insights,
    build_ops_rca_verification_plan,
    build_runbook_execution_evidence,
    diff_runbook_versions,
    evaluate_alert_noise,
    evaluate_self_heal,
    normalize_alerts_from_source,
    recommend_alert_noise_strategy,
    rollback_self_heal_guarded_action,
    summarize_alert_sources,
    summarize_alert_noise_evaluations,
    summarize_alert_slo_predictions,
    summarize_alert_slo_escalations,
    summarize_alert_strategy_canary_audits,
    summarize_alert_strategy_comparisons,
    summarize_alert_strategy_recommendations,
    summarize_ops_strategy_linkages,
    summarize_ops_health,
    summarize_runbook_execution_evidence,
    summarize_runbook_versions,
    predict_alert_source_slo,
    verify_ops_rca_item,
    verify_self_heal_guarded_action,
)
from sop_manager.routers.scope_guard import attach_scope, scope_matches

from sop_manager.project_write_guard import project_file_write_scope

router = APIRouter(prefix="/api/v1/ops-center", tags=["ops-center"])

def _dir(sub: str):
    d = resolved_ai_memory_root() / "ops_center" / sub
    return d

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _scope() -> dict:
    return {"tenant_code": resolved_tenant_code(), "business_code": resolved_business_code(), "project_id": resolved_project_id()}

def _ops_strategy_task_source_report_id(task: dict, index: int) -> str:
    explicit = str(task.get("source_report_id") or "").strip()
    if explicit:
        return explicit[:160]
    raw = "|".join(
        [
            str(task.get("source") or "ops_center_strategy_linkage"),
            str(task.get("title") or ""),
            str(task.get("source_report_title") or ""),
            str(task.get("debug_notes") or ""),
            str(index),
        ]
    )
    return "ops-linkage-task-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]

def _existing_ops_strategy_task_report_ids() -> set[str]:
    try:
        from sop_manager.routers.tasks import list_tasks
        items = list_tasks(source="ops_center_strategy_linkage")
    except Exception:
        return set()
    return {
        str(item.get("source_report_id") or "").strip()
        for item in items
        if str(item.get("source_report_id") or "").strip()
    }

def _load_all(sub: str) -> list[dict]:
    import json
    items = []
    for f in _dir(sub).glob("*.json"):
        try:
            item = json.loads(f.read_text())
        except Exception:
            continue
        if isinstance(item, dict) and scope_matches(item):
            items.append(item)
    return sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)

def _save(sub: str, item: dict):
    with project_file_write_scope():
        _dir(sub).mkdir(parents=True, exist_ok=True)
        import json
        attach_scope(item)
        (_dir(sub) / f"{item['id']}.json").write_text(json.dumps(item, ensure_ascii=False, indent=2))

def _load_scoped_item(sub: str, item_id: str, missing: str) -> dict:
    import json
    p = _dir(sub) / f"{item_id}.json"
    if not p.exists():
        raise HTTPException(404, missing)
    try:
        item = json.loads(p.read_text())
    except Exception as exc:
        raise HTTPException(404, missing) from exc
    if not isinstance(item, dict) or not scope_matches(item):
        raise HTTPException(404, missing)
    return item

def _runbook_snapshot(item: dict) -> dict:
    return {
        "name": str(item.get("name") or ""),
        "steps": [str(step) for step in item.get("steps") or []],
        "tags": [str(tag) for tag in item.get("tags") or []],
        "owner": str(item.get("owner") or "Ops Lead"),
    }

def _runbook_versions(runbook_id: str) -> list[dict]:
    items = [item for item in _load_all("runbook_versions") if item.get("runbook_id") == runbook_id]
    return sorted(items, key=lambda x: int(x.get("version_no") or 0), reverse=True)

def _version_checksum(snapshot: dict) -> str:
    import hashlib
    import json
    raw = json.dumps(snapshot, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()

def _write_runbook_event(runbook_id: str, event_type: str, actor: str, note: str, payload: dict | None = None) -> dict:
    item = {
        **_scope(),
        "id": str(uuid4()),
        "runbook_id": runbook_id,
        "event_type": event_type,
        "actor": actor,
        "note": note,
        "payload": payload or {},
        "created_at": _now(),
    }
    _save("runbook_events", item)
    return item

def _create_runbook_version(runbook: dict, actor: str, note: str, status: str = "active") -> dict:
    versions = _runbook_versions(runbook["id"])
    version_no = max([int(item.get("version_no") or 0) for item in versions] or [0]) + 1
    snapshot = _runbook_snapshot(runbook)
    for version in versions:
        if version.get("status") == "active":
            version["status"] = "superseded"
            version["superseded_at"] = _now()
            _save("runbook_versions", version)
    item = {
        **_scope(),
        "id": str(uuid4()),
        "runbook_id": runbook["id"],
        "version_no": version_no,
        "status": status,
        "snapshot": snapshot,
        "checksum": _version_checksum(snapshot),
        "created_by": actor,
        "change_note": note,
        "created_at": _now(),
    }
    _save("runbook_versions", item)
    runbook["active_version_id"] = item["id"]
    runbook["active_version_no"] = version_no
    runbook["version_count"] = version_no
    runbook["checksum"] = item["checksum"]
    return item

def _promote_runbook_version(runbook: dict, version: dict, actor: str, note: str) -> dict:
    snapshot = version.get("snapshot", {}) if isinstance(version.get("snapshot"), dict) else {}
    for current in _runbook_versions(runbook["id"]):
        if current["id"] == version["id"]:
            current["status"] = "active"
            current["promoted_at"] = _now()
            current["promoted_by"] = actor
        elif current.get("status") == "active":
            current["status"] = "superseded"
            current["superseded_at"] = _now()
        _save("runbook_versions", current)
    runbook.update({
        "name": snapshot.get("name", runbook.get("name", "")),
        "steps": snapshot.get("steps", runbook.get("steps", [])),
        "tags": snapshot.get("tags", runbook.get("tags", [])),
        "owner": snapshot.get("owner", runbook.get("owner", "Ops Lead")),
        "active_version_id": version["id"],
        "active_version_no": version.get("version_no", runbook.get("active_version_no", 1)),
        "checksum": version.get("checksum", _version_checksum(snapshot)),
        "updated_at": _now(),
        "updated_by": actor,
    })
    _save("runbooks", runbook)
    _write_runbook_event(runbook["id"], "version_promoted", actor, note, {"version_id": version["id"], "version_no": version.get("version_no")})
    return runbook

class PipelineCreate(BaseModel):
    name: str
    environment: str = "staging"
    steps: list[str] = Field(default_factory=list)

class RcaCreate(BaseModel):
    incident_id: str
    root_cause: str
    impact: str = ""
    resolution: str = ""

class RcaInsightIn(BaseModel):
    run_id: str = ""
    trace_id: str = ""
    correlation_id: str = ""
    limit: int = Field(100, ge=1, le=500)

class RcaInsightTasksIn(RcaInsightIn, TaskOwnerInput):
    dry_run: bool = True
    priority: str = "P1"
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"

class RcaInsightCreateRcaIn(RcaInsightIn):
    candidate_id: str = ""
    owner: str = "Ops Lead"
    status: str = Field("open", pattern="^(open|resolved)$")
    selected_runbook_ids: list[str] = Field(default_factory=list)
    note: str = ""

class RcaVerifyIn(BaseModel):
    verifier: str = "SRE"
    checks: dict = Field(default_factory=dict)
    close_on_pass: bool = True
    note: str = ""

class AlertSourceCreate(BaseModel):
    name: str
    source_type: str = Field("generic_json", pattern="^(generic_json|prometheus|grafana|datadog|webhook|manual)$")
    endpoint: str = ""
    enabled: bool = True
    auth_ref: str = ""
    query: str = ""
    labels: dict = Field(default_factory=dict)
    headers: dict = Field(default_factory=dict)
    sample_payload: object = Field(default_factory=dict)
    timeout_s: int = Field(5, ge=1, le=30)

class AlertSourceTestIn(BaseModel):
    sample_payload: object = Field(default_factory=dict)
    use_endpoint: bool = False
    endpoint_override: str = ""

class AlertSourceSyncIn(BaseModel):
    source_ids: list[str] = Field(default_factory=list)
    persist: bool = True
    limit: int = Field(100, ge=1, le=500)

class AlertSourceToggleIn(BaseModel):
    enabled: bool

class AlertNoisePolicyCreate(BaseModel):
    name: str
    enabled: bool = True
    group_by: list[str] = Field(default_factory=lambda: ["service", "alertname", "source_id"])
    min_rca_severity: str = Field("high", pattern="^(critical|high|medium|low|info)$")
    suppress_severities: list[str] = Field(default_factory=lambda: ["info"])
    labels: dict = Field(default_factory=dict)
    note: str = ""

class AlertNoiseEvaluateIn(BaseModel):
    policy_id: str = ""
    persist: bool = True
    limit: int = Field(100, ge=1, le=500)

class AlertSilenceCreate(BaseModel):
    name: str
    matchers: dict = Field(default_factory=dict)
    starts_at: str = ""
    ends_at: str = ""
    reason: str = ""
    enabled: bool = True
    owner: str = "Ops Lead"

class AlertNoiseToggleIn(BaseModel):
    enabled: bool

class AlertStrategyRecommendIn(BaseModel):
    persist: bool = True
    limit: int = Field(20, ge=1, le=100)

class AlertStrategyRecommendationActionIn(BaseModel):
    action: str = Field(..., pattern="^(apply|dismiss|reopen)$")
    actor: str = "Ops Lead"
    note: str = ""

class AlertStrategyVariantIn(BaseModel):
    id: str = ""
    name: str = "候选告警策略"
    enabled: bool = True
    group_by: list[str] = Field(default_factory=lambda: ["service", "alertname", "source_id"])
    min_rca_severity: str = Field("high", pattern="^(critical|high|medium|low|info)$")
    suppress_severities: list[str] = Field(default_factory=lambda: ["info", "low"])
    labels: dict = Field(default_factory=dict)
    note: str = ""

class AlertStrategyCompareIn(BaseModel):
    variants: list[AlertStrategyVariantIn] = Field(default_factory=list)
    baseline_policy_id: str = ""
    persist: bool = True
    limit: int = Field(100, ge=1, le=500)

class AlertSloPredictIn(BaseModel):
    window_hours: int = Field(24, ge=1, le=168)
    persist: bool = True
    limit: int = Field(500, ge=1, le=1000)

class AlertSloEscalationPolicyIn(BaseModel):
    enabled: bool = True
    min_risk_level: str = Field("high", pattern="^(critical|high|watch|healthy)$")
    min_breach_probability: float = Field(0.35, ge=0, le=1)
    max_targets: int = Field(5, ge=1, le=50)
    cooldown_minutes: int = Field(60, ge=0, le=10080)
    actions: list[str] = Field(default_factory=lambda: ["create_task", "im_notify"])
    channels: list[str] = Field(default_factory=list)
    owner: str = "Ops Lead"
    note: str = ""

class AlertSloEscalationRunIn(TaskOwnerInput):
    dry_run: bool = True
    priority: str = "P1"
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"
    channels: list[str] = Field(default_factory=list)
    window_hours: int = Field(24, ge=1, le=168)
    force: bool = False
    note: str = ""

class AlertStrategyCanaryAuditIn(BaseModel):
    policy_id: str = ""
    candidate_id: str = ""
    traffic_percent: int = Field(10, ge=1, le=50)
    refresh_inputs: bool = True
    persist: bool = True
    created_by: str = "Ops Lead"
    note: str = ""

class AlertStrategyCanaryActionIn(BaseModel):
    action: str = Field(..., pattern="^(approve|reject|start|rollback|archive|reopen)$")
    actor: str = "Ops Lead"
    note: str = ""

class OpsStrategyLinkageRunIn(TaskOwnerInput):
    dry_run: bool = True
    actions: list[str] = Field(default_factory=lambda: ["create_task", "im_notify"])
    max_items: int = Field(8, ge=1, le=50)
    priority: str = "P1"
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"
    channels: list[str] = Field(default_factory=list)
    note: str = ""

class RunbookCreate(BaseModel):
    name: str
    steps: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    owner: str = "Ops Lead"
    change_note: str = ""

class RunbookVersionActionIn(BaseModel):
    action: str = Field(..., pattern="^(promote|archive|restore)$")
    actor: str = "Ops Lead"
    note: str = ""

class RunbookEvidenceBackfillIn(BaseModel):
    runbook_ids: list[str] = Field(default_factory=list)
    rca_ids: list[str] = Field(default_factory=list)
    include_resolved: bool = True
    persist: bool = True
    actor: str = "Ops Agent"
    note: str = ""
    limit: int = Field(100, ge=1, le=500)

class RunbookEvidenceActionIn(BaseModel):
    action: str = Field(..., pattern="^(acknowledge|archive|reopen)$")
    actor: str = "Ops Lead"
    note: str = ""

class SelfHealCreate(BaseModel):
    trigger_condition: str
    action: str
    enabled: bool = True

class SelfHealEvaluateIn(BaseModel):
    signals: dict = Field(default_factory=dict)
    persist: bool = True

class SelfHealTasksIn(TaskOwnerInput):
    signals: dict = Field(default_factory=dict)
    dry_run: bool = True
    priority: str = "P1"
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"

class ImBriefingIn(BaseModel):
    channels: list[str] = Field(default_factory=list)
    dry_run: bool = True

class SelfHealApproveIn(BaseModel):
    approver: str = "Ops Lead"
    note: str = ""

class SelfHealApplyIn(BaseModel):
    operator: str = "Ops Agent"
    result: dict = Field(default_factory=dict)

class SelfHealVerifyIn(BaseModel):
    verifier: str = "SRE"
    verification: dict = Field(default_factory=dict)

class SelfHealRollbackIn(BaseModel):
    operator: str = "Ops Lead"
    evidence: dict = Field(default_factory=dict)

class PipelineStatus(BaseModel):
    status: str
    duration_s: int | None = None
    error_msg: str = ""

@router.get("/pipelines")
def list_pipelines():
    return {**_scope(), "items": _load_all("pipelines"), "total": len(_load_all("pipelines"))}

@router.post("/pipelines")
def create_pipeline(body: PipelineCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(),
            "status": "idle", "last_triggered_at": None, "duration_s": None, "created_at": _now()}
    _save("pipelines", item)
    return item

@router.put("/pipelines/{pipeline_id}/trigger")
def trigger_pipeline(pipeline_id: str):
    item = _load_scoped_item("pipelines", pipeline_id, "pipeline not found")
    item.update({"status": "running", "last_triggered_at": _now()})
    _save("pipelines", item)
    return item

@router.put("/pipelines/{pipeline_id}/status")
def update_pipeline_status(pipeline_id: str, body: PipelineStatus):
    item = _load_scoped_item("pipelines", pipeline_id, "pipeline not found")
    item.update({"status": body.status, "duration_s": body.duration_s, "error_msg": body.error_msg, "updated_at": _now()})
    _save("pipelines", item)
    return item

@router.delete("/pipelines/{pipeline_id}")
def delete_pipeline(pipeline_id: str):
    _load_scoped_item("pipelines", pipeline_id, "pipeline not found")
    p = _dir("pipelines") / f"{pipeline_id}.json"
    with project_file_write_scope():
        p.unlink()
    return {**_scope(), "deleted": pipeline_id}

@router.get("/rca")
def list_rca():
    return {**_scope(), "items": _load_all("rca"), "total": len(_load_all("rca"))}

@router.post("/rca")
def create_rca(body: RcaCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "status": "open", "created_at": _now()}
    _save("rca", item)
    return item

_SENSITIVE_HEADER_KEYS = ("authorization", "token", "secret", "api-key", "apikey", "x-api-key")
_REF_PREFIXES = ("env://", "vault://", "secret://")

def _redact_alert_source(item: dict) -> dict:
    out = dict(item)
    if out.get("auth_ref"):
        out["auth_ref"] = "configured"
    headers = out.get("headers") if isinstance(out.get("headers"), dict) else {}
    out["headers"] = {
        key: "configured" if any(token in str(key).lower() for token in _SENSITIVE_HEADER_KEYS) else value
        for key, value in headers.items()
    }
    if out.get("sample_payload"):
        out["sample_payload_status"] = "configured"
    out.pop("sample_payload", None)
    return out

def _validate_alert_source_config(item: dict):
    endpoint = str(item.get("endpoint") or "").strip()
    if endpoint and not endpoint.startswith(("http://", "https://")):
        raise HTTPException(400, "alert source endpoint must use http:// or https://")
    auth_ref = str(item.get("auth_ref") or "").strip()
    if auth_ref and not auth_ref.startswith(_REF_PREFIXES):
        raise HTTPException(400, "auth_ref must use env://, vault:// or secret://")
    headers = item.get("headers") if isinstance(item.get("headers"), dict) else {}
    for key, value in headers.items():
        if any(token in str(key).lower() for token in _SENSITIVE_HEADER_KEYS) and str(value) and not str(value).startswith(_REF_PREFIXES):
            raise HTTPException(400, f"header {key} must reference a managed secret")

def _resolve_secret_ref(value: str) -> str:
    if not value.startswith("env://"):
        return ""
    import os
    return os.getenv(value.removeprefix("env://"), "")

def _fetch_alert_source_payload(source: dict, *, sample_payload=None, use_endpoint: bool = True, endpoint_override: str = ""):
    payload = sample_payload if sample_payload not in (None, {}, []) else source.get("sample_payload")
    endpoint = str(endpoint_override or source.get("endpoint") or "").strip()
    if payload not in (None, {}, []) and not (use_endpoint and endpoint):
        return payload
    if not endpoint:
        return []
    if not endpoint.startswith(("http://", "https://")):
        raise HTTPException(400, "alert source endpoint must use http:// or https://")
    import json
    import urllib.request
    headers = {"Accept": "application/json"}
    for key, value in (source.get("headers") or {}).items():
        resolved = _resolve_secret_ref(str(value)) if str(value).startswith("env://") else str(value)
        if resolved:
            headers[str(key)] = resolved
    if source.get("auth_ref"):
        token = _resolve_secret_ref(str(source.get("auth_ref")))
        if token:
            headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(endpoint, headers=headers)
    with urllib.request.urlopen(request, timeout=int(source.get("timeout_s") or 5)) as response:
        raw = response.read(1024 * 1024)
    return json.loads(raw.decode("utf-8"))

def _collect_alert_source(source: dict, *, sample_payload=None, use_endpoint: bool = True, endpoint_override: str = "", limit: int = 100) -> dict:
    try:
        payload = _fetch_alert_source_payload(source, sample_payload=sample_payload, use_endpoint=use_endpoint, endpoint_override=endpoint_override)
        alerts = normalize_alerts_from_source(source, payload)[:limit]
        return {
            **_scope(),
            "ok": True,
            "source_id": source.get("id"),
            "source_name": source.get("name"),
            "source_type": source.get("source_type"),
            "alerts": alerts,
            "summary": {"alerts": len(alerts), "open": sum(1 for item in alerts if str(item.get("status") or "open").lower() in {"open", "active", "triggered", "alerting"})},
            "collected_at": _now(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        return {
            **_scope(),
            "ok": False,
            "source_id": source.get("id"),
            "source_name": source.get("name"),
            "source_type": source.get("source_type"),
            "alerts": [],
            "summary": {"alerts": 0, "open": 0},
            "error": str(exc),
            "collected_at": _now(),
        }

def _persist_alert_collection(result: dict):
    for alert in result.get("alerts") or []:
        alert_item = {**_scope(), **alert, "id": str(alert.get("id") or uuid4()), "collected_at": result.get("collected_at") or _now()}
        _save("external_alerts", alert_item)
    run = {
        **_scope(),
        "id": str(uuid4()),
        "source_id": result.get("source_id"),
        "source_name": result.get("source_name"),
        "source_type": result.get("source_type"),
        "ok": bool(result.get("ok")),
        "summary": result.get("summary", {}),
        "error": result.get("error", ""),
        "created_at": result.get("collected_at") or _now(),
    }
    _save("alert_source_runs", run)

def _collect_configured_alert_sources(*, source_ids: list[str] | None = None, persist: bool = False, limit: int = 100) -> dict:
    selected = set(source_ids or [])
    sources = [
        item for item in _load_all("alert_sources")
        if item.get("enabled", True) and (not selected or item.get("id") in selected)
    ]
    results = [_collect_alert_source(source, limit=limit) for source in sources]
    if persist:
        for result in results:
            _persist_alert_collection(result)
    alerts: list[dict] = []
    for result in results:
        alerts.extend(result.get("alerts") or [])
    return {
        **_scope(),
        "ok": all(result.get("ok") for result in results) if results else True,
        "results": results,
        "alerts": alerts[:limit],
        "summary": {
            "sources": len(sources),
            "ok": sum(1 for item in results if item.get("ok")),
            "failed": sum(1 for item in results if not item.get("ok")),
            "alerts": len(alerts),
        },
    }

def _collect_external_alerts() -> list[dict]:
    alerts: list[dict] = []
    try:
        from sop_manager.routers import data_quality
        for item in data_quality.list_alerts(status="open").get("items", []):
            alerts.append({"source": "data_quality", **item})
    except Exception:
        pass
    try:
        from sop_manager.routers import billing
        for item in billing.alerts_payload().get("items", []):
            alerts.append({"source": "billing", **item})
    except Exception:
        pass
    try:
        stored_alerts = _load_all("external_alerts")[:100]
        configured = _collect_configured_alert_sources(persist=True, limit=100)
        alerts.extend(configured.get("alerts") or stored_alerts)
    except Exception:
        pass
    policies = _load_all("alert_noise_policies")
    silences = _load_all("alert_silences")
    if not [item for item in policies if item.get("enabled", True)] and not [item for item in silences if item.get("enabled", True)]:
        return alerts
    evaluated = evaluate_alert_noise(alerts, policies, silences)
    actionable_ids = {str(item.get("id") or "") for item in evaluated.get("actionable_alerts") or []}
    return [item for item in alerts if str(item.get("id") or "") in actionable_ids]

def _alert_noise_payload(*, policy_id: str = "", persist: bool = False, limit: int = 100) -> dict:
    policies = _load_all("alert_noise_policies")
    if policy_id:
        policies = [item for item in policies if item.get("id") == policy_id]
        if not policies:
            raise HTTPException(404, "alert noise policy not found")
    alerts = _load_all("external_alerts")[: max(1, min(limit, 500))]
    result = evaluate_alert_noise(alerts, policies, _load_all("alert_silences"))
    if persist:
        item = {
            **_scope(),
            "id": str(uuid4()),
            "policy_id": result.get("policy", {}).get("id", ""),
            "summary": result.get("summary", {}),
            "groups": result.get("groups", [])[:50],
            "created_at": _now(),
        }
        _save("alert_noise_evaluations", item)
        result["evaluation_id"] = item["id"]
    result["history_summary"] = summarize_alert_noise_evaluations(_load_all("alert_noise_evaluations"))
    return {**_scope(), **result}

def _alert_strategy_recommendations_payload(body: AlertStrategyRecommendIn) -> dict:
    return recommend_alert_noise_strategy(
        alerts=_load_all("external_alerts")[:500],
        policies=_load_all("alert_noise_policies"),
        silences=_load_all("alert_silences"),
        evaluations=_load_all("alert_noise_evaluations")[:20],
        limit=body.limit,
    )

def _persist_alert_strategy_recommendations(payload: dict) -> list[dict]:
    saved: list[dict] = []
    for recommendation in payload.get("items") or []:
        if not isinstance(recommendation, dict) or not recommendation.get("id"):
            continue
        existing = {}
        try:
            existing = _load_scoped_item("alert_strategy_recommendations", str(recommendation["id"]), "alert strategy recommendation not found")
        except HTTPException:
            existing = {}
        item = {
            **existing,
            **recommendation,
            **_scope(),
            "review_status": existing.get("review_status") or recommendation.get("status") or "open",
            "created_at": existing.get("created_at") or _now(),
            "updated_at": _now(),
            "generated_at": payload.get("generated_at") or _now(),
        }
        _save("alert_strategy_recommendations", item)
        saved.append(item)
    return saved

def _alert_strategy_compare_payload(body: AlertStrategyCompareIn) -> dict:
    return compare_alert_strategy_variants(
        alerts=_load_all("external_alerts")[: max(1, min(body.limit, 1000))],
        policies=_load_all("alert_noise_policies"),
        silences=_load_all("alert_silences"),
        variants=[item.model_dump() for item in body.variants],
        baseline_policy_id=body.baseline_policy_id,
    )

def _persist_alert_strategy_comparison(payload: dict) -> dict:
    item = {
        **_scope(),
        "id": str(uuid4()),
        "summary": payload.get("summary", {}),
        "baseline": payload.get("baseline", {}),
        "items": payload.get("items", [])[:20],
        "agent_consumption": payload.get("agent_consumption", {}),
        "generated_at": payload.get("generated_at") or _now(),
        "created_at": _now(),
    }
    _save("alert_strategy_comparisons", item)
    return item

def _alert_slo_prediction_payload(body: AlertSloPredictIn) -> dict:
    return predict_alert_source_slo(
        alerts=_load_all("external_alerts")[: max(1, min(body.limit, 1000))],
        sources=_load_all("alert_sources"),
        runs=_load_all("alert_source_runs")[:50],
        evaluations=_load_all("alert_noise_evaluations")[:10],
        window_hours=body.window_hours,
    )

def _persist_alert_slo_prediction(payload: dict) -> dict:
    item = {
        **_scope(),
        "id": str(uuid4()),
        "summary": payload.get("summary", {}),
        "items": payload.get("items", [])[:100],
        "agent_consumption": payload.get("agent_consumption", {}),
        "generated_at": payload.get("generated_at") or _now(),
        "created_at": _now(),
    }
    _save("alert_slo_predictions", item)
    return item

def _default_alert_slo_escalation_policy() -> dict:
    return {
        **_scope(),
        "id": "default",
        "enabled": True,
        "min_risk_level": "high",
        "min_breach_probability": 0.35,
        "max_targets": 5,
        "cooldown_minutes": 60,
        "actions": ["create_task", "im_notify"],
        "channels": [],
        "owner": "Ops Lead",
        "note": "高风险告警 SLO 预测自动升级为任务和 IM 风险简报。",
        "updated_at": "",
    }

def _alert_slo_escalation_policy() -> dict:
    items = _load_all("alert_slo_escalation_policy")
    return {**_default_alert_slo_escalation_policy(), **(items[0] if items else {})}

def _save_alert_slo_escalation_policy(body: AlertSloEscalationPolicyIn) -> dict:
    item = {**_scope(), "id": "default", **body.model_dump(), "updated_at": _now()}
    _save("alert_slo_escalation_policy", item)
    return item

def _alert_slo_escalation_run(body: AlertSloEscalationRunIn) -> dict:
    policy = _alert_slo_escalation_policy()
    prediction = predict_alert_source_slo(
        alerts=_load_all("external_alerts")[:1000],
        sources=_load_all("alert_sources"),
        runs=_load_all("alert_source_runs")[:50],
        evaluations=_load_all("alert_noise_evaluations")[:10],
        window_hours=body.window_hours,
    )
    planned = build_alert_slo_escalation(
        prediction,
        policy=policy,
        dry_run=body.dry_run,
        priority=body.priority,
        owner_id=body.owner_id,
        dev_tool=body.dev_tool,
    )
    if not policy.get("enabled", True) and not body.force:
        planned["blocked_reason"] = "policy_disabled"
        planned["summary"] = {**planned.get("summary", {}), "created": 0, "sent": 0}
        return {**_scope(), "prediction": prediction, **planned}

    created: list[dict] = []
    if not body.dry_run:
        from sop_manager.routers.tasks import TaskCreate, create_task

        for task in planned.get("tasks") or []:
            created.append(create_task(TaskCreate(**task)))

    briefing = build_im_briefing(
        module="ops-center",
        title="OpsCenter 告警 SLO 自动升级",
        summary={
            "health_score": prediction.get("summary", {}).get("avg_slo_score", 0),
            "risk_targets": planned.get("summary", {}).get("candidates", 0),
            "breach_probability": planned.get("summary", {}).get("max_breach_probability", 0),
        },
        risks=[
            {
                "level": item.get("risk_level", "high"),
                "title": f"{item.get('source_name')} / {item.get('service')} breach {round(float(item.get('breach_probability') or 0) * 100)}%",
            }
            for item in planned.get("items") or []
        ],
        recommendations=[
            "优先处置 critical/high 风险对象，必要时生成 RCA 并绑定 Runbook。",
            "同步复核告警降噪策略，避免重复告警掩盖真实 SLO 风险。",
        ],
        scope=_scope(),
        actions=[
            {"label": "查看 SLO 预测", "api": "/api/v1/ops-center/alert-noise/slo-prediction"},
            {"label": "查看升级记录", "api": "/api/v1/ops-center/alert-noise/slo-escalation/runs"},
        ],
    )
    delivery_plan: dict = {"ready": False, "messages": [], "target_count": 0}
    sent: list[dict] = []
    if "im_notify" in planned.get("policy", {}).get("actions", []):
        from sop_manager.routers.notify import NotifyMsg, list_channels, send_msg

        target_channels = body.channels or policy.get("channels") or []
        delivery_plan = build_im_delivery_plan(briefing, list_channels(), requested_channels=target_channels, event="ops_alert_slo_escalation")
        if not body.dry_run and delivery_plan.get("ready"):
            for message in delivery_plan.get("messages") or []:
                sent.append(send_msg(NotifyMsg(**message)))

    summary = {
        **planned.get("summary", {}),
        "created": len(created),
        "sent": len(sent),
    }
    run = {
        **_scope(),
        "id": str(uuid4()),
        "dry_run": body.dry_run,
        "policy": planned.get("policy", {}),
        "summary": summary,
        "items": planned.get("items", [])[:50],
        "tasks": created if created else planned.get("tasks", [])[:50],
        "created_task_ids": [item.get("id") for item in created if item.get("id")],
        "briefing": briefing,
        "delivery_plan": delivery_plan,
        "sent": sent,
        "prediction_summary": prediction.get("summary", {}),
        "note": body.note,
        "created_at": _now(),
    }
    if not body.dry_run:
        _save("alert_slo_escalations", run)
    return {
        **_scope(),
        "prediction": prediction,
        **planned,
        "summary": summary,
        "created_tasks": created,
        "briefing": briefing,
        "delivery_plan": delivery_plan,
        "sent": sent,
        "run_id": run["id"] if not body.dry_run else "",
        "persisted": not body.dry_run,
        "history_summary": summarize_alert_slo_escalations(_load_all("alert_slo_escalations")),
    }

def _alert_strategy_canary_audit(body: AlertStrategyCanaryAuditIn) -> dict:
    policies = _load_all("alert_noise_policies")
    variants: list[dict] = []
    if body.policy_id:
        selected = [item for item in policies if str(item.get("id") or "") == body.policy_id]
        if not selected:
            raise HTTPException(404, "alert noise policy not found")
        variants = selected
    if body.refresh_inputs or not _load_all("alert_strategy_comparisons"):
        comparison = compare_alert_strategy_variants(
            alerts=_load_all("external_alerts")[:1000],
            policies=policies,
            silences=_load_all("alert_silences"),
            variants=variants or None,
            baseline_policy_id="",
        )
        compare_runs = [{
            **_scope(),
            "id": "preview",
            "summary": comparison.get("summary", {}),
            "baseline": comparison.get("baseline", {}),
            "items": comparison.get("items", [])[:20],
            "generated_at": comparison.get("generated_at") or _now(),
        }]
    else:
        compare_runs = _load_all("alert_strategy_comparisons")
    if body.refresh_inputs or not _load_all("alert_slo_predictions"):
        prediction = predict_alert_source_slo(
            alerts=_load_all("external_alerts")[:1000],
            sources=_load_all("alert_sources"),
            runs=_load_all("alert_source_runs")[:50],
            evaluations=_load_all("alert_noise_evaluations")[:10],
            window_hours=24,
        )
        slo_predictions = [{
            **_scope(),
            "id": "preview",
            "summary": prediction.get("summary", {}),
            "items": prediction.get("items", [])[:100],
            "generated_at": prediction.get("generated_at") or _now(),
        }]
    else:
        slo_predictions = _load_all("alert_slo_predictions")

    payload = build_alert_strategy_canary_audit(
        compare_runs=compare_runs,
        policies=policies,
        evaluations=_load_all("alert_noise_evaluations")[:10],
        slo_predictions=slo_predictions,
        escalations=_load_all("alert_slo_escalations")[:10],
        candidate_id=body.candidate_id or body.policy_id,
        traffic_percent=body.traffic_percent,
    )
    audit_status = "ready_for_approval" if payload.get("decision") == "ready" else "blocked" if payload.get("decision") == "blocked" else "needs_review"
    run = {
        **_scope(),
        "id": str(uuid4()),
        "audit_status": audit_status,
        "created_by": body.created_by,
        "note": body.note,
        "requested_policy_id": body.policy_id,
        "requested_candidate_id": body.candidate_id,
        "requested_percent": body.traffic_percent,
        "created_at": _now(),
        **payload,
    }
    if body.persist:
        _save("alert_strategy_canary_audits", run)
    return {
        **_scope(),
        **run,
        "persisted": body.persist,
        "history_summary": summarize_alert_strategy_canary_audits(_load_all("alert_strategy_canary_audits")),
    }

def _strategy_canary_action_status(action: str, current: str, decision: str) -> str:
    if action == "approve":
        if decision == "blocked":
            raise HTTPException(409, "blocked audit cannot be approved")
        return "approved"
    if action == "start":
        if current not in {"ready_for_approval", "approved", "needs_review"} or decision == "blocked":
            raise HTTPException(409, "audit is not ready to start canary")
        return "canary_running"
    if action == "rollback":
        return "rolled_back"
    if action == "archive":
        return "archived"
    if action == "reject":
        return "rejected"
    if action == "reopen":
        return "ready_for_approval" if decision == "ready" else "needs_review"
    return current

def _ops_strategy_linkage_run(body: OpsStrategyLinkageRunIn) -> dict:
    planned = build_ops_strategy_linkage(
        canary_audits=_load_all("alert_strategy_canary_audits")[:10],
        slo_escalations=_load_all("alert_slo_escalations")[:10],
        rca=_load_all("rca")[:100],
        runbooks=_load_all("runbooks")[:100],
        self_heal=_load_all("self_heal")[:100],
        pipelines=_load_all("pipelines")[:100],
        actions=body.actions,
        max_items=body.max_items,
        priority=body.priority,
        owner_id=body.owner_id,
        dev_tool=body.dev_tool,
    )
    planned_tasks: list[dict] = []
    for index, task in enumerate(planned.get("tasks") or []):
        normalized = dict(task)
        normalized["source"] = str(normalized.get("source") or "ops_center_strategy_linkage")
        normalized["source_report_id"] = _ops_strategy_task_source_report_id(normalized, index)
        planned_tasks.append(normalized)

    existing_report_ids = _existing_ops_strategy_task_report_ids() if "create_task" in planned.get("actions", []) else set()
    seen_report_ids: set[str] = set()
    tasks_to_create: list[dict] = []
    skipped_existing: list[dict] = []
    for task in planned_tasks:
        report_id = str(task.get("source_report_id") or "").strip()
        if report_id in existing_report_ids or report_id in seen_report_ids:
            skipped_existing.append({**task, "dedupe_status": "existing", "dedupe_key": report_id})
            continue
        seen_report_ids.add(report_id)
        tasks_to_create.append({**task, "dedupe_status": "pending", "dedupe_key": report_id})

    created: list[dict] = []
    if not body.dry_run and "create_task" in planned.get("actions", []):
        from sop_manager.routers.tasks import TaskCreate, create_task

        for task in tasks_to_create:
            created.append(create_task(TaskCreate(**{key: value for key, value in task.items() if key not in {"dedupe_status", "dedupe_key"}})))
            report_id = str(task.get("source_report_id") or "").strip()
            if report_id:
                existing_report_ids.add(report_id)

    briefing = build_im_briefing(
        module="ops-center",
        title="OpsCenter 跨模块运维策略联动",
        summary={
            "health_score": max(0, 100 - int(planned.get("summary", {}).get("high_risk") or 0) * 12),
            "linkage_items": planned.get("summary", {}).get("linkage_items", 0),
            "modules": planned.get("summary", {}).get("modules", 0),
            "tasks": len(created) if not body.dry_run else len(tasks_to_create),
            "skipped_existing": len(skipped_existing),
        },
        risks=[
            {"level": item.get("risk_level", "medium"), "title": f"{item.get('module')}: {item.get('title')}"}
            for item in planned.get("items") or []
        ][:5],
        recommendations=[
            "优先处理 critical/high 联动项，再启动或扩大策略灰度。",
            "将 Runbook、自愈和任务处置结果回写后重新生成灰度审计。",
        ],
        scope=_scope(),
        actions=[
            {"label": "查看策略灰度审计", "api": "/api/v1/ops-center/alert-noise/strategy-canary/audits"},
            {"label": "查看联动运行", "api": "/api/v1/ops-center/strategy-linkage/runs"},
        ],
    )
    delivery_plan: dict = {"ready": False, "messages": [], "target_count": 0}
    sent: list[dict] = []
    if "im_notify" in planned.get("actions", []):
        from sop_manager.routers.notify import NotifyMsg, list_channels, send_msg

        delivery_plan = build_im_delivery_plan(briefing, list_channels(), requested_channels=body.channels, event="ops_strategy_linkage")
        if not body.dry_run and delivery_plan.get("ready"):
            for message in delivery_plan.get("messages") or []:
                sent.append(send_msg(NotifyMsg(**message)))

    summary = {
        **planned.get("summary", {}),
        "created": len(created),
        "skipped_existing": len(skipped_existing),
        "tasks_to_create": len(tasks_to_create),
        "sent": len(sent),
    }
    run = {
        **_scope(),
        "id": str(uuid4()),
        "dry_run": body.dry_run,
        "summary": summary,
        "items": planned.get("items", [])[:50],
        "tasks": created if created else [*tasks_to_create, *skipped_existing][:50],
        "created_task_ids": [item.get("id") for item in created if item.get("id")],
        "skipped_existing": skipped_existing[:50],
        "briefing": briefing,
        "delivery_plan": delivery_plan,
        "sent": sent,
        "strategy_packet": planned.get("strategy_packet", {}),
        "actions": planned.get("actions", []),
        "note": body.note,
        "agent_consumption": planned.get("agent_consumption", {}),
        "created_at": _now(),
    }
    if not body.dry_run:
        _save("ops_strategy_linkages", run)
    return {
        **_scope(),
        **planned,
        "summary": summary,
        "tasks": created if created else [*tasks_to_create, *skipped_existing][:50],
        "created_tasks": created,
        "skipped_existing": skipped_existing,
        "briefing": briefing,
        "delivery_plan": delivery_plan,
        "sent": sent,
        "run_id": run["id"] if not body.dry_run else "",
        "persisted": not body.dry_run,
        "history_summary": summarize_ops_strategy_linkages(_load_all("ops_strategy_linkages")),
    }

def _apply_alert_strategy_recommendation(item: dict, *, actor: str, note: str) -> dict:
    operation = str(item.get("operation") or "")
    payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
    result: dict = {"operation": operation, "changed": False}
    if operation == "upsert_policy":
        policy_id = str(payload.get("policy_id") or "")
        body = AlertNoisePolicyCreate(
            name=str(payload.get("name") or "OpsCenter 推荐降噪策略"),
            enabled=bool(payload.get("enabled", True)),
            group_by=[str(value) for value in payload.get("group_by") or ["service", "alertname", "source_id"] if str(value)],
            min_rca_severity=str(payload.get("min_rca_severity") or "high"),
            suppress_severities=[str(value) for value in payload.get("suppress_severities") or ["info"] if str(value)],
            labels=payload.get("labels") if isinstance(payload.get("labels"), dict) else {"source": "alert_strategy_recommendation"},
            note=str(payload.get("note") or note or "OpsCenter strategy recommendation applied"),
        )
        if policy_id:
            try:
                policy = update_alert_noise_policy(policy_id, body)
            except HTTPException:
                policy = create_alert_noise_policy(body)
        else:
            policy = create_alert_noise_policy(body)
        result = {"operation": operation, "changed": True, "policy": policy}
    elif operation == "create_silence":
        body = AlertSilenceCreate(
            name=str(payload.get("name") or "OpsCenter 推荐静默"),
            matchers=payload.get("matchers") if isinstance(payload.get("matchers"), dict) else {},
            starts_at=str(payload.get("starts_at") or ""),
            ends_at=str(payload.get("ends_at") or ""),
            reason=str(payload.get("reason") or note or "OpsCenter strategy recommendation applied"),
            enabled=bool(payload.get("enabled", True)),
            owner=str(payload.get("owner") or actor),
        )
        silence = create_alert_silence(body)
        result = {"operation": operation, "changed": True, "silence": silence}
    item["review_status"] = "applied"
    item["applied_by"] = actor
    item["applied_at"] = _now()
    item["apply_note"] = note
    item["apply_result"] = result
    item["updated_at"] = _now()
    _save("alert_strategy_recommendations", item)
    return item

@router.get("/alert-sources")
def list_alert_sources():
    sources = _load_all("alert_sources")
    alerts = _load_all("external_alerts")
    runs = _load_all("alert_source_runs")
    summary = summarize_alert_sources(sources, alerts, runs[: len(sources) or 1])
    return {
        **_scope(),
        "items": [_redact_alert_source(item) for item in sources],
        "total": len(sources),
        "summary": summary,
        "recent_runs": runs[:10],
    }

@router.post("/alert-sources")
def create_alert_source(body: AlertSourceCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "created_at": _now(), "updated_at": _now()}
    _validate_alert_source_config(item)
    _save("alert_sources", item)
    return _redact_alert_source(item)

@router.post("/alert-sources/sync")
def sync_alert_sources(body: AlertSourceSyncIn):
    result = _collect_configured_alert_sources(source_ids=body.source_ids, persist=body.persist, limit=body.limit)
    alerts = _load_all("external_alerts") if body.persist else result.get("alerts", [])
    result["source_summary"] = summarize_alert_sources(_load_all("alert_sources"), alerts, _load_all("alert_source_runs"))
    return result

@router.get("/alerts")
def list_external_alerts(source_id: str = "", status: str = "", limit: int = 100):
    items = _load_all("external_alerts")
    if source_id:
        items = [item for item in items if item.get("source_id") == source_id]
    if status:
        items = [item for item in items if str(item.get("status") or "").lower() == status.lower()]
    return {**_scope(), "items": items[: max(1, min(limit, 500))], "total": len(items), "summary": summarize_alert_sources(_load_all("alert_sources"), items, _load_all("alert_source_runs"))}

@router.get("/alert-noise/recommendations")
def list_alert_strategy_recommendations(status: str = "", limit: int = 50):
    items = _load_all("alert_strategy_recommendations")
    if status:
        items = [item for item in items if item.get("review_status") == status or item.get("status") == status]
    items = items[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_alert_strategy_recommendations(items)}

@router.post("/alert-noise/recommendations")
def generate_alert_strategy_recommendations(body: AlertStrategyRecommendIn):
    payload = _alert_strategy_recommendations_payload(body)
    saved = _persist_alert_strategy_recommendations(payload) if body.persist else []
    items = saved if body.persist else payload.get("items", [])
    return {**_scope(), **payload, "items": items, "persisted": len(saved), "summary": {**payload.get("summary", {}), **summarize_alert_strategy_recommendations(items)}}

@router.post("/alert-noise/recommendations/{recommendation_id}/action")
def alert_strategy_recommendation_action(recommendation_id: str, body: AlertStrategyRecommendationActionIn):
    item = _load_scoped_item("alert_strategy_recommendations", recommendation_id, "alert strategy recommendation not found")
    if body.action == "apply":
        updated = _apply_alert_strategy_recommendation(item, actor=body.actor, note=body.note)
        return {**_scope(), "ok": True, "action": body.action, "item": updated}
    item["review_status"] = "dismissed" if body.action == "dismiss" else "open"
    item["reviewed_by"] = body.actor
    item["reviewed_at"] = _now()
    item["review_note"] = body.note
    item["updated_at"] = _now()
    _save("alert_strategy_recommendations", item)
    return {**_scope(), "ok": True, "action": body.action, "item": item}

@router.get("/alert-noise/strategy-compare/runs")
def list_alert_strategy_comparisons(limit: int = 30):
    items = _load_all("alert_strategy_comparisons")[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_alert_strategy_comparisons(items)}

@router.post("/alert-noise/strategy-compare")
def alert_strategy_compare(body: AlertStrategyCompareIn):
    payload = _alert_strategy_compare_payload(body)
    run = _persist_alert_strategy_comparison(payload) if body.persist else None
    return {
        **_scope(),
        **payload,
        "run_id": run.get("id") if run else "",
        "persisted": bool(run),
        "history_summary": summarize_alert_strategy_comparisons(_load_all("alert_strategy_comparisons")),
    }

@router.get("/alert-noise/slo-prediction/runs")
def list_alert_slo_predictions(limit: int = 30):
    items = _load_all("alert_slo_predictions")[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_alert_slo_predictions(items)}

@router.post("/alert-noise/slo-prediction")
def alert_slo_prediction(body: AlertSloPredictIn):
    payload = _alert_slo_prediction_payload(body)
    run = _persist_alert_slo_prediction(payload) if body.persist else None
    return {
        **_scope(),
        **payload,
        "run_id": run.get("id") if run else "",
        "persisted": bool(run),
        "history_summary": summarize_alert_slo_predictions(_load_all("alert_slo_predictions")),
    }

@router.get("/alert-noise/slo-escalation-policy")
def get_alert_slo_escalation_policy():
    return {**_scope(), "item": _alert_slo_escalation_policy()}

@router.put("/alert-noise/slo-escalation-policy")
def update_alert_slo_escalation_policy(body: AlertSloEscalationPolicyIn):
    return {**_scope(), "item": _save_alert_slo_escalation_policy(body)}

@router.get("/alert-noise/slo-escalation/runs")
def list_alert_slo_escalation_runs(limit: int = 30):
    items = _load_all("alert_slo_escalations")[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_alert_slo_escalations(items)}

@router.post("/alert-noise/slo-escalation/run")
def run_alert_slo_escalation(body: AlertSloEscalationRunIn):
    return _alert_slo_escalation_run(body)

@router.get("/alert-noise/strategy-canary/audits")
def list_alert_strategy_canary_audits(limit: int = 30):
    items = _load_all("alert_strategy_canary_audits")[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_alert_strategy_canary_audits(items)}

@router.post("/alert-noise/strategy-canary/audit")
def alert_strategy_canary_audit(body: AlertStrategyCanaryAuditIn):
    return _alert_strategy_canary_audit(body)

@router.post("/alert-noise/strategy-canary/audits/{audit_id}/action")
def alert_strategy_canary_action(audit_id: str, body: AlertStrategyCanaryActionIn):
    item = _load_scoped_item("alert_strategy_canary_audits", audit_id, "alert strategy canary audit not found")
    current = str(item.get("audit_status") or "")
    decision = str(item.get("decision") or item.get("summary", {}).get("decision") or "")
    item["audit_status"] = _strategy_canary_action_status(body.action, current, decision)
    item["updated_at"] = _now()
    item.setdefault("actions", []).append({
        "action": body.action,
        "actor": body.actor,
        "note": body.note,
        "from_status": current,
        "to_status": item["audit_status"],
        "created_at": item["updated_at"],
    })
    _save("alert_strategy_canary_audits", item)
    return {**_scope(), "ok": True, "action": body.action, "item": item, "summary": summarize_alert_strategy_canary_audits(_load_all("alert_strategy_canary_audits"))}

@router.get("/strategy-linkage/runs")
def list_ops_strategy_linkage_runs(limit: int = 30):
    items = _load_all("ops_strategy_linkages")[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_ops_strategy_linkages(items)}

@router.post("/strategy-linkage/run")
def run_ops_strategy_linkage(body: OpsStrategyLinkageRunIn):
    return _ops_strategy_linkage_run(body)

@router.get("/alert-noise/policies")
def list_alert_noise_policies():
    policies = _load_all("alert_noise_policies")
    silences = _load_all("alert_silences")
    evaluations = _load_all("alert_noise_evaluations")
    return {
        **_scope(),
        "items": policies,
        "silences": silences,
        "summary": {
            "policies": len(policies),
            "enabled_policies": sum(1 for item in policies if item.get("enabled", True)),
            "silences": len(silences),
            "enabled_silences": sum(1 for item in silences if item.get("enabled", True)),
            **summarize_alert_noise_evaluations(evaluations),
        },
    }

@router.post("/alert-noise/policies")
def create_alert_noise_policy(body: AlertNoisePolicyCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "created_at": _now(), "updated_at": _now()}
    _save("alert_noise_policies", item)
    return item

@router.put("/alert-noise/policies/{policy_id}")
def update_alert_noise_policy(policy_id: str, body: AlertNoisePolicyCreate):
    item = _load_scoped_item("alert_noise_policies", policy_id, "alert noise policy not found")
    item.update(body.model_dump())
    item["updated_at"] = _now()
    _save("alert_noise_policies", item)
    return item

@router.post("/alert-noise/policies/{policy_id}/toggle")
def toggle_alert_noise_policy(policy_id: str, body: AlertNoiseToggleIn):
    item = _load_scoped_item("alert_noise_policies", policy_id, "alert noise policy not found")
    item["enabled"] = body.enabled
    item["updated_at"] = _now()
    _save("alert_noise_policies", item)
    return item

@router.delete("/alert-noise/policies/{policy_id}")
def delete_alert_noise_policy(policy_id: str):
    _load_scoped_item("alert_noise_policies", policy_id, "alert noise policy not found")
    with project_file_write_scope():
        (_dir("alert_noise_policies") / f"{policy_id}.json").unlink()
    return {**_scope(), "deleted": policy_id}

@router.post("/alert-noise/evaluate")
def evaluate_alert_noise_route(body: AlertNoiseEvaluateIn):
    return _alert_noise_payload(policy_id=body.policy_id, persist=body.persist, limit=body.limit)

@router.get("/alert-noise/evaluations")
def list_alert_noise_evaluations(limit: int = 30):
    items = _load_all("alert_noise_evaluations")[: max(1, min(limit, 200))]
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_alert_noise_evaluations(items)}

@router.post("/alert-noise/silences")
def create_alert_silence(body: AlertSilenceCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "created_at": _now(), "updated_at": _now()}
    _save("alert_silences", item)
    return item

@router.put("/alert-noise/silences/{silence_id}")
def update_alert_silence(silence_id: str, body: AlertSilenceCreate):
    item = _load_scoped_item("alert_silences", silence_id, "alert silence not found")
    item.update(body.model_dump())
    item["updated_at"] = _now()
    _save("alert_silences", item)
    return item

@router.post("/alert-noise/silences/{silence_id}/toggle")
def toggle_alert_silence(silence_id: str, body: AlertNoiseToggleIn):
    item = _load_scoped_item("alert_silences", silence_id, "alert silence not found")
    item["enabled"] = body.enabled
    item["updated_at"] = _now()
    _save("alert_silences", item)
    return item

@router.delete("/alert-noise/silences/{silence_id}")
def delete_alert_silence(silence_id: str):
    _load_scoped_item("alert_silences", silence_id, "alert silence not found")
    with project_file_write_scope():
        (_dir("alert_silences") / f"{silence_id}.json").unlink()
    return {**_scope(), "deleted": silence_id}

@router.put("/alert-sources/{source_id}")
def update_alert_source(source_id: str, body: AlertSourceCreate):
    item = _load_scoped_item("alert_sources", source_id, "alert source not found")
    item.update(body.model_dump())
    item["updated_at"] = _now()
    _validate_alert_source_config(item)
    _save("alert_sources", item)
    return _redact_alert_source(item)

@router.post("/alert-sources/{source_id}/test")
def test_alert_source(source_id: str, body: AlertSourceTestIn):
    item = _load_scoped_item("alert_sources", source_id, "alert source not found")
    sample = body.sample_payload if body.sample_payload not in ({}, []) else None
    result = _collect_alert_source(
        item,
        sample_payload=sample,
        use_endpoint=body.use_endpoint,
        endpoint_override=body.endpoint_override,
        limit=100,
    )
    return {**_scope(), **result, "source": _redact_alert_source(item)}

@router.post("/alert-sources/{source_id}/toggle")
def toggle_alert_source(source_id: str, body: AlertSourceToggleIn):
    item = _load_scoped_item("alert_sources", source_id, "alert source not found")
    item["enabled"] = body.enabled
    item["updated_at"] = _now()
    _save("alert_sources", item)
    return _redact_alert_source(item)

@router.delete("/alert-sources/{source_id}")
def delete_alert_source(source_id: str):
    _load_scoped_item("alert_sources", source_id, "alert source not found")
    p = _dir("alert_sources") / f"{source_id}.json"
    with project_file_write_scope():
        p.unlink()
    return {**_scope(), "deleted": source_id}

def _rca_insight_payload(body: RcaInsightIn) -> dict:
    try:
        from sop_manager.routers.system_ops import observability_trace_summary
        trace = observability_trace_summary(
            run_id=body.run_id,
            trace_id=body.trace_id,
            correlation_id=body.correlation_id,
            limit=body.limit,
            _=object(),
        )
    except Exception as exc:
        trace = {"ok": False, "error": str(exc), "summary": {}, "root_cause": {}, "root_cause_navigation": []}
    return build_ops_rca_insights(
        trace_summary=trace,
        alerts=_collect_external_alerts(),
        pipelines=_load_all("pipelines"),
        rca=_load_all("rca"),
        runbooks=_load_all("runbooks"),
    )

@router.post("/rca/insights")
def rca_insights(body: RcaInsightIn):
    analysis = _rca_insight_payload(body)
    return {**_scope(), **analysis, "filters": body.model_dump()}

@router.post("/rca/insights/tasks")
def rca_insight_tasks(body: RcaInsightTasksIn):
    analysis = _rca_insight_payload(body)
    planned = build_ops_rca_insight_tasks(
        analysis,
        dry_run=body.dry_run,
        priority=body.priority,
        owner_id=body.owner_id,
        dev_tool=body.dev_tool,
    )
    if body.dry_run:
        return {**_scope(), "analysis": analysis, **planned}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = []
    for task in planned.get("tasks") or []:
        created.append(create_task(TaskCreate(**task)))
    out = {**planned, "dry_run": False, "summary": {**planned.get("summary", {}), "created": len(created)}, "items": created, "tasks": created}
    history = {**_scope(), "id": str(uuid4()), "analysis": analysis, "created_task_ids": [x.get("id") for x in created if x.get("id")], "created_at": _now()}
    _save("rca_insight_task_runs", history)
    return {**_scope(), **out, "analysis": analysis}

@router.post("/rca/insights/rca")
def rca_insight_create_rca(body: RcaInsightCreateRcaIn):
    analysis = _rca_insight_payload(body)
    candidates = analysis.get("candidates", []) if isinstance(analysis.get("candidates"), list) else []
    candidate = next((item for item in candidates if isinstance(item, dict) and item.get("id") == body.candidate_id), None)
    if not candidate and candidates:
        candidate = candidates[0]
    if not candidate:
        raise HTTPException(404, "rca insight candidate not found")
    selected = set(body.selected_runbook_ids or [])
    recommended = candidate.get("recommended_runbooks", []) if isinstance(candidate.get("recommended_runbooks"), list) else []
    if not selected:
        selected = {str(item.get("id") or "") for item in recommended[:3] if item.get("id")}
    incident_id = f"RCA-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{candidate.get('kind', 'ops')}"
    item = {
        **_scope(),
        "id": str(uuid4()),
        "incident_id": incident_id,
        "root_cause": str(candidate.get("root_cause") or candidate.get("title") or "OpsCenter insight"),
        "impact": f"{candidate.get('severity', 'medium')} / confidence={candidate.get('confidence')}",
        "resolution": "\n".join(str(x) for x in candidate.get("recommendations") or []),
        "status": body.status,
        "source": "ops_center_rca_insight",
        "source_candidate_id": candidate.get("id", ""),
        "severity": candidate.get("severity", "medium"),
        "confidence": candidate.get("confidence", 0),
        "owner": body.owner,
        "note": body.note,
        "evidence": candidate.get("evidence", []) if isinstance(candidate.get("evidence"), list) else [],
        "recommended_runbooks": recommended,
        "selected_runbook_ids": sorted(x for x in selected if x),
        "linked": candidate.get("linked", {}) if isinstance(candidate.get("linked"), dict) else {},
        "created_at": _now(),
    }
    if body.status == "resolved":
        item["resolved_at"] = _now()
    _save("rca", item)
    history = {**_scope(), "id": str(uuid4()), "rca_id": item["id"], "candidate": candidate, "created_at": _now()}
    _save("rca_insight_creations", history)
    return {**_scope(), "ok": True, "item": item, "analysis": analysis}

@router.put("/rca/{rca_id}/resolve")
def resolve_rca(rca_id: str):
    item = _load_scoped_item("rca", rca_id, "rca not found")
    item.update({"status": "resolved", "resolved_at": _now()})
    _save("rca", item)
    return item

@router.get("/rca/{rca_id}/verification-plan")
def rca_verification_plan(rca_id: str):
    item = _load_scoped_item("rca", rca_id, "rca not found")
    plan = build_ops_rca_verification_plan(
        rca_item=item,
        pipelines=_load_all("pipelines"),
        runbooks=_load_all("runbooks"),
    )
    return {**_scope(), **plan, "item": item}

@router.post("/rca/{rca_id}/verify")
def verify_rca(rca_id: str, body: RcaVerifyIn):
    item = _load_scoped_item("rca", rca_id, "rca not found")
    plan = build_ops_rca_verification_plan(
        rca_item=item,
        pipelines=_load_all("pipelines"),
        runbooks=_load_all("runbooks"),
        manual_checks=body.checks,
    )
    updated = verify_ops_rca_item(
        item,
        verifier=body.verifier,
        checks=body.checks,
        plan=plan,
        close_on_pass=body.close_on_pass,
        note=body.note,
    )
    _save("rca", updated)
    history = {
        **_scope(),
        "id": str(uuid4()),
        "rca_id": updated["id"],
        "incident_id": updated.get("incident_id", ""),
        "verification_status": updated.get("verification_status", ""),
        "verification_score": updated.get("verification_score", 0),
        "plan": plan,
        "checks": body.checks,
        "created_at": _now(),
        "created_by": body.verifier,
    }
    _save("rca_verifications", history)
    return {**_scope(), "ok": True, "item": updated, "plan": plan, "verification": updated.get("verification_history", [])[-1]}

@router.get("/runbooks")
def list_runbooks():
    items = _load_all("runbooks")
    versions = _load_all("runbook_versions")
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_runbook_versions(items, versions)}

@router.post("/runbooks")
def create_runbook(body: RunbookCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "status": "active", "created_at": _now(), "created_by": body.owner}
    version = _create_runbook_version(item, body.owner, body.change_note or "Runbook 初始版本")
    _save("runbooks", item)
    _write_runbook_event(item["id"], "runbook_created", body.owner, body.change_note, {"version_id": version["id"], "version_no": version["version_no"]})
    return {**item, "active_version": version}

@router.put("/runbooks/{runbook_id}")
def update_runbook(runbook_id: str, body: RunbookCreate):
    item = _load_scoped_item("runbooks", runbook_id, "runbook not found")
    actor = body.owner or item.get("owner") or "Ops Lead"
    item.update(body.model_dump())
    item["updated_at"] = _now()
    item["updated_by"] = actor
    version = _create_runbook_version(item, actor, body.change_note or "Runbook 内容更新")
    _save("runbooks", item)
    _write_runbook_event(item["id"], "runbook_updated", actor, body.change_note, {"version_id": version["id"], "version_no": version["version_no"]})
    return {**item, "active_version": version}

@router.get("/runbooks/{runbook_id}/versions")
def list_runbook_versions(runbook_id: str):
    runbook = _load_scoped_item("runbooks", runbook_id, "runbook not found")
    versions = _runbook_versions(runbook_id)
    return {
        **_scope(),
        "runbook": runbook,
        "items": versions,
        "events": [item for item in _load_all("runbook_events") if item.get("runbook_id") == runbook_id][:50],
        "summary": summarize_runbook_versions([runbook], versions),
        "total": len(versions),
    }

@router.get("/runbooks/{runbook_id}/versions/diff")
def diff_runbook_version_route(
    runbook_id: str,
    base_version_id: str = Query(...),
    target_version_id: str = Query(...),
):
    _load_scoped_item("runbooks", runbook_id, "runbook not found")
    base = _load_scoped_item("runbook_versions", base_version_id, "runbook version not found")
    target = _load_scoped_item("runbook_versions", target_version_id, "runbook version not found")
    if base.get("runbook_id") != runbook_id or target.get("runbook_id") != runbook_id:
        raise HTTPException(404, "runbook version not found")
    return {**_scope(), "runbook_id": runbook_id, "diff": diff_runbook_versions(base, target)}

@router.get("/runbooks/{runbook_id}/versions/{version_id}")
def get_runbook_version(runbook_id: str, version_id: str):
    _load_scoped_item("runbooks", runbook_id, "runbook not found")
    version = _load_scoped_item("runbook_versions", version_id, "runbook version not found")
    if version.get("runbook_id") != runbook_id:
        raise HTTPException(404, "runbook version not found")
    return {**_scope(), "item": version}

@router.post("/runbooks/{runbook_id}/versions/{version_id}/action")
def runbook_version_action(runbook_id: str, version_id: str, body: RunbookVersionActionIn):
    runbook = _load_scoped_item("runbooks", runbook_id, "runbook not found")
    version = _load_scoped_item("runbook_versions", version_id, "runbook version not found")
    if version.get("runbook_id") != runbook_id:
        raise HTTPException(404, "runbook version not found")
    if body.action == "promote":
        item = _promote_runbook_version(runbook, version, body.actor, body.note)
        return {**_scope(), "ok": True, "action": body.action, "item": item, "version": _load_scoped_item("runbook_versions", version_id, "runbook version not found")}
    if body.action == "archive":
        if runbook.get("active_version_id") == version_id:
            raise HTTPException(400, "active version cannot be archived")
        version["status"] = "archived"
        version["archived_at"] = _now()
        version["archived_by"] = body.actor
        _save("runbook_versions", version)
        _write_runbook_event(runbook_id, "version_archived", body.actor, body.note, {"version_id": version_id, "version_no": version.get("version_no")})
        return {**_scope(), "ok": True, "action": body.action, "version": version}
    version["status"] = "superseded"
    version["restored_at"] = _now()
    version["restored_by"] = body.actor
    _save("runbook_versions", version)
    _write_runbook_event(runbook_id, "version_restored", body.actor, body.note, {"version_id": version_id, "version_no": version.get("version_no")})
    return {**_scope(), "ok": True, "action": body.action, "version": version}

def _runbook_evidence_payload(body: RunbookEvidenceBackfillIn) -> dict:
    return build_runbook_execution_evidence(
        runbooks=_load_all("runbooks"),
        versions=_load_all("runbook_versions"),
        rca=_load_all("rca"),
        pipelines=_load_all("pipelines"),
        self_heal_actions=_load_all("self_heal_actions"),
        runbook_ids=body.runbook_ids,
        rca_ids=body.rca_ids,
        include_resolved=body.include_resolved,
        limit=body.limit,
    )

def _persist_runbook_evidence(payload: dict, *, actor: str, note: str) -> list[dict]:
    saved: list[dict] = []
    for record in payload.get("items") or []:
        if not isinstance(record, dict) or not record.get("id"):
            continue
        existing = {}
        try:
            existing = _load_scoped_item("runbook_evidence", str(record["id"]), "runbook evidence not found")
        except HTTPException:
            existing = {}
        item = {
            **existing,
            **record,
            **_scope(),
            "last_backfilled_at": _now(),
            "last_backfilled_by": actor,
            "backfill_note": note,
            "created_at": existing.get("created_at") or _now(),
            "created_by": existing.get("created_by") or actor,
            "review_status": existing.get("review_status") or "open",
            "review_note": existing.get("review_note") or "",
        }
        _save("runbook_evidence", item)
        saved.append(item)
    return saved

@router.get("/runbooks/evidence")
def list_runbook_evidence(runbook_id: str = "", status: str = "", limit: int = 100):
    items = _load_all("runbook_evidence")
    if runbook_id:
        items = [item for item in items if item.get("runbook_id") == runbook_id]
    if status:
        items = [item for item in items if item.get("status") == status or item.get("review_status") == status]
    items = items[: max(1, min(limit, 500))]
    return {**_scope(), "items": items, "total": len(items), "summary": summarize_runbook_execution_evidence(items)}

@router.post("/runbooks/evidence/backfill")
def backfill_runbook_evidence(body: RunbookEvidenceBackfillIn):
    payload = _runbook_evidence_payload(body)
    saved = _persist_runbook_evidence(payload, actor=body.actor, note=body.note) if body.persist else []
    return {
        **_scope(),
        **payload,
        "persisted": len(saved),
        "items": saved if body.persist else payload.get("items", []),
        "summary": summarize_runbook_execution_evidence(saved if body.persist else payload.get("items", [])),
    }

@router.post("/runbooks/evidence/{record_id}/action")
def runbook_evidence_action(record_id: str, body: RunbookEvidenceActionIn):
    item = _load_scoped_item("runbook_evidence", record_id, "runbook evidence not found")
    if body.action == "archive":
        item["review_status"] = "archived"
    elif body.action == "reopen":
        item["review_status"] = "open"
    else:
        item["review_status"] = "acknowledged"
    item["reviewed_by"] = body.actor
    item["reviewed_at"] = _now()
    item["review_note"] = body.note
    _save("runbook_evidence", item)
    return {**_scope(), "ok": True, "action": body.action, "item": item}

@router.delete("/runbooks/{runbook_id}")
def delete_runbook(runbook_id: str):
    _load_scoped_item("runbooks", runbook_id, "runbook not found")
    p = _dir("runbooks") / f"{runbook_id}.json"
    with project_file_write_scope():
        p.unlink()
    return {**_scope(), "deleted": runbook_id}

@router.get("/self-heal")
def list_self_heal():
    return {**_scope(), "items": _load_all("self_heal"), "total": len(_load_all("self_heal"))}

@router.post("/self-heal")
def create_self_heal(body: SelfHealCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(), "last_applied_at": None, "created_at": _now()}
    _save("self_heal", item)
    return item

@router.put("/self-heal/{policy_id}")
def update_self_heal(policy_id: str, body: SelfHealCreate):
    item = _load_scoped_item("self_heal", policy_id, "policy not found")
    item.update(body.model_dump())
    item["updated_at"] = _now()
    _save("self_heal", item)
    return item

@router.post("/self-heal/{policy_id}/apply")
def apply_self_heal(policy_id: str):
    item = _load_scoped_item("self_heal", policy_id, "policy not found")
    item["last_applied_at"] = _now()
    _save("self_heal", item)
    return {**_scope(), "policy_id": policy_id, "applied_at": item["last_applied_at"], "action": item.get("action")}

def _persist_guarded_actions(evaluation: dict, created_by: str) -> list[dict]:
    actions = build_self_heal_guarded_actions(evaluation, created_by=created_by)
    for action in actions:
        _save("self_heal_actions", action)
    return actions

@router.post("/self-heal/evaluate")
def evaluate_self_heal_policies(body: SelfHealEvaluateIn):
    policies = _load_all("self_heal")
    pipelines = _load_all("pipelines")
    rca = _load_all("rca")
    runbooks = _load_all("runbooks")
    result = evaluate_self_heal(policies, body.signals or {}, rca, pipelines, runbooks)
    item = {**_scope(), "id": str(uuid4()), **result, "created_at": _now()}
    actions = _persist_guarded_actions(result, created_by="ops-center") if body.persist else build_self_heal_guarded_actions(result, created_by="ops-center")
    item["guarded_actions"] = actions
    if body.persist:
        _save("self_heal_evaluations", item)
    return {**_scope(), **item, "actions": actions}

@router.get("/self-heal/evaluations")
def list_self_heal_evaluations(limit: int = 30):
    items = _load_all("self_heal_evaluations")[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items)}

@router.get("/self-heal/actions")
def list_self_heal_actions(state: str = "", limit: int = 50):
    items = _load_all("self_heal_actions")
    if state:
        items = [item for item in items if item.get("state") == state]
    items = items[: max(1, min(limit, 100))]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/self-heal/actions/{action_id}/approve")
def approve_self_heal_action(action_id: str, body: SelfHealApproveIn):
    item = _load_scoped_item("self_heal_actions", action_id, "self-heal action not found")
    try:
        updated = approve_self_heal_guarded_action(item, approver=body.approver, note=body.note)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _save("self_heal_actions", updated)
    return {**_scope(), "action": updated}

@router.post("/self-heal/actions/{action_id}/apply")
def apply_self_heal_action(action_id: str, body: SelfHealApplyIn):
    item = _load_scoped_item("self_heal_actions", action_id, "self-heal action not found")
    try:
        updated = apply_self_heal_guarded_action(item, operator=body.operator, result=body.result)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _save("self_heal_actions", updated)
    if updated.get("policy_id"):
        try:
            policy = _load_scoped_item("self_heal", str(updated.get("policy_id")), "policy not found")
            policy["last_applied_at"] = updated.get("applied_at") or _now()
            _save("self_heal", policy)
        except HTTPException:
            pass
    return {**_scope(), "action": updated}

@router.post("/self-heal/actions/{action_id}/verify")
def verify_self_heal_action(action_id: str, body: SelfHealVerifyIn):
    item = _load_scoped_item("self_heal_actions", action_id, "self-heal action not found")
    try:
        updated = verify_self_heal_guarded_action(item, verifier=body.verifier, verification=body.verification)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _save("self_heal_actions", updated)
    return {**_scope(), "action": updated}

@router.post("/self-heal/actions/{action_id}/rollback")
def rollback_self_heal_action(action_id: str, body: SelfHealRollbackIn):
    item = _load_scoped_item("self_heal_actions", action_id, "self-heal action not found")
    try:
        updated = rollback_self_heal_guarded_action(item, operator=body.operator, evidence=body.evidence)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _save("self_heal_actions", updated)
    return {**_scope(), "action": updated}

@router.post("/self-heal/tasks")
def self_heal_tasks(body: SelfHealTasksIn):
    policies = _load_all("self_heal")
    pipelines = _load_all("pipelines")
    rca = _load_all("rca")
    runbooks = _load_all("runbooks")
    evaluation = evaluate_self_heal(policies, body.signals or {}, rca, pipelines, runbooks)
    planned = build_self_heal_tasks(
        evaluation,
        dry_run=body.dry_run,
        priority=body.priority,
        owner_id=body.owner_id,
        dev_tool=body.dev_tool,
    )
    if body.dry_run:
        return {**_scope(), "evaluation": evaluation, **planned}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = []
    for task in planned.get("tasks") or []:
        created.append(create_task(TaskCreate(**task)))
    out = {**planned, "dry_run": False, "summary": {**planned.get("summary", {}), "created": len(created)}, "items": created, "tasks": created}
    history = {**_scope(), "id": str(uuid4()), "evaluation": evaluation, "created_task_ids": [x.get("id") for x in created if x.get("id")], "created_at": _now()}
    _save("self_heal_task_runs", history)
    return {**_scope(), **out, "evaluation": evaluation}

@router.delete("/self-heal/{policy_id}")
def delete_self_heal(policy_id: str):
    _load_scoped_item("self_heal", policy_id, "policy not found")
    p = _dir("self_heal") / f"{policy_id}.json"
    with project_file_write_scope():
        p.unlink()
    return {**_scope(), "deleted": policy_id}

@router.get("/summary")
def summary():
    pipelines = _load_all("pipelines")
    rca = _load_all("rca")
    runbooks = _load_all("runbooks")
    self_heal = _load_all("self_heal")
    evaluations = _load_all("self_heal_evaluations")[:10]
    actions = _load_all("self_heal_actions")
    alert_sources = _load_all("alert_sources")
    external_alerts = _load_all("external_alerts")
    alert_runs = _load_all("alert_source_runs")
    runbook_evidence = _load_all("runbook_evidence")
    alert_strategy_recommendations = _load_all("alert_strategy_recommendations")
    alert_strategy_comparisons = _load_all("alert_strategy_comparisons")
    alert_slo_predictions = _load_all("alert_slo_predictions")
    alert_slo_escalations = _load_all("alert_slo_escalations")
    alert_strategy_canary_audits = _load_all("alert_strategy_canary_audits")
    ops_strategy_linkages = _load_all("ops_strategy_linkages")
    summary_payload = summarize_ops_health(
        pipelines=pipelines,
        rca=rca,
        runbooks=runbooks,
        self_heal=self_heal,
        evaluations=evaluations,
    )
    summary_payload["self_heal_actions"] = len(actions)
    summary_payload["self_heal_approval_queue"] = sum(1 for item in actions if item.get("state") == "approval_required")
    summary_payload["self_heal_applied_unverified"] = sum(1 for item in actions if item.get("state") == "applied")
    summary_payload["self_heal_rolled_back"] = sum(1 for item in actions if item.get("state") == "rolled_back")
    alert_summary = summarize_alert_sources(alert_sources, external_alerts, alert_runs)
    runbook_version_summary = summarize_runbook_versions(runbooks, _load_all("runbook_versions"))
    alert_noise_summary = summarize_alert_noise_evaluations(_load_all("alert_noise_evaluations"))
    runbook_evidence_summary = summarize_runbook_execution_evidence(runbook_evidence)
    alert_strategy_summary = summarize_alert_strategy_recommendations(alert_strategy_recommendations)
    alert_strategy_compare_summary = summarize_alert_strategy_comparisons(alert_strategy_comparisons)
    alert_slo_summary = summarize_alert_slo_predictions(alert_slo_predictions)
    alert_slo_escalation_summary = summarize_alert_slo_escalations(alert_slo_escalations)
    alert_strategy_canary_summary = summarize_alert_strategy_canary_audits(alert_strategy_canary_audits)
    ops_strategy_linkage_summary = summarize_ops_strategy_linkages(ops_strategy_linkages)
    summary_payload["alert_sources"] = alert_summary["sources"]
    summary_payload["alert_sources_enabled"] = alert_summary["enabled_sources"]
    summary_payload["external_open_alerts"] = alert_summary["open_alerts"]
    summary_payload["external_high_alerts"] = alert_summary["high_alerts"]
    summary_payload["alert_noise_groups"] = alert_noise_summary["latest_groups"]
    summary_payload["alert_noise_actionable_incidents"] = alert_noise_summary["latest_actionable_incidents"]
    summary_payload["alert_noise_reduction_ratio"] = alert_noise_summary["latest_noise_reduction_ratio"]
    summary_payload["alert_strategy_recommendations"] = alert_strategy_summary["recommendations"]
    summary_payload["alert_strategy_applyable"] = alert_strategy_summary["applyable"]
    summary_payload["alert_strategy_comparisons"] = alert_strategy_compare_summary["comparisons"]
    summary_payload["alert_strategy_winner_score_delta"] = alert_strategy_compare_summary["latest_winner_score_delta"]
    summary_payload["alert_slo_risk_targets"] = alert_slo_summary["latest_risk_targets"]
    summary_payload["alert_slo_avg_score"] = alert_slo_summary["latest_avg_slo_score"]
    summary_payload["alert_slo_escalation_runs"] = alert_slo_escalation_summary["runs"]
    summary_payload["alert_slo_escalation_created"] = alert_slo_escalation_summary["latest_created"]
    summary_payload["alert_strategy_canary_audits"] = alert_strategy_canary_summary["audits"]
    summary_payload["alert_strategy_canary_ready"] = alert_strategy_canary_summary["ready"]
    summary_payload["alert_strategy_canary_running"] = alert_strategy_canary_summary["running"]
    summary_payload["ops_strategy_linkage_runs"] = ops_strategy_linkage_summary["runs"]
    summary_payload["ops_strategy_linkage_items"] = ops_strategy_linkage_summary["latest_items"]
    summary_payload["ops_strategy_linkage_high_risk"] = ops_strategy_linkage_summary["latest_high_risk"]
    summary_payload["runbook_versions"] = runbook_version_summary["versions"]
    summary_payload["runbook_version_health_score"] = runbook_version_summary["health_score"]
    summary_payload["runbook_evidence_records"] = runbook_evidence_summary["records"]
    summary_payload["runbook_evidence_coverage_score"] = runbook_evidence_summary["coverage_score"]
    summary_payload["runbook_evidence_missing"] = runbook_evidence_summary["missing_evidence"]
    return {**_scope(), "summary": summary_payload}

@router.post("/im-briefing")
def im_briefing(body: ImBriefingIn):
    pipelines = _load_all("pipelines")
    rca = _load_all("rca")
    runbooks = _load_all("runbooks")
    self_heal = _load_all("self_heal")
    evaluations = _load_all("self_heal_evaluations")[:10]
    summary_payload = summarize_ops_health(
        pipelines=pipelines,
        rca=rca,
        runbooks=runbooks,
        self_heal=self_heal,
        evaluations=evaluations,
    )
    risks = []
    if summary_payload.get("self_heal_needs_approval"):
        risks.append({"level": "critical", "title": "存在需要审批的自愈决策", "recommendation": "请确认生产环境动作边界并完成审批。"})
    if summary_payload.get("pipelines_failed"):
        risks.append({"level": "high", "title": "存在失败流水线", "recommendation": "生成 RCA 并绑定回滚/重启 Runbook。"})
    if summary_payload.get("rca_open"):
        risks.append({"level": "medium", "title": "存在未关闭 RCA", "recommendation": "补齐解决方案并沉淀自愈策略。"})
    if not summary_payload.get("runbooks"):
        risks.append({"level": "medium", "title": "Runbook 为空", "recommendation": "补齐常见故障 Runbook，降低高风险自愈审批成本。"})
    briefing = build_im_briefing(
        module="ops_center",
        title="OpsCenter 智能运维运行简报",
        summary=summary_payload,
        risks=risks,
        recommendations=list(summary_payload.get("recommendations") or []),
        scope=_scope(),
        actions=[
            {"label": "查看智能运维", "href": "#/ops-center"},
            {"label": "评估自愈策略", "api": "/api/v1/ops-center/self-heal/evaluate"},
            {"label": "生成自愈治理任务", "api": "/api/v1/ops-center/self-heal/tasks"},
        ],
    )
    from sop_manager.routers.notify import NotifyMsg, list_channels, send_msg

    event = "approval_required" if summary_payload.get("self_heal_needs_approval") else "ops_center_risk"
    plan = build_im_delivery_plan(briefing, list_channels(), requested_channels=body.channels, event=event)
    if body.dry_run or not plan.get("ready"):
        return {**_scope(), "dry_run": True, "briefing": briefing, "delivery_plan": plan, "sent": []}
    sent = [send_msg(NotifyMsg(**message)) for message in plan.get("messages") or []]
    return {**_scope(), "dry_run": False, "briefing": briefing, "delivery_plan": plan, "sent": sent}
