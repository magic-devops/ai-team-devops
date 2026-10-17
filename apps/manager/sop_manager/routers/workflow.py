"""
@module: routers.workflow
@purpose: 项目作用域工作流 —— Sprint / Code Review / Bug Triage 本地状态与人工审查
@stable: /api/v1/workflows/* 路径稳定
@ai_safe_edit:
  - 新增工作流：在 workflows/ 目录下加文件 + 注册到 _WORKFLOWS
  - 改 Temporal 地址：TEMPORAL_HOST + TEMPORAL_NAMESPACE 环境变量
@deps_in: 统一模型网关；本地 journal 引擎。Temporal worker 合约尚未实现，不能启动。

最佳实践：
  1. 工作流幂等：用 workflow_id = `<type>-<resource_id>`，重复启动返回已存在
  2. 信号明确携带人工意见，身份由授权请求解析；超时永不批准
  3. journal 保留等待、决定及信号；重启不自动重放模型请求
  4. 本地引擎不替代 CI 验收、业务任务完成或自动合并
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sop_manager.path_config import resolved_ai_memory_root, resolved_project_id, resolved_tenant_id

from .auth_sql import current_user_or_apikey
from .business_access import require_business_access
from .sql_models import Project, User, get_session

_log = logging.getLogger("sop.workflow")

router = APIRouter(prefix="/api/v1/workflows", tags=["workflow"], dependencies=[Depends(require_business_access)])
_JOURNAL_LOCK = RLock()
_TERMINAL = {"completed", "failed", "cancelled"}
_RESERVED = {"actor_id", "user_id", "created_by", "tenant_id", "project_id", "project_path", "scope", "workflow_id"}
UserDependency = Annotated[User, Depends(current_user_or_apikey)]
SessionDependency = Annotated[Session, Depends(get_session)]


# ── 抽象：Engine 接口 ───────────────────────────────────────────
@dataclass
class WorkflowHandle:
    workflow_id: str
    run_id: str
    type: str
    status: str = "running"
    result: Any = None
    error: str = ""
    started_at: float = field(default_factory=time.time)
    temporal: dict[str, Any] = field(default_factory=dict)
    tenant_id: str = ""
    project_id: str = ""
    created_by: str = ""
    args: dict[str, Any] = field(default_factory=dict)
    signals: list[dict[str, Any]] = field(default_factory=list)


_WORKFLOW_STEP_DEFS: dict[str, list[dict[str, str]]] = {
    "sprint_lifecycle": [
        {"id": "planning", "name": "规划"},
        {"id": "in_progress", "name": "执行"},
        {"id": "reviewing", "name": "评审"},
        {"id": "completed", "name": "收尾"},
    ],
    "code_review": [
        {"id": "ai_reviewing", "name": "AI 审查"},
        {"id": "awaiting_human", "name": "人工评审"},
        {"id": "completed", "name": "完成"},
    ],
    "bug_triage": [
        {"id": "classifying", "name": "分类"},
        {"id": "assigned", "name": "指派"},
        {"id": "completed", "name": "完成"},
    ],
}


def _build_workflow_dag(wf_type: str, status: str, result: Any) -> dict[str, Any]:
    steps_def = _WORKFLOW_STEP_DEFS.get(
        wf_type,
        [{"id": "run", "name": wf_type or "workflow"}],
    )
    phase = ""
    if isinstance(result, dict):
        phase = str(result.get("phase") or "")
    order = [s["id"] for s in steps_def]
    if phase == "timeout_pending":
        phase = str(result.get("pending_phase") or "") if isinstance(result, dict) else ""
        if not phase:
            phase = "awaiting_human" if wf_type == "code_review" else "in_progress" if wf_type == "sprint_lifecycle" else "assigned"
    if phase in order:
        current_idx = order.index(phase)
    elif status == "completed":
        current_idx = len(order) - 1
    elif status in ("failed", "cancelled"):
        current_idx = max(0, len(order) - 2)
    else:
        current_idx = 0

    steps: list[dict[str, Any]] = []
    for i, sdef in enumerate(steps_def):
        st = _dag_review_status(wf_type, sdef["id"], result, _dag_step_status(status, i, current_idx))
        steps.append({"id": sdef["id"], "name": sdef["name"], "status": st})

    dag_edges: list[dict[str, str]] = []
    for i in range(len(steps) - 1):
        dag_edges.append({"source": steps[i]["id"], "target": steps[i + 1]["id"]})

    return {
        "workflow_type": wf_type,
        "current_step_id": phase or order[min(current_idx, len(order) - 1)],
        "steps": steps,
        "edges": dag_edges,
    }


def _dag_step_status(status: str, index: int, current: int) -> str:
    if status == "completed":
        return "completed"
    if status == "cancelled":
        return "cancelled" if index <= current else "pending"
    if status == "failed" and index == current:
        return "failed"
    if index < current:
        return "completed"
    if index > current:
        return "pending"
    return {"running": "running", "awaiting_human": "awaiting_human", "timeout_pending": "awaiting_human", "paused": "paused"}.get(status, "pending")


def _dag_review_status(workflow_type: str, step_id: str, result: Any, default: str) -> str:
    if workflow_type != "code_review" or step_id != "ai_reviewing" or not isinstance(result, dict):
        return default
    return {"missing_diff": "skipped", "failed": "failed", "interrupted": "failed"}.get((result.get("review") or {}).get("status"), default)


async def _temporal_snapshot(workflow_id: str) -> dict[str, Any]:
    eng = get_engine()
    configured = os.getenv("WORKFLOW_ENGINE", "memory").lower() == "temporal"
    base: dict[str, Any] = {
        "engine": eng.name,
        "configured": configured,
        "connected": eng.name == "temporal",
    }
    if eng.name != "temporal":
        return {
            **base,
            "available": False,
            "reason": "当前为本地 journal 引擎；Temporal worker 与作用域审查合约尚未实现",
        }
    try:
        cli = await eng._client()  # type: ignore[attr-defined]
        handle = cli.get_workflow_handle(workflow_id)
        desc = await handle.describe()
        status_name = desc.status.name if hasattr(desc.status, "name") else str(desc.status)
        return {
            **base,
            "available": True,
            "workflow_id": workflow_id,
            "run_id": desc.run_id,
            "status": str(desc.status),
            "status_name": status_name,
            "task_queue": getattr(desc, "task_queue", None) or "sop",
            "start_time": desc.start_time.isoformat() if desc.start_time else "",
            "close_time": desc.close_time.isoformat() if desc.close_time else "",
            "history_length": getattr(desc, "history_length", None),
        }
    except Exception as exc:
        return {**base, "available": False, "connected": True, "reason": str(exc)[:300]}


class Engine:
    """统一工作流引擎接口；Temporal 或退化版都实现这套。"""

    name: str = ""

    async def start(self, workflow_type: str, workflow_id: str, args: dict) -> WorkflowHandle:
        raise NotImplementedError

    async def signal(self, workflow_id: str, signal: str, payload: dict) -> None:
        raise NotImplementedError

    async def query(self, workflow_id: str, query: str) -> Any:
        raise NotImplementedError

    async def cancel(self, workflow_id: str) -> None:
        raise NotImplementedError

    async def describe(self, workflow_id: str) -> WorkflowHandle:
        raise NotImplementedError


# ── 工作流注册表 ────────────────────────────────────────────────
@dataclass
class WorkflowDef:
    type: str
    description: str
    handler: Callable[[dict], Awaitable[dict]]
    signals: list[str] = field(default_factory=list)
    signal_handler: Callable[[dict, str, dict], dict] | None = None


_WORKFLOWS: dict[str, WorkflowDef] = {}


def _wf_dir() -> Path:
    d = resolved_ai_memory_root() / "workflow-runs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _runs_file() -> Path:
    return _wf_dir() / "runs.json"


def _events_file() -> Path:
    return _wf_dir() / "events.jsonl"


def _load_runs() -> list[dict[str, Any]]:
    p = _runs_file()
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return [row for row in data if isinstance(row, dict) and _in_scope(row)] if isinstance(data, list) else []
    except Exception:
        return []


def _save_runs(rows: list[dict[str, Any]]) -> None:
    with _JOURNAL_LOCK:
        path = _runs_file()
        # Shared project paths still require explicit tenant/project row isolation.
        existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        foreign = [row for row in existing if isinstance(row, dict) and not _in_scope(row)] if isinstance(existing, list) else []
        temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        temporary.write_text(json.dumps(foreign + rows, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, path)


def _in_scope(row: dict[str, Any]) -> bool:
    return row.get("tenant_id") == resolved_tenant_id() and row.get("project_id") == resolved_project_id()


def _identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", value):
        raise HTTPException(400, "Invalid workflow identifier")
    return value


def _validate_context_payload(value: dict[str, Any]) -> None:
    if any(key in _RESERVED or key.startswith("_") for key in value):
        raise HTTPException(400, "Workflow scope and actor are resolved from authentication")


def _record_event(row: dict[str, Any]) -> dict[str, Any]:
    row.update(tenant_id=resolved_tenant_id(), project_id=resolved_project_id())
    row.setdefault("id", f"wf-evt-{uuid.uuid4().hex[:12]}")
    row.setdefault("ts", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    with _JOURNAL_LOCK, _events_file().open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def _upsert_run(row: dict[str, Any]) -> dict[str, Any]:
    with _JOURNAL_LOCK:
        rows = _load_runs()
        previous = next((r for r in rows if r.get("workflow_id") == row.get("workflow_id")), {})
        row = {**previous, **row, "tenant_id": resolved_tenant_id(), "project_id": resolved_project_id()}
        row["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        rows = [r for r in rows if r.get("workflow_id") != row.get("workflow_id")] + [row]
        _save_runs(sorted(rows, key=lambda r: str(r.get("updated_at", "")), reverse=True))
        return row


def _handle_to_row(h: WorkflowHandle, engine: str) -> dict[str, Any]:
    return {
        "workflow_id": h.workflow_id,
        "run_id": h.run_id,
        "type": h.type,
        "status": h.status,
        "engine": engine,
        "error": h.error or "",
        "result": h.result,
        "started_at": h.started_at,
        "duration_s": int(time.time() - h.started_at),
        "phase": (h.result or {}).get("phase", "") if isinstance(h.result, dict) else "",
        "decision": (h.result or {}).get("human_decision") if isinstance(h.result, dict) else None,
        "tenant_id": h.tenant_id,
        "project_id": h.project_id,
        "created_by": h.created_by,
        "args": h.args,
        "signals": h.signals,
    }


def register(workflow_type: str, *, description: str = "", signals: list[str] | None = None, signal_handler=None):
    def deco(fn: Callable[[dict], Awaitable[dict]]) -> Callable[[dict], Awaitable[dict]]:
        _WORKFLOWS[workflow_type] = WorkflowDef(workflow_type, description, fn, signals or [], signal_handler)
        return fn
    return deco


# ── Local review handlers. Suggestions and receipts never mutate business completion. ──
def _opinion(payload: dict) -> dict[str, Any]:
    if not isinstance(payload.get("comment"), str):
        raise HTTPException(400, "Review comment must be text")
    comment = payload["comment"].strip()
    actor = str(payload.get("actor_id") or "").strip()
    if not comment or not actor or len(comment) > 10000:
        raise HTTPException(400, "An authenticated reviewer and review comment are required")
    return {"comment": comment, "actor_id": actor, "at": time.time()}


def _review_signal(state: dict, signal: str, payload: dict) -> dict:
    if state.get("phase") not in {"awaiting_human", "timeout_pending"}:
        raise HTTPException(409, "Review is not awaiting a human decision")
    record = {**_opinion(payload), "decision": signal}
    return {**state, "phase": "completed", "human_decision": signal, "decision_record": record}


def _sprint_signal(state: dict, signal: str, payload: dict) -> dict:
    opinion = _opinion(payload)
    state = deepcopy(state)
    if state.get("phase") not in {"in_progress", "reviewing", "timeout_pending", "paused"}:
        raise HTTPException(409, "Sprint workflow is not ready for a human signal")
    if signal == "pause":
        state.update(phase="paused", pause_record=opinion)
    elif signal == "resume":
        if state.get("phase") != "paused":
            raise HTTPException(409, "Sprint workflow is not paused")
        state["phase"] = "reviewing" if len(state["completed"]) == len(state["tasks"]) else "in_progress"
    elif signal == "complete_task":
        task = str(payload.get("task_id") or "")
        if state.get("phase") == "paused":
            raise HTTPException(409, "Resume the workflow before reviewing a task")
        if task not in state["tasks"]:
            raise HTTPException(400, "Unknown workflow task")
        if task not in state["completed"]:
            state["completed"].append(task)
            state.setdefault("task_reviews", {})[task] = opinion
        if len(state["completed"]) == len(state["tasks"]):
            state["phase"] = "reviewing"
    elif signal == "complete_review":
        if state.get("phase") not in {"reviewing", "timeout_pending"} or len(state["completed"]) != len(state["tasks"]):
            raise HTTPException(409, "Review each workflow task before closing the sprint workflow")
        state.update(phase="completed", human_decision="approve", decision_record={**opinion, "decision": "approve"})
    return state


def _bug_signal(state: dict, signal: str, payload: dict) -> dict:
    opinion = _opinion(payload)
    if state.get("phase") not in {"assigned", "timeout_pending"}:
        raise HTTPException(409, "Triage is not ready for a human decision")
    if signal == "reassign":
        assignee = str(payload.get("assignee") or "").strip()
        if not assignee:
            raise HTTPException(400, "assignee is required")
        return {**state, "phase": "assigned", "assignee": assignee, "assignment_record": opinion}
    return {**state, "phase": "completed", "human_decision": "resolve", "decision_record": {**opinion, "decision": "resolve"}}


@register("sprint_lifecycle", description="Sprint 工作流：执行记录 → 人工评审 → 结案（不修改业务任务）",
          signals=["pause", "resume", "complete_task", "complete_review"], signal_handler=_sprint_signal)
async def _sprint_lifecycle(args: dict) -> dict:
    tasks = list(dict.fromkeys(args.get("tasks") or []))
    return {"sprint_id": args.get("sprint_id"), "tasks": tasks, "phase": "in_progress" if tasks else "reviewing",
            "completed": [], "human_decision": None, "started_at": time.time()}


@register("code_review", description="代码审查：AI 建议 → 授权人工决定（不自动合并）",
          signals=["approve", "request_changes", "reject"], signal_handler=_review_signal)
async def _code_review(args: dict) -> dict:
    state = args["_state"]
    diff = str(args.get("diff") or "").strip()
    state["review"] = {"source": "llm_gateway", "status": "running", "content": "", "error": "", "model": "", "provider": "", "usage": {},
                       "input_sha256": hashlib.sha256(diff.encode()).hexdigest(), "input_chars": len(diff), "reviewed_chars": min(len(diff), 8000), "truncated": len(diff) > 8000}
    if not diff:
        state["review"].update(source="input", status="missing_diff", error="No diff supplied; AI review was not performed")
    else:
        try:
            from sop_manager.routers.llm_gateway import ChatIn, Message, llm_chat
            out = await asyncio.to_thread(llm_chat, ChatIn(messages=[
                Message(role="system", content="你是资深 Reviewer，对 diff 提 ≤ 5 条关键意见。仅提供建议，不替代人工验收。"),
                Message(role="user", content=diff[:8000])], task_type="review", temperature=0.1, cache_ttl=0), None)
            if not isinstance(out.content, str) or not out.content.strip():
                raise ValueError("empty_review")
            state["review"].update(status="succeeded", content=out.content, model=out.model, provider=out.provider,
                                   usage=out.usage.model_dump())
            state["ai_review"] = out.content
        except Exception:
            # Provider exceptions can contain URLs or credentials. Gateway owns detailed diagnostic logs.
            state["review"].update(status="failed", error="Model review failed; check the model gateway configuration and retry in a new workflow")
    state["phase"] = "awaiting_human"
    return state


@register("bug_triage", description="问题分诊：分类建议 → 责任人指派 → 人工结案",
          signals=["reassign", "resolve"], signal_handler=_bug_signal)
async def _bug_triage(args: dict) -> dict:
    state = args["_state"]
    state.update(issue_id=args.get("issue_id"), severity=None, assignee=args.get("default_assignee") or None)
    try:
        from sop_manager.routers.llm_gateway import ChatIn, Message, llm_chat
        text = str(args.get("text") or "").strip()
        if not text:
            raise ValueError("missing_input")
        out = await asyncio.to_thread(llm_chat, ChatIn(messages=[Message(role="system", content='Classify the issue as JSON: {"priority":"P0|P1|P2|P3","category":"bug|incident|request"}. Do not resolve it.'),
            Message(role="user", content=text[:8000])], task_type="classify", cache_ttl=0), None)
        parsed = json.loads(out.content)
        if parsed.get("priority") not in {"P0", "P1", "P2", "P3"} or parsed.get("category") not in {"bug", "incident", "request"}:
            raise ValueError("invalid_classification")
        state.update(severity=parsed["priority"], category=parsed["category"], classification={"source": "llm_gateway", "status": "succeeded", "model": out.model, "provider": out.provider, "usage": out.usage.model_dump()})
    except Exception:
        state["classification"] = {"source": "llm_gateway" if args.get("text") else "input", "status": "failed" if args.get("text") else "missing_input", "error": "No verified classification; human triage required"}
    state["phase"] = "assigned"
    return state


def _state_status(state: dict) -> str:
    phase = state.get("phase")
    if phase in {"completed", "timeout_pending", "paused"}:
        return phase
    return "awaiting_human" if phase in {"awaiting_human", "reviewing", "assigned"} else "running"


def _timeout(workflow_type: str, args: dict) -> float:
    value = args.get("duration_seconds", 120) if workflow_type == "sprint_lifecycle" else args.get("timeout_seconds", 30)
    try:
        timeout = float(value)
        if not math.isfinite(timeout) or not 0 <= timeout <= 86400 * 30:
            raise ValueError()
        return timeout
    except (TypeError, ValueError):
        raise HTTPException(400, "Workflow timeout must be between 0 and 30 days") from None


class _InMemoryEngine(Engine):
    """Local worker with journalled state; not a Temporal worker or process supervisor."""
    name = "memory"

    def __init__(self) -> None:
        self._handles: dict[tuple[str, str, str], WorkflowHandle] = {}
        self._loop_task: dict[tuple[str, str, str], asyncio.Task] = {}

    def _key(self, workflow_id: str) -> tuple[str, str, str]:
        return resolved_tenant_id(), resolved_project_id(), _identifier(workflow_id)

    def _persist(self, h: WorkflowHandle, event: str = "state_changed") -> None:
        _upsert_run(_handle_to_row(h, self.name))
        row = {"workflow_id": h.workflow_id, "run_id": h.run_id, "type": h.type, "event": event,
               "status": h.status, "phase": (h.result or {}).get("phase"), "decision": (h.result or {}).get("human_decision")}
        if event == "signal_applied" and h.signals:
            row.update(signal=h.signals[-1]["signal"], payload=h.signals[-1]["payload"])
        _record_event(row)

    def _expire(self, h: WorkflowHandle) -> None:
        state = h.result or {}
        if h.status not in _TERMINAL | {"paused", "timeout_pending"} and state.get("review_deadline", float("inf")) <= time.time():
            state.update(pending_phase=state.get("phase"), phase="timeout_pending")
            h.status = "timeout_pending"
            self._persist(h, "review_timeout")

    async def start(self, workflow_type: str, workflow_id: str, args: dict) -> WorkflowHandle:
        key = self._key(workflow_id)
        try:
            previous = await self.describe(workflow_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        else:
            if previous.type != workflow_type or previous.args != args:
                raise HTTPException(409, "Workflow identifier already belongs to a different request")
            return previous
        defn = _WORKFLOWS.get(workflow_type)
        if not defn:
            raise HTTPException(404, f"unknown workflow type: {workflow_type}")
        timeout = _timeout(workflow_type, args)
        phase = {"code_review": "ai_reviewing", "bug_triage": "classifying", "sprint_lifecycle": "planning"}.get(workflow_type, "running")
        h = WorkflowHandle(workflow_id=workflow_id, run_id=str(uuid.uuid4()), type=workflow_type,
                           tenant_id=key[0], project_id=key[1], created_by=str(args.get("_actor_id") or ""), args=deepcopy(args),
                           result={"phase": phase, "human_decision": None, "ai_review": None})
        self._handles[key] = h
        self._persist(h, "started")

        async def run():
            try:
                result = await defn.handler({**deepcopy(args), "workflow_id": workflow_id, "_state": h.result})
                if h.status in _TERMINAL:
                    return
                h.result = result
                h.status = _state_status(result)
                h.result["review_deadline"] = time.time() + timeout
                self._persist(h)
                await asyncio.sleep(timeout)
                self._expire(h)
            except asyncio.CancelledError:
                # Shutdown never approves; a new engine recovers the persisted waiting state.
                return
            except Exception:
                h.error = "Workflow handler failed; inspect configuration and start a new workflow"
                h.status = "failed"
                self._persist(h, "failed")
        self._loop_task[key] = asyncio.create_task(run())
        return h

    async def signal(self, workflow_id: str, signal: str, payload: dict) -> None:
        h = await self.describe(workflow_id)
        defn = _WORKFLOWS[h.type]
        if signal not in defn.signals or not defn.signal_handler:
            raise HTTPException(400, "Signal is not supported by this workflow")
        fingerprint = hashlib.sha256(json.dumps({"signal": signal, "payload": payload}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        signal_id = str(payload.get("signal_id") or fingerprint)
        if not signal_id or len(signal_id) > 128:
            raise HTTPException(400, "Invalid signal_id")
        prior = next((row for row in h.signals if row.get("signal_id") == signal_id), None)
        if prior:
            if prior["fingerprint"] != fingerprint:
                raise HTTPException(409, "signal_id was already used for a different decision")
            return
        if h.status in _TERMINAL:
            raise HTTPException(409, "Workflow is terminal; start a new workflow for a new review")
        result = defn.signal_handler(deepcopy(h.result), signal, payload)
        h.result = result
        h.status = _state_status(result)
        h.signals.append({"signal": signal, "payload": deepcopy(payload), "signal_id": signal_id, "fingerprint": fingerprint, "at": time.time()})
        self._persist(h, "signal_applied")
        self._expire(h)

    async def query(self, workflow_id: str, query: str) -> Any:
        h = await self.describe(workflow_id)
        if query == "status":
            return h.status
        if query == "signals":
            return deepcopy(h.signals)
        if query not in {"progress", "state", "result"}:
            raise HTTPException(400, "Unknown workflow query")
        return deepcopy(h.result)

    async def cancel(self, workflow_id: str) -> None:
        h = await self.describe(workflow_id)
        if h.status == "cancelled":
            return
        if h.status in _TERMINAL:
            raise HTTPException(409, "Terminal workflow cannot be cancelled")
        h.status = "cancelled"
        task = self._loop_task.get(self._key(workflow_id))
        if task:
            task.cancel()
        self._persist(h, "cancelled")

    async def describe(self, workflow_id: str) -> WorkflowHandle:
        key = self._key(workflow_id)
        h = self._handles.get(key)
        if h:
            self._expire(h)
            return h
        row = next((r for r in _load_runs() if r.get("workflow_id") == workflow_id), None)
        if not row:
            raise HTTPException(404, "Workflow not found in the selected project")
        h = WorkflowHandle(workflow_id=workflow_id, run_id=row["run_id"], type=row["type"], status=row["status"],
                           result=row.get("result"), error=row.get("error", ""), started_at=row.get("started_at", time.time()),
                           tenant_id=key[0], project_id=key[1], created_by=row.get("created_by", ""),
                           args=row.get("args", {}), signals=row.get("signals", []))
        if h.status not in _TERMINAL:
            state = h.result or {}
            if state.get("phase") in {"ai_reviewing", "classifying", "planning", "running"}:
                state.update(pending_phase=state.get("phase"), phase="timeout_pending", recovery="worker_interrupted")
                if h.type == "code_review":
                    state["review"] = {"source": "llm_gateway", "status": "interrupted", "error": "Worker stopped before model review completed; human review remains required"}
                h.status = "timeout_pending"
            elif state.get("review_deadline", float("inf")) <= time.time() and h.status != "paused":
                state.update(pending_phase=state.get("phase"), phase="timeout_pending")
                h.status = "timeout_pending"
            h.result = state
        self._handles[key] = h
        return h


# ── Temporal 适配器（M8 完整化时启用） ─────────────────────────
class TemporalEngine(Engine):  # pragma: no cover - 需要 temporal server
    name = "temporal"

    def __init__(self) -> None:
        try:
            from temporalio.client import Client  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError("temporalio 未安装") from e
        self._Client = Client
        self._host = os.getenv("TEMPORAL_HOST", "localhost:7233")
        self._ns = os.getenv("TEMPORAL_NAMESPACE", "default")
        self._cli: Any | None = None

    async def _client(self):
        if self._cli is None:
            self._cli = await self._Client.connect(self._host, namespace=self._ns)
        return self._cli

    async def start(self, workflow_type, workflow_id, args) -> WorkflowHandle:
        raise HTTPException(503, "Temporal workflow workers and scoped review contracts are not configured; use the local journal engine")

    async def signal(self, workflow_id, signal, payload):
        raise HTTPException(503, "Scoped Temporal workflow signals are not implemented")

    async def query(self, workflow_id, query):
        raise HTTPException(503, "Scoped Temporal workflow queries are not implemented")

    async def cancel(self, workflow_id):
        raise HTTPException(503, "Scoped Temporal workflow cancellation is not implemented")

    async def describe(self, workflow_id):
        raise HTTPException(503, "Scoped Temporal workflow state contracts are not implemented")


_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is not None:
        return _engine
    backend = os.getenv("WORKFLOW_ENGINE", "memory").lower()
    if backend == "temporal":
        try:
            _engine = TemporalEngine()
            return _engine
        except Exception as e:
            _log.warning("Temporal 不可用，退化到内存引擎: %s", e)
    _engine = _InMemoryEngine()
    return _engine


# ── 路由 ────────────────────────────────────────────────────────
class StartIn(BaseModel):
    type: str
    workflow_id: str | None = None
    args: dict[str, Any] = Field(default_factory=dict)


class SignalIn(BaseModel):
    signal: str
    payload: dict[str, Any] = Field(default_factory=dict)


class BulkCancelIn(BaseModel):
    workflow_ids: list[str] = Field(default_factory=list, min_length=1, max_length=100)


class WorkflowOpsTasksIn(BaseModel):
    dry_run: bool = True
    priority: str = "P1"
    assigned_to: str = "Coder"


def _permissions(user: User, db) -> dict[str, bool]:
    from .delivery import _permissions as delivery_permissions
    project = db.get(Project, resolved_project_id())
    return {"read": True, **delivery_permissions(db, user, project)}


def _progress(h: WorkflowHandle) -> dict[str, Any]:
    result = h.result if isinstance(h.result, dict) else {}
    return {"status": h.status, "phase": result.get("phase", ""), "decision": result.get("human_decision"),
            "review": result.get("review"), "decision_record": result.get("decision_record"), "result": deepcopy(h.result)}


async def _scoped_handle(workflow_id: str) -> WorkflowHandle:
    _identifier(workflow_id)
    if not any(row.get("workflow_id") == workflow_id for row in _load_runs()):
        raise HTTPException(404, "Workflow not found in the selected project")
    return await get_engine().describe(workflow_id)


@router.get("/types")
def list_types() -> list[dict[str, Any]]:
    return [
        {"type": d.type, "description": d.description, "signals": d.signals}
        for d in _WORKFLOWS.values()
    ]


@router.get("/engine/status")
async def workflow_engine_status() -> dict[str, Any]:
    eng = get_engine()
    configured = os.getenv("WORKFLOW_ENGINE", "memory").lower()
    host = os.getenv("TEMPORAL_HOST", "localhost:7233")
    ns = os.getenv("TEMPORAL_NAMESPACE", "default")
    connected = eng.name == "temporal"
    probe: dict[str, Any] = {"ok": False, "reason": ""}
    if connected:
        try:
            await eng._client()  # type: ignore[attr-defined]
            probe = {"ok": True, "reason": ""}
        except Exception as exc:
            probe = {"ok": False, "reason": str(exc)[:300]}
    return {
        "ok": True,
        "configured_engine": configured,
        "active_engine": eng.name,
        "temporal_host": host,
        "temporal_namespace": ns,
        "temporal_connected": connected and probe["ok"],
        "probe": probe,
        "workflow_types": list(_WORKFLOWS.keys()),
        "worker_supported": eng.name == "memory",
        "durability": "local_journal" if eng.name == "memory" else "temporal_worker_not_implemented",
    }


@router.get("/summary")
async def workflow_summary() -> dict[str, Any]:
    rows = await _current_runs(500)
    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for r in rows:
        by_status[str(r.get("status", "unknown"))] = by_status.get(str(r.get("status", "unknown")), 0) + 1
        by_type[str(r.get("type", "unknown"))] = by_type.get(str(r.get("type", "unknown")), 0) + 1
    return {"ok": True, "engine": get_engine().name, "total": len(rows), "by_status": by_status, "by_type": by_type}


@router.get("/hub")
async def workflow_hub() -> dict[str, Any]:
    summary = await workflow_summary()
    charts = await workflow_charts()
    return {
        "ok": True,
        "summary": {
            "engine": summary.get("engine"),
            "total": summary.get("total", 0),
            "by_status": summary.get("by_status") or {},
            "by_type": summary.get("by_type") or {},
        },
        "charts": {
            "by_status": charts.get("by_status") or [],
            "by_type": charts.get("by_type") or [],
        },
        "domains": [
            {"id": "templates", "path": "#/workflows/templates", "capability": "delivery.workflows.templates"},
            {"id": "instances", "path": "#/workflows/instances", "capability": "delivery.workflows.instances"},
            {"id": "events", "path": "#/workflows/events", "capability": "delivery.workflows.events"},
            {"id": "signals", "path": "#/workflows/signals", "capability": "delivery.workflows.signals"},
            {"id": "bulk_ops", "path": "#/workflows/bulk_ops", "capability": "delivery.workflows.bulk_ops"},
        ],
    }


@router.get("/charts")
async def workflow_charts() -> dict[str, Any]:
    """ECharts 友好：流程实例状态与类型分布。"""
    summary = await workflow_summary()
    by_status = summary.get("by_status") if isinstance(summary.get("by_status"), dict) else {}
    by_type = summary.get("by_type") if isinstance(summary.get("by_type"), dict) else {}

    def _pie(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]

    return {
        "ok": True,
        "by_status": _pie(by_status),
        "by_type": _pie(by_type),
    }


async def _current_runs(limit: int = 100) -> list[dict[str, Any]]:
    eng = get_engine()
    out: list[dict[str, Any]] = []
    for row in _load_runs()[:limit]:
        wid = str(row.get("workflow_id") or "")
        if not wid:
            continue
        try:
            h = await eng.describe(wid)
            row = {**row, **_handle_to_row(h, eng.name)}
            _upsert_run(row)
        except Exception:
            _log.warning("Workflow snapshot unavailable; retaining the scoped journal record")
        out.append(row)
    return out


@router.get("/instances")
async def workflow_instances(user: UserDependency, db: SessionDependency, limit: int = 100, status: str = "", type: str = "", q: str = "") -> dict[str, Any]:
    rows = await _current_runs(limit)
    if status:
        rows = [r for r in rows if r.get("status") == status]
    if type:
        rows = [r for r in rows if r.get("type") == type]
    query = q.strip().lower()
    if query:
        rows = [
            r for r in rows
            if query in "\n".join([
                str(r.get("workflow_id") or ""),
                str(r.get("run_id") or ""),
                str(r.get("type") or ""),
                str(r.get("status") or ""),
                str(r.get("error") or ""),
            ]).lower()
        ]
    return {"ok": True, "items": [{**row, "permissions": _permissions(user, db)} for row in rows[:limit]], "total": len(rows), "permissions": _permissions(user, db)}


@router.get("/events")
def workflow_events(limit: int = 100, workflow_id: str = "") -> dict[str, Any]:
    p = _events_file()
    out: list[dict[str, Any]] = []
    if not p.exists():
        return {"ok": True, "items": [], "total": 0}
    for line in reversed(p.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            _log.warning("Skipping an unreadable workflow event row")
            continue
        if not isinstance(row, dict) or not _in_scope(row):
            continue
        if workflow_id and row.get("workflow_id") != workflow_id:
            continue
        out.append(row)
        if len(out) >= limit:
            break
    return {"ok": True, "items": out, "total": len(out)}


def _workflow_ops_task_specs(rows: list[dict[str, Any]], *, priority: str, assigned_to: str) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    failed = [r for r in rows if r.get("status") == "failed"]
    long_running = [r for r in rows if r.get("status") == "running" and int(r.get("duration_s") or 0) >= 1800]
    if failed:
        specs.append({
            "id": "failed_workflows",
            "title": f"诊断失败工作流实例（{len(failed)} 个）",
            "description": "分析 failed 工作流的错误、事件时间线和 DAG 步骤，形成修复建议并回填执行记录。",
            "priority": priority,
            "estimate": "M",
            "assigned_to": assigned_to,
            "status": "pending",
            "workflow_ids": [str(r.get("workflow_id")) for r in failed[:20]],
        })
    if long_running:
        specs.append({
            "id": "long_running_workflows",
            "title": f"处理长时间运行工作流实例（{len(long_running)} 个）",
            "description": "检查 running 超时实例是否卡在人工信号、外部依赖或 Temporal worker，必要时补发 signal 或取消重试。",
            "priority": priority,
            "estimate": "S",
            "assigned_to": assigned_to,
            "status": "pending",
            "workflow_ids": [str(r.get("workflow_id")) for r in long_running[:20]],
        })
    specs.append({
        "id": "workflow_ops_snapshot",
        "title": "生成 WorkflowOps 运行快照与 Agent 接手包",
        "description": "导出工作流实例、事件、DAG 和信号状态，供 AI Agent 诊断编排运行健康度。",
        "priority": priority,
        "estimate": "S",
        "assigned_to": assigned_to,
        "status": "pending",
        "workflow_ids": [],
    })
    return specs


@router.get("/ops-plan")
async def workflow_ops_plan(limit: int = 200) -> dict[str, Any]:
    """WorkflowOps 操作包：面向 UI/CLI/Agent 的编排运行健康与动作计划。"""
    rows = await _current_runs(limit)
    summary = await workflow_summary()
    engine = await workflow_engine_status()
    events = workflow_events(80)
    failed = [r for r in rows if r.get("status") == "failed"]
    running = [r for r in rows if r.get("status") == "running"]
    long_running = [r for r in running if int(r.get("duration_s") or 0) >= 1800]
    score = 100
    score -= min(45, len(failed) * 15)
    score -= min(25, len(long_running) * 10)
    if not engine.get("temporal_connected") and engine.get("configured_engine") == "temporal":
        score -= 20
    score = max(0, score)
    risks = []
    if failed:
        risks.append({"level": "high", "id": "failed_workflows", "message": f"{len(failed)} 个工作流失败，需要诊断错误和补偿动作"})
    if long_running:
        risks.append({"level": "medium", "id": "long_running_workflows", "message": f"{len(long_running)} 个工作流运行超过 30 分钟，建议检查信号和外部依赖"})
    if not engine.get("temporal_connected") and engine.get("configured_engine") == "temporal":
        risks.append({"level": "high", "id": "temporal_disconnected", "message": "配置为 Temporal 但探活未连接，请检查 TEMPORAL_HOST / namespace / worker"})
    commands = [
        {"id": "list", "title": "查看工作流实例", "command": "sop workflow instances --json", "category": "inspect"},
        {"id": "events", "title": "查看事件流水", "command": "sop workflow events --json", "category": "inspect"},
        {"id": "ops", "title": "导出编排操作包", "command": "sop workflow ops-plan --json", "category": "agent"},
        {"id": "tasks", "title": "生成治理任务", "command": "sop workflow ops-tasks --apply", "category": "repair"},
    ]
    return {
        "ok": True,
        "health": {"score": score, "grade": "good" if score >= 80 else "needs_attention" if score >= 55 else "at_risk", "risks": risks},
        "engine": engine,
        "summary": summary,
        "recent_instances": rows[:20],
        "recent_events": events.get("items") or [],
        "commands": commands,
        "task_candidates": _workflow_ops_task_specs(rows, priority="P1", assigned_to="Coder"),
        "ai_packet": {
            "intent": "workflow_ops_diagnosis",
            "required_context": ["workflow instances", "workflow events", "workflow detail DAG", "signals"],
            "recommended_entry": "#/workflows/events",
            "next_cli": [cmd["command"] for cmd in commands],
        },
    }


@router.post("/ops-tasks")
async def workflow_ops_tasks(body: WorkflowOpsTasksIn) -> dict[str, Any]:
    """将 WorkflowOps 操作包候选项预览或生成任务。"""
    from sop_manager.routers.tasks import TaskCreate, create_task

    rows = await _current_runs(300)
    specs = _workflow_ops_task_specs(rows, priority=body.priority, assigned_to=body.assigned_to)
    planned, created = [], []
    for spec in specs:
        planned.append(spec)
        if not body.dry_run:
            payload = TaskCreate(
                title=spec["title"],
                description=f"{spec['description']}\n\nworkflow_ids={','.join(spec.get('workflow_ids') or [])}",
                priority=spec["priority"],
                estimate=spec["estimate"],
                assigned_to=spec["assigned_to"],
                source="workflow_ops",
                source_report_id=spec["id"],
                source_report_title=spec["title"],
            )
            created.append(create_task(payload))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "planned": planned,
        "created": created,
        "summary": {"planned": len(planned), "created": len(created), "skipped": 0},
    }


@router.post("/start")
async def start_wf(body: StartIn, user: UserDependency, db: SessionDependency) -> dict[str, Any]:
    if body.type not in _WORKFLOWS:
        raise HTTPException(404, f"unknown workflow type: {body.type}")
    _validate_context_payload(body.args)
    wid = _identifier(body.workflow_id or f"{body.type}-{uuid.uuid4().hex[:12]}")
    if body.type == "sprint_lifecycle" and (not isinstance(body.args.get("tasks", []), list) or any(not isinstance(task, str) or not task.strip() for task in body.args.get("tasks", []))):
        raise HTTPException(400, "tasks must be a list of workflow task identifiers")
    eng = get_engine()
    h = await eng.start(body.type, wid, {**body.args, "_actor_id": user.id})
    row = _handle_to_row(h, eng.name)
    return {
        "workflow_id": h.workflow_id, "run_id": h.run_id, "type": h.type,
        **_progress(h), "engine": eng.name, "record": row, "permissions": _permissions(user, db),
    }


@router.post("/{workflow_id}/signal")
async def signal_wf(workflow_id: str, body: SignalIn, user: UserDependency, db: SessionDependency) -> dict[str, Any]:
    _validate_context_payload(body.payload)
    h = await _scoped_handle(workflow_id)
    permissions = _permissions(user, db)
    if body.signal in {"approve", "request_changes", "reject", "complete_task", "complete_review", "resolve"} and not permissions["approve"]:
        raise HTTPException(403, "Project approval permission required")
    await get_engine().signal(workflow_id, body.signal, {**body.payload, "actor_id": user.id})
    return {"ok": True, "workflow_id": workflow_id, **_progress(h), "permissions": permissions}


@router.get("/{workflow_id}/detail")
async def workflow_detail(workflow_id: str, user: UserDependency, db: SessionDependency, events_limit: int = 80) -> dict[str, Any]:
    """实例详情：运行记录 + 事件时间线 + 已投递信号（内存引擎）。"""
    eng = get_engine()
    try:
        h = await _scoped_handle(workflow_id)
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(404, f"工作流不存在: {workflow_id}") from err
    row = next((r for r in _load_runs() if r.get("workflow_id") == workflow_id), {})
    instance = {**row, **_handle_to_row(h, eng.name)}
    ev_payload = workflow_events(events_limit, workflow_id)
    signals: Any = []
    try:
        signals = await eng.query(workflow_id, "signals")
    except Exception:
        signals = []
    result: Any = h.result
    merged_result = result if result is not None else instance.get("result")
    dag = _build_workflow_dag(str(h.type), str(h.status), merged_result)
    temporal = await _temporal_snapshot(workflow_id)
    if h.temporal:
        temporal = {**temporal, "handle": h.temporal}
    return {
        "ok": True,
        "engine": eng.name,
        "instance": instance,
        "events": ev_payload.get("items") or [],
        "signals": signals,
        "result": result,
        "error": h.error or "",
        "dag": dag,
        "temporal": temporal,
        **_progress(h),
        "permissions": _permissions(user, db),
    }


@router.get("/{workflow_id}/status")
async def status_wf(workflow_id: str, user: UserDependency, db: SessionDependency) -> dict[str, Any]:
    h = await _scoped_handle(workflow_id)
    row = _upsert_run(_handle_to_row(h, get_engine().name))
    return {
        "workflow_id": h.workflow_id, "run_id": h.run_id, "type": h.type,
        **_progress(h), "error": h.error or "", "permissions": _permissions(user, db),
        "duration_s": int(time.time() - h.started_at),
        "record": row,
    }


@router.get("/{workflow_id}/result")
async def result_wf(workflow_id: str) -> dict[str, Any]:
    h = await _scoped_handle(workflow_id)
    if h.status not in ("completed", "failed", "cancelled"):
        raise HTTPException(409, f"未完成：{h.status}")
    row = _upsert_run(_handle_to_row(h, get_engine().name))
    return {"workflow_id": workflow_id, "status": h.status, "result": h.result,
            "error": h.error, "record": row}


@router.post("/{workflow_id}/cancel")
async def cancel_wf(workflow_id: str) -> dict[str, str]:
    await _scoped_handle(workflow_id)
    await get_engine().cancel(workflow_id)
    rows = _load_runs()
    for r in rows:
        if r.get("workflow_id") == workflow_id:
            r["status"] = "cancelled"
            r["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _save_runs(rows)
    _record_event({"workflow_id": workflow_id, "event": "cancelled", "status": "cancelled"})
    return {"ok": "true"}


@router.get("/{workflow_id}/query")
async def query_wf(workflow_id: str, user: UserDependency, db: SessionDependency, query: str = "progress") -> dict[str, Any]:
    h = await _scoped_handle(workflow_id)
    return {"ok": True, "workflow_id": workflow_id, "query": query, "value": await get_engine().query(workflow_id, query),
            **_progress(h), "permissions": _permissions(user, db)}


@router.post("/bulk-cancel")
async def bulk_cancel_wf(body: BulkCancelIn) -> dict[str, Any]:
    ids = [str(x).strip() for x in body.workflow_ids if str(x).strip()]
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise HTTPException(400, "workflow_ids 不能为空")
    existing = {str(row.get("workflow_id") or "") for row in _load_runs()}
    missing = [wid for wid in ids if wid not in existing]
    if missing:
        raise HTTPException(400, f"未知工作流实例: {', '.join(missing[:10])}")
    cancelled: list[str] = []
    failed: list[dict[str, str]] = []
    for wid in ids:
        try:
            await get_engine().cancel(wid)
            cancelled.append(wid)
            _record_event({"workflow_id": wid, "event": "cancelled", "status": "cancelled", "via": "bulk"})
        except Exception as err:
            failed.append({"workflow_id": wid, "error": str(err)})
    rows = _load_runs()
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for row in rows:
        if row.get("workflow_id") in cancelled:
            row["status"] = "cancelled"
            row["updated_at"] = ts
    _save_runs(rows)
    return {"ok": True, "cancelled": cancelled, "failed": failed, "count": len(cancelled)}


@router.get("/_health")
def health() -> dict[str, str]:
    return {"engine": get_engine().name, "types": str(len(_WORKFLOWS))}
