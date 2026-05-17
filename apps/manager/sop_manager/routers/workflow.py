"""
@module: routers.workflow
@purpose: Temporal 工作流管理 —— Sprint / Code Review / Bug Triage 长流程持久化
@stable: /api/v1/workflows/* 路径稳定
@ai_safe_edit:
  - 新增工作流：在 workflows/ 目录下加文件 + 注册到 _WORKFLOWS
  - 改 Temporal 地址：TEMPORAL_HOST + TEMPORAL_NAMESPACE 环境变量
@deps_in: temporalio（可选）；不装也能用 _InMemoryEngine 退化跑流程（dev）

最佳实践：
  1. 工作流幂等：用 workflow_id = `<type>-<resource_id>`，重复启动返回已存在
  2. 长流程拆 Activity：每个 Activity 必须幂等
  3. 信号驱动：人工 review、bug 升级用 Signal 而非轮询
  4. 工作流版本化：用 Workflow.get_version 兼容老实例
"""
from __future__ import annotations

import logging
import os
import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root

_log = logging.getLogger("sop.workflow")

router = APIRouter(prefix="/api/v1/workflows", tags=["workflow"])


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
        if status == "completed":
            st = "completed"
        elif status == "cancelled":
            st = "cancelled" if i <= current_idx else "pending"
        elif status == "failed" and i == current_idx:
            st = "failed"
        elif i < current_idx:
            st = "completed"
        elif i == current_idx and status == "running":
            st = "running"
        elif i == current_idx:
            st = "running" if status == "running" else "completed"
        else:
            st = "pending"
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
            "reason": "当前为内存引擎；设置 WORKFLOW_ENGINE=temporal 并启动 Temporal 以获取运行态",
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
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_runs(rows: list[dict[str, Any]]) -> None:
    _runs_file().write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def _record_event(row: dict[str, Any]) -> dict[str, Any]:
    row.setdefault("id", f"wf-evt-{uuid.uuid4().hex[:12]}")
    row.setdefault("ts", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    with _events_file().open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def _upsert_run(row: dict[str, Any]) -> dict[str, Any]:
    rows = _load_runs()
    row["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = [r for r in rows if r.get("workflow_id") != row.get("workflow_id")] + [row]
    rows = sorted(rows, key=lambda r: str(r.get("updated_at", "")), reverse=True)[:500]
    _save_runs(rows)
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
    }


def register(workflow_type: str, *, description: str = "", signals: list[str] | None = None):
    def deco(fn: Callable[[dict], Awaitable[dict]]) -> Callable[[dict], Awaitable[dict]]:
        _WORKFLOWS[workflow_type] = WorkflowDef(workflow_type, description, fn, signals or [])
        return fn
    return deco


# ── 内置工作流：Sprint / Review / Bug ──────────────────────────
@register("sprint_lifecycle", description="Sprint 生命周期：规划 → 执行 → 评审 → 收尾",
          signals=["pause", "resume", "complete_task"])
async def _sprint_lifecycle(args: dict) -> dict:
    """状态机：planning → in_progress → reviewing → completed
    用 Temporal 时 Activity 会持久化每步；退化版仅在内存里跑。"""
    import asyncio
    state: dict[str, Any] = {
        "sprint_id": args.get("sprint_id"),
        "tasks": args.get("tasks", []),
        "phase": "planning",
        "completed": [],
        "started_at": time.time(),
    }
    state["phase"] = "in_progress"
    tasks_list: list[Any] = list(args.get("tasks") or [])
    # 内存引擎下避免默认 14 天忙等；可用 duration_seconds 覆盖
    max_wait = float(args.get("duration_seconds", 120.0))
    if get_engine().name == "memory" and max_wait > 300:
        max_wait = 300.0
    deadline = time.time() + max_wait
    while time.time() < deadline and len(state["completed"]) < len(tasks_list):
        await asyncio.sleep(0.05)
    state["phase"] = "reviewing"
    await asyncio.sleep(0.05)
    state["phase"] = "completed"
    return state


@register("code_review", description="代码审查长流程：自动 AI 审查 → 人工 approve → 合并",
          signals=["approve", "request_changes", "reject"])
async def _code_review(args: dict) -> dict:
    import asyncio
    state: dict[str, Any] = {
        "pr_id": args.get("pr_id"),
        "ai_review": None,
        "human_decision": None,
        "phase": "ai_reviewing",
        "started_at": time.time(),
    }
    # Step 1: AI 评审（占位；接 LLM Gateway 时调 /api/v1/llm/chat task_type=review）
    try:
        from sop_manager.routers.llm_gateway import ChatIn, Message, llm_chat
        out = llm_chat(ChatIn(
            messages=[
                Message(role="system", content="你是资深 Reviewer，对 diff 提 ≤ 5 条关键意见。"),
                Message(role="user", content=args.get("diff", "")[:8000] or "（无 diff）"),
            ],
            task_type="review", temperature=0.1, cache_ttl=300,
        ), None)  # type: ignore[arg-type]
        state["ai_review"] = out.content
    except Exception as e:
        state["ai_review"] = f"AI 评审跳过: {e}"
    state["phase"] = "awaiting_human"
    tw = float(args.get("timeout_seconds", 30.0))
    if get_engine().name == "memory" and tw > 120:
        tw = 120.0
    deadline = time.time() + tw
    while time.time() < deadline and state["human_decision"] is None:
        await asyncio.sleep(0.05)
    if state["human_decision"] is None:
        state["human_decision"] = "approve_by_timeout"
    state["phase"] = "completed"
    return state


@register("bug_triage", description="Bug 分诊：自动分类 → 责任人指派 → SLA 跟踪",
          signals=["reassign", "resolve"])
async def _bug_triage(args: dict) -> dict:
    state: dict[str, Any] = {
        "issue_id": args.get("issue_id"),
        "severity": None,
        "assignee": None,
        "phase": "classifying",
    }
    try:
        from sop_manager.routers.copilot import _chat, _SYS_CLASSIFY
        cls = _chat(_SYS_CLASSIFY, args.get("text", "") or "", task_type="classify")
        import json
        try:
            parsed = json.loads(cls["raw"])
            state["severity"] = parsed.get("priority", "P2")
            state["category"] = parsed.get("category", "bug")
        except Exception:
            state["severity"] = "P2"
    except Exception:
        state["severity"] = "P2"
    state["phase"] = "assigned"
    state["assignee"] = args.get("default_assignee", "AI")
    state["phase"] = "completed"
    return state


# ── 退化版：内存引擎（dev / 无 Temporal） ──────────────────────
class _InMemoryEngine(Engine):
    name = "memory"

    def __init__(self) -> None:
        self._handles: dict[str, WorkflowHandle] = {}
        self._signals: dict[str, list[tuple[str, dict]]] = {}
        import asyncio
        self._loop_task: dict[str, asyncio.Task] = {}

    async def start(self, workflow_type: str, workflow_id: str, args: dict) -> WorkflowHandle:
        if workflow_id in self._handles:
            return self._handles[workflow_id]
        defn = _WORKFLOWS.get(workflow_type)
        if not defn:
            raise HTTPException(404, f"unknown workflow type: {workflow_type}")
        h = WorkflowHandle(workflow_id=workflow_id, run_id=str(uuid.uuid4()), type=workflow_type)
        self._handles[workflow_id] = h
        self._signals[workflow_id] = []
        import asyncio
        async def _run():
            try:
                h.result = await defn.handler({**args, "workflow_id": workflow_id})
                h.status = "completed"
            except Exception as e:
                h.error = str(e)
                h.status = "failed"
        self._loop_task[workflow_id] = asyncio.create_task(_run())
        return h

    async def signal(self, workflow_id: str, signal: str, payload: dict) -> None:
        if workflow_id not in self._handles:
            raise HTTPException(404)
        self._signals[workflow_id].append((signal, payload))
        _log.info("signal posted wf=%s sig=%s", workflow_id, signal)

    async def query(self, workflow_id: str, query: str) -> Any:
        h = self._handles.get(workflow_id)
        if not h:
            raise HTTPException(404)
        if query == "status":
            return h.status
        if query == "signals":
            return self._signals.get(workflow_id, [])
        return h.result

    async def cancel(self, workflow_id: str) -> None:
        t = self._loop_task.get(workflow_id)
        if t:
            t.cancel()
        if workflow_id in self._handles:
            self._handles[workflow_id].status = "cancelled"

    async def describe(self, workflow_id: str) -> WorkflowHandle:
        h = self._handles.get(workflow_id)
        if not h:
            raise HTTPException(404)
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
        self._cli: Optional[Any] = None

    async def _client(self):
        if self._cli is None:
            self._cli = await self._Client.connect(self._host, namespace=self._ns)
        return self._cli

    async def start(self, workflow_type, workflow_id, args) -> WorkflowHandle:
        cli = await self._client()
        # 注意：真实使用时需要 @workflow.defn 类，这里以 dataclass 调用为占位
        h = await cli.start_workflow(workflow_type, args, id=workflow_id, task_queue="sop")
        return WorkflowHandle(workflow_id=workflow_id, run_id=h.first_execution_run_id,
                              type=workflow_type, status="running")

    async def signal(self, workflow_id, signal, payload):
        cli = await self._client()
        await (await cli.get_workflow_handle(workflow_id)).signal(signal, payload)

    async def query(self, workflow_id, query):
        cli = await self._client()
        return await (await cli.get_workflow_handle(workflow_id)).query(query)

    async def cancel(self, workflow_id):
        cli = await self._client()
        await (await cli.get_workflow_handle(workflow_id)).cancel()

    async def describe(self, workflow_id):
        cli = await self._client()
        desc = await (await cli.get_workflow_handle(workflow_id)).describe()
        status_name = desc.status.name if hasattr(desc.status, "name") else str(desc.status)
        status_map = {
            "RUNNING": "running",
            "COMPLETED": "completed",
            "FAILED": "failed",
            "CANCELED": "cancelled",
            "CANCELLED": "cancelled",
            "TERMINATED": "failed",
            "TIMED_OUT": "failed",
        }
        norm = status_map.get(status_name.upper(), "running")
        return WorkflowHandle(
            workflow_id=workflow_id,
            run_id=desc.run_id,
            type=str(desc.workflow_type),
            status=norm,
            temporal={
                "status_name": status_name,
                "task_queue": getattr(desc, "task_queue", None) or "sop",
                "history_length": getattr(desc, "history_length", None),
                "start_time": desc.start_time.isoformat() if desc.start_time else "",
                "close_time": desc.close_time.isoformat() if desc.close_time else "",
            },
        )


_engine: Optional[Engine] = None


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
    workflow_id: Optional[str] = None
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
            pass
        out.append(row)
    return out


@router.get("/instances")
async def workflow_instances(limit: int = 100, status: str = "", type: str = "", q: str = "") -> dict[str, Any]:
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
    return {"ok": True, "items": rows[:limit], "total": len(rows)}


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
async def start_wf(body: StartIn) -> dict[str, Any]:
    if body.type not in _WORKFLOWS:
        raise HTTPException(404, f"unknown workflow type: {body.type}")
    wid = body.workflow_id or f"{body.type}-{uuid.uuid4().hex[:12]}"
    eng = get_engine()
    h = await eng.start(body.type, wid, body.args)
    row = _upsert_run({**_handle_to_row(h, eng.name), "args": body.args})
    _record_event({"workflow_id": h.workflow_id, "run_id": h.run_id, "type": h.type, "event": "started", "status": h.status, "args": body.args})
    return {
        "workflow_id": h.workflow_id, "run_id": h.run_id, "type": h.type,
        "status": h.status, "engine": eng.name, "record": row,
    }


@router.post("/{workflow_id}/signal")
async def signal_wf(workflow_id: str, body: SignalIn) -> dict[str, str]:
    await get_engine().signal(workflow_id, body.signal, body.payload)
    _record_event({"workflow_id": workflow_id, "event": "signal", "signal": body.signal, "payload": body.payload})
    return {"ok": "true"}


@router.get("/{workflow_id}/detail")
async def workflow_detail(workflow_id: str, events_limit: int = 80) -> dict[str, Any]:
    """实例详情：运行记录 + 事件时间线 + 已投递信号（内存引擎）。"""
    eng = get_engine()
    try:
        h = await eng.describe(workflow_id)
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
    result: Any = None
    if h.status in ("completed", "failed", "cancelled"):
        result = h.result
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
    }


