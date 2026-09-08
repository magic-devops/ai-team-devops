"""
ai-team-devops 项目管理后台 - 模块化入口
每个路由模块独立，按需加载，AI 修改时只需读取对应模块文件
"""
import os
from pathlib import Path

# 必须在 logger / sql_models 之前：统一运行时目录（.sop-runtime）、SQLite 与 .ai-memory 落位
from sop_manager.path_config import apply_startup_defaults

apply_startup_defaults()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html
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

def _manager_web_dist_dir() -> Path | None:
    """若存在 Vite 构建产物（dist/index.html），则在 HTTP 根路径挂载管理 UI。"""
    apps_dir = Path(__file__).resolve().parents[2]
    raw = (os.getenv("MANAGER_WEB_DIST") or "").strip()
    dist = Path(raw).expanduser().resolve() if raw else (apps_dir / "manager-web" / "dist")
    if (dist / "index.html").is_file():
        return dist
    return None


_MANAGER_WEB_DIST = _manager_web_dist_dir()

app = FastAPI(title="ai-team-devops Manager", version="2.0", redoc_url=None)
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
from sop_manager.routers import graph_loop, pages_productization, plugins_governance
from sop_manager.routers.hermes_v5 import mount_hermes_v5

mount_hermes_v5(app)
from sop_manager.routers import models, orchestration, docker_env, skill_repo, vibe, design_docs, workspace
from sop_manager.routers import notify, cli_wrapper

# ── 新增：SQL 认证 + 租户/项目/数据库配置 ─────────────────────────
from sop_manager.routers import auth_sql, db_config, audit, webhook
from sop_manager.routers.health import router as health_router
from sop_manager.routers.memory_api import router as memory_router
from sop_manager.routers.sync_api import router as sync_router
from sop_manager.routers.worker_jobs import router as worker_jobs_router
from sop_manager.routers.data_analytics import router as analytics_router
from sop_manager.routers.context_api import router as context_router
from sop_manager.routers.platforms_api import router as platforms_router
from sop_manager.routers.dashboard import router as dashboard_router
from sop_manager.routers.hermes import router as hermes_router
from sop_manager.routers.usage import router as usage_router
from sop_manager.routers.intelligence_api import router as intelligence_router
from sop_manager.routers.billing import router as billing_router
from sop_manager.routers.system_pages import router as system_pages_router
from sop_manager.routers.system_ops import router as system_ops_router, settings_router as settings_hub_router
from sop_manager.routers.tenants import router as tenants_router, biz_router, proj_router
from sop_manager.routers.sprints import router as sprints_router

from sop_manager.routers import data_exchange, organization as organization_router

# ── 新增模块：agent_runs / data_quality / metrics_service / tag_service / data_ingest / metadata_management / a2a_gateway / llm_gateway_v2 / ops_center ──
try:
    from sop_manager.routers import agent_runs as _agent_runs
except Exception as _e:
    _agent_runs = None
    app_logger.warning("agent_runs 路由未启用: %s", _e)

try:
    from sop_manager.routers import data_quality as _data_quality
except Exception as _e:
    _data_quality = None
    app_logger.warning("data_quality 路由未启用: %s", _e)

try:
    from sop_manager.routers import metrics_service as _metrics_service
except Exception as _e:
    _metrics_service = None
    app_logger.warning("metrics_service 路由未启用: %s", _e)

try:
    from sop_manager.routers import tag_service as _tag_service
except Exception as _e:
    _tag_service = None
    app_logger.warning("tag_service 路由未启用: %s", _e)

try:
    from sop_manager.routers import data_ingest as _data_ingest
except Exception as _e:
    _data_ingest = None
    app_logger.warning("data_ingest 路由未启用: %s", _e)

try:
    from sop_manager.routers import metadata_management as _metadata_management
except Exception as _e:
    _metadata_management = None
    app_logger.warning("metadata_management 路由未启用: %s", _e)

try:
    from sop_manager.routers import a2a_gateway as _a2a_gateway
except Exception as _e:
    _a2a_gateway = None
    app_logger.warning("a2a_gateway 路由未启用: %s", _e)

try:
    from sop_manager.routers import llm_gateway_v2 as _llm_gateway_v2
except Exception as _e:
    _llm_gateway_v2 = None
    app_logger.warning("llm_gateway_v2 路由未启用: %s", _e)

try:
    from sop_manager.routers import ops_center as _ops_center
except Exception as _e:
    _ops_center = None
    app_logger.warning("ops_center 路由未启用: %s", _e)

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
    from sop_manager.routers import knowledge_graph as _knowledge_graph
