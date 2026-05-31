"""A2A 协议网关：外部 Agent 注册、能力协商、任务分发、执行证据回写。"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import hashlib
import secrets
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.scope_guard import attach_scope, scope_matches
from sop_manager.routers.a2a_gateway_core import (
    build_a2a_governance_tasks,
    build_protocol_packet,
    evaluate_evidence_quality,
    normalize_capabilities,
    score_agent_match,
    summarize_a2a_health,
)
from sop_manager.routers.im_integration_core import build_im_briefing, build_im_delivery_plan

router = APIRouter(prefix="/api/v1/a2a", tags=["a2a"])
RETRYABLE_DISPATCH_STATUSES = {"failed", "blocked", "cancelled", "retrying"}

def _dir(sub: str):
    d = resolved_ai_memory_root() / "a2a" / sub
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
            item = json.loads(f.read_text())
        except Exception:
            continue
        if isinstance(item, dict) and scope_matches(item, require_business=True):
            items.append(item)
    return sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)

def _save(sub: str, item: dict):
    import json
    attach_scope(item)
    (_dir(sub) / f"{item['id']}.json").write_text(json.dumps(item, ensure_ascii=False, indent=2))

def _load_item(sub: str, item_id: str, *, label: str) -> dict:
    import json
    p = _dir(sub) / f"{item_id}.json"
    if not p.exists():
        raise HTTPException(404, f"{label} not found")
    try:
        item = json.loads(p.read_text())
    except Exception as exc:
        raise HTTPException(404, f"{label} not found") from exc
    if not isinstance(item, dict) or not scope_matches(item, require_business=True):
        raise HTTPException(404, f"{label} not found")
    return item

class AgentRegister(BaseModel):
    name: str
    agent_type: str = "custom"
    endpoint: str = ""
    organization_code: str = ""
    trust_domain: str = ""
    capabilities: list[str] = Field(default_factory=list)

class NegotiateIn(BaseModel):
    task_type: str
    task_description: str = ""
    required_capabilities: list[str] = Field(default_factory=list)
    priority: str = "P1"

class DispatchIn(BaseModel):
    agent_id: str
    task_id: str
    session_id: str = ""
    payload: dict = Field(default_factory=dict)

class EvidenceIn(BaseModel):
    dispatch_id: str
    status: str
    artifact: dict = Field(default_factory=dict)
    confidence: float = 1.0
    quality_gate_results: list[dict] = Field(default_factory=list)

class AgentStatus(BaseModel):
    status: str

class AgentHeartbeatIn(BaseModel):
    credential_token: str
    status: str = "active"
    load: float = 0
    success_rate: float | None = None
    capabilities: list[str] = Field(default_factory=list)
    telemetry: dict = Field(default_factory=dict)

class TrustPolicyIn(BaseModel):
    stale_after_minutes: int = 30
    min_success_rate: float = 0
    max_load: float = 10
    require_endpoint: bool = False
    allowed_agent_types: list[str] = Field(default_factory=list)
    allowed_organization_codes: list[str] = Field(default_factory=list)
    required_capabilities: list[str] = Field(default_factory=list)
    enforce_on_negotiate: bool = True
    enforce_on_dispatch: bool = False
    enforce_on_pull: bool = True

class AgentPullIn(BaseModel):
    credential_token: str
    limit: int = 5
    capabilities: list[str] = Field(default_factory=list)
    lease_seconds: int = 300
    wait_seconds: int = 0

class AgentAckIn(BaseModel):
    credential_token: str
    dispatch_id: str
    lease_id: str
    ack: str = "accepted"
    message: str = ""

class AgentLeaseRenewIn(BaseModel):
    credential_token: str
    dispatch_id: str
    lease_id: str
    extend_seconds: int = 300

class DispatchReassignIn(BaseModel):
    agent_id: str
    reason: str = ""

class AgentProgressIn(BaseModel):
    credential_token: str
    dispatch_id: str
    status: str = "running"
    progress: int = 0
    message: str = ""
    artifact: dict = Field(default_factory=dict)

class GovernanceTasksIn(BaseModel):
    dry_run: bool = True
    assigned_to: str = "Agent Platform"
    dev_tool: str = "codex"

class TrustTasksIn(BaseModel):
    dry_run: bool = True
    assigned_to: str = "Agent Platform"
    dev_tool: str = "codex"

class SlaTasksIn(BaseModel):
    dry_run: bool = True
    assigned_to: str = "Agent Platform"
    dev_tool: str = "codex"

class ExecutionWindowTasksIn(BaseModel):
    dry_run: bool = True
    assigned_to: str = "Agent Platform"
    dev_tool: str = "codex"

class ExecutionWindowActionsIn(BaseModel):
    dry_run: bool = True
    renew_seconds: int = 300
    max_actions: int = 20

class ExecutionWindowPolicyIn(BaseModel):
    stale_after_minutes: int = 15
    due_soon_seconds: int = 300
    max_auto_reassign: int = 1
    action_mode: str = "guarded"
    require_preview_for_high_risk: bool = False
    auto_renew_enabled: bool = True
    auto_reassign_enabled: bool = True
    auto_expire_enabled: bool = True

class SlaPolicyIn(BaseModel):
    default_sla_minutes: int = 30
    due_soon_ratio: float = 0.8
    priority_sla_minutes: dict[str, int] = Field(default_factory=dict)
    auto_retry_enabled: bool = False
    max_auto_retries: int = 1
    im_alert_enabled: bool = True

class SlaEscalationIn(BaseModel):
    dry_run: bool = True
    channels: list[str] = Field(default_factory=list)

class ImBriefingIn(BaseModel):
    channels: list[str] = Field(default_factory=list)
    dry_run: bool = True

def _session_summary(events: list[dict]) -> dict:
    dispatches = sum(1 for event in events if event.get("type") in {"dispatched", "retry_requested"})
    evidence = sum(1 for event in events if event.get("type") == "evidence_received")
    retries = sum(1 for event in events if event.get("type") == "retry_requested")
    return {
        "events": len(events),
        "dispatches": dispatches,
        "evidence": evidence,
        "retries": retries,
        "last_event": events[-1]["type"] if events else "",
    }

def _create_session(task: dict, matches: list[dict]) -> dict:
    session_id = str(uuid4())
    events = [
        {
            "id": str(uuid4()),
            "type": "negotiated",
            "at": _now(),
            "title": "能力协商完成",
            "task_type": task.get("task_type", ""),
            "priority": task.get("priority", ""),
            "required_capabilities": normalize_capabilities(task.get("required_capabilities") or []),
            "candidate_count": len(matches),
            "best_agent_id": matches[0]["agent_id"] if matches else "",
            "matches": matches[:5],
        }
    ]
    session = {
        **_scope(),
        "id": session_id,
        "status": "negotiated",
        "task": task,
        "events": events,
        "summary": _session_summary(events),
        "created_at": _now(),
        "updated_at": _now(),
    }
    attach_scope(session, overwrite=True)
    _save("sessions", session)
    return session

def _append_session_event(session_id: str, event: dict) -> dict | None:
    if not session_id:
        return None
    session = _load_item("sessions", session_id, label="session")
    events = session.get("events") if isinstance(session.get("events"), list) else []
    events.append({"id": str(uuid4()), "at": _now(), **event})
    session["events"] = events
    session["status"] = str(event.get("type") or session.get("status") or "active")
    session["summary"] = _session_summary(events)
    session["updated_at"] = _now()
    _save("sessions", session)
    return session

def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)

def _default_sla_policy() -> dict:
    return {
        **_scope(),
        "id": "policy",
        "default_sla_minutes": 30,
        "due_soon_ratio": 0.8,
        "priority_sla_minutes": {"P0": 15, "P1": 30, "P2": 60, "P3": 120},
        "auto_retry_enabled": False,
        "max_auto_retries": 1,
        "im_alert_enabled": True,
        "updated_at": "",
    }

def _normalize_sla_policy(policy: dict) -> dict:
    base = _default_sla_policy()
    base.update(policy if isinstance(policy, dict) else {})
    try:
        base["default_sla_minutes"] = max(5, min(int(base.get("default_sla_minutes") or 30), 24 * 60))
    except Exception:
        base["default_sla_minutes"] = 30
    try:
        base["due_soon_ratio"] = max(0.1, min(float(base.get("due_soon_ratio") or 0.8), 0.95))
    except Exception:
        base["due_soon_ratio"] = 0.8
    normalized: dict[str, int] = {}
    raw_priorities = base.get("priority_sla_minutes") if isinstance(base.get("priority_sla_minutes"), dict) else {}
    for key, value in raw_priorities.items():
        try:
            minutes = max(5, min(int(value), 24 * 60))
        except Exception:
            continue
        normalized[str(key).upper()] = minutes
    base["priority_sla_minutes"] = normalized
    try:
        base["max_auto_retries"] = max(0, min(int(base.get("max_auto_retries") or 0), 5))
    except Exception:
        base["max_auto_retries"] = 1
    base["auto_retry_enabled"] = bool(base.get("auto_retry_enabled"))
    base["im_alert_enabled"] = bool(base.get("im_alert_enabled"))
    attach_scope(base, overwrite=True)
    return base

def _load_sla_policy() -> dict:
    try:
        item = _load_item("sla_policy", "policy", label="sla policy")
    except HTTPException:
        return _default_sla_policy()
    return _normalize_sla_policy(item)

def _default_execution_window_policy() -> dict:
    return {
        **_scope(),
        "id": "policy",
        "stale_after_minutes": 15,
        "due_soon_seconds": 300,
        "max_auto_reassign": 1,
        "action_mode": "guarded",
        "require_preview_for_high_risk": False,
        "auto_renew_enabled": True,
        "auto_reassign_enabled": True,
        "auto_expire_enabled": True,
        "updated_at": "",
    }

def _normalize_execution_window_policy(policy: dict | None) -> dict:
    base = _default_execution_window_policy()
    base.update(policy if isinstance(policy, dict) else {})
    try:
        base["stale_after_minutes"] = max(1, min(int(base.get("stale_after_minutes") or 15), 24 * 60))
    except Exception:
        base["stale_after_minutes"] = 15
    try:
        base["due_soon_seconds"] = max(30, min(int(base.get("due_soon_seconds") or 300), 24 * 60 * 60))
    except Exception:
        base["due_soon_seconds"] = 300
    try:
        base["max_auto_reassign"] = max(0, min(int(base.get("max_auto_reassign") or 0), 10))
    except Exception:
        base["max_auto_reassign"] = 1
    if base.get("action_mode") not in {"preview", "guarded", "automatic"}:
        base["action_mode"] = "guarded"
    for key in ["require_preview_for_high_risk", "auto_renew_enabled", "auto_reassign_enabled", "auto_expire_enabled"]:
        base[key] = bool(base.get(key))
    attach_scope(base, overwrite=True)
    return base

def _load_execution_window_policy() -> dict:
    try:
        item = _load_item("execution_window_policy", "policy", label="execution window policy")
    except HTTPException:
        return _default_execution_window_policy()
    return _normalize_execution_window_policy(item)

def _default_trust_policy() -> dict:
    return {
        **_scope(),
        "id": "policy",
        "stale_after_minutes": 30,
        "min_success_rate": 0,
        "max_load": 10,
        "require_endpoint": False,
        "allowed_agent_types": [],
        "allowed_organization_codes": [],
        "required_capabilities": [],
        "enforce_on_negotiate": True,
        "enforce_on_dispatch": False,
        "enforce_on_pull": True,
        "updated_at": "",
    }

def _clean_str_list(values: list | None, *, capabilities: bool = False) -> list[str]:
    if not values:
        return []
    if capabilities:
        return normalize_capabilities(values)
    seen: set[str] = set()
    cleaned: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        cleaned.append(text)
    return cleaned

def _normalize_trust_policy(policy: dict | None) -> dict:
    base = _default_trust_policy()
    base.update(policy if isinstance(policy, dict) else {})
    try:
        base["stale_after_minutes"] = max(5, min(int(base.get("stale_after_minutes") or 30), 24 * 60))
    except Exception:
        base["stale_after_minutes"] = 30
    try:
        base["min_success_rate"] = max(0.0, min(float(base.get("min_success_rate") or 0), 1.0))
    except Exception:
        base["min_success_rate"] = 0
    try:
        base["max_load"] = max(0.0, min(float(base.get("max_load") or 10), 100.0))
    except Exception:
        base["max_load"] = 10
    base["allowed_agent_types"] = _clean_str_list(base.get("allowed_agent_types") if isinstance(base.get("allowed_agent_types"), list) else [])
    base["allowed_organization_codes"] = _clean_str_list(base.get("allowed_organization_codes") if isinstance(base.get("allowed_organization_codes"), list) else [])
    base["required_capabilities"] = _clean_str_list(base.get("required_capabilities") if isinstance(base.get("required_capabilities"), list) else [], capabilities=True)
    for key in ["require_endpoint", "enforce_on_negotiate", "enforce_on_dispatch", "enforce_on_pull"]:
        base[key] = bool(base.get(key))
    attach_scope(base, overwrite=True)
    return base

def _load_trust_policy() -> dict:
    try:
        item = _load_item("trust_policy", "policy", label="trust policy")
    except HTTPException:
        return _default_trust_policy()
    return _normalize_trust_policy(item)

def _sla_minutes(dispatch: dict, policy: dict | None = None) -> int:
    active_policy = _normalize_sla_policy(policy or _load_sla_policy())
    payload = dispatch.get("payload") if isinstance(dispatch.get("payload"), dict) else {}
    priority = str(dispatch.get("priority") or payload.get("priority") or "").upper()
    raw = dispatch.get("sla_minutes") or payload.get("sla_minutes") or active_policy.get("priority_sla_minutes", {}).get(priority) or active_policy.get("default_sla_minutes") or 30
    try:
        minutes = int(raw)
    except Exception:
        minutes = int(active_policy.get("default_sla_minutes") or 30)
    return max(5, min(minutes, 24 * 60))

def _dispatch_sla_item(dispatch: dict, now_dt: datetime, policy: dict | None = None) -> dict:
    active_policy = _normalize_sla_policy(policy or _load_sla_policy())
    dispatched_at = _parse_dt(str(dispatch.get("dispatched_at") or "")) or now_dt
    evidence_at = _parse_dt(str(dispatch.get("evidence_at") or "")) if dispatch.get("evidence_at") else None
    sla_minutes = _sla_minutes(dispatch, active_policy)
    deadline = dispatched_at.timestamp() + sla_minutes * 60
    elapsed_seconds = ((evidence_at or now_dt) - dispatched_at).total_seconds()
    elapsed_minutes = max(0, int(elapsed_seconds // 60))
    minutes_overdue = max(0, int(((evidence_at or now_dt).timestamp() - deadline) // 60))
    status = str(dispatch.get("status") or "").lower()

    if evidence_at:
        sla_status = "met" if minutes_overdue == 0 else "breached"
    elif minutes_overdue > 0:
        sla_status = "overdue"
    elif elapsed_minutes >= int(sla_minutes * float(active_policy.get("due_soon_ratio") or 0.8)):
        sla_status = "due_soon"
    else:
        sla_status = "ok"
    if status in {"failed", "blocked", "cancelled"} and not evidence_at:
        sla_status = "breached" if minutes_overdue > 0 else "due_soon"

    risk_level = "low"
    if sla_status in {"overdue", "breached"}:
        risk_level = "high"
    elif sla_status == "due_soon":
        risk_level = "medium"
    return {
        "dispatch_id": dispatch.get("id", ""),
        "agent_id": dispatch.get("agent_id", ""),
        "agent_run_id": dispatch.get("agent_run_id", ""),
        "task_id": dispatch.get("task_id", ""),
        "session_id": dispatch.get("session_id", ""),
        "status": dispatch.get("status", ""),
        "sla_status": sla_status,
        "risk_level": risk_level,
        "sla_minutes": sla_minutes,
        "elapsed_minutes": elapsed_minutes,
        "minutes_overdue": minutes_overdue,
        "dispatched_at": dispatch.get("dispatched_at", ""),
        "evidence_at": dispatch.get("evidence_at", ""),
        "missing_evidence": not bool(dispatch.get("evidence_at")),
    }

def _build_sla_report(now: str = "") -> dict:
    now_dt = _parse_dt(now) or datetime.now(timezone.utc)
    policy = _load_sla_policy()
    items = [_dispatch_sla_item(dispatch, now_dt, policy) for dispatch in _load_all("dispatches")]
    total = len(items)
    overdue = sum(1 for item in items if item["sla_status"] == "overdue")
    breached = sum(1 for item in items if item["sla_status"] == "breached")
    due_soon = sum(1 for item in items if item["sla_status"] == "due_soon")
    met = sum(1 for item in items if item["sla_status"] == "met")
    missing_evidence = sum(1 for item in items if item["missing_evidence"])
    health = max(0, 100 - overdue * 24 - breached * 18 - due_soon * 8)
    risks = []
    if overdue:
        risks.append({"level": "high", "title": "存在 A2A 分发证据超时", "recommendation": "追踪外部 Agent 执行状态，必要时重试分发或切换 Agent。", "count": overdue})
    if due_soon:
        risks.append({"level": "medium", "title": "存在即将超时的 A2A 分发", "recommendation": "提醒外部 Agent 回写证据，避免任务进入超时治理。", "count": due_soon})
    if missing_evidence and not overdue:
        risks.append({"level": "low", "title": "存在待证据回写分发", "recommendation": "保持证据回写观察，确保 Agent Run 可追溯。", "count": missing_evidence})
    return {
        **_scope(),
        "summary": {
            "total": total,
            "met": met,
            "due_soon": due_soon,
            "overdue": overdue,
            "breached": breached,
            "missing_evidence": missing_evidence,
            "health_score": health,
        },
        "items": sorted(items, key=lambda item: (item["risk_level"] != "high", -item["minutes_overdue"], item["dispatch_id"])),
        "risks": risks,
        "policy": {**policy, "source": "dispatch.payload.sla_minutes > priority_sla_minutes > default_sla_minutes"},
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 判断 A2A 外部执行是否超时、是否需要重试或生成治理任务",
            "apis": ["/api/v1/a2a/sla", "/api/v1/a2a/sla/tasks", "/api/v1/a2a/dispatch/{id}/retry"],
            "task_source": "a2a_sla_governance",
        },
    }

def _build_sla_tasks(report: dict, *, assigned_to: str, dev_tool: str) -> list[dict]:
    priority_by_status = {"overdue": "P0", "breached": "P1", "due_soon": "P1"}
    tasks = []
    for item in report.get("items") or []:
        sla_status = str(item.get("sla_status") or "")
        if sla_status not in priority_by_status:
            continue
        tasks.append(
            {
                "title": f"A2A SLA 治理：{item.get('task_id') or item.get('dispatch_id')}",
                "description": "\n".join(
                    [
                        f"Dispatch：{item.get('dispatch_id')}",
                        f"Agent Run：{item.get('agent_run_id') or '-'}",
                        f"Session：{item.get('session_id') or '-'}",
                        f"SLA 状态：{sla_status}",
                        f"已耗时：{item.get('elapsed_minutes')} 分钟，超时：{item.get('minutes_overdue')} 分钟",
                        "建议：追踪外部 Agent 状态，补齐 evidence，必要时通过 A2A retry 重新分发。",
                    ]
                ),
                "priority": priority_by_status[sla_status],
                "estimate": "S" if sla_status == "due_soon" else "M",
                "assigned_to": assigned_to,
                "dev_tool": dev_tool,
                "source": "a2a_sla_governance",
                "source_report_id": str(item.get("dispatch_id") or ""),
                "source_report_title": f"A2A SLA {sla_status}",
            }
        )
    return tasks

def _candidate_agent_ids(dispatch: dict, agents: list[dict]) -> list[str]:
    payload = dispatch.get("payload") if isinstance(dispatch.get("payload"), dict) else {}
    required = set(normalize_capabilities(payload.get("required_capabilities") or []))
    candidates: list[str] = []
    for agent in agents:
        if agent.get("id") == dispatch.get("agent_id") or agent.get("status") not in {"active", ""}:
            continue
        capabilities = set(normalize_capabilities(agent.get("capabilities") or []))
        if required and not required.issubset(capabilities):
            continue
        candidates.append(str(agent.get("id") or ""))
    return [item for item in candidates if item]

def _execution_window_item(dispatch: dict, agents: list[dict], now_dt: datetime, *, stale_after_minutes: int, due_soon_seconds: int) -> dict:
    status = str(dispatch.get("status") or "")
    ack_status = str(dispatch.get("ack_status") or "")
    lease_expires_at = _parse_dt(str(dispatch.get("lease_expires_at") or ""))
    last_progress_at = _parse_dt(str(dispatch.get("last_progress_at") or ""))
    progress = dispatch.get("progress") if isinstance(dispatch.get("progress"), dict) else {}
    minutes_to_lease_expiry = None
    seconds_to_lease_expiry = None
    if lease_expires_at:
        seconds_to_lease_expiry = int((lease_expires_at - now_dt).total_seconds())
        minutes_to_lease_expiry = int(seconds_to_lease_expiry // 60)
    progress_idle_minutes = None
    if last_progress_at:
        progress_idle_minutes = max(0, int((now_dt - last_progress_at).total_seconds() // 60))

    window_status = "ok"
    risk_level = "low"
    recommended_action = "observe"
    if status in {"blocked", "failed", "cancelled"} or ack_status == "rejected":
        window_status = "blocked"
        risk_level = "high"
        recommended_action = "reassign"
    elif lease_expires_at and lease_expires_at < now_dt and ack_status in {"pending", ""}:
        window_status = "lease_expired"
        risk_level = "high"
        recommended_action = "expire_or_reassign"
    elif progress_idle_minutes is not None and progress_idle_minutes >= stale_after_minutes and status == "running":
        window_status = "progress_stale"
        risk_level = "high"
        recommended_action = "renew_or_reassign"
    elif seconds_to_lease_expiry is not None and seconds_to_lease_expiry <= due_soon_seconds and ack_status in {"pending", "accepted"}:
        window_status = "lease_due_soon"
        risk_level = "medium"
        recommended_action = "renew"

    return {
        "dispatch_id": dispatch.get("id", ""),
        "task_id": dispatch.get("task_id", ""),
        "agent_id": dispatch.get("agent_id", ""),
        "agent_run_id": dispatch.get("agent_run_id", ""),
        "session_id": dispatch.get("session_id", ""),
        "status": status,
        "ack_status": ack_status,
        "lease_id": dispatch.get("lease_id", ""),
        "lease_expires_at": dispatch.get("lease_expires_at", ""),
        "minutes_to_lease_expiry": minutes_to_lease_expiry,
        "seconds_to_lease_expiry": seconds_to_lease_expiry,
        "progress": progress,
        "last_progress_at": dispatch.get("last_progress_at", ""),
        "progress_idle_minutes": progress_idle_minutes,
        "window_status": window_status,
        "risk_level": risk_level,
        "recommended_action": recommended_action,
        "candidate_agent_ids": _candidate_agent_ids(dispatch, agents),
        "reassign_dispatch_id": dispatch.get("reassign_dispatch_id", ""),
        "retry_dispatch_id": dispatch.get("retry_dispatch_id", ""),
        "auto_reassign_count": int(dispatch.get("auto_reassign_count") or 0),
    }

def _build_execution_windows(now: str = "", *, stale_after_minutes: int | None = None, policy: dict | None = None) -> dict:
    now_dt = _parse_dt(now) or datetime.now(timezone.utc)
    active_policy = _normalize_execution_window_policy(policy or _load_execution_window_policy())
    if stale_after_minutes is not None and int(stale_after_minutes or 0) > 0:
        active_policy["stale_after_minutes"] = max(1, min(int(stale_after_minutes or 15), 24 * 60))
    stale_limit = int(active_policy.get("stale_after_minutes") or 15)
    due_soon_seconds = int(active_policy.get("due_soon_seconds") or 300)
    agents = _load_all("registry")
    dispatches = [
        item for item in _load_all("dispatches")
        if not item.get("evidence_at") and str(item.get("status") or "") in {"claimed", "running", "blocked", "failed", "cancelled"}
    ]
    items = [
        _execution_window_item(dispatch, agents, now_dt, stale_after_minutes=stale_limit, due_soon_seconds=due_soon_seconds)
        for dispatch in dispatches
    ]
    expired = sum(1 for item in items if item["window_status"] == "lease_expired")
    stale = sum(1 for item in items if item["window_status"] == "progress_stale")
    blocked = sum(1 for item in items if item["window_status"] == "blocked")
    due_soon = sum(1 for item in items if item["window_status"] == "lease_due_soon")
    high = sum(1 for item in items if item["risk_level"] == "high")
    medium = sum(1 for item in items if item["risk_level"] == "medium")
    health = max(0, 100 - high * 25 - medium * 10)
    risks = []
    if expired:
        risks.append({"level": "high", "title": "存在过期未回收 A2A 租约", "count": expired, "recommendation": "回收过期租约或重派给备用 Agent。"})
    if stale:
        risks.append({"level": "high", "title": "存在进度停滞的外部 Agent 执行", "count": stale, "recommendation": "要求续报进度，必要时续租或重派。"})
    if blocked:
        risks.append({"level": "high", "title": "存在拒绝/阻塞的 A2A 分发", "count": blocked, "recommendation": "优先重派给具备能力的备用 Agent。"})
    if due_soon:
        risks.append({"level": "medium", "title": "存在即将到期的 A2A 租约", "count": due_soon, "recommendation": "确认 Agent 仍在执行并及时续租。"})
    priority = {"high": 0, "medium": 1, "low": 2}
    return {
        **_scope(),
        "summary": {
            "total": len(items),
            "expired_leases": expired,
            "stale_progress": stale,
            "blocked": blocked,
            "due_soon": due_soon,
            "healthy": sum(1 for item in items if item["window_status"] == "ok"),
            "health_score": health,
            "stale_after_minutes": stale_limit,
            "due_soon_seconds": due_soon_seconds,
        },
        "policy": active_policy,
        "items": sorted(items, key=lambda item: (priority.get(item["risk_level"], 9), item["task_id"], item["dispatch_id"])),
        "risks": risks,
        "agent_consumption": {
            "purpose": "供运维、调度器和 AI Agent 审计外部 Agent 执行窗口，识别租约、进度和重派风险",
            "apis": ["/api/v1/a2a/execution-windows", "/api/v1/a2a/execution-windows/policy", "/api/v1/a2a/execution-windows/tasks", "/api/v1/a2a/execution-windows/actions", "/api/v1/a2a/registry/{id}/tasks/renew", "/api/v1/a2a/dispatch/{id}/reassign"],
            "task_source": "a2a_execution_window_governance",
        },
    }

def _build_execution_window_tasks(report: dict, *, assigned_to: str, dev_tool: str) -> list[dict]:
    tasks = []
    for item in report.get("items") or []:
        if item.get("risk_level") not in {"high", "medium"}:
            continue
        priority = "P0" if item.get("risk_level") == "high" else "P1"
        tasks.append(
            {
                "title": f"A2A 执行窗口治理：{item.get('task_id') or item.get('dispatch_id')}",
                "description": "\n".join(
                    [
                        f"Dispatch：{item.get('dispatch_id')}",
                        f"Agent Run：{item.get('agent_run_id') or '-'}",
                        f"Session：{item.get('session_id') or '-'}",
                        f"窗口状态：{item.get('window_status')}，建议动作：{item.get('recommended_action')}",
                        f"租约到期：{item.get('lease_expires_at') or '-'}，进度停滞：{item.get('progress_idle_minutes') if item.get('progress_idle_minutes') is not None else '-'} 分钟",
                        f"候选备用 Agent：{', '.join(item.get('candidate_agent_ids') or []) or '-'}",
                    ]
                ),
                "priority": priority,
                "estimate": "S" if priority == "P1" else "M",
                "assigned_to": assigned_to,
                "dev_tool": dev_tool,
                "source": "a2a_execution_window_governance",
                "source_report_id": str(item.get("dispatch_id") or ""),
                "source_report_title": f"A2A execution window {item.get('window_status')}",
            }
        )
    return tasks

def _build_trust_tasks(report: dict, *, assigned_to: str, dev_tool: str) -> list[dict]:
    tasks: list[dict] = []
    for item in report.get("items") or []:
        decision = item.get("trust_decision") if isinstance(item.get("trust_decision"), dict) else {}
        matched_rules = [str(rule) for rule in decision.get("matched_rules") or [] if rule]
        heartbeat_status = str(item.get("heartbeat_status") or "")
        if not matched_rules and heartbeat_status not in {"stale", "never_seen"}:
            continue
        priority = "P0" if matched_rules else "P1"
        tasks.append(
            {
                "title": f"A2A 跨组织信任治理：{item.get('name') or item.get('id')}",
                "description": "\n".join(
                    [
                        f"Agent：{item.get('id')}",
                        f"组织：{item.get('organization_code') or '-'}，类型：{item.get('agent_type') or '-'}",
                        f"Endpoint：{item.get('endpoint') or '-'}",
                        f"心跳：{heartbeat_status}，滞后：{item.get('heartbeat_lag_minutes') if item.get('heartbeat_lag_minutes') is not None else '-'} 分钟",
                        f"策略决策：{decision.get('decision') or '-'}",
                        f"命中规则：{', '.join(matched_rules) or '-'}",
                    ]
                ),
                "priority": priority,
                "estimate": "M" if priority == "P0" else "S",
                "assigned_to": assigned_to,
                "dev_tool": dev_tool,
                "source": "a2a_trust_policy_governance",
                "source_report_id": str(item.get("id") or ""),
                "source_report_title": f"A2A trust {decision.get('decision') or heartbeat_status}",
            }
        )
    return tasks

def _execution_window_policy_decision(action: dict, policy: dict) -> dict:
    action_type = str(action.get("action") or "")
    risk_level = str(action.get("risk_level") or "")
    mode = str(policy.get("action_mode") or "guarded")
    if action_type == "reassign":
        if not policy.get("auto_reassign_enabled"):
            return {"allowed": False, "decision": "auto_reassign_disabled", "reason": "执行窗口策略未开启自动重派。"}
        if int(action.get("auto_reassign_count") or 0) >= int(policy.get("max_auto_reassign") or 0):
            return {"allowed": False, "decision": "max_reassign_reached", "reason": "已达到执行窗口自动重派上限。"}
    elif action_type == "renew_lease" and not policy.get("auto_renew_enabled"):
        return {"allowed": False, "decision": "auto_renew_disabled", "reason": "执行窗口策略未开启自动续租。"}
    elif action_type == "expire_lease" and not policy.get("auto_expire_enabled"):
        return {"allowed": False, "decision": "auto_expire_disabled", "reason": "执行窗口策略未开启自动回收租约。"}

    if mode == "preview":
        return {"allowed": False, "decision": "preview_required", "reason": "当前为预览模式，需人工确认后执行。"}
    if risk_level == "high" and policy.get("require_preview_for_high_risk") and mode != "automatic":
        return {"allowed": False, "decision": "preview_required", "reason": "高风险执行窗口动作需要先预览并人工确认。"}
    return {"allowed": True, "decision": f"{mode}_allowed", "reason": "执行窗口策略允许该动作。"}

def _build_execution_window_actions(report: dict, *, renew_seconds: int, max_actions: int, policy: dict | None = None) -> list[dict]:
    actions: list[dict] = []
    capped = max(1, min(int(max_actions or 20), 100))
    active_policy = _normalize_execution_window_policy(policy or report.get("policy") or _load_execution_window_policy())
    for item in report.get("items") or []:
        if len(actions) >= capped:
            break
        window_status = str(item.get("window_status") or "")
        if item.get("risk_level") not in {"high", "medium"}:
            continue
        base = {
            "dispatch_id": item.get("dispatch_id", ""),
            "agent_id": item.get("agent_id", ""),
            "agent_run_id": item.get("agent_run_id", ""),
            "session_id": item.get("session_id", ""),
            "task_id": item.get("task_id", ""),
            "window_status": window_status,
            "risk_level": item.get("risk_level", ""),
            "reason": item.get("recommended_action", ""),
            "auto_reassign_count": int(item.get("auto_reassign_count") or 0),
        }
        candidates = [str(candidate) for candidate in item.get("candidate_agent_ids") or [] if candidate]
        if window_status == "blocked" and candidates:
            action = {**base, "action": "reassign", "target_agent_id": candidates[0], "candidate_agent_ids": candidates}
        elif window_status in {"lease_due_soon", "progress_stale"} and item.get("lease_id"):
            action = {**base, "action": "renew_lease", "lease_id": item.get("lease_id", ""), "extend_seconds": _lease_seconds(renew_seconds)}
        elif window_status == "lease_expired" and item.get("lease_id"):
            action = {**base, "action": "expire_lease", "lease_id": item.get("lease_id", "")}
        else:
            continue
        decision = _execution_window_policy_decision(action, active_policy)
        actions.append(
            {
                **action,
                "allowed": bool(decision.get("allowed")),
                "block_reason": "" if decision.get("allowed") else str(decision.get("reason") or ""),
                "policy_decision": {k: v for k, v in decision.items() if k != "allowed"},
            }
        )
    return actions

def _build_sla_escalation_actions(report: dict, policy: dict) -> list[dict]:
    actions: list[dict] = []
    for item in report.get("items") or []:
        if item.get("sla_status") not in {"overdue", "breached"}:
            continue
        retry_count = 0
        try:
            dispatch = _load_item("dispatches", str(item.get("dispatch_id") or ""), label="dispatch")
            retry_count = int(dispatch.get("retry_count") or 0)
        except Exception:
            dispatch = {}
        if policy.get("auto_retry_enabled") and retry_count < int(policy.get("max_auto_retries") or 0):
            actions.append({
                "action": "auto_retry",
                "dispatch_id": item.get("dispatch_id"),
                "agent_run_id": item.get("agent_run_id"),
                "session_id": item.get("session_id"),
                "sla_status": item.get("sla_status"),
                "risk_level": item.get("risk_level"),
                "reason": "A2A 分发已超出 SLA 且未达到自动重试上限。",
            })
        if policy.get("im_alert_enabled"):
            actions.append({
                "action": "im_alert",
                "dispatch_id": item.get("dispatch_id"),
                "agent_run_id": item.get("agent_run_id"),
                "session_id": item.get("session_id"),
                "sla_status": item.get("sla_status"),
                "risk_level": item.get("risk_level"),
                "reason": "通知运维与 Agent 平台关注 A2A SLA 风险。",
            })
    return actions

def _hash_token(token: str) -> str:
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()

def _new_credential() -> tuple[str, str, str]:
    token = f"a2a_{secrets.token_urlsafe(32)}"
    credential_id = str(uuid4())
    return credential_id, token, _hash_token(token)

def _public_agent(agent: dict, *, credential_token: str = "") -> dict:
    item = {key: value for key, value in agent.items() if key not in {"credential_hash", "credential_token"}}
    item["credential_status"] = "trusted" if agent.get("credential_hash") else "missing"
    if credential_token:
        item["credential_token"] = credential_token
        item["token_preview"] = f"{credential_token[:8]}...{credential_token[-4:]}"
    elif agent.get("credential_id"):
        item["token_preview"] = "stored"
    return item

def _verify_agent_token(agent: dict, token: str):
    if not agent.get("credential_hash") or _hash_token(token) != agent.get("credential_hash"):
        raise HTTPException(401, "invalid A2A agent credential")

def _heartbeat_lag_minutes(agent: dict, now_dt: datetime) -> int | None:
    if int(agent.get("heartbeat_count") or 0) <= 0:
        return None
    last = _parse_dt(str(agent.get("last_heartbeat_at") or ""))
    if not last:
        return None
    return max(0, int((now_dt - last).total_seconds() // 60))

def _evaluate_agent_trust(agent: dict, policy: dict, now_dt: datetime) -> dict:
    active_policy = _normalize_trust_policy(policy)
    matched: list[str] = []
    warnings: list[str] = []
    lag = _heartbeat_lag_minutes(agent, now_dt)
    capabilities = set(normalize_capabilities(agent.get("capabilities") or []))
    required = set(active_policy.get("required_capabilities") or [])
    if not agent.get("credential_hash"):
        matched.append("credential_missing")
    if lag is None:
        warnings.append("heartbeat_never_seen")
    elif lag > int(active_policy.get("stale_after_minutes") or 30):
        warnings.append("heartbeat_stale")
    if active_policy.get("require_endpoint") and not str(agent.get("endpoint") or "").strip():
        matched.append("endpoint_required")
    allowed_types = set(str(item) for item in active_policy.get("allowed_agent_types") or [])
    if allowed_types and str(agent.get("agent_type") or "") not in allowed_types:
        matched.append("agent_type_not_allowed")
    allowed_orgs = set(str(item) for item in active_policy.get("allowed_organization_codes") or [])
    if allowed_orgs and str(agent.get("organization_code") or "") not in allowed_orgs:
        matched.append("organization_not_allowed")
    if required and not required.issubset(capabilities):
        matched.append("missing_required_capability")
    try:
        success_rate = float(agent.get("success_rate") if agent.get("success_rate") is not None else 0)
    except Exception:
        success_rate = 0
    if success_rate < float(active_policy.get("min_success_rate") or 0):
        matched.append("success_rate_below_min")
    try:
        load = float(agent.get("load") or 0)
    except Exception:
        load = 0
    if load > float(active_policy.get("max_load") or 10):
        matched.append("load_above_max")
    if str(agent.get("status") or "active") != "active":
        warnings.append("agent_not_active")
    decision = "deny" if matched else "allow"
    return {
        "decision": decision,
        "allowed": decision == "allow",
        "matched_rules": matched,
        "warnings": warnings,
        "reason": "符合 A2A 跨组织信任策略。" if decision == "allow" else "未通过 A2A 跨组织信任策略。",
    }

def _ensure_agent_trusted(agent: dict, *, operation: str, now_dt: datetime | None = None):
    policy = _load_trust_policy()
    enforce_key = f"enforce_on_{operation}"
    if not policy.get(enforce_key, False):
        return
    decision = _evaluate_agent_trust(agent, policy, now_dt or datetime.now(timezone.utc))
    if not decision.get("allowed"):
        raise HTTPException(403, f"blocked by A2A trust policy: {', '.join(decision.get('matched_rules') or [])}")

def _task_packet(dispatch: dict, agent: dict) -> dict:
    packet = dispatch.get("protocol_packet") if isinstance(dispatch.get("protocol_packet"), dict) else build_protocol_packet(dispatch, agent, _scope())
    return {
        "dispatch_id": dispatch.get("id", ""),
        "task_id": dispatch.get("task_id", ""),
        "agent_run_id": dispatch.get("agent_run_id", ""),
        "session_id": dispatch.get("session_id", ""),
        "status": dispatch.get("status", ""),
        "payload": dispatch.get("payload") if isinstance(dispatch.get("payload"), dict) else {},
        "protocol_packet": packet,
        "claimed_at": dispatch.get("claimed_at", ""),
        "lease_id": dispatch.get("lease_id", ""),
        "lease_owner_agent_id": dispatch.get("lease_owner_agent_id", ""),
        "lease_expires_at": dispatch.get("lease_expires_at", ""),
        "ack_status": dispatch.get("ack_status", ""),
        "progress": dispatch.get("progress") if isinstance(dispatch.get("progress"), dict) else {},
    }

def _lease_seconds(value: int | None) -> int:
    try:
        seconds = int(value or 300)
    except Exception:
        seconds = 300
    return max(30, min(seconds, 3600))

def _assign_lease(dispatch: dict, agent: dict, *, now_dt: datetime, lease_seconds: int) -> dict:
    now = now_dt.isoformat()
    expires_at = (now_dt + timedelta(seconds=lease_seconds)).isoformat()
    dispatch["status"] = "claimed"
    dispatch["claimed_at"] = dispatch.get("claimed_at") or now
    dispatch["lease_id"] = str(uuid4())
    dispatch["lease_owner_agent_id"] = agent.get("id", "")
    dispatch["lease_seconds"] = lease_seconds
    dispatch["lease_expires_at"] = expires_at
    dispatch["ack_status"] = "pending"
    dispatch["pull_count"] = int(dispatch.get("pull_count") or 0) + 1
    dispatch["protocol_packet"] = dispatch.get("protocol_packet") if isinstance(dispatch.get("protocol_packet"), dict) else build_protocol_packet(dispatch, agent, _scope())
    return dispatch

def _collect_pull_items(agent_id: str, agent: dict, body: AgentPullIn, now_dt: datetime) -> list[dict]:
    requested_caps = set(normalize_capabilities(body.capabilities))
    items = []
    limit = max(1, min(int(body.limit or 5), 50))
    lease_seconds = _lease_seconds(body.lease_seconds)
    for dispatch in _load_all("dispatches"):
        if len(items) >= limit:
            break
        if dispatch.get("agent_id") != agent_id:
            continue
        if dispatch.get("evidence_at"):
            continue
        if str(dispatch.get("status") or "") not in {"dispatched", "claimed", "running"}:
            continue
        payload = dispatch.get("payload") if isinstance(dispatch.get("payload"), dict) else {}
        required = set(normalize_capabilities(payload.get("required_capabilities") or []))
        if requested_caps and required and not required.issubset(requested_caps | set(normalize_capabilities(agent.get("capabilities") or []))):
            continue
        has_active_pending_lease = (
            dispatch.get("lease_id")
            and dispatch.get("ack_status") == "pending"
            and (_parse_dt(str(dispatch.get("lease_expires_at") or "")) or now_dt) >= now_dt
        )
        if str(dispatch.get("status") or "") == "dispatched" or not dispatch.get("lease_id"):
            dispatch = _assign_lease(dispatch, agent, now_dt=now_dt, lease_seconds=lease_seconds)
            _save("dispatches", dispatch)
            _append_session_event(
                str(dispatch.get("session_id") or ""),
                {
                    "type": "task_pulled",
                    "title": "外部 Agent 已拉取任务",
                    "dispatch_id": dispatch.get("id", ""),
                    "agent_run_id": dispatch.get("agent_run_id", ""),
                    "agent_id": agent_id,
                    "status": "claimed",
                    "lease_id": dispatch.get("lease_id", ""),
                    "lease_expires_at": dispatch.get("lease_expires_at", ""),
                },
            )
        elif not has_active_pending_lease and dispatch.get("ack_status") == "expired":
            dispatch = _assign_lease(dispatch, agent, now_dt=now_dt, lease_seconds=lease_seconds)
            _save("dispatches", dispatch)
        items.append(_task_packet(dispatch, agent))
    return items

@router.get("/registry")
def list_registry(agent_type: str = ""):
    items = _load_all("registry")
    if agent_type:
        items = [i for i in items if i.get("agent_type") == agent_type]
    return {**_scope(), "items": [_public_agent(item) for item in items], "total": len(items)}

@router.post("/registry")
def register_agent(body: AgentRegister):
    payload = body.model_dump()
    payload["capabilities"] = normalize_capabilities(payload.get("capabilities") or [])
    credential_id, token, token_hash = _new_credential()
    item = {**_scope(), "id": str(uuid4()), **payload,
            "status": "active", "success_rate": 0.8, "load": 0,
            "credential_id": credential_id, "credential_hash": token_hash,
            "credential_issued_at": _now(), "heartbeat_count": 0,
            "last_heartbeat_at": _now(), "created_at": _now()}
    attach_scope(item, overwrite=True)
    _save("registry", item)
    return _public_agent(item, credential_token=token)

@router.put("/registry/{agent_id}")
def update_agent(agent_id: str, body: AgentRegister):
    item = _load_item("registry", agent_id, label="agent")
    payload = body.model_dump()
    payload["capabilities"] = normalize_capabilities(payload.get("capabilities") or [])
    item.update(payload)
    _save("registry", item)
    return _public_agent(item)

@router.delete("/registry/{agent_id}")
def deregister_agent(agent_id: str):
    p = _dir("registry") / f"{agent_id}.json"
    _load_item("registry", agent_id, label="agent")
    p.unlink()
    return {**_scope(), "deleted": agent_id}

@router.put("/registry/{agent_id}/status")
def update_agent_status(agent_id: str, body: AgentStatus):
    item = _load_item("registry", agent_id, label="agent")
    item.update({"status": body.status, "last_heartbeat_at": _now() if body.status == "active" else item.get("last_heartbeat_at")})
    _save("registry", item)
    return _public_agent(item)

@router.post("/registry/{agent_id}/credentials/rotate")
def rotate_agent_credential(agent_id: str):
    item = _load_item("registry", agent_id, label="agent")
    credential_id, token, token_hash = _new_credential()
    item.update({"credential_id": credential_id, "credential_hash": token_hash, "credential_issued_at": _now()})
    _save("registry", item)
    return _public_agent(item, credential_token=token)

@router.get("/trust/policy")
def get_trust_policy():
    return _load_trust_policy()

@router.put("/trust/policy")
def update_trust_policy(body: TrustPolicyIn):
    policy = _normalize_trust_policy({**body.model_dump(), "id": "policy", "updated_at": _now()})
    _save("trust_policy", policy)
    return policy

@router.post("/registry/{agent_id}/heartbeat")
def agent_heartbeat(agent_id: str, body: AgentHeartbeatIn):
    item = _load_item("registry", agent_id, label="agent")
    _verify_agent_token(item, body.credential_token)
    item["status"] = body.status or "active"
    item["load"] = max(0.0, float(body.load or 0))
    if body.success_rate is not None:
        item["success_rate"] = max(0.0, min(float(body.success_rate), 1.0))
    if body.capabilities:
        item["capabilities"] = normalize_capabilities(body.capabilities)
    item["telemetry"] = body.telemetry if isinstance(body.telemetry, dict) else {}
    item["last_heartbeat_at"] = _now()
    item["last_seen_at"] = item["last_heartbeat_at"]
    item["heartbeat_count"] = int(item.get("heartbeat_count") or 0) + 1
    _save("registry", item)
    return _public_agent(item)

@router.post("/registry/{agent_id}/tasks/pull")
def agent_pull_tasks(agent_id: str, body: AgentPullIn):
    agent = _load_item("registry", agent_id, label="agent")
    _verify_agent_token(agent, body.credential_token)
    started_dt = datetime.now(timezone.utc)
    now_dt = datetime.now(timezone.utc)
    _ensure_agent_trusted(agent, operation="pull", now_dt=now_dt)
    now = now_dt.isoformat()
    agent["last_pull_at"] = now
    agent["last_seen_at"] = now
    _save("registry", agent)

    wait_seconds = max(0, min(int(body.wait_seconds or 0), 30))
    items = _collect_pull_items(agent_id, agent, body, now_dt)
    if not items and wait_seconds:
        import time

        deadline = started_dt + timedelta(seconds=wait_seconds)
        while not items:
            current_dt = datetime.now(timezone.utc)
            remaining = (deadline - current_dt).total_seconds()
            if remaining <= 0:
                break
            time.sleep(min(1, remaining))
            items = _collect_pull_items(agent_id, agent, body, datetime.now(timezone.utc))
    waited_seconds = max(0, int((datetime.now(timezone.utc) - started_dt).total_seconds()))
    return {
        **_scope(),
        "agent_id": agent_id,
        "items": items,
        "total": len(items),
        "long_poll": wait_seconds > 0,
        "wait_seconds": wait_seconds,
        "waited_seconds": waited_seconds,
        "agent_consumption": {
            "purpose": "供可信外部 Agent 主动拉取已分发任务、获取协议包并通过租约确认避免重复领取",
            "apis": ["/api/v1/a2a/registry/{id}/tasks/pull", "/api/v1/a2a/registry/{id}/tasks/ack", "/api/v1/a2a/registry/{id}/progress", "/api/v1/a2a/evidence"],
            "ack_api": "/api/v1/a2a/registry/{id}/tasks/ack",
        },
    }

@router.post("/registry/{agent_id}/tasks/ack")
def agent_ack_task(agent_id: str, body: AgentAckIn):
    agent = _load_item("registry", agent_id, label="agent")
    _verify_agent_token(agent, body.credential_token)
    dispatch = _load_item("dispatches", body.dispatch_id, label="dispatch")
    if dispatch.get("agent_id") != agent_id:
        raise HTTPException(404, "dispatch not found")
    if not dispatch.get("lease_id") or dispatch.get("lease_id") != body.lease_id:
        raise HTTPException(409, "lease id mismatch")
    now_dt = datetime.now(timezone.utc)
    expires_at = _parse_dt(str(dispatch.get("lease_expires_at") or ""))
    if expires_at and expires_at < now_dt:
        raise HTTPException(409, "lease expired")

    ack = str(body.ack or "accepted").lower()
    if ack not in {"accepted", "rejected"}:
        raise HTTPException(400, "ack must be accepted or rejected")
    now = now_dt.isoformat()
    dispatch["ack_status"] = ack
    dispatch["acked_at"] = now
    dispatch["ack_message"] = body.message
    dispatch["status"] = "running" if ack == "accepted" else "blocked"
    _save("dispatches", dispatch)

    agent["last_seen_at"] = now
    agent["last_ack_at"] = now
    _save("registry", agent)

    if dispatch.get("agent_run_id"):
        from sop_manager.routers.agent_runs import StatusUpdate, update_status, _save_run

        run_status = "running" if ack == "accepted" else "failed"
        run = update_status(
            str(dispatch["agent_run_id"]),
            StatusUpdate(status=run_status, error_msg="" if ack == "accepted" else body.message or "A2A task rejected"),
        )
        meta = run.get("meta") if isinstance(run.get("meta"), dict) else {}
        meta["a2a_ack"] = {
            "ack_status": ack,
            "lease_id": body.lease_id,
            "acked_at": now,
            "message": body.message,
        }
        run["meta"] = meta
        _save_run(run)

    _append_session_event(
        str(dispatch.get("session_id") or ""),
        {
            "type": "task_acknowledged",
            "title": "外部 Agent 已确认任务租约",
            "dispatch_id": body.dispatch_id,
            "agent_run_id": dispatch.get("agent_run_id", ""),
            "agent_id": agent_id,
            "status": dispatch["status"],
            "ack_status": ack,
            "lease_id": body.lease_id,
        },
    )
    return {
        **_scope(),
        "dispatch_id": body.dispatch_id,
        "agent_run_id": dispatch.get("agent_run_id", ""),
        "agent_id": agent_id,
        "lease_id": body.lease_id,
        "ack_status": ack,
        "status": dispatch["status"],
        "acked_at": now,
    }

def _renew_dispatch_lease(
    dispatch: dict,
    *,
    agent: dict | None = None,
    extend_seconds: int = 300,
    now_dt: datetime | None = None,
    actor: str = "agent",
) -> dict:
    active_now = now_dt or datetime.now(timezone.utc)
    extend = _lease_seconds(extend_seconds)
    current_expires = _parse_dt(str(dispatch.get("lease_expires_at") or ""))
    base_dt = current_expires if current_expires and current_expires > active_now else active_now
    new_expires_at = (base_dt + timedelta(seconds=extend)).isoformat()
    now = active_now.isoformat()
    dispatch["lease_expires_at"] = new_expires_at
    dispatch["lease_renewed_at"] = now
    dispatch["renew_count"] = int(dispatch.get("renew_count") or 0) + 1
    _save("dispatches", dispatch)

    if agent:
        agent["last_seen_at"] = now
        agent["last_renew_at"] = now
        _save("registry", agent)

    if dispatch.get("agent_run_id"):
        from sop_manager.routers.agent_runs import _load_run, _save_run

        try:
            run = _load_run(str(dispatch["agent_run_id"]))
            meta = run.get("meta") if isinstance(run.get("meta"), dict) else {}
            meta["a2a_lease"] = {
                "lease_id": dispatch.get("lease_id", ""),
                "lease_expires_at": new_expires_at,
                "renew_count": dispatch["renew_count"],
                "renewed_at": now,
                "actor": actor,
            }
            run["meta"] = meta
            _save_run(run)
        except Exception:
            pass

    _append_session_event(
        str(dispatch.get("session_id") or ""),
        {
            "type": "lease_renewed",
            "title": "外部 Agent 已续租任务" if actor == "agent" else "A2A 执行窗口已自动续租",
            "dispatch_id": dispatch.get("id", ""),
            "agent_run_id": dispatch.get("agent_run_id", ""),
            "agent_id": dispatch.get("agent_id", ""),
            "lease_id": dispatch.get("lease_id", ""),
            "lease_expires_at": new_expires_at,
            "renew_count": dispatch["renew_count"],
            "actor": actor,
        },
    )
    return {
        **_scope(),
        "dispatch_id": dispatch.get("id", ""),
        "agent_run_id": dispatch.get("agent_run_id", ""),
        "agent_id": dispatch.get("agent_id", ""),
        "lease_id": dispatch.get("lease_id", ""),
        "lease_expires_at": new_expires_at,
        "renew_count": dispatch["renew_count"],
    }

@router.post("/registry/{agent_id}/tasks/renew")
def agent_renew_lease(agent_id: str, body: AgentLeaseRenewIn):
    agent = _load_item("registry", agent_id, label="agent")
    _verify_agent_token(agent, body.credential_token)
    dispatch = _load_item("dispatches", body.dispatch_id, label="dispatch")
    if dispatch.get("agent_id") != agent_id:
        raise HTTPException(404, "dispatch not found")
    if not dispatch.get("lease_id") or dispatch.get("lease_id") != body.lease_id:
        raise HTTPException(409, "lease id mismatch")
    if dispatch.get("ack_status") not in {"pending", "accepted"}:
        raise HTTPException(409, "lease is not renewable")
    now_dt = datetime.now(timezone.utc)
    current_expires = _parse_dt(str(dispatch.get("lease_expires_at") or ""))
    if current_expires and current_expires < now_dt:
        raise HTTPException(409, "lease expired")
    return _renew_dispatch_lease(dispatch, agent=agent, extend_seconds=body.extend_seconds, now_dt=now_dt, actor="agent")

def _expire_dispatch_lease(dispatch: dict, *, now_dt: datetime) -> dict:
    previous = {
        "lease_id": dispatch.get("lease_id", ""),
        "agent_id": dispatch.get("lease_owner_agent_id") or dispatch.get("agent_id", ""),
        "lease_expires_at": dispatch.get("lease_expires_at", ""),
        "expired_at": now_dt.isoformat(),
        "ack_status": dispatch.get("ack_status", ""),
    }
    history = dispatch.get("lease_history") if isinstance(dispatch.get("lease_history"), list) else []
    history.append(previous)
    dispatch["lease_history"] = history
    dispatch["previous_lease_id"] = previous["lease_id"]
    dispatch["lease_id"] = ""
    dispatch["lease_owner_agent_id"] = ""
    dispatch["lease_expires_at"] = ""
    dispatch["ack_status"] = "expired"
    dispatch["status"] = "dispatched"
    dispatch["updated_at"] = now_dt.isoformat()
    _save("dispatches", dispatch)
    _append_session_event(
        str(dispatch.get("session_id") or ""),
        {
            "type": "lease_expired",
            "title": "A2A 任务租约已过期并回收",
            "dispatch_id": dispatch.get("id", ""),
            "agent_run_id": dispatch.get("agent_run_id", ""),
            "agent_id": dispatch.get("agent_id", ""),
            "previous_lease_id": previous["lease_id"],
        },
    )
    return {
        "dispatch_id": dispatch.get("id", ""),
        "agent_id": dispatch.get("agent_id", ""),
        "agent_run_id": dispatch.get("agent_run_id", ""),
        "previous_lease_id": previous["lease_id"],
        "lease_expires_at": previous["lease_expires_at"],
    }

@router.post("/leases/expire")
def expire_leases(now: str = ""):
    now_dt = _parse_dt(now) or datetime.now(timezone.utc)
    expired: list[dict] = []
    for dispatch in _load_all("dispatches"):
        if dispatch.get("evidence_at"):
            continue
        if dispatch.get("ack_status") != "pending" or not dispatch.get("lease_id"):
            continue
        if str(dispatch.get("status") or "") not in {"claimed", "running"}:
            continue
        lease_expires_at = _parse_dt(str(dispatch.get("lease_expires_at") or ""))
        if not lease_expires_at or lease_expires_at >= now_dt:
            continue
        expired.append(_expire_dispatch_lease(dispatch, now_dt=now_dt))
    return {
        **_scope(),
        "expired": len(expired),
        "items": expired,
        "agent_consumption": {
            "purpose": "供运维或调度器回收未确认的 A2A 任务租约，使任务可再次被可信 Agent 拉取",
            "expire_api": "/api/v1/a2a/leases/expire",
            "pull_api": "/api/v1/a2a/registry/{id}/tasks/pull",
        },
    }

@router.post("/registry/{agent_id}/progress")
def agent_progress(agent_id: str, body: AgentProgressIn):
    agent = _load_item("registry", agent_id, label="agent")
    _verify_agent_token(agent, body.credential_token)
    dispatch = _load_item("dispatches", body.dispatch_id, label="dispatch")
    if dispatch.get("agent_id") != agent_id:
        raise HTTPException(404, "dispatch not found")
    now = _now()
    status = str(body.status or "running")
    dispatch["status"] = status
    dispatch["progress"] = {
        "status": status,
        "progress": max(0, min(int(body.progress or 0), 100)),
        "message": body.message,
        "artifact": body.artifact if isinstance(body.artifact, dict) else {},
        "reported_at": now,
    }
    dispatch["last_progress_at"] = now
    if not dispatch.get("claimed_at"):
        dispatch["claimed_at"] = now
    _save("dispatches", dispatch)
    agent["last_seen_at"] = now
    agent["last_progress_at"] = now
    _save("registry", agent)

    if dispatch.get("agent_run_id"):
        from sop_manager.routers.agent_runs import StatusUpdate, update_status

        run_status = "failed" if status in {"failed", "blocked"} else "success" if status == "success" else "running"
        run = update_status(
            str(dispatch["agent_run_id"]),
            StatusUpdate(status=run_status, error_msg="" if run_status in {"running", "success"} else body.message),
        )
        meta = run.get("meta") if isinstance(run.get("meta"), dict) else {}
        meta["a2a_progress"] = dispatch["progress"]
        run["meta"] = meta
        from sop_manager.routers.agent_runs import _save_run

        _save_run(run)
    _append_session_event(
        str(dispatch.get("session_id") or ""),
        {
            "type": "progress_reported",
            "title": "外部 Agent 已上报进度",
            "dispatch_id": body.dispatch_id,
            "agent_run_id": dispatch.get("agent_run_id", ""),
            "agent_id": agent_id,
            "status": status,
            "progress": dispatch["progress"],
        },
    )
    return {**_scope(), "dispatch_id": body.dispatch_id, "agent_run_id": dispatch.get("agent_run_id", ""), "progress": dispatch["progress"], "status": status}

@router.get("/trust")
def agent_trust_report(now: str = "", stale_after_minutes: int = 0):
    now_dt = _parse_dt(now) or datetime.now(timezone.utc)
    policy = _load_trust_policy()
    if stale_after_minutes > 0:
        policy = _normalize_trust_policy({**policy, "stale_after_minutes": stale_after_minutes})
    stale_limit = int(policy.get("stale_after_minutes") or 30)
    agents = _load_all("registry")
    items = []
    for agent in agents:
        lag = _heartbeat_lag_minutes(agent, now_dt)
        heartbeat_status = "never_seen" if lag is None else "stale" if lag > stale_limit else "fresh"
        trust_decision = _evaluate_agent_trust(agent, policy, now_dt)
        public = _public_agent(agent)
        public.update(
            {
                "heartbeat_status": heartbeat_status,
                "heartbeat_lag_minutes": lag,
                "stale_after_minutes": stale_limit,
                "trust_decision": trust_decision,
                "eligible_for_dispatch": bool(trust_decision.get("allowed")),
            }
        )
        items.append(public)
    trusted = [item for item in items if item.get("credential_status") == "trusted"]
    stale = [item for item in items if item.get("heartbeat_status") in {"stale", "never_seen"}]
    policy_blocked = [item for item in items if not item.get("eligible_for_dispatch")]
    risks = []
    if stale:
        risks.append({"level": "high", "title": "存在心跳掉线 A2A Agent", "recommendation": "检查外部 Agent 进程、网络和凭证状态。", "count": len(stale)})
    if len(trusted) < len(items):
        risks.append({"level": "medium", "title": "存在未配置可信凭证 Agent", "recommendation": "轮换或补发 A2A Agent 凭证。", "count": len(items) - len(trusted)})
    if policy_blocked:
        risks.append({"level": "high", "title": "存在未通过跨组织信任策略 Agent", "recommendation": "检查组织代码、端点、能力、成功率和负载阈值。", "count": len(policy_blocked)})
    return {
        **_scope(),
        "summary": {
            "agents": len(items),
            "trusted_agents": len(trusted),
            "stale_agents": len(stale),
            "fresh_agents": len(items) - len(stale),
            "policy_allowed_agents": len(items) - len(policy_blocked),
            "policy_blocked_agents": len(policy_blocked),
            "health_score": max(0, 100 - len(stale) * 25 - (len(items) - len(trusted)) * 15 - len(policy_blocked) * 20),
        },
        "policy": policy,
        "items": items,
        "risks": risks,
        "agent_consumption": {
            "purpose": "供外部 Agent 与 AI CLI 校验 A2A 接入凭证、心跳新鲜度和可信状态",
            "apis": ["/api/v1/a2a/registry/{id}/heartbeat", "/api/v1/a2a/registry/{id}/credentials/rotate", "/api/v1/a2a/trust", "/api/v1/a2a/trust/policy"],
            "task_source": "a2a_agent_trust_governance",
        },
    }

@router.post("/trust/tasks")
def trust_tasks(body: TrustTasksIn, now: str = ""):
    report = agent_trust_report(now=now)
    drafts = _build_trust_tasks(report, assigned_to=body.assigned_to or "Agent Platform", dev_tool=body.dev_tool or "codex")
    if body.dry_run:
        return {**_scope(), "dry_run": True, "policy": report.get("policy"), "summary": report["summary"], "items": drafts, "created": []}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = []
    for draft in drafts:
        created.append(create_task(TaskCreate(**draft)))
    return {**_scope(), "dry_run": False, "policy": report.get("policy"), "summary": report["summary"], "items": drafts, "created": created}

@router.post("/negotiate")
def negotiate(body: NegotiateIn):
    agents = _load_all("registry")
    policy = _load_trust_policy()
    now_dt = datetime.now(timezone.utc)
    matches = []
    task = body.model_dump()
    for a in agents:
        if policy.get("enforce_on_negotiate", True) and not _evaluate_agent_trust(a, policy, now_dt).get("allowed"):
            continue
        result = score_agent_match(a, task)
        if result["confidence"] > 0.05:
            matches.append(result)
    matches.sort(key=lambda x: x["confidence"], reverse=True)
    session = _create_session(task, matches)
    return {
        **_scope(),
        "session_id": session["id"],
        "task_type": body.task_type,
        "required_capabilities": normalize_capabilities(body.required_capabilities),
        "matches": matches[:5],
        "best_match": matches[0] if matches else None,
        "recommendation": "可直接分发给推荐 Agent" if matches and matches[0].get("decision") == "recommended" else "建议人工复核能力缺口后再分发",
    }

@router.post("/dispatch")
def dispatch_task(body: DispatchIn):
    agent = _load_item("registry", body.agent_id, label="agent")
    _ensure_agent_trusted(agent, operation="dispatch")
    dispatch_id = str(uuid4())
    from sop_manager.routers.agent_runs import RunCreate, StatusUpdate, create_run, update_status

    session_id = body.session_id or str((body.payload or {}).get("session_id") or "")
    run = create_run(
        RunCreate(
            agent_id=body.agent_id,
            task_id=body.task_id,
            meta={
                "source": "a2a_dispatch",
                "dispatch_id": dispatch_id,
                "session_id": session_id,
                "agent_type": agent.get("agent_type") or "custom",
                "payload_title": (body.payload or {}).get("title", ""),
            },
        )
    )
    run = update_status(run["id"], StatusUpdate(status="running"))
    item = {**_scope(), "id": dispatch_id, "agent_id": body.agent_id, "task_id": body.task_id,
            "agent_run_id": run["id"], "session_id": session_id, "payload": body.payload, "status": "dispatched", "dispatched_at": _now()}
    attach_scope(item, overwrite=True)
    item["protocol_packet"] = build_protocol_packet(item, agent, _scope())
    _save("dispatches", item)
    _append_session_event(
        session_id,
        {
            "type": "dispatched",
            "title": "任务已分发",
            "dispatch_id": dispatch_id,
            "agent_run_id": run["id"],
            "agent_id": body.agent_id,
            "task_id": body.task_id,
        },
    )
    return item

@router.get("/dispatch/{dispatch_id}/packet")
def dispatch_packet(dispatch_id: str):
    dispatch = _load_item("dispatches", dispatch_id, label="dispatch")
    agent_path = _dir("registry") / f"{dispatch.get('agent_id')}.json"
    if agent_path.exists():
        try:
            agent = _load_item("registry", str(dispatch.get("agent_id") or ""), label="agent")
        except HTTPException:
            agent = {"id": dispatch.get("agent_id")}
    else:
        agent = {"id": dispatch.get("agent_id")}
    packet = dispatch.get("protocol_packet") or build_protocol_packet(dispatch, agent, _scope())
    return {**_scope(), "packet": packet}

@router.post("/dispatch/{dispatch_id}/retry")
def retry_dispatch(dispatch_id: str):
    original = _load_item("dispatches", dispatch_id, label="dispatch")
    status = str(original.get("status") or "").lower()
    if status not in RETRYABLE_DISPATCH_STATUSES:
        raise HTTPException(400, "only failed/blocked/cancelled/retrying dispatches can be retried")
    agent = _load_item("registry", str(original.get("agent_id") or ""), label="agent")
    retry_id = str(uuid4())
    retry_count = int(original.get("retry_count") or 0) + 1

    from sop_manager.routers.agent_runs import RunCreate, StatusUpdate, create_run, update_status

    run = create_run(
        RunCreate(
            agent_id=str(original.get("agent_id") or ""),
            task_id=str(original.get("task_id") or ""),
            meta={
                "source": "a2a_dispatch_retry",
                "dispatch_id": retry_id,
                "session_id": original.get("session_id", ""),
                "retry_of_dispatch_id": original.get("id"),
                "retry_of_agent_run_id": original.get("agent_run_id"),
                "retry_count": retry_count,
                "agent_type": agent.get("agent_type") or "custom",
                "payload_title": (original.get("payload") if isinstance(original.get("payload"), dict) else {}).get("title", ""),
            },
        )
    )
    run = update_status(run["id"], StatusUpdate(status="running"))

    original.update(
        {
            "status": "retrying",
            "retry_count": retry_count,
            "retry_dispatch_id": retry_id,
            "retry_requested_at": _now(),
        }
    )
    _save("dispatches", original)

    retry = {
        **_scope(),
        "id": retry_id,
        "agent_id": original.get("agent_id"),
        "task_id": original.get("task_id"),
        "agent_run_id": run["id"],
        "session_id": original.get("session_id", ""),
        "payload": original.get("payload") if isinstance(original.get("payload"), dict) else {},
        "status": "dispatched",
        "dispatched_at": _now(),
        "retry_of_dispatch_id": original.get("id"),
        "retry_of_agent_run_id": original.get("agent_run_id"),
        "retry_count": retry_count,
        "previous_status": status,
        "previous_evidence_quality": original.get("evidence_quality") if isinstance(original.get("evidence_quality"), dict) else {},
    }
    attach_scope(retry, overwrite=True)
    retry["protocol_packet"] = build_protocol_packet(retry, agent, _scope())
    _save("dispatches", retry)
    _append_session_event(
        str(original.get("session_id") or ""),
        {
            "type": "retry_requested",
            "title": "失败分发已重试",
            "dispatch_id": retry_id,
            "retry_of_dispatch_id": original.get("id"),
            "agent_run_id": run["id"],
            "retry_count": retry_count,
        },
    )
    return retry

@router.post("/dispatch/{dispatch_id}/reassign")
def reassign_dispatch(dispatch_id: str, body: DispatchReassignIn):
    original = _load_item("dispatches", dispatch_id, label="dispatch")
    status = str(original.get("status") or "").lower()
    if status not in {"blocked", "failed", "cancelled", "reassigned"}:
        raise HTTPException(400, "only blocked/failed/cancelled/reassigned dispatches can be reassigned")
    if body.agent_id == original.get("agent_id"):
        raise HTTPException(400, "target agent must be different")
    agent = _load_item("registry", body.agent_id, label="agent")
    reassign_id = str(uuid4())
    reassign_count = int(original.get("reassign_count") or 0) + 1

    from sop_manager.routers.agent_runs import RunCreate, StatusUpdate, create_run, update_status

    run = create_run(
        RunCreate(
            agent_id=body.agent_id,
            task_id=str(original.get("task_id") or ""),
            meta={
                "source": "a2a_dispatch_reassign",
                "dispatch_id": reassign_id,
                "session_id": original.get("session_id", ""),
                "reassign_of_dispatch_id": original.get("id"),
                "previous_agent_id": original.get("agent_id"),
                "previous_agent_run_id": original.get("agent_run_id"),
                "reassign_count": reassign_count,
                "reassign_reason": body.reason,
                "agent_type": agent.get("agent_type") or "custom",
                "payload_title": (original.get("payload") if isinstance(original.get("payload"), dict) else {}).get("title", ""),
            },
        )
    )
    run = update_status(run["id"], StatusUpdate(status="running"))

    original.update(
        {
            "status": "reassigned",
            "reassign_count": reassign_count,
            "reassign_dispatch_id": reassign_id,
            "reassign_requested_at": _now(),
            "reassign_reason": body.reason,
            "lease_id": "",
            "lease_owner_agent_id": "",
            "lease_expires_at": "",
            "ack_status": "reassigned",
        }
    )
    _save("dispatches", original)

    reassigned = {
        **_scope(),
        "id": reassign_id,
        "agent_id": body.agent_id,
        "task_id": original.get("task_id"),
        "agent_run_id": run["id"],
        "session_id": original.get("session_id", ""),
        "payload": original.get("payload") if isinstance(original.get("payload"), dict) else {},
        "status": "dispatched",
        "dispatched_at": _now(),
        "reassign_of_dispatch_id": original.get("id"),
        "previous_agent_id": original.get("agent_id"),
        "previous_agent_run_id": original.get("agent_run_id"),
        "reassign_count": reassign_count,
        "reassign_reason": body.reason,
        "previous_status": status,
    }
    attach_scope(reassigned, overwrite=True)
    reassigned["protocol_packet"] = build_protocol_packet(reassigned, agent, _scope())
    _save("dispatches", reassigned)
    _append_session_event(
        str(original.get("session_id") or ""),
        {
            "type": "task_reassigned",
            "title": "A2A 任务已重新分派",
            "dispatch_id": reassign_id,
            "reassign_of_dispatch_id": original.get("id"),
            "previous_agent_id": original.get("agent_id"),
            "agent_id": body.agent_id,
            "agent_run_id": run["id"],
            "reason": body.reason,
        },
    )
    return reassigned

@router.get("/dispatch")
def list_dispatches(agent_id: str = "", status: str = ""):
    items = _load_all("dispatches")
    if agent_id:
        items = [i for i in items if i.get("agent_id") == agent_id]
    if status:
        items = [i for i in items if i.get("status") == status]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/evidence")
def receive_evidence(body: EvidenceIn):
    dispatch = _load_item("dispatches", body.dispatch_id, label="dispatch")
    evidence = body.model_dump()
    quality = evaluate_evidence_quality(evidence)
    dispatch.update({"status": body.status, "artifact": body.artifact,
                     "confidence": body.confidence, "quality_gate_results": body.quality_gate_results,
                     "evidence_quality": quality, "evidence_at": _now()})
    _save("dispatches", dispatch)
    _append_session_event(
        str(dispatch.get("session_id") or ""),
        {
            "type": "evidence_received",
            "title": "执行证据已回写",
            "dispatch_id": body.dispatch_id,
            "agent_run_id": dispatch.get("agent_run_id", ""),
            "status": body.status,
            "confidence": body.confidence,
            "evidence_quality": quality,
        },
    )
    if dispatch.get("agent_run_id"):
        from sop_manager.routers.agent_runs import EvidenceIn as RunEvidenceIn
        from sop_manager.routers.agent_runs import StatusUpdate, update_status, write_evidence

        gate_results = {
            "a2a_dispatch_id": body.dispatch_id,
            "a2a_status": body.status,
            "a2a_quality_gates": body.quality_gate_results,
            "evidence_quality": quality,
        }
        write_evidence(
            str(dispatch["agent_run_id"]),
            RunEvidenceIn(artifact=body.artifact, gate_results=gate_results, confidence=body.confidence),
        )
        status = str(body.status or "").lower()
        if status in {"success", "cancelled"}:
            run_status = status
        elif status in {"failed", "blocked"}:
            run_status = "failed"
        else:
            run_status = "running"
        update_status(
            str(dispatch["agent_run_id"]),
            StatusUpdate(status=run_status, error_msg="" if run_status == "success" else f"A2A evidence status: {body.status}"),
        )
    return dispatch

@router.get("/evidence")
def list_evidence(agent_id: str = ""):
    items = [d for d in _load_all("dispatches") if d.get("evidence_at")]
    if agent_id:
        items = [i for i in items if i.get("agent_id") == agent_id]
    return {**_scope(), "items": items, "total": len(items)}

@router.get("/sessions")
def list_sessions(limit: int = 100):
    items = _load_all("sessions")
    return {**_scope(), "items": items[:limit], "total": len(items)}

@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    return _load_item("sessions", session_id, label="session")

@router.get("/summary")
def summary():
    registry = _load_all("registry")
    dispatches = _load_all("dispatches")
    return {**_scope(), "summary": summarize_a2a_health(registry, dispatches)}

@router.get("/health")
def health():
    registry = _load_all("registry")
    dispatches = _load_all("dispatches")
    summary = summarize_a2a_health(registry, dispatches)
    return {
        **_scope(),
        "summary": summary,
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 判断 A2A 网关是否适合接入、协商和分发任务",
            "apis": ["/api/v1/a2a/registry", "/api/v1/a2a/negotiate", "/api/v1/a2a/dispatch", "/api/v1/a2a/evidence"],
            "task_source": "a2a_protocol_governance",
        },
    }

@router.get("/sla")
def sla_report(now: str = ""):
    return _build_sla_report(now=now)

@router.get("/sla/policy")
def get_sla_policy():
    return _load_sla_policy()

@router.put("/sla/policy")
def update_sla_policy(body: SlaPolicyIn):
    policy = _normalize_sla_policy({**body.model_dump(), "id": "policy", "updated_at": _now()})
    _save("sla_policy", policy)
    return policy

@router.get("/execution-windows/policy")
def get_execution_window_policy():
    return _load_execution_window_policy()

@router.put("/execution-windows/policy")
def update_execution_window_policy(body: ExecutionWindowPolicyIn):
    policy = _normalize_execution_window_policy({**body.model_dump(), "id": "policy", "updated_at": _now()})
    _save("execution_window_policy", policy)
    return policy

@router.post("/sla/tasks")
def sla_tasks(body: SlaTasksIn, now: str = ""):
    report = _build_sla_report(now=now)
    drafts = _build_sla_tasks(report, assigned_to=body.assigned_to or "Agent Platform", dev_tool=body.dev_tool or "codex")
    if body.dry_run:
        return {**_scope(), "dry_run": True, "summary": report["summary"], "items": drafts, "created": []}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = []
    for draft in drafts:
        created.append(create_task(TaskCreate(**draft)))
    return {**_scope(), "dry_run": False, "summary": report["summary"], "items": drafts, "created": created}

@router.get("/execution-windows")
def execution_windows(now: str = "", stale_after_minutes: int = 0):
    override = stale_after_minutes if stale_after_minutes > 0 else None
    return _build_execution_windows(now=now, stale_after_minutes=override)

@router.post("/execution-windows/tasks")
def execution_window_tasks(body: ExecutionWindowTasksIn, now: str = "", stale_after_minutes: int = 0):
    override = stale_after_minutes if stale_after_minutes > 0 else None
    report = _build_execution_windows(now=now, stale_after_minutes=override)
    drafts = _build_execution_window_tasks(report, assigned_to=body.assigned_to or "Agent Platform", dev_tool=body.dev_tool or "codex")
    if body.dry_run:
        return {**_scope(), "dry_run": True, "summary": report["summary"], "policy": report.get("policy"), "items": drafts, "created": []}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created = []
    for draft in drafts:
        created.append(create_task(TaskCreate(**draft)))
    return {**_scope(), "dry_run": False, "summary": report["summary"], "policy": report.get("policy"), "items": drafts, "created": created}

@router.post("/execution-windows/actions")
def execution_window_actions(body: ExecutionWindowActionsIn, now: str = "", stale_after_minutes: int = 0):
    now_dt = _parse_dt(now) or datetime.now(timezone.utc)
    policy = _load_execution_window_policy()
    override = stale_after_minutes if stale_after_minutes > 0 else None
    report = _build_execution_windows(now=now, stale_after_minutes=override, policy=policy)
    actions = _build_execution_window_actions(report, renew_seconds=body.renew_seconds, max_actions=body.max_actions, policy=policy)
    blocked = [action for action in actions if not action.get("allowed")]
    consumption = {
        "purpose": "供运维控制面和 AI Agent 对 A2A 执行窗口风险执行保守自动治理动作",
        "apis": ["/api/v1/a2a/execution-windows/policy", "/api/v1/a2a/execution-windows/actions", "/api/v1/a2a/registry/{id}/tasks/renew", "/api/v1/a2a/leases/expire", "/api/v1/a2a/dispatch/{id}/reassign"],
        "action_source": "a2a_execution_window_auto_actions",
    }
    if body.dry_run:
        return {**_scope(), "dry_run": True, "policy": policy, "summary": report["summary"], "actions": actions, "blocked": blocked, "applied": [], "agent_consumption": consumption}

    applied: list[dict] = []
    for action in actions:
        if not action.get("allowed"):
            continue
        action_type = str(action.get("action") or "")
        dispatch_id = str(action.get("dispatch_id") or "")
        if action_type == "renew_lease":
            dispatch = _load_item("dispatches", dispatch_id, label="dispatch")
            if not dispatch.get("lease_id") or dispatch.get("lease_id") != action.get("lease_id"):
                continue
            result = _renew_dispatch_lease(
                dispatch,
                extend_seconds=int(action.get("extend_seconds") or body.renew_seconds),
                now_dt=now_dt,
                actor="execution_window_auto",
            )
            applied.append({**action, "result": result})
        elif action_type == "expire_lease":
            dispatch = _load_item("dispatches", dispatch_id, label="dispatch")
            lease_expires_at = _parse_dt(str(dispatch.get("lease_expires_at") or ""))
            if not dispatch.get("lease_id") or not lease_expires_at or lease_expires_at >= now_dt:
                continue
            applied.append({**action, "result": _expire_dispatch_lease(dispatch, now_dt=now_dt)})
        elif action_type == "reassign":
            target_agent_id = str(action.get("target_agent_id") or "")
            if not target_agent_id:
                continue
            original = _load_item("dispatches", dispatch_id, label="dispatch")
            original["auto_reassign_count"] = int(original.get("auto_reassign_count") or 0) + 1
            _save("dispatches", original)
            result = reassign_dispatch(
                dispatch_id,
                DispatchReassignIn(agent_id=target_agent_id, reason=f"execution window auto action: {action.get('reason') or action.get('window_status')}"),
            )
            applied.append({**action, "result_dispatch_id": result.get("id", ""), "result": result})
    return {**_scope(), "dry_run": False, "policy": policy, "summary": report["summary"], "actions": actions, "blocked": blocked, "applied": applied, "agent_consumption": consumption}

@router.post("/sla/escalations")
def sla_escalations(body: SlaEscalationIn, now: str = ""):
    policy = _load_sla_policy()
    report = _build_sla_report(now=now)
    actions = _build_sla_escalation_actions(report, policy)
    if body.dry_run:
        return {**_scope(), "dry_run": True, "policy": policy, "summary": report["summary"], "actions": actions, "applied": []}

    applied: list[dict] = []
    for action in actions:
        if action.get("action") == "auto_retry":
            dispatch_id = str(action.get("dispatch_id") or "")
            dispatch = _load_item("dispatches", dispatch_id, label="dispatch")
            dispatch["status"] = "blocked"
            dispatch["sla_escalation"] = {
                "level": action.get("sla_status"),
                "action": "auto_retry",
                "at": _now(),
                "reason": action.get("reason"),
            }
            _save("dispatches", dispatch)
            _append_session_event(
                str(dispatch.get("session_id") or ""),
                {
                    "type": "sla_escalated",
                    "title": "SLA 超时已升级",
                    "dispatch_id": dispatch_id,
                    "agent_run_id": dispatch.get("agent_run_id", ""),
                    "sla_status": action.get("sla_status"),
                    "action": "auto_retry",
                },
            )
            retry = retry_dispatch(dispatch_id)
            applied.append({**action, "retry_dispatch_id": retry.get("id", "")})
        elif action.get("action") == "im_alert":
            applied.append({**action, "delivery": "planned"})
    return {**_scope(), "dry_run": False, "policy": policy, "summary": report["summary"], "actions": actions, "applied": applied}

@router.post("/governance-tasks")
def governance_tasks(body: GovernanceTasksIn):
    summary = summarize_a2a_health(_load_all("registry"), _load_all("dispatches"))
    drafts = build_a2a_governance_tasks(summary)
    for draft in drafts:
        draft["assigned_to"] = body.assigned_to or draft["assigned_to"]
        draft["dev_tool"] = body.dev_tool or draft["dev_tool"]
    if body.dry_run:
        return {**_scope(), "dry_run": True, "items": drafts, "created": []}
    from sop_manager.routers.tasks import TaskCreate, create_task
    created = []
    for draft in drafts:
        created.append(create_task(TaskCreate(**draft)))
    return {**_scope(), "dry_run": False, "items": drafts, "created": created}

@router.post("/im-briefing")
def im_briefing(body: ImBriefingIn):
    registry = _load_all("registry")
    dispatches = _load_all("dispatches")
    summary = summarize_a2a_health(registry, dispatches)
    briefing = build_im_briefing(
        module="a2a",
        title="A2A 协议网关运行简报",
        summary=summary,
        risks=list(summary.get("risks") or []),
        recommendations=list(summary.get("recommendations") or []),
        scope=_scope(),
        actions=[
            {"label": "查看 A2A 协议网关", "href": "#/a2a-gateway"},
            {"label": "生成 A2A 治理任务", "api": "/api/v1/a2a/governance-tasks"},
        ],
    )
    from sop_manager.routers.notify import NotifyMsg, list_channels, send_msg

    plan = build_im_delivery_plan(briefing, list_channels(), requested_channels=body.channels, event="a2a_risk")
    if body.dry_run or not plan.get("ready"):
        return {**_scope(), "dry_run": True, "briefing": briefing, "delivery_plan": plan, "sent": []}
    sent = [send_msg(NotifyMsg(**message)) for message in plan.get("messages") or []]
    return {**_scope(), "dry_run": False, "briefing": briefing, "delivery_plan": plan, "sent": sent}
