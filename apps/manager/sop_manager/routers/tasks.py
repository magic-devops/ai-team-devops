from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field

from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
    resolved_tenant_id,
)
from .db_sql_compat import rows, table, now
from .webhook import notify_webhook

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

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
    return {"version": 1, "columns": {p: [] for p in _PRIOS}, "fields": {}, "dependencies": {}}


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
        d.setdefault("dependencies", {})
        for p in _PRIOS:
            d["columns"].setdefault(p, [])
        return d
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
    deps = st.setdefault("dependencies", {})
    deps.pop(task_id, None)
    for source_id, edges in list(deps.items()):
        deps[source_id] = [e for e in edges if e.get("target_id") != task_id]


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


class TaskAgentReportIn(BaseModel):
    claim_id: str = Field("", max_length=80)
    agent: str = Field("", max_length=120)
    status: Optional[str] = Field(None, pattern="^(pending|in_progress|blocked|completed)$")
    progress: int = Field(0, ge=0, le=100)
    summary: str = Field("", max_length=4000)
    confidence: Optional[float] = Field(None, ge=0, le=1)
    artifact_url: str = Field("", max_length=800)
    artifact_path: str = Field("", max_length=400)
    artifacts: List[Dict[str, Any]] = Field(default_factory=list, max_length=50)
    branch: str = Field("", max_length=120)
    gate_results: List[Dict[str, Any]] = Field(default_factory=list, max_length=50)
    block_reason: str = Field("", max_length=1000)
    next_action: str = Field("", max_length=1000)


class TaskAgentClaimIn(BaseModel):
    task_id: str = ""
    packet_id: str = ""
    agent: str = Field("HermesAgent", max_length=120)
    dev_tool: str = Field("", max_length=80)
    lease_seconds: int = Field(900, ge=60, le=86400)
    force: bool = False
    auto_start: bool = True
    note: str = Field("", max_length=1000)


class TaskAgentHeartbeatIn(BaseModel):
    claim_id: str = Field("", max_length=80)
    task_id: str = ""
    agent: str = Field("", max_length=120)
    progress: int = Field(0, ge=0, le=100)
    state: str = Field("running", pattern="^(claimed|running|heartbeat|blocked)$")
    status_message: str = Field("", max_length=1000)
    extend_seconds: int = Field(900, ge=60, le=86400)


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


class TaskDependencyIn(BaseModel):
    target_id: str
    type: str = Field("blocks", pattern="^(blocks|relates|duplicates)$")
    note: str = ""


def _task_by_id(task_id: str) -> Dict[str, Any] | None:
    return next((x for x in rows("tasks", 1000) if x.get("id") == task_id), None)