except Exception as _e:
    _knowledge_graph = None
    app_logger.warning("knowledge_graph 路由未启用: %s", _e)

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
app.include_router(memory_router)
app.include_router(intelligence_router)
app.include_router(sync_router)
app.include_router(worker_jobs_router)
app.include_router(analytics_router)
app.include_router(context_router)
app.include_router(platforms_router)
app.include_router(dashboard_router)
app.include_router(hermes_router)
app.include_router(usage_router)
app.include_router(billing_router)
app.include_router(system_pages_router)
app.include_router(system_ops_router)
app.include_router(settings_hub_router)
app.include_router(workspace.router)
app.include_router(requirements.router)
app.include_router(tasks.router)
app.include_router(issues.router)
app.include_router(agents.router)
app.include_router(skills.router)
app.include_router(mcp_mgr.router)
app.include_router(system.router)
app.include_router(graph_loop.router)
app.include_router(pages_productization.router)
app.include_router(plugins_governance.router)
app.include_router(models.router)
app.include_router(orchestration.router)
app.include_router(docker_env.router)
app.include_router(skill_repo.router)
app.include_router(vibe.router)
app.include_router(design_docs.router)
app.include_router(dev_flow.router)
app.include_router(notify.router)
app.include_router(organization_router.router)
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
if _knowledge_graph is not None:
    app.include_router(_knowledge_graph.router)
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
              "_workflow", "_marketplace", "_reflection_distill", "_sso",
              "_agent_runs", "_data_quality", "_metrics_service", "_tag_service",
              "_data_ingest", "_metadata_management", "_a2a_gateway", "_llm_gateway_v2", "_ops_center"):
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

# single 模式：将 memory/current_state.json 的 project_id 注册到 projects 表
try:
    from sop_manager.project_provision import ensure_default_project_on_startup

    ensure_default_project_on_startup()
except Exception as _e:
    app_logger.warning("project provision on startup: %s", _e)

# 启动 WORM 后台归档线程（幂等）
try:
    _audit_worm_mod = globals().get("_audit_worm")
    if _audit_worm_mod is not None:
        _audit_worm_mod.start_background()
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


_redoc_js_url = (os.getenv("REDOC_JS_URL") or "").strip() or (
    "https://unpkg.com/redoc@2.1.4/bundles/redoc.standalone.js"
)


@app.get("/redoc", include_in_schema=False)
async def redoc_page():
    """ReDoc：避免默认 redoc@next + Google Fonts 在离线/内网环境空白；固定 2.x + 不拉取外网字体。"""
    return get_redoc_html(
        openapi_url="./openapi.json",
        title=f"{app.title} - ReDoc",
        redoc_js_url=_redoc_js_url,
        with_google_fonts=False,
    )


def _pair_html_path() -> Path | None:
    """CLI 配对页：优先 dist，其次 public（无 build 时仍可 /pair）。"""
    if _MANAGER_WEB_DIST is not None:
        p = _MANAGER_WEB_DIST / "pair.html"
        if p.is_file():
            return p
    pub = Path(__file__).resolve().parents[2] / "manager-web" / "public" / "pair.html"
    return pub if pub.is_file() else None


_PAIR_HTML = _pair_html_path()


@app.get("/pair", include_in_schema=False)
async def pair_page():
    """sop login --pair 浏览器配对页（须先登录 Manager）。"""
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    if _PAIR_HTML is None:
        raise HTTPException(
            404,
            "配对页未找到；请确认 apps/manager-web/public/pair.html 存在",
        )
    return FileResponse(_PAIR_HTML, media_type="text/html; charset=utf-8")


if _MANAGER_WEB_DIST is not None:
    from starlette.staticfiles import StaticFiles

    app.mount(
        "/",
        StaticFiles(directory=str(_MANAGER_WEB_DIST), html=True),
        name="manager-web",
    )
    app_logger.info("Manager Web 已挂载: %s（根路径 / 与 /assets/*）", _MANAGER_WEB_DIST)
else:

    @app.get("/")
    def root_info():
        """无 dist 时返回 JSON 说明；构建 UI：`cd apps/manager-web && pnpm install && pnpm build`。"""
        return JSONResponse(
            content={
                "service": "sop-manager",
                "apiPrefix": "/api/v1",
                "openapi": "/docs",
                "managerWeb": "apps/manager-web — pnpm install && pnpm build（生成 dist/ 后本端口根路径即管理界面）或 pnpm dev（默认 5173）",
            }
        )
