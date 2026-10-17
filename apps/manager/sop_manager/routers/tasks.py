from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Body, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
    resolved_tenant_id,
)
from .db_sql_compat import rows, table, now
from .business_access import require_business_access, validate_business_references
from .scope_guard import attach_scope, current_scope, scope_matches
from .sql_models import get_session
from .webhook import notify_webhook

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"],
                   dependencies=[Depends(require_business_access)])

_PRIOS = ("P0", "P1", "P2", "P3")


def _task_ui_path():
    return resolved_ai_memory_root() / "tasks_plan_ui_state.json"


def _scheduler_runs_path():
    return resolved_ai_memory_root() / "task_scheduler_runs.jsonl"


def _agent_reports_path():
    return resolved_ai_memory_root() / "task_agent_reports.jsonl"


def _agent_claims_path():
    return resolved_ai_memory_root() / "task_agent_claims.json"


def _quality_policy_path():
    return resolved_ai_memory_root() / "task_quality_policy.json"


def _quality_evaluations_path():
    return resolved_ai_memory_root() / "task_quality_evaluations.jsonl"


def _safe_task_id(tid: str) -> str:
    tid = (tid or "").strip()
    if not re.match(r"^T-[a-zA-Z0-9._-]{2,80}$", tid):
        raise HTTPException(400, "非法任务 ID")
    return tid


def _ui_default() -> Dict[str, Any]:
    return {"version": 1, "columns": {p: [] for p in _PRIOS}, "fields": {}}


def _ui_load() -> Dict[str, Any]:
    p = _task_ui_path()
    if not p.exists():
        return _ui_default()
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(d, dict):
            return _ui_default()
        d.setdefault("columns", {p: [] for p in _PRIOS})
        d.setdefault("fields", {})
        for p in _PRIOS:
            d["columns"].setdefault(p, [])
        return {key: d[key] for key in ("version", "columns", "fields") if key in d}
    except Exception:
        return _ui_default()


def _ui_save(d: Dict[str, Any]) -> None:
    p = _task_ui_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def _ui_rebuild_columns(rows_all: List[Dict[str, Any]], st: Dict[str, Any]) -> None:
    by_p: Dict[str, List[str]] = {p: [] for p in _PRIOS}

    def _ts(r: Dict[str, Any]) -> str:
        return str(r.get("created_at") or "")

    for r in rows_all:
        tid = r.get("id")
        if not tid:
            continue
        pr = (r.get("priority") or "P3").upper()
        if pr not in _PRIOS:
            pr = "P3"
        by_p[pr].append(tid)
    for p in _PRIOS:
        by_p[p].sort(key=lambda i: _ts(next((x for x in rows_all if x.get("id") == i), {})))
    st["columns"] = by_p


def _ui_remove_from_columns(st: Dict[str, Any], task_id: str) -> None:
    for p in _PRIOS:
        st["columns"][p] = [x for x in st["columns"].get(p, []) if x != task_id]


def _ui_delete_id(st: Dict[str, Any], task_id: str) -> None:
    _ui_remove_from_columns(st, task_id)
    st.get("fields", {}).pop(task_id, None)


def _ui_append_to_column(st: Dict[str, Any], task_id: str, priority: str) -> None:
    pr = (priority or "P3").upper()
    if pr not in _PRIOS:
        pr = "P3"
    _ui_remove_from_columns(st, task_id)
    st.setdefault("columns", {p: [] for p in _PRIOS})
    st["columns"].setdefault(pr, []).append(task_id)