def _dep_edges(st: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    deps = st.get("dependencies") or {}
    if not isinstance(deps, dict):
        return out
    for source_id, edges in deps.items():
        if not isinstance(edges, list):
            continue
        for edge in edges:
            if not isinstance(edge, dict):
                continue
            target_id = str(edge.get("target_id") or "")
            if not target_id:
                continue
            out.append({
                "source_id": str(source_id),
                "target_id": target_id,
                "type": str(edge.get("type") or "blocks"),
                "note": str(edge.get("note") or ""),
                "created_at": str(edge.get("created_at") or ""),
            })
    return out


def _would_cycle(source_id: str, target_id: str, edges: List[Dict[str, Any]]) -> bool:
    graph: Dict[str, List[str]] = {}
    for edge in edges:
        if edge.get("type") != "blocks":
            continue
        graph.setdefault(str(edge["source_id"]), []).append(str(edge["target_id"]))
    graph.setdefault(source_id, []).append(target_id)
    seen: set[str] = set()

    def visit(node: str) -> bool:
        if node == source_id:
            return True
        if node in seen:
            return False
        seen.add(node)
        return any(visit(n) for n in graph.get(node, []))

    return visit(target_id)


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
    edges = _dep_edges(_ui_load())
    blockers: Dict[str, list[str]] = {}
    completed = {str(t.get("id")) for t in tasks if str(t.get("status") or "") == "completed"}
    for edge in edges:
        if edge.get("type") != "blocks":
            continue
        source = str(edge.get("source_id") or "")
        target = str(edge.get("target_id") or "")
        if source and target and source not in completed:
            blockers.setdefault(target, []).append(source)

    candidates: list[Dict[str, Any]] = []
    for task in tasks:
        tid = str(task.get("id") or "")
        if not tid:
            continue
        if selected and tid not in selected:
            continue
        if str(task.get("status") or "pending") == "completed":
            continue
        blocked_by = blockers.get(tid, [])
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
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _scope_payload() -> Dict[str, str]:
    return {
        "tenant_id": resolved_tenant_id(),
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
    }


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
        return data
    except Exception:
        return _agent_claims_default()


def _save_agent_claims(data: Dict[str, Any]) -> None:
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
    task_by_id = {str(task.get("id")): task for task in task_rows if task.get("id")}
    active_ids = [
        tid
        for tid, task in task_by_id.items()
        if (not selected or tid in selected) and str(task.get("status") or "pending") != "completed"
    ]
    active = set(active_ids)
    completed = {tid for tid, task in task_by_id.items() if str(task.get("status") or "") == "completed"}
    edges = [edge for edge in _dep_edges(_ui_load()) if edge.get("type") == "blocks"]
    blockers: Dict[str, List[str]] = {}
    graph: Dict[str, List[str]] = {tid: [] for tid in active}
    indegree: Dict[str, int] = {tid: 0 for tid in active}
    for edge in edges:
        source = str(edge.get("source_id") or "")
        target = str(edge.get("target_id") or "")
        if target not in active:
            continue
        if source and source not in completed:
            blockers.setdefault(target, []).append(source)
        if source in active and target in active:
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
        row = {**task, "blocked_by": blocked_by, "ready": not bool(blocked_by)}
        if blocked_by:
            blocked.append(row)
        else:
            ready.append(row)
    return {"stages": stages, "ready": ready, "blocked": blocked, "cycle_ids": cycle_ids, "edges": edges}


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
                "所有必需质量卡点有证据，失败卡点需要回写 blocked 和下一步动作。",
                "执行结果通过 agent-report 或 task update 回写，保留 artifact/branch/notes。",
            ],
        },
        "quality_gates": gates,
        "claim": claim,
        "callbacks": {
            "claim": "POST /api/v1/tasks/agent-feed/claim",
            "heartbeat": "POST /api/v1/tasks/agent-feed/heartbeat",
            "pull": f"POST /api/v1/tasks/{tid}:pull",
            "update": f"PATCH /api/v1/tasks/{tid}",
            "agent_report": f"POST /api/v1/tasks/{tid}/agent-report",
            "events_ingest": "POST /api/v1/events:ingest",
        },
        "suggested_commands": [
            "sop context prepare --flush",
            f"sop task claim --task-id {tid} --agent {assigned_to}",
            f"sop task heartbeat --task-id {tid} --agent {assigned_to} --progress 50",
            f"sop task report {tid} --status completed --confidence 0.8 --summary '<what changed>'",
        ],
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
        {"event": "task.status_changed", "action": "unlock_downstream_when_completed", "target": "scheduler"},
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
    task_rows = rows("tasks", 1000)
    task_ids = {str(t.get("id")) for t in task_rows if t.get("id")}
    st = _ui_load()
    edges = [
        edge for edge in _dep_edges(st)
        if edge["source_id"] in task_ids and edge["target_id"] in task_ids
    ]
    outgoing: Dict[str, int] = {}
    incoming: Dict[str, int] = {}
    blockers: Dict[str, List[str]] = {}
    for edge in edges:
        outgoing[edge["source_id"]] = outgoing.get(edge["source_id"], 0) + 1
        incoming[edge["target_id"]] = incoming.get(edge["target_id"], 0) + 1
        if edge["type"] == "blocks":
            blockers.setdefault(edge["target_id"], []).append(edge["source_id"])
    nodes = []
    for task in task_rows:
        tid = str(task.get("id") or "")
        if not tid:
            continue
        nodes.append({
            "id": tid,
            "title": task.get("title") or "",
            "status": task.get("status") or "pending",
            "priority": task.get("priority") or "P3",
            "assigned_to": task.get("assigned_to") or "",
            "outgoing": outgoing.get(tid, 0),
            "incoming": incoming.get(tid, 0),
            "blocked_by": blockers.get(tid, []),
            "is_dependency_blocked": bool(blockers.get(tid)) and task.get("status") != "completed",
        })
    return {
        "ok": True,
        "nodes": nodes,
        "edges": edges,
        "summary": {
            "nodes": len(nodes),
            "edges": len(edges),
            "blocked": sum(1 for n in nodes if n["is_dependency_blocked"]),
            "by_type": {k: sum(1 for e in edges if e["type"] == k) for k in ("blocks", "relates", "duplicates")},
        },
    }


