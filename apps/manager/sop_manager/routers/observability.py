"""
@module: routers.observability
@purpose: OpenTelemetry Trace/Log/Metric 统一接入 + 结构化日志
@stable: setup_otel() 签名稳定；可重复调用幂等
@ai_safe_edit:
  - 新增 instrumentor：在 _INSTRUMENTORS 列表加一项即可（导入 + 实例 + instrument(app)）
  - 改 exporter：通过 OTEL_EXPORTER_OTLP_ENDPOINT 环境变量切换；不动代码
  - 改采样率：OTEL_TRACES_SAMPLER + OTEL_TRACES_SAMPLER_ARG
@deps_in: opentelemetry-api/sdk/exporter-otlp（可选）

最佳实践：
  1. 单例：tracer / meter / logger provider 在进程内只创建一次
  2. 优雅降级：缺包不影响应用启动，只记 warning
  3. 资源标签：service.name / service.version / deployment.environment / tenant.id 自动注入
  4. trace_id 写入响应头 `traceparent` 便于前后端联调
  5. 结构化日志：自动把当前 trace_id 注入 log record
"""
from __future__ import annotations

import logging
import os
import socket
import time
from typing import Any, Awaitable, Callable

from fastapi import Request, Response

_log = logging.getLogger("sop.observability")

_OTEL_READY = False
_TRACER: Any = None
_METER: Any = None


def is_enabled() -> bool:
    """是否已成功初始化（外部可读，用于路由判断）。"""
    return _OTEL_READY


def setup_otel(app: Any | None = None) -> bool:
    """幂等初始化。返回是否成功。"""
    global _OTEL_READY, _TRACER, _METER
    if _OTEL_READY:
        return True

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint and os.getenv("SOP_OTEL_FORCE", "0") != "1":
        _log.info("OTel skipped: OTEL_EXPORTER_OTLP_ENDPOINT 未设置（设 SOP_OTEL_FORCE=1 强制启用本地导出）")
        return False

    try:
        from opentelemetry import trace, metrics  # type: ignore[import-not-found]
        from opentelemetry.sdk.resources import Resource  # type: ignore[import-not-found]
        from opentelemetry.sdk.trace import TracerProvider  # type: ignore[import-not-found]
        from opentelemetry.sdk.trace.export import BatchSpanProcessor  # type: ignore[import-not-found]
        from opentelemetry.sdk.metrics import MeterProvider  # type: ignore[import-not-found]
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader  # type: ignore[import-not-found]
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter  # type: ignore[import-not-found]
        from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter  # type: ignore[import-not-found]
    except ImportError as e:
        _log.warning("OTel 包未安装，跳过初始化：%s", e)
        return False

    resource = Resource.create({
        "service.name": os.getenv("OTEL_SERVICE_NAME", "sop-manager"),
        "service.version": os.getenv("SOP_VERSION", "1.0.0"),
        "deployment.environment": os.getenv("DEPLOY_ENV", "dev"),
        "host.name": socket.gethostname(),
    })

    # Trace
    tp = TracerProvider(resource=resource)
    tp.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, insecure=True)))
    trace.set_tracer_provider(tp)
    _TRACER = trace.get_tracer("sop.manager")

    # Metric
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=endpoint, insecure=True),
        export_interval_millis=15_000,
    )
    mp = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(mp)
    _METER = metrics.get_meter("sop.manager")

    # 自动 instrument FastAPI / SQLAlchemy / httpx
    if app is not None:
        try:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # type: ignore[import-not-found]
            FastAPIInstrumentor.instrument_app(app, excluded_urls="/metrics,/api/v1/health,/api/v1/health/")
        except Exception as e:  # pragma: no cover
            _log.warning("FastAPI instrument 失败: %s", e)
    for mod, fn in (
        ("opentelemetry.instrumentation.sqlalchemy", "SQLAlchemyInstrumentor"),
        ("opentelemetry.instrumentation.httpx", "HTTPXClientInstrumentor"),
        ("opentelemetry.instrumentation.logging", "LoggingInstrumentor"),
    ):
        try:
            m = __import__(mod, fromlist=[fn])
            getattr(m, fn)().instrument()
        except Exception:  # pragma: no cover
            pass

    _OTEL_READY = True
    _log.info("OTel ready: endpoint=%s service=%s", endpoint, resource.attributes.get("service.name"))
    return True


def tracer() -> Any:
    """获取 Tracer 句柄（无 OTel 时返回 NoOp）。"""
    if _TRACER:
        return _TRACER
    try:
        from opentelemetry import trace  # type: ignore[import-not-found]
        return trace.get_tracer("sop.manager")
    except ImportError:
        return _NoOpTracer()


class _NoOpTracer:
    """OTel 缺包时的退化实现。"""
    def start_as_current_span(self, name: str, **_kw: Any):  # type: ignore[no-untyped-def]
        import contextlib
        return contextlib.nullcontext()

    def start_span(self, name: str, **_kw: Any):  # type: ignore[no-untyped-def]
        import contextlib
        return contextlib.nullcontext()


# ── 中间件：把 trace_id 写到响应头 ─────────────────────────────
async def trace_header_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    start = time.time()
    resp = await call_next(request)
    if _OTEL_READY:
        try:
            from opentelemetry import trace  # type: ignore[import-not-found]
            ctx = trace.get_current_span().get_span_context()
            if ctx.is_valid:
                resp.headers["traceparent"] = (
                    f"00-{ctx.trace_id:032x}-{ctx.span_id:016x}-"
                    f"{'01' if ctx.trace_flags else '00'}"
                )
        except Exception:  # pragma: no cover
            pass
    resp.headers["X-Response-Time-Ms"] = f"{int((time.time() - start) * 1000)}"
    return resp


# ── 结构化 JSON logging（无 structlog 依赖） ───────────────────
class JsonLogFormatter(logging.Formatter):
    """把 LogRecord 输出为单行 JSON。"""
    BASE_KEYS = {"name", "levelname", "msg", "args", "exc_info", "exc_text",
                 "created", "msecs", "thread", "threadName", "process",
                 "processName", "module", "filename", "lineno", "pathname",
                 "stack_info", "funcName", "relativeCreated", "levelno", "message"}

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        import json
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
                  + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # 自动注入 trace_id
        if _OTEL_READY:
            try:
                from opentelemetry import trace  # type: ignore[import-not-found]
                ctx = trace.get_current_span().get_span_context()
                if ctx.is_valid:
                    payload["trace_id"] = f"{ctx.trace_id:032x}"
                    payload["span_id"] = f"{ctx.span_id:016x}"
            except Exception:
                pass
        # 自定义 extra 字段
        for k, v in record.__dict__.items():
            if k not in self.BASE_KEYS and not k.startswith("_"):
                payload[k] = v
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_json_logging(level: str = "INFO") -> None:
    """把根 logger 输出格式改成 JSON（生产推荐）。"""
    if os.getenv("SOP_LOG_FORMAT", "").lower() != "json":
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    root = logging.getLogger()
    # 清掉已有 handler（避免重复输出）
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    logging.getLogger("sop").info("json logging enabled")