def _ui_merge_row(r: Dict[str, Any], st: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(r)
    fd = (st.get("fields") or {}).get(r.get("id")) or {}
    out["dev_tool"] = str(fd.get("dev_tool") or "")
    for k in ("artifact_url", "artifact_path", "debug_notes", "branch", "source_report_id", "source_report_title", "source"):
        if k in fd and fd.get(k) is not None:
            out[k] = str(fd.get(k) or "")
    return out


def _ui_ordered_list(rows_all: List[Dict[str, Any]], st: Dict[str, Any]) -> List[Dict[str, Any]]:
    row_by_id = {r["id"]: r for r in rows_all if r.get("id")}
    if not any(st.get("columns", {}).get(p) for p in _PRIOS) and rows_all:
        _ui_rebuild_columns(rows_all, st)
        _ui_save(st)
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for p in _PRIOS:
        for tid in st.get("columns", {}).get(p, []):
            if tid in row_by_id and tid not in seen:
                rr = dict(row_by_id[tid])
                rr["priority"] = p
                out.append(_ui_merge_row(rr, st))
                seen.add(tid)
    for r in sorted(rows_all, key=lambda x: str(x.get("created_at") or "")):
        tid = r.get("id")
        if tid and tid not in seen:
            out.append(_ui_merge_row(r, st))
            seen.add(tid)
    return out


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: str = "P1"
    estimate: str = "M"
    assigned_to: Optional[str] = "Coder"
    req_id: Optional[str] = ""
    sprint_id: Optional[str] = ""
    dev_tool: Optional[str] = ""
    artifact_url: Optional[str] = ""
    artifact_path: Optional[str] = ""
    debug_notes: Optional[str] = ""
    branch: Optional[str] = ""
    source: Optional[str] = ""
    source_report_id: Optional[str] = ""
    source_report_title: Optional[str] = ""


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    estimate: Optional[str] = None
    assigned_to: Optional[str] = None
    actual_hours: Optional[float] = None
    confidence: Optional[float] = None
    sprint_id: Optional[str] = None
    human_notes: Optional[str] = None
    req_id: Optional[str] = None
    dev_tool: Optional[str] = None
    artifact_url: Optional[str] = None
    artifact_path: Optional[str] = None
    debug_notes: Optional[str] = None
    branch: Optional[str] = None


class ReorderTasksBody(BaseModel):
    groups: Dict[str, List[str]] = Field(default_factory=dict)


class TaskBulkUpdate(BaseModel):
    ids: List[str] = Field(default_factory=list, min_length=1, max_length=200)
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None


class TaskDispatchIn(BaseModel):
    ids: List[str] = Field(default_factory=list, max_length=200)
    dry_run: bool = True
    max_items: int = Field(50, ge=1, le=200)
    include_blocked: bool = False
    strategy: str = Field("balanced", pattern="^(balanced|ai_first|human_review)$")


class TaskSchedulerIn(BaseModel):
    ids: List[str] = Field(default_factory=list, max_length=300)
    dry_run: bool = True
    max_items: int = Field(50, ge=1, le=300)
    max_parallel: int = Field(6, ge=1, le=50)
    include_blocked: bool = False
    policy: str = Field("quality_first", pattern="^(balanced|throughput|quality_first|cost_saver)$")
    event: str = ""
    agent_pool: List[str] = Field(default_factory=list, max_length=50)


class TaskSchedulerActionIn(BaseModel):
    action: str = Field(..., pattern="^(rerun|cancel|archive|restore)$")
    dry_run: bool = True
    policy: str = Field("quality_first", pattern="^(balanced|throughput|quality_first|cost_saver)$")
    max_parallel: int = Field(6, ge=1, le=50)
    include_blocked: bool = False
    note: str = Field("", max_length=1000)


class TaskSchedulerRunbookIn(BaseModel):
    dry_run: bool = True
    include_unclaimed: bool = True
    include_stale_claims: bool = True
    include_quality_blocks: bool = True
    include_dependency_blocks: bool = True
    stale_minutes: int = Field(30, ge=5, le=1440)
    assigned_to: str = Field("Ops", max_length=120)
    priority: str = Field("P1", pattern="^P[0-3]$")
    limit: int = Field(50, ge=1, le=200)
    note: str = Field("", max_length=1000)


class TaskSchedulerInsightsIn(BaseModel):
    ids: List[str] = Field(default_factory=list, max_length=300)
    max_items: int = Field(80, ge=1, le=300)
    max_parallel: int = Field(6, ge=1, le=50)
    include_blocked: bool = False
    policies: List[str] = Field(default_factory=lambda: ["quality_first", "balanced", "throughput", "cost_saver"], max_length=8)


class TaskSchedulerInsightTasksIn(BaseModel):
    dry_run: bool = True
    limit: int = Field(20, ge=1, le=100)
    assigned_to: str = Field("Scheduler Agent", max_length=120)
    priority: str = Field("P1", pattern="^P[0-3]$")






class TaskAgentPlanIn(BaseModel):
    claim_id: str = Field("", max_length=80)
    task_id: str = ""
    agent: str = Field("", max_length=120)
    include_context: bool = True




class QualityPolicyIn(BaseModel):
    mode: str = Field("blocking", pattern="^(advisory|blocking|strict)$")
    required_gate_ids: List[str] = Field(default_factory=list, max_length=100)
    advisory_gate_ids: List[str] = Field(default_factory=list, max_length=100)
    auto_block_on_failed_required: bool = True
    min_confidence_to_complete: float = Field(0.65, ge=0, le=1)
    require_artifact_for_complete: bool = True
    notes: str = Field("", max_length=2000)


class QualityEvaluateIn(BaseModel):
    task_id: str
    gate_results: List[Dict[str, Any]] = Field(default_factory=list, max_length=100)
    confidence: Optional[float] = Field(None, ge=0, le=1)
    artifact_url: str = Field("", max_length=800)
    artifact_path: str = Field("", max_length=400)
    status: str = Field("", max_length=40)
    dry_run: bool = True
    source: str = Field("manual", max_length=80)


class QualityTasksIn(BaseModel):
    dry_run: bool = True
    decisions: List[str] = Field(default_factory=lambda: ["block", "warn"], max_length=10)
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = Field("QA Agent", max_length=120)
    limit: int = Field(50, ge=1, le=200)


class TaskDependencyTasksIn(BaseModel):
    dry_run: bool = True
    include_cycles: bool = True
    include_blocked: bool = True
    include_bottlenecks: bool = True
    include_missing_map: bool = True
    assigned_to: str = Field("Dependency Agent", max_length=120)
    priority: str = Field("P1", pattern="^P[0-3]$")
    limit: int = Field(30, ge=1, le=100)


def _task_by_id(task_id: str) -> Dict[str, Any] | None:
    return next((x for x in rows("tasks", 1000) if x.get("id") == task_id), None)


def _dispatch_actor(task: Dict[str, Any]) -> tuple[str, str, str]:
    text = " ".join([
        str(task.get("title") or ""),
        str(task.get("description") or ""),
        str(task.get("debug_notes") or ""),
        str(task.get("source") or ""),
    ]).lower()
    source = str(task.get("source") or "")
    if source == "audit_event" or any(k in text for k in ("security", "audit", "权限", "审计", "安全")):
        return "SecurityOps", "copilot", "安全/审计治理任务，先由安全运维 Agent 评估风险和补救动作。"
    if source in {"usage_quota_alert", "notify_inbound"} or any(k in text for k in ("deploy", "ops", "quota", "monitor", "配额", "运维", "监控", "告警")):
        return "Ops", "copilot", "运维或外部事件任务，优先交给 Ops Agent 处理并沉淀运行证据。"
    if any(k in text for k in ("frontend", "react", "ui", "页面", "交互", "antd")):
        return "Frontend Agent", "codex", "前端体验或页面实现任务，适合由前端 Agent 使用 Codex/CLI 落地。"
    if any(k in text for k in ("backend", "api", "router", "database", "sql", "接口", "后端", "数据库")):
        return "Backend Agent", "codex", "后端接口或数据任务，适合由后端 Agent 使用 Codex/CLI 实现并补验证。"
    if any(k in text for k in ("test", "qa", "验证", "测试", "质量")):
        return "QA Agent", "codex", "质量验证任务，适合由 QA Agent 补测试、回归和验收证据。"
    if any(k in text for k in ("doc", "spec", "rule", "kb", "文档", "规约", "知识库")):
        return "Docs Agent", "codex", "规约/知识任务，适合由文档 Agent 维护 spec、规则和知识库。"
    return "Coder", "codex", "通用研发任务，建议由 Coder Agent 按优先级执行。"


def _dispatch_plan(tasks: List[Dict[str, Any]], body: TaskDispatchIn) -> list[Dict[str, Any]]:
    selected = {str(x) for x in body.ids if str(x).strip()}
    snapshot = _dependency_snapshot(tasks, selected)
    candidates: list[Dict[str, Any]] = []
    for task in snapshot["ready"] + snapshot["blocked"]:
        blocked_by = task["blocked_by"]
        if blocked_by and not body.include_blocked:
            continue
        candidates.append({**task, "_blocked_by": blocked_by})

    pr_order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    candidates.sort(key=lambda x: (len(x.get("_blocked_by") or []) > 0, pr_order.get(str(x.get("priority") or "P3"), 9), str(x.get("created_at") or "")))
    plan: list[Dict[str, Any]] = []
    for order, task in enumerate(candidates[: body.max_items], start=1):
        assignee, tool, reason = _dispatch_actor(task)
        if body.strategy == "ai_first" and assignee == "Coder":
            assignee = "AI Agent"
        if body.strategy == "human_review":
            assignee = "Tech Lead"
            reason = "人工评审优先策略：先由负责人确认范围、依赖和执行工具。"
        blocked_by = task.get("_blocked_by") or []
        plan.append({
            "order": order,
            "task_id": task.get("id"),
            "title": task.get("title"),
            "priority": task.get("priority") or "P3",
            "status": task.get("status") or "pending",
            "current_assigned_to": task.get("assigned_to") or "",
            "current_dev_tool": task.get("dev_tool") or "",
            "assigned_to": assignee,
            "dev_tool": tool,
            "blocked_by": blocked_by,
            "ready": not bool(blocked_by),
            "reason": reason,
        })
    return plan


def _utc_now() -> str:
    return now().replace(microsecond=0).isoformat() + "Z"


def _utc_dt() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _utc_iso(dt: datetime | None = None) -> str:
    return (dt or _utc_dt()).isoformat().replace("+00:00", "Z")


def _parse_utc(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _append_jsonl(path, row: Dict[str, Any]) -> None:
    attach_scope(row)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _read_jsonl(path, limit: int = 5000) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    out: List[Dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out[-limit:]


def _write_jsonl(path, rows_in: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows_in)
    path.write_text((text + "\n") if text else "", encoding="utf-8")


def _scope_payload() -> Dict[str, str]:
    return current_scope()


def _agent_claims_default() -> Dict[str, Any]:
    return {"version": 1, "claims": {}}


def _load_agent_claims() -> Dict[str, Any]:
    p = _agent_claims_path()
    if not p.exists():
        return _agent_claims_default()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return _agent_claims_default()
        data.setdefault("claims", {})
        data["claims"] = {
            str(claim_id): claim
            for claim_id, claim in (data.get("claims") or {}).items()
            if isinstance(claim, dict) and scope_matches(claim)
        }
        return data
    except Exception:
        return _agent_claims_default()


def _save_agent_claims(data: Dict[str, Any]) -> None:
    claims = data.setdefault("claims", {})
    data["claims"] = {
        str(claim_id): attach_scope(dict(claim))
        for claim_id, claim in claims.items()
        if isinstance(claim, dict)
    }
    p = _agent_claims_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _claim_active(row: Dict[str, Any], *, at: datetime | None = None) -> bool:
    status = str(row.get("status") or "")
    if status not in {"claimed", "running", "heartbeat"}:
        return False
    expires = _parse_utc(row.get("lease_expires_at"))
    return bool(expires and expires > (at or _utc_dt()))


def _active_claim_for_task(task_id: str, *, agent: str = "") -> Dict[str, Any] | None:
    state = _load_agent_claims()
    now_dt = _utc_dt()
    for row in (state.get("claims") or {}).values():
        if str(row.get("task_id") or "") != task_id:
            continue
        if agent and str(row.get("agent") or "") != agent:
            continue
        if _claim_active(row, at=now_dt):
            return dict(row)
    return None


def _quality_policy_default() -> Dict[str, Any]:
    return {
        "version": 1,
        "mode": "blocking",
        "required_gate_ids": ["scope.traceability", "sop.context", "implementation.diff", "test.evidence"],
        "advisory_gate_ids": ["ops.observability", "data.quality"],
        "auto_block_on_failed_required": True,
        "min_confidence_to_complete": 0.65,
        "require_artifact_for_complete": True,
        "notes": "默认策略：核心交付卡点阻断，运维/数据卡点先作为建议，可按租户/项目后续扩展。",
        "updated_at": "",
    }


def _load_quality_policy() -> Dict[str, Any]:
    p = _quality_policy_path()
    default = _quality_policy_default()
    if not p.exists():
        return default
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return default
        return {**default, **data}
    except Exception:
        return default


def _save_quality_policy(data: Dict[str, Any]) -> None:
    p = _quality_policy_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _gate_result_map(gate_results: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for item in gate_results:
        if not isinstance(item, dict):
            continue
        gid = str(item.get("id") or item.get("gate_id") or item.get("name") or "").strip()
        if gid:
            out[gid] = item
    return out


def _gate_passed(result: Dict[str, Any] | None) -> bool:
    return str((result or {}).get("status") or "").lower() in {"passed", "pass", "ok", "success", "completed"}


def _gate_failed(result: Dict[str, Any] | None) -> bool:
    return str((result or {}).get("status") or "").lower() in {"failed", "fail", "blocked", "error"}


def _evaluate_quality(
    task: Dict[str, Any],
    gate_results: List[Dict[str, Any]],
    *,
    confidence: float | None = None,
    artifact_url: str = "",
    artifact_path: str = "",
    status: str = "",
    source: str = "manual",
) -> Dict[str, Any]:
    policy = _load_quality_policy()
    gates = _quality_gates(task)
    by_id = _gate_result_map(gate_results)
    required_ids = set(str(x) for x in (policy.get("required_gate_ids") or []))
    if policy.get("mode") == "strict":
        required_ids.update(str(g.get("id")) for g in gates if g.get("required"))
    required_ids.update(str(g.get("id")) for g in gates if g.get("severity") == "blocking")
    missing_required: List[str] = []
    failed_required: List[str] = []
    passed_required: List[str] = []
    advisory_failed: List[str] = []
    for gate in gates:
        gid = str(gate.get("id") or "")
        result = by_id.get(gid)
        if gid in required_ids:
            if _gate_passed(result):
                passed_required.append(gid)
            elif _gate_failed(result):
                failed_required.append(gid)
            else:
                missing_required.append(gid)
        elif _gate_failed(result):
            advisory_failed.append(gid)
    evidence_count = sum(1 for item in by_id.values() if str(item.get("evidence") or item.get("artifact") or "").strip())
    artifact_present = bool((artifact_url or "").strip() or (artifact_path or "").strip())
    confidence_value = confidence
    confidence_blocked = confidence_value is not None and confidence_value < float(policy.get("min_confidence_to_complete") or 0)
    artifact_blocked = bool(status == "completed" and policy.get("require_artifact_for_complete") and not artifact_present)
    blockers = []
    if missing_required:
        blockers.append("missing_required_gates")
    if failed_required:
        blockers.append("failed_required_gates")
    if confidence_blocked:
        blockers.append("low_confidence")
    if artifact_blocked:
        blockers.append("missing_artifact")
    decision = "pass"
    if blockers and policy.get("mode") in {"blocking", "strict"}:
        decision = "block"
    elif advisory_failed or blockers:
        decision = "warn"
    score_base = max(1, len(required_ids))
    score = round((len(passed_required) / score_base) * 100)
    if failed_required:
        score = max(0, score - 25)
    if confidence_blocked:
        score = max(0, score - 10)
    if artifact_blocked:
        score = max(0, score - 10)
    return {
        "id": f"quality-eval-{uuid.uuid4().hex[:12]}",
        "task_id": task.get("id"),
        "created_at": _utc_iso(),
        "scope": _scope_payload(),
        "source": source,
        "policy": policy,
        "decision": decision,
        "score": score,
        "blockers": blockers,
        "missing_required": missing_required,
        "failed_required": failed_required,
        "passed_required": passed_required,
        "advisory_failed": advisory_failed,
        "evidence_count": evidence_count,
        "artifact_present": artifact_present,
        "confidence": confidence_value,
        "gate_results": gate_results,
        "gates": gates,
    }


def _estimate_weight(value: Any) -> int:
    return {"XS": 1, "S": 2, "M": 3, "L": 5, "XL": 8}.get(str(value or "M").upper(), 3)


def _priority_rank(task: Dict[str, Any]) -> int:
    return {"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(str(task.get("priority") or "P3").upper(), 9)


def _task_text(task: Dict[str, Any]) -> str:
    return "\n".join(
        [
            str(task.get("title") or ""),
            str(task.get("description") or ""),
            str(task.get("debug_notes") or ""),
            str(task.get("source") or ""),
            str(task.get("dev_tool") or ""),
        ]
    ).lower()


def _quality_gates(task: Dict[str, Any]) -> List[Dict[str, Any]]:
    text = _task_text(task)
    gates: List[Dict[str, Any]] = [
        {
            "id": "scope.traceability",
            "name": "需求/任务可追溯",
            "type": "governance",
            "severity": "blocking",
            "required": True,
            "evidence": "关联需求、任务描述、验收标准或来源报告，说明本次交付范围。",
        },
        {
            "id": "sop.context",
            "name": "规约上下文加载",
            "type": "ai_context",
            "severity": "blocking",
            "required": True,
            "evidence": "执行前读取 AGENTS.md、RULES.md、manifest/work snapshot 和相关 specs。",
        },
        {
            "id": "implementation.diff",
            "name": "实现影响面说明",
            "type": "delivery",
            "severity": "blocking",
            "required": True,
            "evidence": "列出改动文件、接口/数据结构变化、兼容性影响和回滚方式。",
        },
        {
            "id": "test.evidence",
            "name": "测试与验证证据",
            "type": "quality",
            "severity": "blocking",
            "required": True,
            "evidence": "提交单元测试、构建、接口调用或人工验收截图/日志中的至少一种证据。",
        },
    ]
    if any(k in text for k in ("frontend", "react", "ui", "页面", "交互", "antd", "visual")):
        gates.append({
            "id": "frontend.visual",
            "name": "前端视觉与交互验收",
            "type": "quality",
            "severity": "blocking",
            "required": True,
            "evidence": "提供桌面/移动端截图或 Playwright 验证结果，确认布局、空态、批量操作和错误态可用。",
        })
    if any(k in text for k in ("backend", "api", "router", "sql", "database", "auth", "tenant", "权限", "租户", "接口", "数据库")):
        gates.append({
            "id": "backend.contract",
            "name": "后端契约与隔离验收",
            "type": "security",
            "severity": "blocking",
            "required": True,
            "evidence": "验证 tenant_code、business_code、project_id 作用域，说明鉴权、幂等、分页和错误码行为。",
        })
    if any(k in text for k in ("security", "audit", "secret", "token", "安全", "审计", "密钥")):
        gates.append({
            "id": "security.review",
            "name": "安全审查",
            "type": "security",
            "severity": "blocking",
            "required": True,
            "evidence": "确认无硬编码密钥、无越权数据访问、敏感字段不直出并记录审计事件。",
        })
    if any(k in text for k in ("deploy", "ops", "monitor", "workflow", "notify", "运维", "部署", "监控", "告警", "调度")):
        gates.append({
            "id": "ops.observability",
            "name": "运维与可观测性验收",
            "type": "ops",
            "severity": "advisory",
            "required": True,
            "evidence": "说明事件、日志、指标、告警、重试或回滚策略如何闭环。",
        })
    if any(k in text for k in ("analytics", "data", "report", "lineage", "数据", "指标", "报表", "洞察")):
        gates.append({
            "id": "data.quality",
            "name": "数据质量与口径验收",
            "type": "data",
            "severity": "advisory",
            "required": True,
            "evidence": "说明数据口径、来源、过滤条件、权限边界和异常值处理方式。",
        })
    seen: set[str] = set()
    out: List[Dict[str, Any]] = []
    for gate in gates:
        gid = str(gate["id"])
        if gid in seen:
            continue
        seen.add(gid)
        out.append({**gate, "status": "pending"})
    return out


def _dependency_snapshot(task_rows: List[Dict[str, Any]], selected: set[str]) -> Dict[str, Any]:
    from .delivery_dependencies import scoped_dependencies

    delivery = scoped_dependencies()
    task_by_id = {str(task.get("id")): task for task in task_rows if task.get("id")}
    active_ids = [
        tid
        for tid, task in task_by_id.items()
        if (not selected or tid in selected) and str(task.get("status") or "pending") != "completed"
    ]
    active = set(active_ids)
    edges = delivery["edges"]
    completed = delivery["verified_completed"]
    blockers: Dict[str, List[str]] = {}
    graph: Dict[str, List[str]] = {tid: [] for tid in active}
    indegree: Dict[str, int] = {tid: 0 for tid in active}
    for edge in edges:
        source = str(edge.get("source_id") or "")
        target = str(edge.get("target_id") or "")
        if target not in active:
            continue
        if source and source not in completed:
            values = blockers.setdefault(target, [])
            if source not in values:
                values.append(source)
        if source in active and target in active and target not in graph.get(source, []):
            graph.setdefault(source, []).append(target)
            indegree[target] = indegree.get(target, 0) + 1

    queue = sorted([tid for tid in active if indegree.get(tid, 0) == 0], key=lambda tid: (_priority_rank(task_by_id[tid]), str(task_by_id[tid].get("created_at") or "")))
    stages: List[Dict[str, Any]] = []
    processed: set[str] = set()
    stage_no = 1
    while queue:
        batch = queue[:]
        queue = []
        stage_tasks = []
        for tid in batch:
            if tid in processed:
                continue
            processed.add(tid)
            task = task_by_id[tid]
            blocked_by = blockers.get(tid, [])
            if tid in delivery["explicit_blocks"]:
                blocked_by = blocked_by + ["delivery:blocked_reason"]
            if str(task.get("status") or "") == "blocked":
                blocked_by = blocked_by + ["manual_status:blocked"]
            stage_tasks.append({
                "id": tid,
                "title": task.get("title") or "",
                "priority": task.get("priority") or "P3",
                "status": task.get("status") or "pending",
                "ready": not bool(blocked_by),
                "blocked_by": blocked_by,
            })
            for nxt in graph.get(tid, []):
                indegree[nxt] = indegree.get(nxt, 0) - 1
                if indegree[nxt] == 0:
                    queue.append(nxt)
        stages.append({"stage": stage_no, "tasks": stage_tasks})
        stage_no += 1
        queue.sort(key=lambda tid: (_priority_rank(task_by_id[tid]), str(task_by_id[tid].get("created_at") or "")))

    cycle_ids = sorted(active - processed)
    if cycle_ids:
        stages.append({
            "stage": "cycle",
            "tasks": [
                {
                    "id": tid,
                    "title": task_by_id[tid].get("title") or "",
                    "priority": task_by_id[tid].get("priority") or "P3",
                    "status": task_by_id[tid].get("status") or "pending",
                    "ready": False,
                    "blocked_by": ["dependency_cycle"],
                }
                for tid in cycle_ids
            ],
        })
    ready: List[Dict[str, Any]] = []
    blocked: List[Dict[str, Any]] = []
    for tid in active_ids:
        task = task_by_id[tid]
        blocked_by = list(dict.fromkeys(blockers.get(tid, [])))
        if tid in cycle_ids:
            blocked_by.append("dependency_cycle")
        if str(task.get("status") or "") == "blocked":
            blocked_by.append("manual_status:blocked")
        if tid in delivery["explicit_blocks"]:
            blocked_by.append("delivery:blocked_reason")
        row = {
            **task,
            "blocked_by": blocked_by,
            "ready": not bool(blocked_by),
            "blocking_reason": delivery["explicit_blocks"].get(tid, ""),
        }
        if blocked_by:
            blocked.append(row)
        else:
            ready.append(row)
    return {
        "stages": stages,
        "ready": ready,
        "blocked": blocked,
        "cycle_ids": cycle_ids,
        "edges": edges,
        "verified_completed": completed,
        "explicit_blocks": delivery["explicit_blocks"],
    }


def _require_task_dependencies(task_ids: List[str], target_status: str | None = None) -> None:
    """Preflight every requested task before changing status, assignments or files."""
    selected = set(task_ids)
    task_rows = rows("tasks", 1000)
    if selected - {row.get("id") for row in task_rows}:
        raise HTTPException(404, "Task not found in the selected project task scope")
    # An explicit status transition can resume a manually blocked record. Keep
    # actual planning/requirement reasons and predecessor proof authoritative.
    # A completion candidate stays in the active graph during this preflight.
    candidate_status = "in_progress" if target_status == "in_progress" else "pending"
    candidates = [
        {**row, "status": candidate_status}
        if row.get("id") in selected and (target_status is not None or row.get("status") == "completed")
        else row
        for row in task_rows
    ]
    snapshot = _dependency_snapshot(candidates, selected)
    blocked = {row["id"]: row["blocked_by"] for row in snapshot["blocked"]}
    if blocked:
        raise HTTPException(409, {
            "code": "task_dependencies_blocked",
            "message": "Resolve blocking reasons and verify predecessor deliveries first",
            "blocked": blocked,
        })


def _sort_scheduler_candidates(items: List[Dict[str, Any]], policy: str) -> List[Dict[str, Any]]:
    def gate_count(task: Dict[str, Any]) -> int:
        return len(_quality_gates(task))

    if policy == "throughput":
        return sorted(items, key=lambda x: (not x.get("ready"), _priority_rank(x), _estimate_weight(x.get("estimate")), str(x.get("created_at") or "")))
    if policy == "cost_saver":
        return sorted(items, key=lambda x: (not x.get("ready"), _priority_rank(x), gate_count(x), _estimate_weight(x.get("estimate")), str(x.get("created_at") or "")))
    if policy == "quality_first":
        return sorted(items, key=lambda x: (not x.get("ready"), _priority_rank(x), -gate_count(x), str(x.get("created_at") or "")))
    return sorted(items, key=lambda x: (not x.get("ready"), _priority_rank(x), str(x.get("created_at") or "")))


def _agent_packet(task: Dict[str, Any], *, order: int, lane: int, assigned_to: str, dev_tool: str, reason: str) -> Dict[str, Any]:
    gates = _quality_gates(task)
    tid = str(task.get("id") or "")
    blocked_by = [str(x) for x in (task.get("blocked_by") or [])]
    claim = _active_claim_for_task(tid)
    return {
        "packet_id": f"pkt-{uuid.uuid4().hex[:12]}",
        "order": order,
        "lane": lane,
        "ready": not bool(blocked_by),
        "blocked_by": blocked_by,
        "task_id": tid,
        "title": task.get("title") or "",
        "priority": task.get("priority") or "P3",
        "status": task.get("status") or "pending",
        "assigned_to": assigned_to,
        "dev_tool": dev_tool,
        "dispatch_reason": reason,
        "scope": _scope_payload(),
        "contract": {
            "objective": task.get("title") or tid,
            "description": task.get("description") or "",
            "req_id": task.get("req_id") or "",
            "sprint_id": task.get("sprint_id") or "",
            "source": task.get("source") or "manual",
            "source_report_id": task.get("source_report_id") or "",
            "dependencies": blocked_by,
            "done_definition": [
                "实现范围与任务描述一致，不引入无关重构。",
                "通过固定任务、智能体版本与执行目标预览，明确测试命令。",
                "运行结果由设备执行协议回写；测试证据通过后仍需人工验收。",
            ],
        },
        "quality_gates": gates,
        "claim": claim,
        "callbacks": {
            "preview": "POST /api/v1/delivery/execution-preview",
            "command": "POST /api/v1/delivery/commands",
            "observations": "GET /api/v1/delivery/executions/{execution_id}/observations",
        },
        "suggested_commands": [
            "sop context prepare --flush",
            "sop delivery targets",
            "sop delivery execution-preview --file proposal.json",
            "sop delivery command --file intent.json",
        ],
    }


def _agent_execution_plan(task_id: str, *, claim: Dict[str, Any] | None = None, agent: str = "", include_context: bool = True) -> Dict[str, Any]:
    tid = _safe_task_id(task_id)
    task_rows = [_ui_merge_row(r, _ui_load()) for r in rows("tasks", 1000)]
    task = next((row for row in task_rows if str(row.get("id") or "") == tid), None)
    if not task:
        raise HTTPException(404, "任务不存在")
    fallback_assignee, tool, reason = _dispatch_actor(task)
    agent_name = agent.strip() or str((claim or {}).get("agent") or "") or fallback_assignee
    packet = _agent_packet(
        task,
        order=1,
        lane=1,
        assigned_to=agent_name,
        dev_tool=str((claim or {}).get("dev_tool") or task.get("dev_tool") or tool),
        reason=reason,
    )
    snapshot = _dependency_snapshot(task_rows, {tid})
    blocked = next((row for row in snapshot.get("blocked", []) if str(row.get("id") or "") == tid), None)
    ready = next((row for row in snapshot.get("ready", []) if str(row.get("id") or "") == tid), None)
    dependency_state = {
        "ready": bool(ready) and not bool((ready or {}).get("blocked_by")),
        "blocked_by": (blocked or ready or {}).get("blocked_by") or [],
        "upstream": [edge for edge in snapshot.get("edges", []) if str(edge.get("target_id") or "") == tid],
        "downstream": [edge for edge in snapshot.get("edges", []) if str(edge.get("source_id") or "") == tid],
    }
    gates = packet.get("quality_gates") or []
    context_files = [
        "AGENTS.md",
        ".ai-memory/rules/RULES.md",
        "memory/current_state.json",
        ".sop-runtime/project_manifest.json",
        ".sop-runtime/work_snapshot.json",
        ".sop-runtime/pages_manifest.json",
        ".sop-runtime/pages_capabilities.json",
    ] if include_context else []
    execution_steps = [
        {
            "id": "prepare-context",
            "title": "加载项目上下文与页面能力清单",
            "command": "sop context prepare --flush",
            "required": True,
        },
        {
            "id": "confirm-scope",
            "title": "确认任务目标、依赖与质量卡点",
            "command": f"sop task agent-plan --task-id {tid} --json",
            "required": True,
        },
        {
            "id": "select-target",
            "title": "选择有明确授权且能力可用的执行目标",
            "command": "sop delivery targets",
            "required": True,
        },
        {
            "id": "preview",
            "title": "预览固定任务、目标、智能体与明确后置测试",
            "command": "sop delivery execution-preview --file proposal.json",
            "required": True,
        },
        {
            "id": "queue",
            "title": "提交固定依据的派发；执行与测试后由人审查",
            "command": "sop delivery command --file intent.json",
            "required": True,
        },
    ]
    if dependency_state["blocked_by"]:
        execution_steps.insert(2, {
            "id": "resolve-blockers",
            "title": "先检查并解决上游依赖阻塞",
            "command": f"sop task agent-plan --task-id {tid} --json",
            "required": True,
        })
    return {
        "ok": True,
        "scope": _scope_payload(),
        "task": {
            "id": tid,
            "title": task.get("title") or "",
            "description": task.get("description") or "",
            "status": task.get("status") or "pending",
            "priority": task.get("priority") or "P3",
            "assigned_to": task.get("assigned_to") or "",
            "req_id": task.get("req_id") or "",
            "sprint_id": task.get("sprint_id") or "",
            "source": task.get("source") or "manual",
            "source_report_id": task.get("source_report_id") or "",
            "source_report_title": task.get("source_report_title") or "",
            "dev_tool": task.get("dev_tool") or packet.get("dev_tool") or "",
        },
        "claim": claim or _active_claim_for_task(tid),
        "packet": packet,
        "dependency_state": dependency_state,
        "quality_gates": gates,
        "context_files": context_files,
        "execution_steps": execution_steps,
        "agent_consumption": {
            "purpose": "读取目标、依赖和质量卡点；执行由固定身份的交付协议管理，历史登记不代表在线或交付完成。",
            "api": f"/api/v1/tasks/{tid}/agent-plan",
            "claim_plan_api": "/api/v1/tasks/agent-feed/execution-plan",
            "cli": f"sop task agent-plan --task-id {tid} --json",
        },
    }


def _scheduler_plan(task_rows: List[Dict[str, Any]], body: TaskSchedulerIn) -> Dict[str, Any]:
    selected = {_safe_task_id(str(x).strip()) for x in body.ids if str(x).strip()}
    snapshot = _dependency_snapshot(task_rows, selected)
    candidates = list(snapshot["ready"])
    if body.include_blocked:
        candidates += list(snapshot["blocked"])
    candidates = _sort_scheduler_candidates(candidates, body.policy)[: body.max_items]
    packets: List[Dict[str, Any]] = []
    for idx, task in enumerate(candidates, start=1):
        fallback_assignee, tool, reason = _dispatch_actor(task)
        assigned_to = fallback_assignee
        if body.agent_pool:
            assigned_to = str(body.agent_pool[(idx - 1) % len(body.agent_pool)]).strip() or fallback_assignee
        lane = ((idx - 1) % body.max_parallel) + 1
        packets.append(_agent_packet(task, order=idx, lane=lane, assigned_to=assigned_to, dev_tool=tool, reason=reason))
    event_wakeups = [
        {"event": "task.created", "action": "recompute_ready_queue", "target": "scheduler"},
        {"event": "task.updated", "action": "refresh_priority_and_quality_gates", "target": "scheduler"},
        {"event": "task.status_changed", "action": "recheck_verified_deliveries", "target": "scheduler"},
        {"event": "task.dependency_deleted", "action": "wake_blocked_task", "target": "scheduler"},
        {"event": "task.agent_reported", "action": "evaluate_quality_gate_and_continue_dag", "target": "scheduler"},
        {"event": "notify.inbound", "action": "convert_message_to_requirement_or_task", "target": "intake"},
        {"event": "agent.heartbeat", "action": "rebalance_agent_lanes", "target": "agent_pool"},
    ]
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "schedule_id": f"sched-{uuid.uuid4().hex[:12]}",
        "scope": _scope_payload(),
        "policy": body.policy,
        "max_parallel": body.max_parallel,
        "event": body.event,
        "summary": {
            "total_open": len(snapshot["ready"]) + len(snapshot["blocked"]),
            "ready": len(snapshot["ready"]),
            "blocked": len(snapshot["blocked"]),
            "scheduled": len(packets),
            "stages": len(snapshot["stages"]),
            "cycles": len(snapshot["cycle_ids"]),
            "quality_gates": sum(len(packet["quality_gates"]) for packet in packets),
            "event_wakeups": len(event_wakeups),
        },
        "stages": snapshot["stages"],
        "ready_queue": [
            {"id": t.get("id"), "title": t.get("title"), "priority": t.get("priority"), "status": t.get("status"), "assigned_to": t.get("assigned_to") or ""}
            for t in _sort_scheduler_candidates(snapshot["ready"], body.policy)
        ],
        "blocked_queue": [
            {"id": t.get("id"), "title": t.get("title"), "priority": t.get("priority"), "status": t.get("status"), "blocked_by": t.get("blocked_by") or []}
            for t in _sort_scheduler_candidates(snapshot["blocked"], body.policy)
        ],
        "agent_packets": packets,
        "event_wakeups": event_wakeups,
    }


def _scheduler_run_item(record: Dict[str, Any]) -> Dict[str, Any]:
    summary = record.get("summary") if isinstance(record.get("summary"), dict) else {}
    return {
        "schedule_id": record.get("schedule_id") or record.get("id") or "",
        "created_at": record.get("created_at") or "",
        "updated_at": record.get("updated_at") or record.get("created_at") or "",
        "status": record.get("status") or "applied",
        "policy": record.get("policy") or "",
        "event": record.get("event") or "",
        "applied": record.get("applied") or 0,
        "summary": summary,
        "task_ids": record.get("task_ids") or [],
        "archived": bool(record.get("archived")),
        "parent_schedule_id": record.get("parent_schedule_id") or "",
        "note": record.get("note") or "",
    }


def _scheduler_runs(limit: int = 50, q: str = "", include_archived: bool = False) -> Dict[str, Any]:
    q_norm = q.strip().lower()
    records = list(reversed(_read_jsonl(_scheduler_runs_path(), limit=1000)))
    items: List[Dict[str, Any]] = []
    for record in records:
        item = _scheduler_run_item(record)
        if item.get("archived") and not include_archived:
            continue
        if q_norm:
            haystack = "\n".join(
                [
                    str(item.get("schedule_id") or ""),
                    str(item.get("policy") or ""),
                    str(item.get("event") or ""),
                    str(item.get("status") or ""),
                    ",".join(str(x) for x in item.get("task_ids") or []),
                ]
            ).lower()
            if q_norm not in haystack:
                continue
        items.append(item)
    by_status: Dict[str, int] = {}
    for item in items:
        status = str(item.get("status") or "applied")
        by_status[status] = by_status.get(status, 0) + 1
    return {
        "ok": True,
        "scope": _scope_payload(),
        "items": items[:limit],
        "total": len(items),
        "summary": {
            "runs": len(items),
            "applied": sum(int(x.get("applied") or 0) for x in items),
            "scheduled": sum(int((x.get("summary") or {}).get("scheduled") or 0) for x in items),
            "blocked": sum(int((x.get("summary") or {}).get("blocked") or 0) for x in items),
            "by_status": by_status,
        },
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 查看任务 DAG 调度历史、判断是否需要重放、取消或归档调度。",
            "api": "/api/v1/tasks/scheduler/runs",
            "cli": "sop task schedule-runs --json",
            "actions": ["rerun", "cancel", "archive", "restore"],
        },
    }


def _find_scheduler_run(schedule_id: str) -> tuple[List[Dict[str, Any]], Dict[str, Any] | None]:
    records = _read_jsonl(_scheduler_runs_path(), limit=1000)
    found = None
    for record in records:
        if str(record.get("schedule_id") or record.get("id") or "") == schedule_id:
            found = record
            break
    return records, found


def _minutes_since(value: Any) -> int | None:
    dt = _parse_utc(value)
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0, int((_utc_dt() - dt).total_seconds() // 60))


def _latest_quality_blocks(limit: int = 100) -> List[Dict[str, Any]]:
    rows_in = list(reversed(_read_jsonl(_quality_evaluations_path(), limit=1000)))
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows_in:
        tid = str(row.get("task_id") or "")
        if not tid or tid in seen:
            continue
        if str(row.get("decision") or "") == "block":
            out.append(row)
            seen.add(tid)
        if len(out) >= limit:
            break
    return out


def _scheduler_ops_payload() -> Dict[str, Any]:
    st = _ui_load()
    task_rows = [_ui_merge_row(r, st) for r in rows("tasks", 1000)]
    snapshot = _dependency_snapshot(task_rows, set())
    feed_plan = _scheduler_plan(
        task_rows,
        TaskSchedulerIn(dry_run=True, max_items=100, max_parallel=20, include_blocked=False, policy="quality_first", event="scheduler.ops"),
    )
    claims_all = [dict(row) for row in (_load_agent_claims().get("claims") or {}).values()]
    active_claims = [row for row in claims_all if _claim_active(row)]
    stale_claims = [
        {**row, "heartbeat_lag_minutes": _minutes_since(row.get("updated_at") or row.get("claimed_at")) or 0}
        for row in active_claims
        if (_minutes_since(row.get("updated_at") or row.get("claimed_at")) or 0) > 30
    ]
    quality_blocks = _latest_quality_blocks(limit=100)
    runs_payload = _scheduler_runs(limit=100, include_archived=True)
    runs = runs_payload.get("items") or []
    cancelled_runs = [row for row in runs if row.get("status") == "cancelled"]
    archived_runs = [row for row in runs if row.get("archived")]
    ready_unclaimed = [
        packet for packet in feed_plan.get("agent_packets") or []
        if packet.get("ready") and not packet.get("claim")
    ]
    risk_score = 100
    risk_score -= min(15, len(ready_unclaimed))
    risk_score -= min(30, len(snapshot["blocked"]) * 5)
    risk_score -= min(25, len(stale_claims) * 10)
    risk_score -= min(25, len(quality_blocks) * 6)
    risk_score -= min(10, len(cancelled_runs) * 2)
    risk_score = max(0, risk_score)
    recommendations: List[Dict[str, Any]] = []
    if ready_unclaimed:
        recommendations.append({
            "id": "claim-ready-packets",
            "severity": "medium",
            "title": "存在未领取就绪任务包",
            "summary": f"{len(ready_unclaimed)} 个 ready packet 尚未被 Agent 领取。",
            "command": "sop task schedule-runbook --include-unclaimed --apply",
        })
    if stale_claims:
        recommendations.append({
            "id": "stale-agent-claims",
            "severity": "high",
            "title": "存在过期心跳风险的 Agent 租约",
            "summary": f"{len(stale_claims)} 个活跃租约超过 30 分钟未更新。",
            "command": "sop task schedule-runbook --include-stale-claims --apply",
        })
    if quality_blocks:
        recommendations.append({
            "id": "quality-blocks",
            "severity": "high",
            "title": "存在质量卡点阻断",
            "summary": f"{len(quality_blocks)} 个任务最近质量评估为 block。",
            "command": "sop task schedule-runbook --include-quality-blocks --apply",
        })
    if snapshot["blocked"]:
        recommendations.append({
            "id": "dependency-blocks",
            "severity": "medium",
            "title": "存在依赖阻塞队列",
            "summary": f"{len(snapshot['blocked'])} 个任务受依赖或状态阻塞。",
            "command": "sop task schedule-runbook --include-dependency-blocks --apply",
        })
    return {
        "ok": True,
        "scope": _scope_payload(),
        "summary": {
            "health_score": risk_score,
            "ready_unclaimed": len(ready_unclaimed),
            "active_claims": len(active_claims),
            "stale_claims": len(stale_claims),
            "quality_blocks": len(quality_blocks),
            "dependency_blocked": len(snapshot["blocked"]),
            "scheduler_runs": len(runs),
            "cancelled_runs": len(cancelled_runs),
            "archived_runs": len(archived_runs),
            "recommendations": len(recommendations),
        },
        "ready_unclaimed": ready_unclaimed[:20],
        "stale_claims": stale_claims[:20],
        "quality_blocks": quality_blocks[:20],
        "dependency_blocked": snapshot["blocked"][:20],
        "recommendations": recommendations,
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 发现调度中心阻塞、未领取、过期租约和质量阻断，并生成可执行 Runbook。",
            "api": "/api/v1/tasks/scheduler/ops-summary",
            "cli": "sop task schedule-ops --json",
            "runbook": "sop task schedule-runbook --json",
        },
    }


def _scheduler_runbook(body: TaskSchedulerRunbookIn) -> Dict[str, Any]:
    ops = _scheduler_ops_payload()
    steps: List[Dict[str, Any]] = []
    if body.include_unclaimed:
        for packet in (ops.get("ready_unclaimed") or [])[: body.limit]:
            steps.append({
                "id": f"runbook-claim-{len(steps) + 1}",
                "type": "claim_ready_packet",
                "severity": "medium",
                "task_id": packet.get("task_id") or "",
                "title": f"预览并派发就绪任务包：{packet.get('title') or packet.get('task_id')}",
                "reason": "历史名称登记不代表当前执行；请核对交付工作台",
                "commands": [
                    "sop delivery targets",
                    "sop delivery execution-preview --file proposal.json",
                    "sop delivery command --file intent.json",
                ],
            })
    if body.include_stale_claims:
        for claim in (ops.get("stale_claims") or [])[: body.limit]:
            if int(claim.get("heartbeat_lag_minutes") or 0) < body.stale_minutes:
                continue
            steps.append({
                "id": f"runbook-stale-{len(steps) + 1}",
                "type": "stale_claim",
                "severity": "high",
                "task_id": claim.get("task_id") or "",
                "title": f"核对历史 Agent 登记：{claim.get('task_id')}",
                "reason": "历史登记过期不代表当前设备离线，请查看实际执行观测",
                "commands": [
                    "sop task claims --status all --json",
                    "sop delivery workspace",
                ],
            })
    if body.include_quality_blocks:
        for row in (ops.get("quality_blocks") or [])[: body.limit]:
            tid = str(row.get("task_id") or "")
            steps.append({
                "id": f"runbook-quality-{len(steps) + 1}",
                "type": "quality_block_fix",
                "severity": "high",
                "task_id": tid,
                "title": f"修复质量卡点阻断：{tid}",
                "reason": ",".join(row.get("blockers") or []) or "quality decision block",
                "commands": [
                    f"sop task gates --task-id {tid} --json",
                    f"sop task evaluate --task-id {tid} --json",
                    "sop delivery workspace",
                ],
            })
    if body.include_dependency_blocks:
        for task in (ops.get("dependency_blocked") or [])[: body.limit]:
            tid = str(task.get("id") or "")
            steps.append({
                "id": f"runbook-dep-{len(steps) + 1}",
                "type": "dependency_unblock",
                "severity": "medium",
                "task_id": tid,
                "title": f"解除任务依赖阻塞：{task.get('title') or tid}",
                "reason": ",".join(task.get("blocked_by") or []) or "dependency blocked",
                "commands": [
                    "sop task schedule --include-blocked --json",
                    f"sop task update {tid} --status pending --notes 'dependency reviewed'",
                    "sop task schedule --apply",
                ],
            })
    steps = steps[: body.limit]
    planned: List[Dict[str, Any]] = []
    created: List[Dict[str, Any]] = []
    for step in steps:
        task = {
            "title": step["title"],
            "description": "\n".join([
                f"Runbook step: {step.get('id')}",
                f"Type: {step.get('type')}",
                f"Reason: {step.get('reason')}",
                "",
                "Commands:",
                *[f"- {cmd}" for cmd in step.get("commands") or []],
                "",
                body.note,
            ]).strip(),
            "priority": "P0" if step.get("severity") == "high" else body.priority,
            "estimate": "S",
            "assigned_to": body.assigned_to,
            "dev_tool": "sop-cli",
            "source": "task_scheduler_runbook",
            "source_report_id": str(step.get("id") or ""),
            "source_report_title": str(step.get("title") or ""),
            "debug_notes": f"scheduler_runbook type={step.get('type')} severity={step.get('severity')}",
        }
        planned.append(task)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**task)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "summary": {
            "steps": len(steps),
            "planned": len(planned),
            "created": len(created),
            "health_score": (ops.get("summary") or {}).get("health_score", 0),
        },
        "steps": steps,
        "items": planned,
        "created": created,
        "ops_summary": ops.get("summary") or {},
    }


def _scheduler_insights(body: TaskSchedulerInsightsIn) -> Dict[str, Any]:
    task_rows = [_ui_merge_row(r, _ui_load()) for r in rows("tasks", 1000)]
    selected = {_safe_task_id(str(x).strip()) for x in body.ids if str(x).strip()}
    snapshot = _dependency_snapshot(task_rows, selected)
    policies = []
    seen_policy: set[str] = set()
    for policy in body.policies or ["quality_first", "balanced", "throughput", "cost_saver"]:
        if policy not in {"quality_first", "balanced", "throughput", "cost_saver"} or policy in seen_policy:
            continue
        seen_policy.add(policy)
        plan = _scheduler_plan(
            task_rows,
            TaskSchedulerIn(
                ids=list(selected),
                dry_run=True,
                max_items=body.max_items,
                max_parallel=body.max_parallel,
                include_blocked=body.include_blocked,
                policy=policy,
                event="scheduler.insights",
            ),
        )
        summary = plan.get("summary") or {}
        lanes: Dict[str, int] = {}
        for packet in plan.get("agent_packets") or []:
            lane = f"L{packet.get('lane') or 1}"
            lanes[lane] = lanes.get(lane, 0) + 1
        policies.append({
            "policy": policy,
            "scheduled": summary.get("scheduled", 0),
            "ready": summary.get("ready", 0),
            "blocked": summary.get("blocked", 0),
            "stages": summary.get("stages", 0),
            "quality_gates": summary.get("quality_gates", 0),
            "event_wakeups": summary.get("event_wakeups", 0),
            "lane_load": lanes,
            "first_packets": (plan.get("agent_packets") or [])[:5],
        })

    stages = snapshot.get("stages") or []
    critical_path: List[Dict[str, Any]] = []
    for stage in stages:
        tasks_in_stage = stage.get("tasks") or []
        if not tasks_in_stage:
            continue
        ranked = sorted(tasks_in_stage, key=lambda x: (_priority_rank(x), not bool(x.get("ready")), str(x.get("id") or "")))
        item = ranked[0]
        critical_path.append({
            "stage": stage.get("stage"),
            "task_id": item.get("id"),
            "title": item.get("title"),
            "priority": item.get("priority"),
            "ready": item.get("ready"),
            "blocked_by": item.get("blocked_by") or [],
        })

    blocker_counts: Dict[str, int] = {}
    for task in snapshot.get("blocked") or []:
        for blocker in task.get("blocked_by") or []:
            blocker_counts[str(blocker)] = blocker_counts.get(str(blocker), 0) + 1
    bottlenecks = [
        {
            "id": blocker,
            "type": "dependency" if blocker.startswith("T-") else "status",
            "severity": "high" if count >= 3 or blocker == "dependency_cycle" else "medium",
            "count": count,
            "title": f"{blocker} 阻塞 {count} 个任务",
            "command": "sop task schedule-runbook --include-dependency-blocks --apply",
        }
        for blocker, count in sorted(blocker_counts.items(), key=lambda x: (-x[1], x[0]))
    ]
    if snapshot.get("cycle_ids"):
        bottlenecks.insert(0, {
            "id": "dependency_cycle",
            "type": "cycle",
            "severity": "high",
            "count": len(snapshot.get("cycle_ids") or []),
            "title": "存在任务依赖环路",
            "command": "sop task deps --json",
        })

    ready_count = len(snapshot.get("ready") or [])
    blocked_count = len(snapshot.get("blocked") or [])
    cycle_count = len(snapshot.get("cycle_ids") or [])
    health_score = max(0, 100 - blocked_count * 5 - cycle_count * 20 - max(0, ready_count - body.max_parallel * 2) * 2)
    recommendations: List[Dict[str, Any]] = []
    if cycle_count:
        recommendations.append({
            "id": "fix-cycles",
            "severity": "high",
            "title": "先修复依赖环路",
            "summary": f"{cycle_count} 个任务处于依赖环路，调度器无法可靠推进关键路径。",
            "command": "sop task deps --json",
        })
    if blocked_count:
        recommendations.append({
            "id": "unblock-dependencies",
            "severity": "medium",
            "title": "处理依赖阻塞队列",
            "summary": f"{blocked_count} 个任务被依赖或 blocked 状态阻塞，建议生成调度 Runbook。",
            "command": "sop task schedule-runbook --include-dependency-blocks --apply",
        })
    if ready_count > body.max_parallel * 2:
        recommendations.append({
            "id": "increase-parallelism",
            "severity": "low",
            "title": "就绪队列较长，可提升并发或扩充 Agent 池",
            "summary": f"当前 ready={ready_count}，max_parallel={body.max_parallel}，可按 Agent SLO 增加并发。",
            "command": "sop platforms agent-slo --json",
        })
    if not recommendations:
        recommendations.append({
            "id": "scheduler-stable",
            "severity": "info",
            "title": "任务依赖调度状态稳定",
            "summary": "未发现明显依赖环、长阻塞或并发瓶颈，可按当前策略继续调度。",
            "command": "sop task schedule --apply",
        })

    return {
        "ok": True,
        "scope": _scope_payload(),
        "summary": {
            "health_score": health_score,
            "ready": ready_count,
            "blocked": blocked_count,
            "stages": len(stages),
            "cycles": cycle_count,
            "bottlenecks": len(bottlenecks),
            "policies": len(policies),
        },
        "critical_path": critical_path[:30],
        "bottlenecks": bottlenecks[:30],
        "policy_comparison": policies,
        "recommendations": recommendations,
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 在自主派单前比较调度策略、识别关键路径和依赖瓶颈。",
            "api": "/api/v1/tasks/scheduler/insights",
            "tasks_api": "/api/v1/tasks/scheduler/insights/tasks",
            "cli": "sop task schedule-insights --json",
        },
    }