@router.get("/{workflow_id}/status")
async def status_wf(workflow_id: str) -> dict[str, Any]:
    h = await get_engine().describe(workflow_id)
    row = _upsert_run(_handle_to_row(h, get_engine().name))
    return {
        "workflow_id": h.workflow_id, "run_id": h.run_id, "type": h.type,
        "status": h.status, "error": h.error or "",
        "duration_s": int(time.time() - h.started_at),
        "record": row,
    }


@router.get("/{workflow_id}/result")
async def result_wf(workflow_id: str) -> dict[str, Any]:
    h = await get_engine().describe(workflow_id)
    if h.status not in ("completed", "failed", "cancelled"):
        raise HTTPException(409, f"未完成：{h.status}")
    row = _upsert_run(_handle_to_row(h, get_engine().name))
    return {"workflow_id": workflow_id, "status": h.status, "result": h.result,
            "error": h.error, "record": row}


@router.post("/{workflow_id}/cancel")
async def cancel_wf(workflow_id: str) -> dict[str, str]:
    await get_engine().cancel(workflow_id)
    rows = _load_runs()
    for r in rows:
        if r.get("workflow_id") == workflow_id:
            r["status"] = "cancelled"
            r["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _save_runs(rows)
    _record_event({"workflow_id": workflow_id, "event": "cancelled", "status": "cancelled"})
    return {"ok": "true"}


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
