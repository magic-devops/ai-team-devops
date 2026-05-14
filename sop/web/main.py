"""
ai-team-devops 项目管理后台 - 模块化入口
每个路由模块独立，按需加载，AI 修改时只需读取对应模块文件
"""
import os
from datetime import datetime
from pathlib import Path

# 必须在 logger / sql_models 之前：统一运行时目录、迁移旧 sop.db 与 .ai-memory
from path_config import apply_startup_defaults

apply_startup_defaults()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ── 日志系统（最先初始化）────────────────────────────────────────
from routers.logger import app_logger, access_logger

app = FastAPI(title="ai-team-devops Manager", version="2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── 初始化 SQL 数据库 ─────────────────────────────────────────────
from routers.sql_models import create_all as _sql_create_all
_sql_create_all()

# ── 审计中间件 + 访问日志 ─────────────────────────────────────────
from routers.audit import audit_middleware
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

from routers.project_scope_middleware import project_scope_middleware

app.middleware("http")(project_scope_middleware)

# ── 按需注册路由模块 ──────────────────────────────────────────────
from routers import requirements, tasks, issues, agents, skills, mcp_mgr, system, dev_flow
from routers import models, orchestration, docker_env, skill_repo, vibe, design_docs
from path_config import resolved_ai_memory_root, resolved_project_id, resolved_project_path
from routers.db_sql_compat import rows, table, now

# ── 新增：SQL 认证 + 租户/项目/数据库配置 ─────────────────────────
from routers import auth_sql, db_config, audit, webhook
from routers.health import router as health_router
from routers.tenants import router as tenants_router, biz_router, proj_router
from routers.sprints import router as sprints_router

from routers import data_exchange

_APP_BOOT_AT = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

app.include_router(health_router)
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

# ── 保留原有接口（向后兼容） ──────────────────────────────────────
import json
import re
from typing import Optional, List
from fastapi import HTTPException, Query, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

@app.get("/api/dashboard")
def dashboard():
    tasks_all = rows("tasks"); reqs = rows("requirements")
    issues_all = rows("issues"); sprints = rows("sprints")
    active = next((s for s in sprints if s.get("status") == "active"), None)
    sprint_tasks = [t for t in tasks_all if t.get("sprint_id") == (active or {}).get("id")] if active else tasks_all
    total = len(sprint_tasks); done = sum(1 for t in sprint_tasks if t.get("status") == "completed")
    return {
        "sprint": active,
        "tasks": {"total": total, "completed": done,
                  "in_progress": sum(1 for t in sprint_tasks if t.get("status") == "in_progress"),
                  "blocked": [t for t in sprint_tasks if t.get("status") == "blocked"],
                  "pending": sum(1 for t in sprint_tasks if t.get("status") == "pending")},
        "requirements": {"total": len(reqs),
                         "by_priority": {k: sum(1 for r in reqs if r.get("priority") == k) for k in ["P0","P1","P2","P3"]},
                         "by_status": {}},
        "issues": {"open": [i for i in issues_all if i.get("status") == "open"],
                   "critical": [i for i in issues_all if i.get("status") == "open" and i.get("severity") in ("P0","P1")]},
        "velocity": [{"id": s.get("id"), "velocity": s.get("velocity", 0), "planned": s.get("planned_points", 0)}
                     for s in [x for x in sprints if x.get("status") == "completed"][-5:]],
    }

@app.get("/api/sprints")
def get_sprints(): return rows("sprints", 20)

@app.post("/api/sprints")
def create_sprint(goal: str, planned_points: int = 0, ends_at: Optional[str] = None):
    t = table("sprints")
    if t is None: raise HTTPException(503, "数据库不可用")
    existing = rows("sprints")
    for s in existing:
        if s.get("status") == "active":
            t.update(where=f"id = '{s['id']}'", values={"status": "completed"})
    row = {"id": f"SPRINT-{len(existing)+1}", "project_id": resolved_project_id(),
           "goal": goal, "status": "active", "started_at": now(), "ends_at": None,
           "velocity": 0.0, "planned_points": planned_points, "completion_rate": 0.0, "retrospective": ""}
    t.add([row]); return {"ok": True, "id": row["id"]}

@app.get("/api/sprints/{sprint_id}/progress")
def sprint_progress(sprint_id: str):
    tasks_all = [t for t in rows("tasks") if t.get("sprint_id") == sprint_id]
    issues_all = [i for i in rows("issues") if i.get("sprint_id") == sprint_id]
    total = len(tasks_all); done = sum(1 for t in tasks_all if t.get("status") == "completed")
    confs = [t.get("confidence", 0) for t in tasks_all if t.get("confidence")]
    return {"sprint_id": sprint_id, "total_tasks": total, "completed": done,
            "in_progress": sum(1 for t in tasks_all if t.get("status") == "in_progress"),
            "blocked": [t for t in tasks_all if t.get("status") == "blocked"],
            "pending": sum(1 for t in tasks_all if t.get("status") == "pending"),
            "completion_rate": round(done / max(1, total) * 100, 1),
            "avg_confidence": round(sum(confs) / max(1, len(confs)), 2),
            "open_issues": [i for i in issues_all if i.get("status") == "open"], "tasks": tasks_all}

@app.get("/api/reflections")
def get_reflections(limit: int = 100):
    try:
        from routers.db import rows as lance_rows
        return lance_rows("agent_reflections", limit=limit)
    except Exception:
        return []

@app.get("/api/search")
def search(q: str = Query(..., min_length=1)):
    results = []
    for name in ["requirements", "tasks", "issues"]:
        for row in rows(name, 500):
            if q.lower() in f"{row.get('title','')} {row.get('description','')}".lower():
                results.append({"type": name, **{k: v for k, v in row.items() if k != "vector"}})
    return results[:50]

@app.get("/api/state")
def get_state():
    f = resolved_project_path() / "memory" / "current_state.json"
    return json.loads(f.read_text()) if f.exists() else {"error": "current_state.json not found"}

@app.patch("/api/state")
def update_state(body: dict):
    f = resolved_project_path() / "memory" / "current_state.json"
    if not f.exists(): raise HTTPException(404, "Not found")
    state = json.loads(f.read_text()); state.update(body)
    state["updated_at"] = now().isoformat() + "Z"
    f.write_text(json.dumps(state, indent=2, ensure_ascii=False)); return {"ok": True}

@app.get("/api/analytics")
def analytics():
    tasks_all = rows("tasks", 1000); reqs = rows("requirements", 1000)
    issues_all = rows("issues", 1000); sprints = rows("sprints", 20)
    def by(items, field): r = {}; [r.update({i.get(field,"?"): r.get(i.get(field,"?"),0)+1}) for i in items]; return r
    done = [t for t in tasks_all if t.get("status") == "completed"]
    confs = [t.get("confidence",0) for t in done if t.get("confidence")]
    return {"tasks": {"total": len(tasks_all), "by_status": by(tasks_all,"status"), "by_priority": by(tasks_all,"priority")},
            "requirements": {"total": len(reqs), "by_status": by(reqs,"status"), "by_priority": by(reqs,"priority")},
            "issues": {"total": len(issues_all), "by_type": by(issues_all,"type"), "by_severity": by(issues_all,"severity"),
                       "open": sum(1 for i in issues_all if i.get("status") == "open")},
            "sprints": {"total": len(sprints), "active": sum(1 for s in sprints if s.get("status") == "active")},
            "avg_confidence": round(sum(confs)/max(1,len(confs)), 2),
            "velocity_trend": [{"id": s.get("id"), "velocity": s.get("velocity",0), "planned": s.get("planned_points",0)} for s in sprints[-5:]]}

@app.get("/api/semantic-search")
def semantic_search(q: str = Query(...), tables: str = "tasks,requirements,issues,knowledge"):
    try:
        import sys; sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        ops = LanceOps(); results = []
        for tbl in tables.split(","):
            for h in ops.search(tbl.strip(), q, limit=3):
                results.append({"table": tbl.strip(), "id": h.get("id",""),
                    "title": h.get("title", h.get("rule", h.get("path",""))),
                    "snippet": str(h.get("description", h.get("content", h.get("rule",""))))[:200],
                    "status": h.get("status",""), "priority": h.get("priority", h.get("severity",""))})
        return results
    except Exception: return []

# 规范/知识库/自定义模块接口（保持兼容）
@app.get("/api/specs")
def list_specs():
    specs_dir = Path(__file__).parent.parent / "specs"
    if not specs_dir.exists(): return []
    return [{"path": str(f.relative_to(specs_dir)), "category": str(f.relative_to(specs_dir)).split("/")[0] if "/" in str(f.relative_to(specs_dir)) else "root",
             "name": f.name, "size": f.stat().st_size, "ext": f.suffix.lstrip(".")}
            for f in sorted(specs_dir.rglob("*")) if f.is_file() and not f.name.startswith(".")]

@app.get("/api/specs/content")
def get_spec_content(path: str = Query(...)):
    specs_dir = (Path(__file__).parent.parent / "specs").resolve()
    target = (specs_dir / path).resolve()
    if not str(target).startswith(str(specs_dir)): raise HTTPException(403, "Access denied")
    if not target.exists(): raise HTTPException(404, "Not found")
    return {"content": target.read_text(errors="replace"), "type": "text"} if target.suffix in (".md",".yaml",".yml",".json") else {"content": None, "type": "binary"}

@app.put("/api/specs/content")
def update_spec(path: str = Query(...), content: str = ""):
    specs_dir = (Path(__file__).parent.parent / "specs").resolve()
    target = (specs_dir / path).resolve()
    if not str(target).startswith(str(specs_dir)): raise HTTPException(403, "Access denied")
    target.write_text(content, encoding="utf-8"); return {"ok": True}

@app.get("/api/custom")
def list_custom():
    custom_dir = resolved_project_path() / "sop" / "custom"
    if not custom_dir.exists(): return []
    return [{"path": str(f.relative_to(custom_dir)), "category": str(f.relative_to(custom_dir)).split("/")[0] if "/" in str(f.relative_to(custom_dir)) else "root",
             "name": f.name, "size": f.stat().st_size, "ext": f.suffix.lstrip(".")}
            for f in sorted(custom_dir.rglob("*")) if f.is_file() and not f.name.startswith(".")]

@app.get("/api/custom/content")
def get_custom_content(path: str = Query(...)):
    custom_dir = (resolved_project_path() / "sop" / "custom").resolve()
    target = (custom_dir / path).resolve()
    if not str(target).startswith(str(custom_dir)): raise HTTPException(403, "Access denied")
    if not target.exists(): raise HTTPException(404, "Not found")
    return {"content": target.read_text(errors="replace"), "type": "text"} if target.suffix in (".md",".txt",".html",".json",".yaml",".yml",".java",".ts",".tsx",".py",".sql") else {"content": None, "type": "binary"}

@app.get("/api/rules")
def get_rules():
    try:
        from routers.db import rows as lr
        return lr("rules", 200)
    except Exception:
        return []

@app.get("/api/knowledge")
def get_knowledge():
    try:
        from routers.db import rows as lr
        return lr("knowledge", 200)
    except Exception:
        return []

@app.post("/api/rules")
def create_rule(rule: str, category: str = "coding", source: str = "human", confidence: float = 0.75):
    try:
        import sys; sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        rid = LanceOps().add_rule(rule, category, source, confidence)
        return {"ok": True, "id": rid}
    except Exception as e: raise HTTPException(500, str(e))

class KnowledgeCreate(BaseModel):
    title: str
    content: str
    category: str = "general"
    tags: Optional[List[str]] = []


class KnowledgeAiPolish(BaseModel):
    """对原始素材或正文做 AI 总结 / 润色，返回可填入表单的 JSON。"""
    raw_text: str = Field(..., max_length=200_000)
    mode: str = "summarize"  # summarize | polish
    category_hint: Optional[str] = None
    title_hint: Optional[str] = None


def _extract_json_obj(text: str) -> dict:
    t = text.strip()
    if "```" in t:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", t, re.I)
        if m:
            t = m.group(1).strip()
    i0, i1 = t.find("{"), t.rfind("}")
    if i0 < 0 or i1 <= i0:
        raise ValueError("模型未返回 JSON")
    return json.loads(t[i0 : i1 + 1])


def _knowledge_ai_polish(body: KnowledgeAiPolish) -> dict:
    try:
        import anthropic
    except ImportError:
        raise HTTPException(503, "请安装 anthropic")
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(503, "未配置 ANTHROPIC_API_KEY")
    mode = body.mode if body.mode in ("summarize", "polish") else "summarize"
    if mode == "polish":
        sys = """你是技术写作编辑。用户给的是知识库 Markdown 正文，请润色：结构清晰、术语统一、删冗余、补全小节标题与列表；不编造事实。
只输出一个 JSON 对象（不要 Markdown 围栏）：{"title":"精炼标题","content":"完整 Markdown","category":"general|specs|examples|design|interaction|daily|rules 之一","tags":["标签"]}"""
        user = f"标题参考: {body.title_hint or ''}\n分类参考: {body.category_hint or ''}\n\n--- 正文 ---\n{body.raw_text[:180_000]}"
    else:
        sys = """你是知识工程师。用户粘贴的是原始素材（文档摘录、会议记录、杂乱笔记等），请整理为**团队知识库条目**。
只输出一个 JSON 对象（不要 Markdown 围栏）：{"title":"20字内中文标题","content":"结构化 Markdown 正文（概述/要点/可选步骤/注意）","category":"general|specs|examples|design|interaction|daily|rules 之一","tags":["3-10个短标签，小写英文或中文词"]}
规则：去重、保留可核查事实；缺信息处用「待补充」占位，不要杜撰业务数据。"""
        user = f"标题参考: {body.title_hint or ''}\n分类参考: {body.category_hint or ''}\n\n--- 原始素材 ---\n{body.raw_text[:180_000]}"
    model = os.getenv("KNOWLEDGE_AI_MODEL", "claude-3-5-sonnet-20241022")
    client = anthropic.Anthropic(api_key=key)
    msg = client.messages.create(
        model=model,
        max_tokens=8192,
        system=sys,
        messages=[{"role": "user", "content": user}],
    )
    if not msg.content:
        raise HTTPException(502, "模型返回为空")
    raw = getattr(msg.content[0], "text", "") or ""
    obj = _extract_json_obj(raw)
    title = str(obj.get("title") or "").strip()[:200]
    content = str(obj.get("content") or "").strip()
    cat = str(obj.get("category") or "general").strip()
    if cat not in ("general", "specs", "examples", "design", "interaction", "daily", "rules"):
        cat = "general"
    tags = obj.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    tags = [str(x).strip() for x in tags if str(x).strip()][:16]
    if not title or not content:
        raise HTTPException(502, "模型返回缺少 title 或 content")
    return {"title": title, "content": content, "category": cat, "tags": tags}


@app.post("/api/knowledge")
def create_knowledge(body: KnowledgeCreate):
    try:
        import sys; sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        doc_id = LanceOps().index_document(
            path=f"manual/{body.category}/{body.title}",
            content=body.content,
            category=body.category,
            metadata={"title": body.title, "tags": body.tags or [], "source": "human"},
        )
        return {"ok": True, "id": doc_id}
    except Exception as e: raise HTTPException(500, str(e))


@app.post("/api/knowledge/ai-polish")
def knowledge_ai_polish(body: KnowledgeAiPolish):
    try:
        return {"ok": True, **_knowledge_ai_polish(body)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI 处理失败: {e}") from e


@app.post("/api/knowledge/extract-text")
async def knowledge_extract_text(file: UploadFile = File(...)):
    """从上传文件抽取纯文本，供前端填入「内容」或再走 AI 总结。"""
    raw = await file.read()
    if len(raw) > 2_000_000:
        raise HTTPException(400, "文件过大（最大 2MB）")
    name = (file.filename or "").lower()
    ct = (file.content_type or "").lower()
    if name.endswith((".md", ".markdown", ".txt")) or "text/" in ct or ct in ("application/json",):
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("utf-8", errors="replace")
        return {"ok": True, "text": text, "filename": file.filename}
    if name.endswith(".pdf"):
        try:
            import io
            from pypdf import PdfReader
        except ImportError:
            raise HTTPException(503, "PDF 需安装: pip install pypdf")
        try:
            reader = PdfReader(io.BytesIO(raw))
            parts = []
            for p in reader.pages[:200]:
                parts.append(p.extract_text() or "")
            text = "\n".join(parts).strip()
            if not text:
                raise HTTPException(400, "PDF 未解析到文本（可能为扫描件）")
            return {"ok": True, "text": text[:500_000], "filename": file.filename}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"PDF 解析失败: {e}") from e
    raise HTTPException(400, "暂支持 .txt / .md / .markdown / .pdf；其它格式请粘贴文本")


@app.delete("/api/knowledge/{doc_id}")
def delete_knowledge(doc_id: str):
    t = table("knowledge")
    if t is None: raise HTTPException(503, "数据库不可用")
    try:
        t.delete(f"id = '{doc_id}'")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/knowledge/index")
def index_knowledge():
    try:
        import sys; sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        n = LanceOps().index_custom_dir(); return {"ok": True, "count": n}
    except Exception as e: raise HTTPException(500, str(e))

@app.get("/api/knowledge/search")
def search_knowledge(q: str = Query(...), category: Optional[str] = None):
    try:
        import sys; sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        return [{"id": r.get("id"), "path": r.get("path"), "category": r.get("category"), "content": r.get("content","")[:300]}
                for r in LanceOps().search_knowledge(q, category=category, limit=10)]
    except Exception: return []

@app.get("/api/health")
def health():
    """探活与版本信息；展示版本可读自运行时 ai-memory/admin_release.json 或环境变量 ADMIN_RELEASE_VERSION。"""
    from path_config import request_scope_active, resolved_project_id, resolved_tenant_id

    display_version = "2.0"
    notes_val: Optional[str] = None
    updated_at: Optional[str] = None
    rp = resolved_ai_memory_root() / "admin_release.json"
    if rp.is_file():
        try:
            d = json.loads(rp.read_text(encoding="utf-8"))
            display_version = str(d.get("displayVersion") or d.get("display_version") or display_version)[:64]
            raw_notes = d.get("notes")
            if raw_notes is not None and str(raw_notes).strip():
                notes_val = str(raw_notes)[:800]
            updated_at = d.get("updatedAt") or d.get("updated_at")
            if updated_at is not None:
                updated_at = str(updated_at)[:40]
        except Exception:
            pass
    envv = (os.getenv("ADMIN_RELEASE_VERSION") or "").strip()
    if envv:
        display_version = envv[:64]
    out = {
        "ok": True,
        "service": "ai-team-devops-manager",
        "version": display_version,
        "notes": notes_val,
        "updatedAt": updated_at,
        "startedAt": _APP_BOOT_AT,
        "pid": os.getpid(),
        "admin_mode": os.getenv("ADMIN_MODE", "single"),
    }
    if request_scope_active():
        out["scopedTenantId"] = resolved_tenant_id()
        out["scopedProjectId"] = resolved_project_id()
    return out

# ── v1 版本化路由（新接口统一用 /api/v1/） ────────────────────────
from routers import notify, cli_wrapper
app.include_router(notify.router)
app.include_router(cli_wrapper.router)

# v1 别名（向后兼容：/api/v1/requirements 等同于 /api/requirements）
from fastapi import APIRouter as _AR
v1 = _AR(prefix="/api/v1")
for _r in [requirements.router, tasks.router, issues.router, agents.router,
           skills.router, mcp_mgr.router, system.router,
           models.router, orchestration.router, docker_env.router,
           skill_repo.router, vibe.router, design_docs.router, notify.router, cli_wrapper.router]:
    v1.include_router(_r, prefix=_r.prefix.replace("/api",""))
app.include_router(v1)

# Chrome DevTools 会探测此 URL；未注册时静态站返回 404 并刷屏访问日志
@app.get("/.well-known/appspecific/com.chrome.devtools.json")
def chrome_devtools_appspecific():
    return JSONResponse(content={})


# 静态文件（必须置于所有 API 路由之后，否则会拦截 /api/*）
static_dir = Path(__file__).parent
if (static_dir / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