def _scheduler_insight_tasks(body: TaskSchedulerInsightTasksIn) -> Dict[str, Any]:
    insights = _scheduler_insights(TaskSchedulerInsightsIn(include_blocked=True, max_items=120, max_parallel=20))
    candidates = [
        item for item in (insights.get("recommendations") or [])
        if str(item.get("severity") or "") in {"high", "medium", "low"}
    ][: body.limit]
    planned: List[Dict[str, Any]] = []
    created: List[Dict[str, Any]] = []
    for item in candidates:
        task = {
            "title": f"调度优化：{item.get('title')}",
            "description": "\n".join([
                str(item.get("summary") or ""),
                "",
                f"Severity: {item.get('severity')}",
                "建议命令:",
                f"- {item.get('command') or 'sop task schedule-insights --json'}",
            ]),
            "priority": "P0" if item.get("severity") == "high" else body.priority,
            "estimate": "S",
            "assigned_to": body.assigned_to,
            "dev_tool": "sop-cli",
            "source": "task_scheduler_insights",
            "source_report_id": str(item.get("id") or ""),
            "source_report_title": str(item.get("title") or ""),
            "debug_notes": f"scheduler_insight severity={item.get('severity')}",
        }
        planned.append(task)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**task)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "summary": {
            "planned": len(planned),
            "created": len(created),
            "health_score": (insights.get("summary") or {}).get("health_score", 0),
        },
        "items": planned,
        "created": created,
        "insights_summary": insights.get("summary") or {},
    }


