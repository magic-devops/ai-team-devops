"""
ai-team-devops 项目管理后台 - 模块化入口
每个路由模块独立，按需加载，AI 修改时只需读取对应模块文件
"""
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="ai-team-devops Manager", version="2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── 按需注册路由模块 ──────────────────────────────────────────────
from routers import requirements, tasks, issues, agents, skills, mcp_mgr, auth, system
from routers import models, orchestration, docker_env, skill_repo, vibe
from routers.db import rows, table, now, PROJECT_PATH

app.include_router(requirements.router)
app.include_router(tasks.router)
app.include_router(issues.router)
app.include_router(agents.router)
app.include_router(skills.router)
app.include_router(mcp_mgr.router)
app.include_router(auth.router)
app.include_router(system.router)
app.include_router(models.router)
app.include_router(orchestration.router)
app.include_router(docker_env.router)
app.include_router(skill_repo.router)
app.include_router(vibe.router)

# ── 保留原有接口（向后兼容） ──────────────────────────────────────
import json
from datetime import datetime
from typing import Optional, List
from fastapi import HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

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
    if t is None: raise HTTPException(503, "LanceDB not available")
    existing = rows("sprints")
    for s in existing:
        if s.get("status") == "active":
            t.update(where=f"id = '{s['id']}'", values={"status": "completed"})
    row = {"id": f"SPRINT-{len(existing)+1}", "project_id": os.getenv("PROJECT_ID","default"),
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
def get_reflections(limit: int = 100): return rows("agent_reflections", limit=limit)

@app.get("/api/search")
def search(q: str = Query(..., min_length=1)):
    results = []
    for name in ["requirements", "tasks", "issues"]:
        for row in rows(name, 500):
            if q.lower() in f"{row.get('title','')} {row.get('description','')}".lower():
                results.append({"type": name, **{k: v for k, v in row.items() if k != "vector"}})
    return results[:50]

@app.get("/api/export")
def export_all():
    data = {}
    for name in ["requirements", "tasks", "issues", "sprints", "agent_reflections"]:
        raw = rows(name, 1000)
        for row in raw:
            for k, v in row.items():
                if hasattr(v, "isoformat"): row[k] = v.isoformat()
        data[name] = raw
    return JSONResponse(content=data, headers={"Content-Disposition": "attachment; filename=export.json"})

@app.get("/api/state")
def get_state():
    f = PROJECT_PATH / "memory" / "current_state.json"
    return json.loads(f.read_text()) if f.exists() else {"error": "current_state.json not found"}

@app.patch("/api/state")
def update_state(body: dict):
    f = PROJECT_PATH / "memory" / "current_state.json"
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
    custom_dir = PROJECT_PATH / "sop" / "custom"
    if not custom_dir.exists(): return []
    return [{"path": str(f.relative_to(custom_dir)), "category": str(f.relative_to(custom_dir)).split("/")[0] if "/" in str(f.relative_to(custom_dir)) else "root",
             "name": f.name, "size": f.stat().st_size, "ext": f.suffix.lstrip(".")}
            for f in sorted(custom_dir.rglob("*")) if f.is_file() and not f.name.startswith(".")]

@app.get("/api/custom/content")
def get_custom_content(path: str = Query(...)):
    custom_dir = (PROJECT_PATH / "sop" / "custom").resolve()
    target = (custom_dir / path).resolve()
    if not str(target).startswith(str(custom_dir)): raise HTTPException(403, "Access denied")
    if not target.exists(): raise HTTPException(404, "Not found")
    return {"content": target.read_text(errors="replace"), "type": "text"} if target.suffix in (".md",".txt",".html",".json",".yaml",".yml",".java",".ts",".tsx",".py",".sql") else {"content": None, "type": "binary"}

@app.get("/api/rules")
def get_rules(): return rows("rules", 200)

@app.post("/api/rules")
def create_rule(rule: str, category: str = "coding", source: str = "human", confidence: float = 0.75):
    try:
        import sys; sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        rid = LanceOps().add_rule(rule, category, source, confidence)
        return {"ok": True, "id": rid}
    except Exception as e: raise HTTPException(500, str(e))

@app.get("/api/knowledge")
def get_knowledge(): return rows("knowledge", 200)

class KnowledgeCreate(BaseModel):
    title: str
    content: str
    category: str = "general"
    tags: Optional[List[str]] = []

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

@app.delete("/api/knowledge/{doc_id}")
def delete_knowledge(doc_id: str):
    t = table("knowledge")
    if t is None: raise HTTPException(503, "LanceDB not available")
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
    """探活与版本信息（监控 / 网关健康检查）。"""
    return {"ok": True, "service": "ai-team-devops-manager", "version": "2.0"}

# ── v1 版本化路由（新接口统一用 /api/v1/） ────────────────────────
from routers import notify, cli_wrapper
app.include_router(notify.router)
app.include_router(cli_wrapper.router)

# v1 别名（向后兼容：/api/v1/requirements 等同于 /api/requirements）
from fastapi import APIRouter as _AR
v1 = _AR(prefix="/api/v1")
for _r in [requirements.router, tasks.router, issues.router, agents.router,
           skills.router, mcp_mgr.router, auth.router, system.router,
           models.router, orchestration.router, docker_env.router,
           skill_repo.router, vibe.router, notify.router, cli_wrapper.router]:
    v1.include_router(_r, prefix=_r.prefix.replace("/api",""))
app.include_router(v1)

# 静态文件（必须置于所有 API 路由之后，否则会拦截 /api/*）
static_dir = Path(__file__).parent
if (static_dir / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
