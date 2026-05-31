"""
@module: routers.metrics
@purpose: /metrics（Prometheus 文本）+ 业务级 SLI 指标
@stable: 指标名 v1 内不破坏（仅新增 label）
@ai_safe_edit:
  - 新增指标：直接定义 Counter/Histogram + 在业务代码处 inc/observe
@deps_in: prometheus-client（必装）
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Awaitable, Callable
from uuid import uuid4

from fastapi import APIRouter, Request, Response
from starlette.responses import PlainTextResponse

try:
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
        Counter,
        Gauge,
        Histogram,
        generate_latest,
    )
except ImportError:  # pragma: no cover
    Counter = Gauge = Histogram = None  # type: ignore[assignment]
    CollectorRegistry = None  # type: ignore[assignment]


router = APIRouter(tags=["metrics"])

_ctx_trace_id: ContextVar[str] = ContextVar("sop_trace_id", default="")
_ctx_span_id: ContextVar[str] = ContextVar("sop_span_id", default="")
_ctx_correlation_id: ContextVar[str] = ContextVar("sop_correlation_id", default="")
_ctx_agent_run_id: ContextVar[str] = ContextVar("sop_agent_run_id", default="")


_REGISTRY = CollectorRegistry() if CollectorRegistry else None  # type: ignore[truthy-function]

if _REGISTRY:
    REQ_COUNT = Counter(
        "sop_http_requests_total", "HTTP 请求计数",
        ["method", "path", "status", "tenant_id", "project_id"],
        registry=_REGISTRY,
    )
    REQ_LATENCY = Histogram(
        "sop_http_request_seconds", "HTTP 请求耗时",
        ["method", "path"], registry=_REGISTRY,
    )
    LLM_CALL_COUNT = Counter(
        "sop_llm_calls_total", "LLM 调用计数",
        ["provider", "model", "task_type", "cached"], registry=_REGISTRY,
    )
    LLM_COST_USD = Counter(
        "sop_llm_cost_usd_total", "LLM 累计成本（美元）",
        ["provider", "model"], registry=_REGISTRY,
    )
    EVENT_INGEST_TOTAL = Counter(
        "sop_events_ingested_total", "agentd 上行事件接收数",
        ["type", "result"], registry=_REGISTRY,
    )
    AGENT_ONLINE = Gauge(
        "sop_agents_online", "在线 agentd 数（按租户/项目）",
        ["tenant_id", "project_id"], registry=_REGISTRY,
    )
else:  # pragma: no cover
    REQ_COUNT = REQ_LATENCY = LLM_CALL_COUNT = LLM_COST_USD = None  # type: ignore[assignment]
    EVENT_INGEST_TOTAL = AGENT_ONLINE = None  # type: ignore[assignment]


async def metrics_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    ctx = trace_context_from_request(request)
    tokens = (
        _ctx_trace_id.set(ctx["trace_id"]),
        _ctx_span_id.set(ctx["span_id"]),
        _ctx_correlation_id.set(ctx["correlation_id"]),
        _ctx_agent_run_id.set(ctx.get("agent_run_id", "")),
    )
    if _REGISTRY is None:
        try:
            resp = await call_next(request)
            _attach_trace_headers(resp)
            return resp
        finally:
            _reset_trace_tokens(tokens)
    t0 = time.time()
    try:
        resp = await call_next(request)
        dt = time.time() - t0
        path = _normalize_path(request.url.path)
        REQ_LATENCY.labels(request.method, path).observe(dt)  # type: ignore[union-attr]
        tenant = ""
        project = ""
        try:
            from sop_manager.path_config import resolved_project_id, resolved_tenant_id  # type: ignore[import-not-found]
            tenant = resolved_tenant_id()
            project = resolved_project_id()
        except Exception:
            pass
        REQ_COUNT.labels(request.method, path, str(resp.status_code), tenant, project).inc()  # type: ignore[union-attr]
        _attach_trace_headers(resp)
        return resp
    finally:
        _reset_trace_tokens(tokens)


def trace_context_from_request(request: Request) -> dict[str, str]:
    traceparent = request.headers.get("traceparent", "").strip()
    trace_id = ""
    span_id = ""
    if traceparent:
        parts = traceparent.split("-")
        if len(parts) >= 4:
            trace_id = _safe_hex(parts[1], 32)
            span_id = _safe_hex(parts[2], 16)
    trace_id = trace_id or _safe_hex(request.headers.get("X-Trace-Id", ""), 32) or uuid4().hex
    span_id = span_id or uuid4().hex[:16]
    correlation_id = request.headers.get("X-Correlation-Id", "").strip() or trace_id
    agent_run_id = request.headers.get("X-Agent-Run-Id", "").strip()
    return {"trace_id": trace_id, "span_id": span_id, "correlation_id": correlation_id, "agent_run_id": agent_run_id}


def current_trace_context() -> dict[str, str]:
    trace_id = _ctx_trace_id.get() or uuid4().hex
    span_id = _ctx_span_id.get() or uuid4().hex[:16]
    correlation_id = _ctx_correlation_id.get() or trace_id
    return {
        "trace_id": trace_id,
        "span_id": span_id,
        "correlation_id": correlation_id,
        "agent_run_id": _ctx_agent_run_id.get(),
    }


@contextmanager
def trace_context(*, trace_id: str = "", correlation_id: str = "", span_id: str = "", agent_run_id: str = ""):
    trace_id = _safe_hex(trace_id, 32) or uuid4().hex
    span_id = _safe_hex(span_id, 16) or uuid4().hex[:16]
    correlation_id = correlation_id or trace_id
    tokens = (
        _ctx_trace_id.set(trace_id),
        _ctx_span_id.set(span_id),
        _ctx_correlation_id.set(correlation_id),
        _ctx_agent_run_id.set(agent_run_id),
    )
    try:
        yield current_trace_context()
    finally:
        _reset_trace_tokens(tokens)


def _safe_hex(value: str, length: int) -> str:
    text = str(value or "").lower()
    return text if len(text) == length and all(c in "0123456789abcdef" for c in text) else ""


def _reset_trace_tokens(tokens) -> None:
    _ctx_trace_id.reset(tokens[0])
    _ctx_span_id.reset(tokens[1])
    _ctx_correlation_id.reset(tokens[2])
    _ctx_agent_run_id.reset(tokens[3])


def _attach_trace_headers(resp: Response) -> None:
    ctx = current_trace_context()
    resp.headers.setdefault("X-Trace-Id", ctx["trace_id"])
    resp.headers.setdefault("X-Correlation-Id", ctx["correlation_id"])
    resp.headers.setdefault("traceparent", f"00-{ctx['trace_id']}-{ctx['span_id']}-01")


def _normalize_path(path: str) -> str:
    """避免 ID 高基数：把数字/uuid 段替换为 :id。"""
    import re
    parts = []
    for p in path.split("/"):
        if not p:
            parts.append("")
            continue
        if re.fullmatch(r"[A-Za-z0-9]{20,}|\d+", p):
            parts.append(":id")
        elif re.fullmatch(r"(t-|proj-|T-|REQ-|agent-)[A-Za-z0-9_-]+", p):
            parts.append(":id")
        else:
            parts.append(p)
    return "/".join(parts) or "/"


@router.get("/metrics")
def metrics() -> Response:
    if _REGISTRY is None:  # pragma: no cover
        return PlainTextResponse("# prometheus-client 未安装\n", media_type="text/plain")
    return Response(content=generate_latest(_REGISTRY), media_type=CONTENT_TYPE_LATEST)