def _quality_summary_payload(limit: int = 100) -> Dict[str, Any]:
    policy = _load_quality_policy()
    evaluations = list(reversed(_read_jsonl(_quality_evaluations_path(), limit=1000)))
    recent = evaluations[:limit]
    by_decision: Dict[str, int] = {}
    blocked_tasks: Dict[str, Dict[str, Any]] = {}
    warnings: List[Dict[str, Any]] = []
    for row in recent:
        decision = str(row.get("decision") or "unknown")
        by_decision[decision] = by_decision.get(decision, 0) + 1
        tid = str(row.get("task_id") or "")
        if decision == "block" and tid and tid not in blocked_tasks:
            blocked_tasks[tid] = row
        if decision == "warn":
            warnings.append(row)
    scores = [float(row.get("score") or 0) for row in recent if row.get("score") is not None]
    avg_score = round(sum(scores) / len(scores), 1) if scores else 100
    return {
        "ok": True,
        "scope": _scope_payload(),
        "policy": policy,
        "summary": {
            "evaluations": len(recent),
            "avg_score": avg_score,
            "pass": by_decision.get("pass", 0),
            "warn": by_decision.get("warn", 0),
            "block": by_decision.get("block", 0),
            "blocked_tasks": len(blocked_tasks),
            "required_gates": len(policy.get("required_gate_ids") or []),
            "advisory_gates": len(policy.get("advisory_gate_ids") or []),
            "mode": policy.get("mode"),
        },
        "recent": recent[:50],
        "blocked_tasks": list(blocked_tasks.values())[:50],
        "warnings": warnings[:50],
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 读取当前项目质量策略、最近质量评估和阻断任务，决定是否可完成任务或需要补证据。",
            "api": "/api/v1/tasks/quality/summary",
            "cli": "sop task quality-ops --json",
            "policy_update": "sop task quality-policy-set --mode blocking --required scope.traceability,test.evidence",
        },
    }


