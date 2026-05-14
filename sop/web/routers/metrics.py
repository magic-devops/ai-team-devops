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
from typing import Awaitable, Callable

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
    if _REGISTRY is None:
        return await call_next(request)
    t0 = time.time()
    resp = await call_next(request)
    dt = time.time() - t0
    path = _normalize_path(request.url.path)
    REQ_LATENCY.labels(request.method, path).observe(dt)  # type: ignore[union-attr]
    tenant = ""
    project = ""
    try:
        from path_config import resolved_project_id, resolved_tenant_id  # type: ignore[import-not-found]
        tenant = resolved_tenant_id()
        project = resolved_project_id()
    except Exception:
        pass
    REQ_COUNT.labels(request.method, path, str(resp.status_code), tenant, project).inc()  # type: ignore[union-attr]
    return resp


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