@router.post("/{task_id}/dependencies")
def add_task_dependency(task_id: str, body: TaskDependencyIn):
    task_id = _safe_task_id(task_id)
    target_id = _safe_task_id(body.target_id)
    if task_id == target_id:
        raise HTTPException(400, "任务不能依赖自身")
    if not _task_by_id(task_id):
        raise HTTPException(404, "源任务不存在")
    if not _task_by_id(target_id):
        raise HTTPException(404, "目标任务不存在")
    st = _ui_load()
    deps = st.setdefault("dependencies", {})
    edges = _dep_edges(st)
    if body.type == "blocks" and _would_cycle(task_id, target_id, edges):
        raise HTTPException(400, "blocks 依赖不能形成环")
    arr = deps.setdefault(task_id, [])
    for edge in arr:
        if edge.get("target_id") == target_id and edge.get("type", "blocks") == body.type:
            edge["note"] = (body.note or "").strip()[:500]
            edge["updated_at"] = now().isoformat()
            _ui_save(st)
            return {"ok": True, "updated": True, "edge": {"source_id": task_id, **edge}}
    edge = {
        "target_id": target_id,
        "type": body.type,
        "note": (body.note or "").strip()[:500],
        "created_at": now().isoformat(),
    }
    arr.append(edge)
    _ui_save(st)
    notify_webhook(
        "task.dependency_added",
        {"task_id": task_id, "target_id": target_id, "type": body.type},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "edge": {"source_id": task_id, **edge}}


@router.delete("/{task_id}/dependencies/{target_id}")
def delete_task_dependency(task_id: str, target_id: str, type: str = Query("")):
    task_id = _safe_task_id(task_id)
    target_id = _safe_task_id(target_id)
    st = _ui_load()
    deps = st.setdefault("dependencies", {})
    arr = deps.get(task_id) or []
    before = len(arr)
    deps[task_id] = [
        e for e in arr
        if not (e.get("target_id") == target_id and (not type or e.get("type", "blocks") == type))
    ]
    _ui_save(st)
    if before != len(deps[task_id]):
        notify_webhook(
            "task.dependency_deleted",
            {"task_id": task_id, "target_id": target_id, "type": type or "*"},
            tenant_id=resolved_tenant_id(),
            project_id=resolved_project_id(),
        )
    return {"ok": True, "deleted": before - len(deps[task_id])}