def _agent_reports_payload(
    *,
    limit: int = 100,
    status: str = "",
    agent: str = "",
    task_id: str = "",
    q: str = "",
) -> Dict[str, Any]:
    scope = _scope_payload()
    status = status.strip() if isinstance(status, str) else ""
    agent_l = agent.strip().lower() if isinstance(agent, str) else ""
    task_id_l = task_id.strip().lower() if isinstance(task_id, str) else ""
    q_l = q.strip().lower() if isinstance(q, str) else ""
    rows_all = list(reversed(_read_jsonl(_agent_reports_path(), limit=5000)))
    items: List[Dict[str, Any]] = []
    by_status: Dict[str, int] = {}
    by_quality: Dict[str, int] = {}
    failed_gate_count = 0
    artifact_count = 0
    heartbeat_count = 0
    for row in rows_all:
        if not scope_matches(row):
            continue
        row_type = str(row.get("type") or "report")
        if row_type == "heartbeat":
            heartbeat_count += 1
        row_status = str(row.get("status") or row.get("report_status") or row_type)
        quality = row.get("quality") if isinstance(row.get("quality"), dict) else {}
        decision = str(quality.get("decision") or "unknown")
        by_status[row_status] = by_status.get(row_status, 0) + 1
        by_quality[decision] = by_quality.get(decision, 0) + 1
        failed_gate_count += len(row.get("failed_gates") or [])
        if row.get("artifact_url") or row.get("artifact_path") or row.get("artifacts"):
            artifact_count += 1
        text = " ".join([
            str(row.get("id") or ""),
            str(row.get("task_id") or ""),
            str(row.get("claim_id") or ""),
            str(row.get("agent") or ""),
            str(row.get("summary") or ""),
            str(row.get("block_reason") or ""),
            str(row.get("next_action") or ""),
            row_status,
            decision,
        ]).lower()
        if status and row_status != status:
            continue
        if agent_l and agent_l not in str(row.get("agent") or "").lower():
            continue
        if task_id_l and task_id_l != str(row.get("task_id") or "").lower():
            continue
        if q_l and q_l not in text:
            continue
        item = dict(row)
        item["type"] = row_type
        item["status"] = row_status
        item["quality_decision"] = decision
        item["quality_score"] = quality.get("score")
        item["quality_blockers"] = quality.get("blockers") or []
        items.append(item)
    return {
        "ok": True,
        "scope": scope,
        "summary": {
            "reports": len(items),
            "total_records": len(rows_all),
            "heartbeats": heartbeat_count,
            "artifacts": artifact_count,
            "failed_gates": failed_gate_count,
            "by_status": by_status,
            "by_quality": by_quality,
        },
        "items": items[:limit],
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 和管理者审计自主开发交付记录、质量结果、失败卡点和后续动作。",
            "api": "/api/v1/tasks/agent-feed/reports",
            "cli": "sop task reports --json",
        },
    }


def _quality_tasks(body: QualityTasksIn) -> Dict[str, Any]:
    wanted = {str(x) for x in (body.decisions or [])}
    payload = _quality_summary_payload(limit=500)
    candidates = [
        row for row in (payload.get("recent") or [])
        if not wanted or str(row.get("decision") or "") in wanted
    ][: body.limit]
    planned: List[Dict[str, Any]] = []
    created: List[Dict[str, Any]] = []
    for row in candidates:
        tid = str(row.get("task_id") or "")
        decision = str(row.get("decision") or "")
        blockers = row.get("blockers") or []
        missing = row.get("missing_required") or []
        failed = row.get("failed_required") or []
        title = f"补齐任务质量证据：{tid or row.get('id')}"
        task = {
            "title": title,
            "description": "\n".join([
                f"质量决策: {decision}",
                f"质量评分: {row.get('score')}",
                f"阻断项: {', '.join(blockers) or '-'}",
                f"缺失必需卡点: {', '.join(missing) or '-'}",
                f"失败必需卡点: {', '.join(failed) or '-'}",
                "",
                "建议命令:",
                f"- sop task gates --task-id {tid} --json",
                f"- sop task evaluate --task-id {tid} --json",
                "- sop delivery workspace",
            ]),
            "priority": "P0" if decision == "block" else body.priority,
            "estimate": "S",
            "assigned_to": body.assigned_to,
            "dev_tool": "sop-cli",
            "source": "task_quality_governance",
            "source_report_id": str(row.get("id") or tid),
            "source_report_title": title,
            "debug_notes": f"quality_decision={decision} score={row.get('score')}",
        }
        planned.append(task)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**task)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "items": planned,
        "created": created,
        "summary": {
            "planned": len(planned),
            "created": len(created),
            "candidates": len(candidates),
            "avg_score": (payload.get("summary") or {}).get("avg_score", 0),
        },
    }


def _filter_tasks(
    raw: List[Dict[str, Any]],
    *,
    status: str = "",
    priority: str = "",
    sprint_id: str = "",
    source: str = "",
    q: str = "",
) -> List[Dict[str, Any]]:
    q_norm = q.strip().lower()
    if sprint_id:
        raw = [x for x in raw if x.get("sprint_id") == sprint_id]
    if status:
        raw = [x for x in raw if x.get("status") == status]
    if priority:
        raw = [x for x in raw if str(x.get("priority") or "").upper() == priority.upper()]
    if source:
        raw = [x for x in raw if str(x.get("source") or "") == source]
    if q_norm:
        def hit(item: Dict[str, Any]) -> bool:
            haystack = "\n".join(
                [
                    str(item.get("id") or ""),
                    str(item.get("title") or ""),
                    str(item.get("description") or ""),
                    str(item.get("assigned_to") or ""),
                    str(item.get("dev_tool") or ""),
                    str(item.get("branch") or ""),
                    str(item.get("source_report_id") or ""),
                    str(item.get("source_report_title") or ""),
                    str(item.get("debug_notes") or ""),
                ]
            ).lower()
            return q_norm in haystack

        raw = [x for x in raw if hit(x)]
    return raw


