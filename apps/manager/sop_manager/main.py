"""
ai-team-devops 项目管理后台 - 模块化入口
每个路由模块独立，按需加载，AI 修改时只需读取对应模块文件
"""
import os

# 必须在 logger / sql_models 之前：统一运行时目录、迁移旧 sop.db 与 .ai-memory
from sop_manager.path_config import apply_startup_defaults

apply_startup_defaults()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── 日志系统（最先初始化）────────────────────────────────────────
from sop_manager.routers.logger import app_logger, access_logger

# ── 可观测性（OTel + 结构化 JSON 日志，幂等）──────────────────────
try:
    from sop_manager.routers.observability import setup_otel, setup_json_logging
    setup_json_logging(os.getenv("SOP_LOG_LEVEL", "INFO"))
except Exception as _e:
    setup_otel = None
    app_logger.warning("observability 初始化失败: %s", _e)

app = FastAPI(title="ai-team-devops Manager", version="2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# OTel instrument FastAPI（在路由注册前调用）
try:
    if setup_otel is not None:
        setup_otel(app)
except Exception as _e:
    app_logger.warning("setup_otel(app) failed: %s", _e)

# ── 初始化 SQL 数据库 ─────────────────────────────────────────────
from sop_manager.routers.sql_models import create_all as _sql_create_all
_sql_create_all()

# ── 审计中间件 + 访问日志 ─────────────────────────────────────────
from sop_manager.routers.audit import audit_middleware
app.middleware("http")(audit_middleware)

import time
from fastapi import Request as _Req
@app.middleware("http")
async def _access_log(request: _Req, call_next):
    t0 = time.time()
    resp = await call_next(request)
    ms = round((time.time() - t0) * 1000)
    access_logger.info("%s %s %d %dms", request.method, request.url.path, resp.status_code, ms)
    return resp

from sop_manager.routers.project_scope_middleware import project_scope_middleware

# 顺序注意：先 HMAC（如带签名头则鉴权）→ project_scope（JWT/X-Project-Id 注入）→ 路由
try:
    from sop_manager.routers.hmac_middleware import hmac_middleware
    app.middleware("http")(hmac_middleware)
except Exception as _e:
    app_logger.warning("hmac_middleware 未启用: %s", _e)

# 指标中间件（最外层，统计所有路由耗时）
try:
    from sop_manager.routers.metrics import metrics_middleware as _metrics_middleware
    app.middleware("http")(_metrics_middleware)
except Exception as _e:
    _metrics_middleware = None
    app_logger.warning("metrics_middleware 未启用: %s", _e)

app.middleware("http")(project_scope_middleware)

# 最外层之一：将旧客户端的 /api/* 308 到 /api/v1/*（须注册在 project_scope 之后，以便先于其作用域解析）
from sop_manager.routers.legacy_unversioned_api_redirect import legacy_unversioned_api_redirect_middleware

app.middleware("http")(legacy_unversioned_api_redirect_middleware)

# ── 按需注册路由模块（业务 REST 挂载在 /api/v1/*；未版本化 /api/* 由上方中间件重定向）────────
from sop_manager.routers import requirements, tasks, issues, agents, skills, mcp_mgr, system, dev_flow
from sop_manager.routers import models, orchestration, docker_env, skill_repo, vibe, design_docs, workspace
from sop_manager.routers import notify, cli_wrapper

# ── 新增：SQL 认证 + 租户/项目/数据库配置 ─────────────────────────
from sop_manager.routers import auth_sql, db_config, audit, webhook
from sop_manager.routers.health import router as health_router
from sop_manager.routers.tenants import router as tenants_router, biz_router, proj_router
from sop_manager.routers.sprints import router as sprints_router

from sop_manager.routers import data_exchange

# ── 新增：LLM Gateway + RAG（M5）+ Events 推送（M9）────────────
try:
    from sop_manager.routers import llm_gateway as _llm_gateway
except Exception as _e:  # 缺可选依赖时不阻塞启动
    _llm_gateway = None
    app_logger.warning("llm_gateway 路由未启用: %s", _e)

try:
    from sop_manager.routers import rag as _rag
except Exception as _e:
    _rag = None
    app_logger.warning("rag 路由未启用: %s", _e)

try:
    from sop_manager.routers import events_ingest as _events_ingest
except Exception as _e:
    _events_ingest = None
    app_logger.warning("events_ingest 路由未启用: %s", _e)

try:
    from sop_manager.routers import copilot as _copilot
except Exception as _e:
    _copilot = None
    app_logger.warning("copilot 路由未启用: %s", _e)

try:
    from sop_manager.routers import plugin_loader as _plugin_loader
    _plugin_loader.discover()
except Exception as _e:
    _plugin_loader = None
    app_logger.warning("plugin_loader 未启用: %s", _e)

try:
    from sop_manager.routers import metrics as _metrics_router
except Exception as _e:
    _metrics_router = None
    app_logger.warning("metrics 路由未启用: %s", _e)

try:
    from sop_manager.routers import ws_events as _ws_events
except Exception as _e:
    _ws_events = None
    app_logger.warning("ws_events 路由未启用: %s", _e)

# ── 新增 M7-M12：可观测性、加密、Key 轮换、WORM、工作流、市场、蒸馏、SSO ──
for _mod_name in ("audit_chain", "audit_worm", "crypto_box", "key_rotation",
                  "workflow", "marketplace", "reflection_distill", "sso"):
    try:
        _imp = __import__(f"sop_manager.routers.{_mod_name}", fromlist=["router"])
        globals()[f"_{_mod_name}"] = _imp
    except Exception as _e:
        globals()[f"_{_mod_name}"] = None
        app_logger.warning("%s 路由未启用: %s", _mod_name, _e)

# env 子包：扫描所有子模块，自动 include
_env_subrouters: list = []
try:
    import pkgutil
    import importlib
    from sop_manager.routers import env as _env_pkg  # type: ignore[import-not-found]
    for _m in pkgutil.iter_modules(_env_pkg.__path__):
        if _m.name.startswith("_"):
            continue
        try:
            _sub = importlib.import_module(f"sop_manager.routers.env.{_m.name}")
            if hasattr(_sub, "router"):
                _env_subrouters.append(_sub.router)
        except Exception as _e:
            app_logger.warning("routers.env.%s: %s", _m.name, _e)
except Exception as _e:
    app_logger.warning("routers.env 子包扫描失败: %s", _e)

app.include_router(health_router)
app.include_router(workspace.router)
app.include_router(requirements.router)
app.include_router(tasks.router)
app.include_router(issues.router)
app.include_router(agents.router)
app.include_router(skills.router)
app.include_router(mcp_mgr.router)
app.include_router(system.router)
app.include_router(models.router)
app.include_router(orchestration.router)
app.include_router(docker_env.router)
app.include_router(skill_repo.router)
app.include_router(vibe.router)
app.include_router(design_docs.router)
app.include_router(dev_flow.router)
app.include_router(notify.router)
app.include_router(cli_wrapper.router)

# ── 新增路由 ──────────────────────────────────────────────────────
app.include_router(auth_sql.router)
app.include_router(db_config.router)
app.include_router(audit.router)
app.include_router(webhook.router)
app.include_router(sprints_router)
app.include_router(tenants_router)
app.include_router(biz_router)
app.include_router(proj_router)
app.include_router(data_exchange.router)
if _llm_gateway is not None:
    app.include_router(_llm_gateway.router)
if _rag is not None:
    app.include_router(_rag.router)
if _events_ingest is not None:
    app.include_router(_events_ingest.router)
if _copilot is not None:
    app.include_router(_copilot.router)
if _metrics_router is not None:
    app.include_router(_metrics_router.router)
if _ws_events is not None:
    app.include_router(_ws_events.router)
if _plugin_loader is not None:
    try:
        _plugin_loader.mount(app)
    except Exception as _e:
        app_logger.warning("plugin mount: %s", _e)

# ── M7-M12 子模块 mount ──────────────────────────────────────────
for _name in ("_audit_chain", "_audit_worm", "_crypto_box", "_key_rotation",
              "_workflow", "_marketplace", "_reflection_distill", "_sso"):
    _mod = globals().get(_name)
    if _mod is not None and hasattr(_mod, "router"):
        try:
            app.include_router(_mod.router)
        except Exception as _e:
            app_logger.warning("include %s: %s", _name, _e)

# env 子包 router
for _sr in _env_subrouters:
    try:
        app.include_router(_sr)
    except Exception as _e:
        app_logger.warning("include env subrouter: %s", _e)

# 启动 WORM 后台归档线程（幂等）
try:
    if globals().get("_audit_worm") is not None:
        _audit_worm.start_background()  # type: ignore[name-defined]
except Exception as _e:
    app_logger.warning("audit worm start: %s", _e)

# 写入响应头 traceparent（在所有中间件之后注册，最里层执行）
try:
    from sop_manager.routers.observability import trace_header_middleware

    app.middleware("http")(trace_header_middleware)
except Exception as _e:
    app_logger.warning("trace_header_middleware: %s", _e)

# Chrome DevTools 会探测此 URL；未注册时静态站返回 404 并刷屏访问日志
@app.get("/.well-known/appspecific/com.chrome.devtools.json")
def chrome_devtools_appspecific():
    return JSONResponse(content={})


@app.get("/")
def root_info():
    """API-only 根路径；管理 UI 见 `apps/manager-web`（Vite dev 或构建产物由反向代理挂载）。"""
    return JSONResponse(
        content={
            "service": "sop-manager",
            "apiPrefix": "/api/v1",
            "openapi": "/docs",
            "managerWeb": "apps/manager-web — pnpm install && pnpm dev",
        }
    )
