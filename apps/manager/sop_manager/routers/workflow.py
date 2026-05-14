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
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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
        return WorkflowHandle(workflow_id=workflow_id, run_id=desc.run_id,
                              type=desc.workflow_type, status=str(desc.status))


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


@router.get("/types")
def list_types() -> list[dict[str, Any]]:
    return [
        {"type": d.type, "description": d.description, "signals": d.signals}
        for d in _WORKFLOWS.values()
    ]


@router.post("/start")
async def start_wf(body: StartIn) -> dict[str, Any]:
    if body.type not in _WORKFLOWS:
        raise HTTPException(404, f"unknown workflow type: {body.type}")
    wid = body.workflow_id or f"{body.type}-{uuid.uuid4().hex[:12]}"
    eng = get_engine()
    h = await eng.start(body.type, wid, body.args)
    return {
        "workflow_id": h.workflow_id, "run_id": h.run_id, "type": h.type,
        "status": h.status, "engine": eng.name,
    }


@router.post("/{workflow_id}/signal")
async def signal_wf(workflow_id: str, body: SignalIn) -> dict[str, str]:
    await get_engine().signal(workflow_id, body.signal, body.payload)
    return {"ok": "true"}


@router.get("/{workflow_id}/status")
async def status_wf(workflow_id: str) -> dict[str, Any]:
    h = await get_engine().describe(workflow_id)
    return {
        "workflow_id": h.workflow_id, "run_id": h.run_id, "type": h.type,
        "status": h.status, "error": h.error or "",
        "duration_s": int(time.time() - h.started_at),
    }


@router.get("/{workflow_id}/result")
async def result_wf(workflow_id: str) -> dict[str, Any]:
    h = await get_engine().describe(workflow_id)
    if h.status not in ("completed", "failed", "cancelled"):
        raise HTTPException(409, f"未完成：{h.status}")
    return {"workflow_id": workflow_id, "status": h.status, "result": h.result,
            "error": h.error}


@router.post("/{workflow_id}/cancel")
async def cancel_wf(workflow_id: str) -> dict[str, str]:
    await get_engine().cancel(workflow_id)
    return {"ok": "true"}


@router.get("/_health")
def health() -> dict[str, str]:
    return {"engine": get_engine().name, "types": str(len(_WORKFLOWS))}