@router.get("")
def list_tasks(
    status: Optional[str] = None,
    sprint_id: Optional[str] = None,
    priority: Optional[str] = None,
    source: Optional[str] = None,
    q: Optional[str] = None,
):
    raw = rows("tasks", 500)
    st = _ui_load()
    raw = [_ui_merge_row(r, st) for r in raw]
    raw = _filter_tasks(
        raw,
        status=status or "",
        sprint_id=sprint_id or "",
        priority=priority or "",
        source=source or "",
        q=q or "",
    )
    if status or sprint_id or priority or source or q:
        return sorted(raw, key=lambda x: (x.get("priority", "P9"), str(x.get("created_at") or "")))
    return _ui_ordered_list(raw, st)


@router.get("/summary")
def tasks_summary():
    task_rows = [_ui_merge_row(r, _ui_load()) for r in rows("tasks", 1000)]
    by_status: Dict[str, int] = {}
    by_priority: Dict[str, int] = {}
    by_source: Dict[str, int] = {}
    by_tool: Dict[str, int] = {}
    assigned: Dict[str, int] = {}
    blocked = 0
    completed = 0
    for task in task_rows:
        status = str(task.get("status") or "pending")
        priority = str(task.get("priority") or "P3")
        source = str(task.get("source") or "manual")
        tool = str(task.get("dev_tool") or "manual")
        assignee = str(task.get("assigned_to") or "")
        by_status[status] = by_status.get(status, 0) + 1
        by_priority[priority] = by_priority.get(priority, 0) + 1
        by_source[source] = by_source.get(source, 0) + 1
        by_tool[tool] = by_tool.get(tool, 0) + 1
        if assignee:
            assigned[assignee] = assigned.get(assignee, 0) + 1
        if status == "blocked":
            blocked += 1
        if status == "completed":
            completed += 1
    total = len(task_rows)
    return {
        "ok": True,
        "summary": {
            "total": total,
            "completed": completed,
            "in_progress": by_status.get("in_progress", 0),
            "blocked": blocked,
            "completion_rate": round((completed / total) * 100, 1) if total else 0,
            "by_status": by_status,
            "by_priority": by_priority,
            "by_source": by_source,
            "by_tool": by_tool,
            "assigned": assigned,
        },
    }


@router.get("/hub")
def tasks_hub() -> dict[str, Any]:
    payload = tasks_summary()
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    charts = tasks_charts()
    return {
        "ok": True,
        "summary": summary,
        "charts": {
            "by_status": charts.get("by_status") or [],
            "by_priority": charts.get("by_priority") or [],
            "by_source": charts.get("by_source") or [],
        },
        "domains": [
            {"id": "execution", "path": "#/tasks/execution", "capability": "delivery.tasks.execution"},
            {"id": "board", "path": "#/tasks/board", "capability": "delivery.tasks.board"},
            {"id": "sprints", "path": "#/tasks/sprints", "capability": "delivery.tasks.sprints"},
            {"id": "dependencies", "path": "#/tasks/dependencies", "capability": "delivery.tasks.dependencies"},
            {"id": "scheduler", "path": "#/tasks/scheduler", "capability": "delivery.tasks.scheduler"},
        ],
    }


@router.get("/charts")
def tasks_charts() -> dict[str, Any]:
    """ECharts 友好：任务状态/优先级/来源分布。"""
    payload = tasks_summary()
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}

    def _pie(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]

    return {
        "ok": True,
        "by_status": _pie(summary.get("by_status") or {}),
        "by_priority": _pie(summary.get("by_priority") or {}),
        "by_source": _pie(summary.get("by_source") or {}),
        "by_tool": _pie(summary.get("by_tool") or {}),
    }


@router.get("/dependencies")
def task_dependencies():
    st = _ui_load()
    task_rows = [_ui_merge_row(r, st) for r in rows("tasks", 1000)]
    task_by_id = {str(t.get("id")): t for t in task_rows if t.get("id")}
    task_ids = {str(t.get("id")) for t in task_rows if t.get("id")}
    snapshot = _dependency_snapshot(task_rows, set())
    edges = [
        edge for edge in snapshot["edges"]
        if edge["target_id"] in task_ids
    ]
    outgoing: Dict[str, int] = {}
    incoming: Dict[str, int] = {}
    blockers: Dict[str, List[str]] = {}
    for edge in edges:
        outgoing[edge["source_id"]] = outgoing.get(edge["source_id"], 0) + 1
        incoming[edge["target_id"]] = incoming.get(edge["target_id"], 0) + 1
        if edge["type"] == "blocks" and edge["source_id"] not in snapshot["verified_completed"]:
            sources = blockers.setdefault(edge["target_id"], [])
            if edge["source_id"] not in sources:
                sources.append(edge["source_id"])
        edge["source_title"] = str((task_by_id.get(edge["source_id"]) or {}).get("title") or "")
        edge["target_title"] = str((task_by_id.get(edge["target_id"]) or {}).get("title") or "")
    nodes = []
    active_state = {row["id"]: row for row in snapshot["ready"] + snapshot["blocked"]}
    for task in task_rows:
        tid = str(task.get("id") or "")
        if not tid:
            continue
        is_blocked = bool(blockers.get(tid)) and tid not in snapshot["verified_completed"]
        state = active_state.get(tid, {})
        blocked_by = list(dict.fromkeys(blockers.get(tid, []) + state.get("blocked_by", [])))
        blocking_reason = snapshot["explicit_blocks"].get(tid, "")
        if blocking_reason and "delivery:blocked_reason" not in blocked_by:
            blocked_by.append("delivery:blocked_reason")
        nodes.append({
            "id": tid,
            "req_id": task.get("req_id") or "",
            "title": task.get("title") or "",
            "status": task.get("status") or "pending",
            "priority": task.get("priority") or "P3",
            "assigned_to": task.get("assigned_to") or "",
            "outgoing": outgoing.get(tid, 0),
            "incoming": incoming.get(tid, 0),
            "blocked_by": blocked_by,
            "blocking_reason": blocking_reason,
            "ready": bool(state.get("ready")),
            "is_dependency_blocked": is_blocked,
            "risk_level": "high" if blocked_by and str(task.get("priority") or "").upper() in {"P0", "P1"} else "medium" if blocked_by else "normal",
        })
    recommendations: List[Dict[str, Any]] = []
    if snapshot.get("cycle_ids"):
        recommendations.append({
            "id": "fix-dependency-cycle",
            "severity": "high",
            "title": "存在 blocks 依赖环路",
            "summary": f"{len(snapshot.get('cycle_ids') or [])} 个任务处于环路中，调度器无法自动推进。",
            "command": "sop task deps --json",
        })
    blocked_nodes = [n for n in nodes if n["is_dependency_blocked"]]
    if blocked_nodes:
        recommendations.append({
            "id": "unblock-priority-chain",
            "severity": "medium",
            "title": "优先处理阻塞链路",
            "summary": f"{len(blocked_nodes)} 个任务被 blocks 依赖阻塞，建议从 P0/P1 上游任务开始清理。",
            "command": "sop task schedule-insights --include-blocked --json",
        })
    if not edges:
        recommendations.append({
            "id": "build-dependency-map",
            "severity": "info",
            "title": "补齐任务依赖关系",
            "summary": "当前没有任务依赖，请在交付工作台的任务计划中维护前置任务。",
            "command": "sop task deps --json",
        })
    return {
        "ok": True,
        "nodes": nodes,
        "edges": edges,
        "stages": snapshot.get("stages") or [],
        "ready_queue": [
            {"id": t.get("id"), "title": t.get("title"), "priority": t.get("priority"), "status": t.get("status")}
            for t in _sort_scheduler_candidates(snapshot.get("ready") or [], "quality_first")
        ],
        "blocked_queue": [
            {"id": t.get("id"), "title": t.get("title"), "priority": t.get("priority"), "status": t.get("status"), "blocked_by": t.get("blocked_by") or []}
            for t in _sort_scheduler_candidates(snapshot.get("blocked") or [], "quality_first")
        ],
        "cycle_ids": snapshot.get("cycle_ids") or [],
        "recommendations": recommendations,
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 和调度器理解任务依赖图、阻塞链路、可执行队列和环路风险。",
            "api": "/api/v1/tasks/dependencies",
            "cli": "sop task deps --json",
            "scheduler": "sop task schedule-insights --json",
        },
        "summary": {
            "nodes": len(nodes),
            "edges": len(edges),
            "blocked": len(snapshot["blocked"]),
            "ready": len(snapshot.get("ready") or []),
            "cycles": len(snapshot.get("cycle_ids") or []),
            "stages": len(snapshot.get("stages") or []),
            "by_type": {"blocks": len(edges)},
        },
    }