@router.post("")
def create_task(body: TaskCreate):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    tid = f"T-{int(now().timestamp() * 1000)}"
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
    for item in plan:
        tid = _safe_task_id(str(item.get("task_id") or ""))
        t.update(where=f"id = '{tid}'", values={"assigned_to": item["assigned_to"], "updated_at": ts})
        task_fields = fld.setdefault(tid, {})
        task_fields["dev_tool"] = item["dev_tool"]
        task_fields["debug_notes"] = (
            f"智能分发: {item['reason']} ready={item['ready']} order={item['order']} "
            f"blocked_by={','.join(item.get('blocked_by') or [])}"
        )[:2000]
        applied += 1
    _ui_save(st)
    notify_webhook(
        "task.dispatched",
        {"count": applied, "strategy": body.strategy, "task_ids": [x.get("task_id") for x in plan]},
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
        "scope": plan["scope"],
        "policy": body.policy,
        "event": body.event,
        "applied": applied,
        "summary": plan["summary"],
        "task_ids": [packet.get("task_id") for packet in plan["agent_packets"]],
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


@router.get("/quality/policy")
def task_quality_policy():
    task_rows = [_ui_merge_row(r, _ui_load()) for r in rows("tasks", 1000)]
    sample: Dict[str, Any] = task_rows[0] if task_rows else {"id": "T-sample", "title": "sample", "description": ""}
    policy = _load_quality_policy()
    gates = _quality_gates(sample)
    return {
        "ok": True,
        "scope": _scope_payload(),
        "policy": policy,
        "default_gates": gates,
        "summary": {
            "required": len(policy.get("required_gate_ids") or []),
            "advisory": len(policy.get("advisory_gate_ids") or []),
            "mode": policy.get("mode"),
        },
    }


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
            "claim": "POST /api/v1/tasks/agent-feed/claim",
            "heartbeat": "POST /api/v1/tasks/agent-feed/heartbeat",
            "report": "POST /api/v1/tasks/{task_id}/agent-report",
            "lease_seconds_default": 900,
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


@router.post("/agent-feed/claim")
def task_agent_claim(body: TaskAgentClaimIn):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    agent = (body.agent or "HermesAgent").strip()[:120]
    st = _ui_load()
    task_rows = [_ui_merge_row(r, st) for r in rows("tasks", 1000)]
    task_id = body.task_id.strip()
    packet: Dict[str, Any] | None = None
    if not task_id:
        plan = _scheduler_plan(
            task_rows,
            TaskSchedulerIn(dry_run=True, max_items=50, max_parallel=20, include_blocked=False, policy="quality_first", event="agent.claim.pick", agent_pool=[agent]),
        )
        for item in plan["agent_packets"]:
            if item.get("ready") and not _active_claim_for_task(str(item.get("task_id") or "")):
                packet = item
                task_id = str(item.get("task_id") or "")
                break
    task_id = _safe_task_id(task_id)
    task = next((row for row in task_rows if row.get("id") == task_id), None)
    if not task:
        raise HTTPException(404, "任务不存在")
    if packet is None:
        fallback_assignee, tool, reason = _dispatch_actor(task)
        packet = _agent_packet(task, order=1, lane=1, assigned_to=agent or fallback_assignee, dev_tool=body.dev_tool or tool, reason=reason)
    existing = _active_claim_for_task(task_id)
    if existing and not body.force and str(existing.get("agent") or "") != agent:
        raise HTTPException(409, {"detail": "任务已被其他 Agent 领取", "claim": existing})

    claim_id = str(existing.get("claim_id") or "") if existing else f"claim-{uuid.uuid4().hex[:12]}"
    ts = _utc_iso()
    expires_at = _utc_iso(_utc_dt() + timedelta(seconds=body.lease_seconds))
    claim = {
        "claim_id": claim_id,
        "packet_id": body.packet_id or packet.get("packet_id") or "",
        "task_id": task_id,
        "agent": agent,
        "dev_tool": (body.dev_tool or packet.get("dev_tool") or "").strip()[:80],
        "status": "claimed",
        "progress": 0,
        "claimed_at": ts,
        "updated_at": ts,
        "lease_expires_at": expires_at,
        "scope": _scope_payload(),
        "note": body.note,
    }
    state = _load_agent_claims()
    state.setdefault("claims", {})[claim_id] = claim
    _save_agent_claims(state)

    fields = st.setdefault("fields", {}).setdefault(task_id, {})
    if claim["dev_tool"]:
        fields["dev_tool"] = claim["dev_tool"]
    fields["debug_notes"] = f"Agent claimed: {agent} claim_id={claim_id} lease={expires_at} {body.note}".strip()[:2000]
    _ui_save(st)
    if body.auto_start:
        t.update(where=f"id = '{task_id}'", values={"status": "in_progress", "assigned_to": agent, "updated_at": now()})
    notify_webhook(
        "task.agent_claimed",
        {"task_id": task_id, "claim_id": claim_id, "agent": agent, "lease_expires_at": expires_at},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    packet["claim"] = claim
    return {"ok": True, "claim": claim, "packet": packet}


@router.post("/agent-feed/heartbeat")
def task_agent_heartbeat(body: TaskAgentHeartbeatIn):
    state = _load_agent_claims()
    claims = state.setdefault("claims", {})
    claim: Dict[str, Any] | None = None
    if body.claim_id:
        claim = claims.get(body.claim_id)
    if claim is None and body.task_id:
        claim = _active_claim_for_task(_safe_task_id(body.task_id), agent=body.agent.strip())
    if not claim:
        raise HTTPException(404, "领取记录不存在或已过期")
    claim_id = str(claim.get("claim_id") or body.claim_id)
    if body.agent and str(claim.get("agent") or "") != body.agent.strip():
        raise HTTPException(403, "Agent 与领取记录不一致")
    ts = _utc_iso()
    claim.update(
        {
            "status": body.state,
            "progress": body.progress,
            "status_message": body.status_message,
            "updated_at": ts,
            "lease_expires_at": _utc_iso(_utc_dt() + timedelta(seconds=body.extend_seconds)),
        }
    )
    claims[claim_id] = claim
    _save_agent_claims(state)
    _append_jsonl(
        _agent_reports_path(),
        {
            "id": f"agent-heartbeat-{uuid.uuid4().hex[:12]}",
            "type": "heartbeat",
            "claim_id": claim_id,
            "task_id": claim.get("task_id"),
            "agent": claim.get("agent"),
            "progress": body.progress,
            "status_message": body.status_message,
            "created_at": ts,
            "scope": _scope_payload(),
        },
    )
    notify_webhook(
        "agent.heartbeat",
        {"task_id": claim.get("task_id"), "claim_id": claim_id, "agent": claim.get("agent"), "progress": body.progress},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "claim": claim}


@router.post("/{task_id}:pull")
def pull_task(task_id: str):
    _safe_task_id(task_id)
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


@router.post("/{task_id}/agent-report")
def task_agent_report(task_id: str, body: TaskAgentReportIn):
    task_id = _safe_task_id(task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    row = _task_by_id(task_id)
    if not row:
        raise HTTPException(404, "任务不存在")
    gate_results = [g for g in body.gate_results if isinstance(g, dict)]
    failed_gates = [
        str(g.get("id") or g.get("name") or "unknown")
        for g in gate_results
        if str(g.get("status") or "").lower() in {"failed", "blocked", "error"}
    ]
    status = body.status
    if body.block_reason.strip() and not status:
        status = "blocked"
    if failed_gates and status == "completed":
        status = "blocked"
    vals: Dict[str, Any] = {"updated_at": now()}
    if status:
        vals["status"] = status
    if body.confidence is not None:
        vals["confidence"] = body.confidence
    note_parts = []
    if body.summary.strip():
        note_parts.append(body.summary.strip())
    if failed_gates:
        note_parts.append("失败卡点: " + ", ".join(failed_gates[:10]))
    if body.block_reason.strip():
        note_parts.append("阻塞原因: " + body.block_reason.strip())
    if body.next_action.strip():
        note_parts.append("下一步: " + body.next_action.strip())
    if note_parts:
        vals["human_notes"] = "\n".join(note_parts)[:4000]
    t.update(where=f"id = '{task_id}'", values=vals)

    st = _ui_load()
    task_fields = st.setdefault("fields", {}).setdefault(task_id, {})
    if body.artifact_url.strip():
        task_fields["artifact_url"] = body.artifact_url.strip()[:800]
    if body.artifact_path.strip():
        task_fields["artifact_path"] = body.artifact_path.strip()[:400]
    if body.branch.strip():
        task_fields["branch"] = body.branch.strip()[:120]
    task_fields["debug_notes"] = (
        f"Agent report: agent={body.agent or '-'} claim={body.claim_id or '-'} progress={body.progress}% "
        f"status={status or row.get('status') or 'pending'} gates={len(gate_results)} failed={len(failed_gates)} {body.summary.strip()}"
    )[:2000]
    _ui_save(st)

    if body.claim_id:
        claim_state = _load_agent_claims()
        claim = (claim_state.get("claims") or {}).get(body.claim_id)
        if claim:
            if str(claim.get("task_id") or "") != task_id:
                raise HTTPException(400, "claim_id 与 task_id 不匹配")
            if body.agent and str(claim.get("agent") or "") != body.agent.strip():
                raise HTTPException(403, "Agent 与领取记录不一致")
            claim["status"] = "completed" if status == "completed" else "blocked" if status == "blocked" else "reported"
            claim["progress"] = body.progress
            claim["updated_at"] = _utc_iso()
            claim["reported_at"] = claim["updated_at"]
            claim["lease_expires_at"] = claim["updated_at"]
            claim["report_status"] = status or row.get("status") or "pending"
            claim_state.setdefault("claims", {})[body.claim_id] = claim
            _save_agent_claims(claim_state)

    quality = _evaluate_quality(
        _ui_merge_row(row, st),
        gate_results,
        confidence=body.confidence,
        artifact_url=body.artifact_url,
        artifact_path=body.artifact_path,
        status=status or row.get("status") or "pending",
        source="agent-report",
    )
    _append_jsonl(_quality_evaluations_path(), quality)
    if quality["decision"] == "block" and (status == "completed" or not status):
        t.update(
            where=f"id = '{task_id}'",
            values={
                "status": "blocked",
                "human_notes": ("质量卡点阻断: " + ", ".join(quality.get("blockers") or []))[:4000],
                "updated_at": now(),
            },
        )
        status = "blocked"

    report = {
        "id": f"agent-report-{uuid.uuid4().hex[:12]}",
        "task_id": task_id,
        "claim_id": body.claim_id,
        "agent": body.agent,
        "created_at": _utc_now(),
        "scope": _scope_payload(),
        "status": status or row.get("status") or "pending",
        "progress": body.progress,
        "confidence": body.confidence,
        "summary": body.summary,
        "artifact_url": body.artifact_url,
        "artifact_path": body.artifact_path,
        "artifacts": body.artifacts,
        "branch": body.branch,
        "gate_results": gate_results,
        "failed_gates": failed_gates,
        "block_reason": body.block_reason,
        "next_action": body.next_action,
        "quality": quality,
    }
    _append_jsonl(_agent_reports_path(), report)
    notify_webhook(
        "task.agent_reported",
        {"task_id": task_id, "status": report["status"], "progress": body.progress, "failed_gates": failed_gates},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "task_id": task_id, "status": report["status"], "failed_gates": failed_gates, "quality": quality, "report": report}


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