def _dependency_governance_tasks(body: TaskDependencyTasksIn) -> Dict[str, Any]:
    graph = task_dependencies()
    nodes = list(graph.get("nodes") or [])
    edges = list(graph.get("edges") or [])
    node_by_id = {str(node.get("id")): node for node in nodes}
    planned: List[Dict[str, Any]] = []

    def _append(issue_id: str, severity: str, title: str, summary: str, commands: List[str], related_ids: List[str]) -> None:
        if len(planned) >= body.limit:
            return
        priority = "P0" if severity == "high" else body.priority
        planned.append({
            "title": title,
            "description": "\n".join([
                summary,
                "",
                f"Severity: {severity}",
                f"Related tasks: {', '.join([x for x in related_ids if x]) or '-'}",
                "",
                "Suggested commands:",
                *[f"- {cmd}" for cmd in commands],
            ]),
            "priority": priority,
            "estimate": "S",
            "assigned_to": body.assigned_to,
            "dev_tool": "sop-cli",
            "source": "task_dependency_governance",
            "source_report_id": issue_id,
            "source_report_title": title,
            "debug_notes": f"dependency_governance severity={severity} related={','.join(related_ids[:8])}",
        })

    if body.include_cycles and graph.get("cycle_ids"):
        cycle_ids = [str(x) for x in graph.get("cycle_ids") or []]
        _append(
            "dependency-cycle",
            "high",
            f"修复任务依赖环路：{len(cycle_ids)} 个任务",
            "任务依赖存在环路，请在交付工作台修正前置任务后重新计算调度。",
            [
                "sop task deps --json",
                "sop task dep-tasks --json",
                "sop task schedule-insights --include-blocked --json",
            ],
            cycle_ids,
        )

    if body.include_blocked:
        blocked_nodes = [
            node for node in nodes
            if node.get("is_dependency_blocked") and str(node.get("priority") or "").upper() in {"P0", "P1", "P2"}
        ]
        blocked_nodes.sort(key=lambda n: ({"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(str(n.get("priority")), 9), -len(n.get("blocked_by") or [])))
        for node in blocked_nodes:
            tid = str(node.get("id") or "")
            blockers = [str(x) for x in node.get("blocked_by") or []]
            severity = "high" if str(node.get("priority") or "").upper() in {"P0", "P1"} else "medium"
            _append(
                f"dependency-blocked-{tid}",
                severity,
                f"解除高优先级任务依赖阻塞：{node.get('title') or tid}",
                f"任务 {tid} 被 {len(blockers)} 个上游 blocks 依赖阻塞，建议先检查上游完成定义、质量卡点和是否需要拆边。",
                [
                    f"sop task agent-plan --task-id {tid} --json",
                    "sop task schedule --include-blocked --json",
                    f"sop task update {tid} --status pending --notes 'dependency reviewed'",
                ],
                [tid, *blockers],
            )

    if body.include_bottlenecks:
        bottlenecks = [node for node in nodes if int(node.get("outgoing") or 0) >= 3 and str(node.get("status") or "") != "completed"]
        bottlenecks.sort(key=lambda n: (-int(n.get("outgoing") or 0), {"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(str(n.get("priority")), 9)))
        for node in bottlenecks[: body.limit]:
            tid = str(node.get("id") or "")
            downstream = [str(edge.get("target_id")) for edge in edges if str(edge.get("source_id")) == tid and edge.get("type") == "blocks"]
            _append(
                f"dependency-bottleneck-{tid}",
                "medium",
                f"拆解关键上游阻塞瓶颈：{node.get('title') or tid}",
                f"任务 {tid} 阻塞 {len(downstream)} 个下游任务，是当前 DAG 的关键上游瓶颈。",
                [
                    f"sop task agent-plan --task-id {tid} --json",
                    "sop delivery targets",
                    "sop task schedule-insights --include-blocked --json",
                ],
                [tid, *downstream],
            )

    if body.include_missing_map and not edges:
        high_tasks = [
            str(node.get("id")) for node in nodes
            if str(node.get("priority") or "").upper() in {"P0", "P1"} and str(node.get("status") or "") != "completed"
        ]
        if high_tasks:
            _append(
                "dependency-map-missing",
                "medium",
                "补齐高优先级任务依赖地图",
                "当前任务池没有前置任务关系，请在交付工作台补齐任务计划。",
                [
                    "sop task deps --json",
                    "sop task schedule-insights --json",
                    "sop task schedule --apply",
                ],
                high_tasks[:20],
            )

    created: List[Dict[str, Any]] = []
    if not body.dry_run:
        for item in planned:
            created.append(create_task(TaskCreate(**item)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "scope": _scope_payload(),
        "summary": {
            "planned": len(planned),
            "created": len(created),
            "nodes": len(nodes),
            "edges": len(edges),
            "blocked": (graph.get("summary") or {}).get("blocked", 0),
            "cycles": (graph.get("summary") or {}).get("cycles", 0),
        },
        "items": planned,
        "created": created,
        "graph_summary": graph.get("summary") or {},
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 将依赖图风险转成可执行治理任务，打通依赖诊断到修复派单。",
            "api": "/api/v1/tasks/dependencies/tasks",
            "cli": "sop task dep-tasks --json",
            "source": "task_dependency_governance",
        },
    }


@router.post("/dependencies/tasks")
def task_dependency_tasks(body: TaskDependencyTasksIn):
    return _dependency_governance_tasks(body)


@router.post("")
def create_task(body: TaskCreate):
    validate_business_references(req_id=body.req_id, sprint_id=body.sprint_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    tid = f"T-{int(now().timestamp() * 1000)}-{uuid.uuid4().hex[:8]}"
    row = {
        "id": tid,
        "project_id": resolved_project_id(),
        "req_id": body.req_id or "",
        "sprint_id": body.sprint_id or "",
        "title": body.title,
        "description": body.description or "",
        "status": "pending",
        "priority": body.priority,
        "estimate": body.estimate,
        "assigned_to": body.assigned_to or "Coder",
        "actual_hours": 0.0,
        "confidence": 0.0,
        "created_at": now(),
        "updated_at": now(),
    }
    t.add([row])
    st = _ui_load()
    _ui_append_to_column(st, tid, body.priority)
    fld: Dict[str, Any] = {}
    if (body.dev_tool or "").strip():
        fld["dev_tool"] = (body.dev_tool or "").strip()
    if (body.artifact_url or "").strip():
        fld["artifact_url"] = (body.artifact_url or "").strip()[:800]
    if (body.artifact_path or "").strip():
        fld["artifact_path"] = (body.artifact_path or "").strip()[:400]
    if (body.debug_notes or "").strip():
        fld["debug_notes"] = (body.debug_notes or "").strip()[:2000]
    if (body.branch or "").strip():
        fld["branch"] = (body.branch or "").strip()[:120]
    if (body.source or "").strip():
        fld["source"] = (body.source or "").strip()[:120]
    if (body.source_report_id or "").strip():
        fld["source_report_id"] = (body.source_report_id or "").strip()[:160]
    if (body.source_report_title or "").strip():
        fld["source_report_title"] = (body.source_report_title or "").strip()[:240]
    if fld:
        st.setdefault("fields", {})[tid] = fld
    _ui_save(st)
    notify_webhook(
        "task.created",
        {"task_id": tid, "title": body.title, "priority": body.priority, "status": "pending"},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "id": tid}


@router.post("/reorder-board")
def reorder_tasks_board(body: ReorderTasksBody):
    raw = rows("tasks", 500)
    all_ids = {r["id"] for r in raw if r.get("id")}
    groups: Dict[str, List[str]] = {p: [] for p in _PRIOS}
    combined: List[str] = []
    raw_in = body.groups or {}
    for p in _PRIOS:
        arr = raw_in.get(p)
        if not isinstance(arr, list):
            arr = raw_in.get(p.lower()) or []
        if not isinstance(arr, list):
            arr = []
        for tid in arr:
            tid = _safe_task_id(str(tid).strip())
            if tid not in all_ids:
                raise HTTPException(400, f"未知任务 ID: {tid}")
            groups[p].append(tid)
            combined.append(tid)
    if len(combined) != len(set(combined)):
        raise HTTPException(400, "任务 ID 重复")
    if set(combined) != all_ids:
        raise HTTPException(400, "各列须覆盖当前全部任务 ID 且无多余项")
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    ts = now()
    for p in _PRIOS:
        for tid in groups[p]:
            t.update(where=f"id = '{tid}'", values={"priority": p, "updated_at": ts})
    st = _ui_load()
    st["columns"] = groups
    _ui_save(st)
    return {"ok": True}


@router.patch("/bulk")
def bulk_update_tasks(body: TaskBulkUpdate):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    ids = [_safe_task_id(str(tid).strip()) for tid in body.ids if str(tid).strip()]
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise HTTPException(400, "ids 不能为空")
    existing = {str(x.get("id")) for x in rows("tasks", 1000) if x.get("id")}
    missing = [tid for tid in ids if tid not in existing]
    if missing:
        raise HTTPException(400, f"未知任务 ID: {', '.join(missing[:10])}")
    vals: Dict[str, Any] = {}
    if body.status is not None:
        status = str(body.status).strip()
        if status not in {"pending", "in_progress", "blocked", "completed"}:
            raise HTTPException(400, "非法任务状态")
        vals["status"] = status
    if body.priority is not None:
        priority = str(body.priority).strip().upper()
        if priority not in _PRIOS:
            raise HTTPException(400, "非法任务优先级")
        vals["priority"] = priority
    if body.assigned_to is not None:
        vals["assigned_to"] = str(body.assigned_to).strip()[:64]
    if not vals:
        raise HTTPException(400, "未提供可更新字段")
    if vals.get("status") in {"in_progress", "completed"}:
        _require_task_dependencies(ids, target_status=vals["status"])
    vals["updated_at"] = now()
    for tid in ids:
        t.update(where=f"id = '{tid}'", values=vals)
    if "priority" in vals:
        st = _ui_load()
        for tid in ids:
            _ui_append_to_column(st, tid, str(vals["priority"]))
        _ui_save(st)
    notify_webhook(
        "task.bulk_updated",
        {"task_ids": ids, "fields": [k for k in vals.keys() if k != "updated_at"], "count": len(ids)},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    if "status" in vals:
        notify_webhook(
            "task.status_changed",
            {"task_ids": ids, "status": vals["status"], "via": "bulk"},
            tenant_id=resolved_tenant_id(),
            project_id=resolved_project_id(),
        )
    return {"ok": True, "updated": len(ids), "fields": [k for k in vals.keys() if k != "updated_at"]}


@router.post("/dispatch-plan")
def dispatch_tasks(body: TaskDispatchIn):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    st = _ui_load()
    task_rows = [_ui_merge_row(r, st) for r in rows("tasks", 1000)]
    plan = _dispatch_plan(task_rows, body)
    if body.dry_run:
        return {"ok": True, "dry_run": True, "items": plan, "total": len(plan)}

    ts = now()
    fld = st.setdefault("fields", {})
    applied = 0
    applied_ids = []
    for item in plan:
        if not item["ready"]:
            continue
        tid = _safe_task_id(str(item.get("task_id") or ""))
        t.update(where=f"id = '{tid}'", values={"assigned_to": item["assigned_to"], "updated_at": ts})
        task_fields = fld.setdefault(tid, {})
        task_fields["dev_tool"] = item["dev_tool"]
        task_fields["debug_notes"] = (
            f"智能分发: {item['reason']} ready={item['ready']} order={item['order']} "
            f"blocked_by={','.join(item.get('blocked_by') or [])}"
        )[:2000]
        applied += 1
        applied_ids.append(tid)
    _ui_save(st)
    notify_webhook(
        "task.dispatched",
        {"count": applied, "strategy": body.strategy, "task_ids": applied_ids},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "dry_run": False, "updated": applied, "items": plan, "total": len(plan)}


@router.post("/scheduler/plan")
def task_scheduler_plan(body: TaskSchedulerIn):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    st = _ui_load()
    task_rows = [_ui_merge_row(r, st) for r in rows("tasks", 1000)]
    plan = _scheduler_plan(task_rows, body)
    if body.dry_run:
        return plan

    ts = now()
    fields = st.setdefault("fields", {})
    applied = 0
    for packet in plan["agent_packets"]:
        if not packet.get("ready"):
            continue
        tid = _safe_task_id(str(packet.get("task_id") or ""))
        t.update(where=f"id = '{tid}'", values={"assigned_to": packet["assigned_to"], "updated_at": ts})
        task_fields = fields.setdefault(tid, {})
        task_fields["dev_tool"] = packet["dev_tool"]
        task_fields["debug_notes"] = (
            f"Hermes 调度: policy={body.policy} lane={packet['lane']} order={packet['order']} "
            f"quality_gates={len(packet.get('quality_gates') or [])} reason={packet.get('dispatch_reason') or ''}"
        )[:2000]
        applied += 1
    _ui_save(st)
    run = {
        "schedule_id": plan["schedule_id"],
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "scope": plan["scope"],
        "status": "applied",
        "policy": body.policy,
        "event": body.event,
        "applied": applied,
        "summary": plan["summary"],
        "stages": plan.get("stages") or [],
        "agent_packets": plan.get("agent_packets") or [],
        "event_wakeups": plan.get("event_wakeups") or [],
        "ready_queue": plan.get("ready_queue") or [],
        "blocked_queue": plan.get("blocked_queue") or [],
        "task_ids": [packet.get("task_id") for packet in plan["agent_packets"]],
        "archived": False,
    }
    _append_jsonl(_scheduler_runs_path(), run)
    notify_webhook(
        "task.scheduler_planned",
        {"schedule_id": plan["schedule_id"], "policy": body.policy, "applied": applied, "summary": plan["summary"]},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    plan["dry_run"] = False
    plan["applied"] = applied
    return plan


@router.get("/scheduler/runs")
def task_scheduler_runs(limit: int = Query(20, ge=1, le=100), q: str = Query("", max_length=200), include_archived: bool = False):
    lim = limit if isinstance(limit, int) else 20
    query = q if isinstance(q, str) else ""
    return _scheduler_runs(limit=lim, q=query, include_archived=bool(include_archived))


@router.get("/scheduler/runs/{schedule_id}")
def task_scheduler_run_detail(schedule_id: str):
    _, record = _find_scheduler_run(schedule_id)
    if not record:
        raise HTTPException(404, "调度运行记录不存在")
    return {"ok": True, "item": record, "summary": _scheduler_run_item(record)}


@router.get("/scheduler/ops-summary")
def task_scheduler_ops_summary():
    return _scheduler_ops_payload()


@router.post("/scheduler/runbook")
def task_scheduler_runbook(body: TaskSchedulerRunbookIn):
    return _scheduler_runbook(body)


@router.post("/scheduler/insights")
def task_scheduler_insights(body: TaskSchedulerInsightsIn):
    return _scheduler_insights(body)


@router.post("/scheduler/insights/tasks")
def task_scheduler_insight_tasks(body: TaskSchedulerInsightTasksIn):
    return _scheduler_insight_tasks(body)


@router.post("/scheduler/runs/{schedule_id}/action")
def task_scheduler_run_action(schedule_id: str, body: TaskSchedulerActionIn):
    records, record = _find_scheduler_run(schedule_id)
    if not record:
        raise HTTPException(404, "调度运行记录不存在")
    if body.action == "rerun":
        ids = [str(x) for x in (record.get("task_ids") or []) if str(x).strip()]
        plan = _scheduler_plan(
            [_ui_merge_row(r, _ui_load()) for r in rows("tasks", 1000)],
            TaskSchedulerIn(
                ids=ids,
                dry_run=body.dry_run,
                max_items=max(1, len(ids) or 50),
                max_parallel=body.max_parallel,
                include_blocked=body.include_blocked,
                policy=body.policy,
                event=f"rerun:{schedule_id}",
            ),
        )
        plan["parent_schedule_id"] = schedule_id
        if body.dry_run:
            return {"ok": True, "action": body.action, "dry_run": True, "plan": plan}
        applied = 0
        t = table("tasks")
        if t is None:
            raise HTTPException(503, "数据库不可用")
        st = _ui_load()
        fields = st.setdefault("fields", {})
        ts = now()
        for packet in plan["agent_packets"]:
            if not packet.get("ready"):
                continue
            tid = _safe_task_id(str(packet.get("task_id") or ""))
            t.update(where=f"id = '{tid}'", values={"assigned_to": packet["assigned_to"], "updated_at": ts})
            task_fields = fields.setdefault(tid, {})
            task_fields["dev_tool"] = packet["dev_tool"]
            task_fields["debug_notes"] = f"Hermes 调度重放: parent={schedule_id} policy={body.policy} lane={packet['lane']} order={packet['order']}"[:2000]
            applied += 1
        _ui_save(st)
        child = {
            "schedule_id": plan["schedule_id"],
            "parent_schedule_id": schedule_id,
            "created_at": _utc_now(),
            "updated_at": _utc_now(),
            "scope": plan["scope"],
            "status": "applied",
            "policy": body.policy,
            "event": f"rerun:{schedule_id}",
            "applied": applied,
            "summary": plan["summary"],
            "stages": plan.get("stages") or [],
            "agent_packets": plan.get("agent_packets") or [],
            "event_wakeups": plan.get("event_wakeups") or [],
            "ready_queue": plan.get("ready_queue") or [],
            "blocked_queue": plan.get("blocked_queue") or [],
            "task_ids": [packet.get("task_id") for packet in plan["agent_packets"]],
            "archived": False,
            "note": body.note,
        }
        _append_jsonl(_scheduler_runs_path(), child)
        notify_webhook(
            "task.scheduler_rerun",
            {"schedule_id": child["schedule_id"], "parent_schedule_id": schedule_id, "applied": applied},
            tenant_id=resolved_tenant_id(),
            project_id=resolved_project_id(),
        )
        return {"ok": True, "action": body.action, "dry_run": False, "created": child, "plan": plan, "applied": applied}

    if body.dry_run:
        preview = dict(record)
        if body.action == "cancel":
            preview["status"] = "cancelled"
        elif body.action == "archive":
            preview["archived"] = True
            preview["status"] = "archived"
        elif body.action == "restore":
            preview["archived"] = False
            preview["status"] = "applied"
        preview["note"] = body.note
        return {"ok": True, "action": body.action, "dry_run": True, "item": preview}

    now_at = _utc_now()
    for item in records:
        if str(item.get("schedule_id") or item.get("id") or "") != schedule_id:
            continue
        if body.action == "cancel":
            item["status"] = "cancelled"
        elif body.action == "archive":
            item["archived"] = True
            item["status"] = "archived"
        elif body.action == "restore":
            item["archived"] = False
            item["status"] = "applied"
        item["updated_at"] = now_at
        item["note"] = body.note
        events = item.setdefault("events", [])
        if isinstance(events, list):
            events.append({"event": f"scheduler.{body.action}", "at": now_at, "note": body.note})
    _write_jsonl(_scheduler_runs_path(), records)
    notify_webhook(
        f"task.scheduler_{body.action}",
        {"schedule_id": schedule_id, "note": body.note},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    _, updated = _find_scheduler_run(schedule_id)
    return {"ok": True, "action": body.action, "item": updated}


@router.get("/quality/policy")
def task_quality_policy():
    task_rows = [_ui_merge_row(r, _ui_load()) for r in rows("tasks", 1000)]
    sample: Dict[str, Any] = task_rows[0] if task_rows else {"id": "T-sample", "title": "sample", "description": ""}
    policy = _load_quality_policy()
    gates = _quality_gates(sample)
    quality_summary = _quality_summary_payload(limit=200).get("summary") or {}
    return {
        "ok": True,
        "scope": _scope_payload(),
        "policy": policy,
        "default_gates": gates,
        "summary": {
            "required": len(policy.get("required_gate_ids") or []),
            "advisory": len(policy.get("advisory_gate_ids") or []),
            "mode": policy.get("mode"),
            "evaluations": quality_summary.get("evaluations", 0),
            "avg_score": quality_summary.get("avg_score", 100),
            "block": quality_summary.get("block", 0),
            "warn": quality_summary.get("warn", 0),
        },
    }


@router.get("/quality/summary")
def task_quality_summary(limit: int = Query(100, ge=1, le=500)):
    return _quality_summary_payload(limit=limit if isinstance(limit, int) else 100)


@router.post("/quality/tasks")
def task_quality_tasks(body: QualityTasksIn):
    return _quality_tasks(body)


@router.put("/quality/policy")
def task_quality_policy_update(body: QualityPolicyIn):
    policy = {
        **_quality_policy_default(),
        **body.model_dump(),
        "updated_at": _utc_iso(),
        "scope": _scope_payload(),
    }
    _save_quality_policy(policy)
    notify_webhook(
        "task.quality_policy_updated",
        {"mode": policy["mode"], "required_gate_ids": policy["required_gate_ids"]},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "policy": policy}


@router.get("/{task_id}/quality")
def task_quality(task_id: str):
    task_id = _safe_task_id(task_id)
    st = _ui_load()
    row = next((x for x in rows("tasks", 1000) if x.get("id") == task_id), None)
    if not row:
        raise HTTPException(404, "任务不存在")
    task = _ui_merge_row(row, st)
    evaluation = _evaluate_quality(
        task,
        [],
        confidence=task.get("confidence") if task.get("confidence") is not None else None,
        artifact_url=str(task.get("artifact_url") or ""),
        artifact_path=str(task.get("artifact_path") or ""),
        status=str(task.get("status") or ""),
        source="task.quality.preview",
    )
    return {"ok": True, "task": task, "quality": evaluation}


@router.post("/quality/evaluate")
def task_quality_evaluate(body: QualityEvaluateIn):
    task_id = _safe_task_id(body.task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    st = _ui_load()
    row = next((x for x in rows("tasks", 1000) if x.get("id") == task_id), None)
    if not row:
        raise HTTPException(404, "任务不存在")
    task = _ui_merge_row(row, st)
    evaluation = _evaluate_quality(
        task,
        [g for g in body.gate_results if isinstance(g, dict)],
        confidence=body.confidence,
        artifact_url=body.artifact_url,
        artifact_path=body.artifact_path,
        status=body.status,
        source=body.source,
    )
    if not body.dry_run:
        _append_jsonl(_quality_evaluations_path(), evaluation)
        if evaluation["decision"] == "block":
            t.update(
                where=f"id = '{task_id}'",
                values={
                    "status": "blocked",
                    "human_notes": ("质量卡点阻断: " + ", ".join(evaluation.get("blockers") or []))[:4000],
                    "updated_at": now(),
                },
            )
    return {"ok": True, "dry_run": body.dry_run, "quality": evaluation}


@router.get("/agent-feed")
def task_agent_feed(limit: int = Query(10, ge=1, le=100), agent: str = "", include_blocked: bool = False):
    st = _ui_load()
    task_rows = [_ui_merge_row(r, st) for r in rows("tasks", 1000)]
    body = TaskSchedulerIn(
        dry_run=True,
        max_items=limit,
        max_parallel=max(1, min(limit, 20)),
        include_blocked=include_blocked,
        policy="quality_first",
        agent_pool=[agent] if agent.strip() else [],
        event="agent.feed.pull",
    )
    plan = _scheduler_plan(task_rows, body)
    return {
        "ok": True,
        "scope": plan["scope"],
        "summary": plan["summary"],
        "items": plan["agent_packets"],
        "event_wakeups": plan["event_wakeups"],
        "protocol": {
            "preview": "POST /api/v1/delivery/execution-preview",
            "command": "POST /api/v1/delivery/commands",
            "observations": "GET /api/v1/delivery/executions/{execution_id}/observations",
        },
    }


@router.get("/agent-feed/claims")
def task_agent_claims(status: str = Query("active", pattern="^(active|all|closed)$"), limit: int = Query(50, ge=1, le=500)):
    state = _load_agent_claims()
    rows_all = [dict(row) for row in (state.get("claims") or {}).values()]
    if status == "active":
        rows_all = [row for row in rows_all if _claim_active(row)]
    elif status == "closed":
        rows_all = [row for row in rows_all if not _claim_active(row)]
    rows_all.sort(key=lambda row: str(row.get("updated_at") or row.get("claimed_at") or ""), reverse=True)
    return {"ok": True, "scope": _scope_payload(), "items": rows_all[:limit], "total": len(rows_all)}




@router.post("/agent-feed/execution-plan")
def task_agent_execution_plan(body: TaskAgentPlanIn):
    claim: Dict[str, Any] | None = None
    task_id = body.task_id.strip()
    if body.claim_id:
        claim = (_load_agent_claims().get("claims") or {}).get(body.claim_id)
        if not claim:
            raise HTTPException(404, "领取记录不存在")
        task_id = str(claim.get("task_id") or task_id)
        if body.agent and str(claim.get("agent") or "") != body.agent.strip():
            raise HTTPException(403, "Agent 与领取记录不一致")
    if not task_id:
        raise HTTPException(400, "task_id 或 claim_id 必填")
    return _agent_execution_plan(task_id, claim=claim, agent=body.agent, include_context=body.include_context)


@router.get("/agent-feed/reports")
def task_agent_reports(
    limit: int = Query(100, ge=1, le=500),
    status: str = Query("", max_length=40),
    agent: str = Query("", max_length=120),
    task_id: str = Query("", max_length=100),
    q: str = Query("", max_length=200),
):
    return _agent_reports_payload(limit=limit, status=status, agent=agent, task_id=task_id, q=q)


@router.get("/{task_id}/agent-plan")
def task_agent_plan(task_id: str, claim_id: str = Query("", max_length=80), agent: str = Query("", max_length=120), include_context: bool = True):
    claim = None
    if claim_id:
        claim = (_load_agent_claims().get("claims") or {}).get(claim_id)
        if not claim:
            raise HTTPException(404, "领取记录不存在")
        if str(claim.get("task_id") or "") != _safe_task_id(task_id):
            raise HTTPException(400, "claim_id 与 task_id 不匹配")
        if agent and str(claim.get("agent") or "") != agent.strip():
            raise HTTPException(403, "Agent 与领取记录不一致")
    return _agent_execution_plan(task_id, claim=claim, agent=agent, include_context=include_context)




@router.post("/{task_id}:pull")
def pull_task(task_id: str):
    _safe_task_id(task_id)
    _require_task_dependencies([task_id], target_status="in_progress")
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    t.update(where=f"id = '{task_id}'", values={"status": "in_progress", "updated_at": now()})
    notify_webhook(
        "task.status_changed",
        {"task_id": task_id, "status": "in_progress", "via": "pull"},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    row = next((x for x in rows("tasks", 500) if x.get("id") == task_id), None)
    if not row:
        return {"ok": True, "id": task_id, "status": "in_progress"}
    return _ui_merge_row(row, _ui_load())




@router.patch("/{task_id}/unblock")
def unblock_task(task_id: str, human_notes: str = Body("", embed=True)):
    _safe_task_id(task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    t.update(
        where=f"id = '{task_id}'",
        values={"status": "pending", "human_notes": human_notes or "", "updated_at": now()},
    )
    notify_webhook(
        "task.status_changed",
        {"task_id": task_id, "status": "pending", "via": "unblock"},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True}


@router.patch("/{task_id}")
def update_task(task_id: str, body: TaskUpdate):
    _safe_task_id(task_id)
    validate_business_references(req_id=body.req_id, sprint_id=body.sprint_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    try:
        raw = body.model_dump(exclude_unset=True)
    except AttributeError:
        raw = body.dict(exclude_unset=True)
    ui_keys = ("dev_tool", "artifact_url", "artifact_path", "debug_notes", "branch", "source_report_id", "source_report_title", "source")
    ui_patch: Dict[str, Any] = {}
    for uk in ui_keys:
        if uk in raw:
            ui_patch[uk] = raw.pop(uk)
    vals = {k: v for k, v in raw.items() if v is not None}
    if not vals and not ui_patch:
        return {"ok": True}
    if vals.get("status") in {"in_progress", "completed"}:
        _require_task_dependencies([task_id], target_status=vals["status"])
    if vals:
        vals["updated_at"] = now()
        t.update(where=f"id = '{task_id}'", values=vals)
    st = _ui_load()
    if "priority" in vals:
        _ui_append_to_column(st, task_id, str(vals["priority"]))
    if ui_patch:
        fld = st.setdefault("fields", {}).setdefault(task_id, {})
        for k, v in ui_patch.items():
            if v is None or (isinstance(v, str) and not str(v).strip()):
                fld.pop(k, None)
                continue
            s = str(v).strip()
            if k == "artifact_url":
                fld[k] = s[:800]
            elif k == "artifact_path":
                fld[k] = s[:400]
            elif k == "debug_notes":
                fld[k] = s[:2000]
            elif k == "branch":
                fld[k] = s[:120]
            elif k == "dev_tool":
                fld[k] = s[:80]
            elif k == "source_report_id":
                fld[k] = s[:80]
            elif k == "source_report_title":
                fld[k] = s[:160]
            elif k == "source":
                fld[k] = s[:80]
    if "priority" in vals or ui_patch:
        _ui_save(st)
    if vals or ui_patch:
        notify_webhook(
            "task.updated",
            {"task_id": task_id, "fields": list(vals.keys()) if vals else []},
            tenant_id=resolved_tenant_id(),
            project_id=resolved_project_id(),
        )
    if "status" in vals:
        notify_webhook(
            "task.status_changed",
            {"task_id": task_id, "status": vals["status"]},
            tenant_id=resolved_tenant_id(),
            project_id=resolved_project_id(),
        )
    return {"ok": True}


@router.delete("/{task_id}")
def delete_task(task_id: str):
    _safe_task_id(task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    t.delete(f"id = '{task_id}'")
    st = _ui_load()
    _ui_delete_id(st, task_id)
    _ui_save(st)
    notify_webhook(
        "task.deleted",
        {"task_id": task_id},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True}


@router.get("/{task_id}")
def get_task(task_id: str, db: Annotated[Session, Depends(get_session)]):
    """Return the same scoped business row and UI fields as the task list."""
    from .db_sql_compat import _to_dict
    from .sql_models import Task

    _safe_task_id(task_id)
    task = db.query(Task).filter_by(
        id=task_id, tenant_id=resolved_tenant_id(), project_id=resolved_project_id()
    ).first()
    if not task:
        raise HTTPException(404, "任务不存在")
    return _ui_merge_row(_to_dict(task), _ui_load())
