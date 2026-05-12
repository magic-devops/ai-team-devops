"""
AI Dev Dashboard - FastAPI 后端 v1.1
读取 LanceDB 数据，提供 REST API 供前端消费，支持人工介入操作。
新增：需求创建、Sprint 管理、自定义模块浏览、搜索、导出
"""
import os
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="AI Dev Dashboard")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

PROJECT_PATH = Path(os.getenv("PROJECT_PATH", "."))
DB_PATH = PROJECT_PATH / ".ai-memory" / "lancedb"

# ── 懒加载 LanceDB ──────────────────────────────────────────────
_db = None
def get_db():
    global _db
    if _db is None:
        try:
            import lancedb
            _db = lancedb.connect(str(DB_PATH))
        except Exception:
            _db = None
    return _db

def table(name: str):
    db = get_db()
    if db is None:
        return None
    try:
        return db.open_table(name)
    except Exception:
        return None

def _json_safe_value(v: Any):
    """将 pandas / numpy 等转为 FastAPI JSON 可序列化类型。"""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    if isinstance(v, datetime):
        return v.isoformat() + ("Z" if v.tzinfo is None else "")
    try:
        import numpy as np
        if isinstance(v, np.ndarray):
            return v.tolist()
        if isinstance(v, np.generic):
            return v.item()
    except ImportError:
        pass
    if isinstance(v, dict):
        return {k: _json_safe_value(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_json_safe_value(x) for x in v]
    if hasattr(v, "tolist") and callable(getattr(v, "tolist", None)):
        try:
            return v.tolist()
        except Exception:
            pass
    if hasattr(v, "isoformat") and callable(getattr(v, "isoformat", None)):
        try:
            return v.isoformat()
        except Exception:
            pass
    return str(v)

def rows(name: str, limit: int = 200) -> list:
    t = table(name)
    if t is None:
        return []
    try:
        raw = t.to_pandas().head(limit).to_dict("records")
        return [{k: _json_safe_value(v) for k, v in row.items()} for row in raw]
    except Exception:
        return []

# ── 仪表盘总览 ──────────────────────────────────────────────────
@app.get("/api/dashboard")
def dashboard():
    tasks = rows("tasks")
    reqs = rows("requirements")
    issues = rows("issues")
    sprints = rows("sprints")

    active_sprint = next((s for s in sprints if s.get("status") == "active"), None)
    sprint_tasks = [t for t in tasks if t.get("sprint_id") == (active_sprint or {}).get("id")] if active_sprint else tasks

    return {
        "sprint": active_sprint,
        "tasks": {
            "total": len(sprint_tasks),
            "completed": sum(1 for t in sprint_tasks if t.get("status") == "completed"),
            "in_progress": sum(1 for t in sprint_tasks if t.get("status") == "in_progress"),
            "blocked": [t for t in sprint_tasks if t.get("status") == "blocked"],
            "pending": sum(1 for t in sprint_tasks if t.get("status") == "pending"),
        },
        "requirements": {
            "total": len(reqs),
            "by_priority": _count_by(reqs, "priority"),
            "by_status": _count_by(reqs, "status"),
        },
        "issues": {
            "open": [i for i in issues if i.get("status") == "open"],
            "critical": [i for i in issues if i.get("status") == "open" and i.get("severity") in ("P0", "P1")],
        },
        "velocity": _velocity_trend(sprints),
    }

def _count_by(items, field):
    result = {}
    for item in items:
        k = item.get(field, "unknown")
        result[k] = result.get(k, 0) + 1
    return result

def _velocity_trend(sprints):
    completed = [s for s in sprints if s.get("status") == "completed"][-5:]
    return [{"id": s.get("id"), "velocity": s.get("velocity", 0), "planned": s.get("planned_points", 0)} for s in completed]

# ── 需求列表 ────────────────────────────────────────────────────
@app.get("/api/requirements")
def get_requirements(status: Optional[str] = None, priority: Optional[str] = None):
    reqs = rows("requirements")
    if status:
        reqs = [r for r in reqs if r.get("status") == status]
    if priority:
        reqs = [r for r in reqs if r.get("priority") == priority]
    return sorted(reqs, key=lambda r: (r.get("priority", "P9"), r.get("created_at", "")))

# ── 任务列表 ────────────────────────────────────────────────────
@app.get("/api/tasks")
def get_tasks(status: Optional[str] = None, sprint_id: Optional[str] = None):
    task_list = rows("tasks")
    if status:
        task_list = [t for t in task_list if t.get("status") == status]
    if sprint_id:
        task_list = [t for t in task_list if t.get("sprint_id") == sprint_id]
    return task_list

# ── 问题列表 ────────────────────────────────────────────────────
@app.get("/api/issues")
def get_issues(status: Optional[str] = None, severity: Optional[str] = None):
    issue_list = rows("issues")
    if status:
        issue_list = [i for i in issue_list if i.get("status") == status]
    if severity:
        issue_list = [i for i in issue_list if i.get("severity") == severity]
    return sorted(issue_list, key=lambda i: (i.get("severity", "P9"), i.get("created_at", "")))

# ── Agent 反思记录 ───────────────────────────────────────────────
@app.get("/api/reflections")
def get_reflections(limit: int = 50):
    return rows("agent_reflections", limit=limit)

# ── 人工介入：更新需求优先级 ─────────────────────────────────────
class PriorityUpdate(BaseModel):
    priority: str
    human_notes: Optional[str] = None

@app.patch("/api/requirements/{req_id}/priority")
def update_priority(req_id: str, body: PriorityUpdate):
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        t.update(where=f"id = '{req_id}'", values={
            "priority": body.priority,
            "human_notes": body.human_notes or "",
            "updated_at": datetime.utcnow(),
        })
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 人工介入：解除任务阻塞 ───────────────────────────────────────
class UnblockBody(BaseModel):
    human_notes: str

@app.patch("/api/tasks/{task_id}/unblock")
def unblock_task(task_id: str, body: UnblockBody):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        t.update(where=f"id = '{task_id}'", values={
            "status": "pending",
            "human_notes": body.human_notes,
            "updated_at": datetime.utcnow(),
        })
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 人工介入：关闭问题 ───────────────────────────────────────────
class ResolveBody(BaseModel):
    resolution: str

@app.patch("/api/issues/{issue_id}/resolve")
def resolve_issue(issue_id: str, body: ResolveBody):
    t = table("issues")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        t.update(where=f"id = '{issue_id}'", values={
            "status": "resolved",
            "resolution": body.resolution,
            "resolved_by": "human",
            "resolved_at": datetime.utcnow(),
        })
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 静态文件（前端） ─────────────────────────────────────────────
static_dir = Path(__file__).parent
if (static_dir / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

# ── 新增：需求创建 ───────────────────────────────────────────────
class RequirementCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: str = "P1"
    acceptance_criteria: Optional[List[str]] = []
    tags: Optional[List[str]] = []

@app.post("/api/requirements")
def create_requirement(body: RequirementCreate):
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        row = {
            "id": f"REQ-{int(datetime.utcnow().timestamp()*1000)}",
            "project_id": os.getenv("PROJECT_ID", "default"),
            "title": body.title,
            "description": body.description,
            "status": "pending",
            "priority": body.priority,
            "sprint_id": "",
            "story_points": 0,
            "acceptance_criteria": body.acceptance_criteria,
            "tags": body.tags,
            "human_notes": "",
            "confidence": 0.0,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        t.add([row])
        return {"ok": True, "id": row["id"]}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 新增：问题创建（人工上报） ────────────────────────────────────
class IssueCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    type: str = "bug"
    severity: str = "P2"
    task_id: Optional[str] = ""

@app.post("/api/issues")
def create_issue(body: IssueCreate):
    t = table("issues")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        row = {
            "id": f"ISSUE-{int(datetime.utcnow().timestamp()*1000)}",
            "project_id": os.getenv("PROJECT_ID", "default"),
            "sprint_id": "",
            "task_id": body.task_id or "",
            "title": body.title,
            "description": body.description,
            "type": body.type,
            "severity": body.severity,
            "status": "open",
            "reported_by": "human",
            "resolved_by": "",
            "resolution": "",
            "created_at": datetime.utcnow(),
            "resolved_at": None,
        }
        t.add([row])
        return {"ok": True, "id": row["id"]}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 新增：Sprint 列表 ────────────────────────────────────────────
@app.get("/api/sprints")
def get_sprints():
    return rows("sprints", limit=20)

# ── 新增：Sprint 创建 ────────────────────────────────────────────
class SprintCreate(BaseModel):
    goal: str
    planned_points: int = 0
    ends_at: Optional[str] = None

@app.post("/api/sprints")
def create_sprint(body: SprintCreate):
    t = table("sprints")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        # 关闭当前活跃 Sprint
        existing = rows("sprints")
        for s in existing:
            if s.get("status") == "active":
                t.update(where=f"id = '{s['id']}'", values={"status": "completed"})
        sprint_n = len(existing) + 1
        row = {
            "id": f"SPRINT-{sprint_n}",
            "project_id": os.getenv("PROJECT_ID", "default"),
            "goal": body.goal,
            "status": "active",
            "started_at": datetime.utcnow(),
            "ends_at": datetime.fromisoformat(body.ends_at) if body.ends_at else None,
            "velocity": 0.0,
            "planned_points": body.planned_points,
            "completion_rate": 0.0,
            "retrospective": "",
        }
        t.add([row])
        return {"ok": True, "id": row["id"]}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 新增：搜索 ──────────────────────────────────────────────────
@app.get("/api/search")
def search(q: str = Query(..., min_length=1)):
    results = []
    for name in ["requirements", "tasks", "issues"]:
        for row in rows(name, limit=500):
            text = f"{row.get('title','')} {row.get('description','')}".lower()
            if q.lower() in text:
                results.append({"type": name, **{k: v for k, v in row.items() if k != "vector"}})
    return results[:50]

# ── 新增：导出 JSON ──────────────────────────────────────────────
@app.get("/api/export")
def export_all():
    data = {}
    for name in ["requirements", "tasks", "issues", "sprints", "agent_reflections"]:
        raw = rows(name, limit=1000)
        # 序列化 datetime
        for row in raw:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        data[name] = raw
    return JSONResponse(content=data, headers={"Content-Disposition": "attachment; filename=ai-dev-export.json"})

# ── 新增：自定义模块文件列表 ─────────────────────────────────────
@app.get("/api/custom")
def list_custom():
    custom_dir = Path(os.getenv("PROJECT_PATH", ".")) / "sop" / "custom"
    if not custom_dir.exists():
        return []
    result = []
    for f in sorted(custom_dir.rglob("*")):
        if f.is_file() and not f.name.startswith("."):
            rel = str(f.relative_to(custom_dir))
            result.append({
                "path": rel,
                "category": rel.split("/")[0] if "/" in rel else "root",
                "name": f.name,
                "size": f.stat().st_size,
                "ext": f.suffix.lstrip("."),
            })
    return result

@app.get("/api/custom/content")
def get_custom_content(path: str = Query(...)):
    custom_dir = Path(os.getenv("PROJECT_PATH", ".")) / "sop" / "custom"
    target = (custom_dir / path).resolve()
    if not str(target).startswith(str(custom_dir.resolve())):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "File not found")
    if target.suffix in (".md", ".txt", ".html", ".json", ".yaml", ".yml", ".java", ".ts", ".tsx", ".py", ".sql"):
        return {"content": target.read_text(errors="replace"), "type": "text"}
    return {"content": None, "type": "binary", "size": target.stat().st_size}

# ── 新增：项目状态（current_state.json） ─────────────────────────
@app.get("/api/state")
def get_state():
    state_file = Path(os.getenv("PROJECT_PATH", ".")) / "memory" / "current_state.json"
    if state_file.exists():
        return json.loads(state_file.read_text())
    return {"error": "current_state.json not found"}

@app.patch("/api/state")
def update_state(body: dict):
    state_file = Path(os.getenv("PROJECT_PATH", ".")) / "memory" / "current_state.json"
    if not state_file.exists():
        raise HTTPException(404, "current_state.json not found")
    state = json.loads(state_file.read_text())
    state.update(body)
    state["updated_at"] = datetime.utcnow().isoformat() + "Z"
    state_file.write_text(json.dumps(state, indent=2, ensure_ascii=False))
    return {"ok": True}

# ── 规范文档列表（sop/specs/） ────────────────────────────────────
@app.get("/api/specs")
def list_specs():
    specs_dir = Path(__file__).parent.parent / "specs"
    if not specs_dir.exists():
        return []
    result = []
    for f in sorted(specs_dir.rglob("*")):
        if f.is_file() and not f.name.startswith("."):
            rel = str(f.relative_to(specs_dir))
            result.append({
                "path": rel, "category": rel.split("/")[0] if "/" in rel else "root",
                "name": f.name, "size": f.stat().st_size, "ext": f.suffix.lstrip("."),
            })
    return result

@app.get("/api/specs/content")
def get_spec_content(path: str = Query(...)):
    specs_dir = (Path(__file__).parent.parent / "specs").resolve()
    target = (specs_dir / path).resolve()
    if not str(target).startswith(str(specs_dir)):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "Not found")
    if target.suffix in (".md", ".txt", ".yaml", ".yml", ".json"):
        return {"content": target.read_text(errors="replace"), "type": "text"}
    return {"content": None, "type": "binary"}

# ── 规则库 ────────────────────────────────────────────────────────
@app.get("/api/rules")
def get_rules():
    return rows("rules", limit=200)

class RuleCreate(BaseModel):
    rule: str
    category: str = "coding"
    source: str = "human"
    confidence: float = 0.75

@app.post("/api/rules")
def create_rule(body: RuleCreate):
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        rid = LanceOps().add_rule(body.rule, body.category, body.source, body.confidence)
        return {"ok": True, "id": rid}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 知识库 ────────────────────────────────────────────────────────
@app.get("/api/knowledge")
def get_knowledge():
    return rows("knowledge", limit=200)

@app.post("/api/knowledge/index")
def index_knowledge():
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        n = LanceOps().index_custom_dir()
        return {"ok": True, "count": n}
    except Exception as e:
        raise HTTPException(500, str(e))

# ═══════════════════════════════════════════════════════════════
# v1.2 增强：需求 CRUD、执行计划、迭代进度、知识库、规范编辑
# ═══════════════════════════════════════════════════════════════

# ── 需求更新（标题/描述/状态/验收标准） ──────────────────────────
class RequirementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    story_points: Optional[int] = None
    acceptance_criteria: Optional[List[str]] = None
    human_notes: Optional[str] = None

@app.patch("/api/requirements/{req_id}")
def update_requirement(req_id: str, body: RequirementUpdate):
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        vals = {k: v for k, v in body.dict().items() if v is not None}
        vals["updated_at"] = datetime.utcnow()
        t.update(where=f"id = '{req_id}'", values=vals)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.delete("/api/requirements/{req_id}")
def delete_requirement(req_id: str):
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        t.delete(f"id = '{req_id}'")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 执行计划（任务 CRUD） ─────────────────────────────────────────
class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: str = "P1"
    estimate: str = "M"
    req_id: Optional[str] = ""
    sprint_id: Optional[str] = ""
    assigned_to: Optional[str] = "Coder"

@app.post("/api/tasks")
def create_task(body: TaskCreate):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        row = {
            "id": f"T-{int(datetime.utcnow().timestamp()*1000)}",
            "project_id": os.getenv("PROJECT_ID", "default"),
            "req_id": body.req_id or "",
            "sprint_id": body.sprint_id or "",
            "title": body.title,
            "description": body.description,
            "status": "pending",
            "priority": body.priority,
            "estimate": body.estimate,
            "assigned_to": body.assigned_to,
            "actual_hours": 0.0,
            "confidence": 0.0,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        t.add([row])
        return {"ok": True, "id": row["id"]}
    except Exception as e:
        raise HTTPException(500, str(e))

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    estimate: Optional[str] = None
    assigned_to: Optional[str] = None
    actual_hours: Optional[float] = None
    confidence: Optional[float] = None
    sprint_id: Optional[str] = None
    human_notes: Optional[str] = None

@app.patch("/api/tasks/{task_id}")
def update_task(task_id: str, body: TaskUpdate):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        vals = {k: v for k, v in body.dict().items() if v is not None}
        vals["updated_at"] = datetime.utcnow()
        t.update(where=f"id = '{task_id}'", values=vals)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        t.delete(f"id = '{task_id}'")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 迭代进度详情 ──────────────────────────────────────────────────
@app.get("/api/sprints/{sprint_id}/progress")
def sprint_progress(sprint_id: str):
    tasks = [t for t in rows("tasks") if t.get("sprint_id") == sprint_id]
    issues = [i for i in rows("issues") if i.get("sprint_id") == sprint_id]
    total = len(tasks)
    done = sum(1 for t in tasks if t.get("status") == "completed")
    blocked = [t for t in tasks if t.get("status") == "blocked"]
    avg_conf = (sum(t.get("confidence", 0) for t in tasks if t.get("confidence")) /
                max(1, sum(1 for t in tasks if t.get("confidence"))))
    return {
        "sprint_id": sprint_id,
        "total_tasks": total,
        "completed": done,
        "in_progress": sum(1 for t in tasks if t.get("status") == "in_progress"),
        "blocked": blocked,
        "pending": sum(1 for t in tasks if t.get("status") == "pending"),
        "completion_rate": round(done / max(1, total) * 100, 1),
        "avg_confidence": round(avg_conf, 2),
        "open_issues": [i for i in issues if i.get("status") == "open"],
        "tasks": tasks,
    }

@app.patch("/api/sprints/{sprint_id}")
def update_sprint(sprint_id: str, body: dict):
    t = table("sprints")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        body["updated_at"] = datetime.utcnow()
        t.update(where=f"id = '{sprint_id}'", values=body)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 知识库 CRUD ───────────────────────────────────────────────────
class KnowledgeCreate(BaseModel):
    title: str
    content: str
    category: str = "general"
    tags: Optional[List[str]] = []

@app.post("/api/knowledge")
def create_knowledge(body: KnowledgeCreate):
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        doc_id = LanceOps().index_document(
            path=f"manual/{body.category}/{body.title}",
            content=body.content,
            category=body.category,
            metadata={"title": body.title, "tags": body.tags, "source": "human"}
        )
        return {"ok": True, "id": doc_id}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.delete("/api/knowledge/{doc_id}")
def delete_knowledge(doc_id: str):
    t = table("knowledge")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        t.delete(f"id = '{doc_id}'")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/api/knowledge/search")
def search_knowledge(q: str = Query(...), category: Optional[str] = None):
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        results = LanceOps().search_knowledge(q, category=category, limit=10)
        return [{"id": r.get("id"), "path": r.get("path"), "category": r.get("category"),
                 "content": r.get("content", "")[:300]} for r in results]
    except Exception as e:
        return []

# ── 规范文件编辑 ──────────────────────────────────────────────────
class SpecUpdate(BaseModel):
    content: str

@app.put("/api/specs/content")
def update_spec(path: str = Query(...), body: SpecUpdate = None):
    specs_dir = (Path(__file__).parent.parent / "specs").resolve()
    target = (specs_dir / path).resolve()
    if not str(target).startswith(str(specs_dir)):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "Not found")
    if target.suffix not in (".md", ".yaml", ".yml", ".json"):
        raise HTTPException(400, "Only text files can be edited")
    try:
        target.write_text(body.content, encoding="utf-8")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── LanceDB 语义搜索增强（跨表） ──────────────────────────────────
@app.get("/api/semantic-search")
def semantic_search(q: str = Query(...), tables: str = "tasks,requirements,issues,knowledge"):
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from knowledge.lancedb_ops import LanceOps
        ops = LanceOps()
        results = []
        for tbl in tables.split(","):
            tbl = tbl.strip()
            hits = ops.search(tbl, q, limit=3)
            for h in hits:
                results.append({
                    "table": tbl,
                    "id": h.get("id", ""),
                    "title": h.get("title", h.get("rule", h.get("path", ""))),
                    "snippet": str(h.get("description", h.get("content", h.get("rule", ""))))[:200],
                    "status": h.get("status", ""),
                    "priority": h.get("priority", h.get("severity", "")),
                })
        return results
    except Exception as e:
        return []

# ── 统计分析 ──────────────────────────────────────────────────────
@app.get("/api/analytics")
def analytics():
    tasks = rows("tasks", 1000)
    reqs = rows("requirements", 1000)
    issues = rows("issues", 1000)
    sprints = rows("sprints", 20)

    def by(items, field):
        r = {}
        for i in items:
            k = i.get(field, "unknown")
            r[k] = r.get(k, 0) + 1
        return r

    completed_tasks = [t for t in tasks if t.get("status") == "completed"]
    avg_conf = (sum(t.get("confidence", 0) for t in completed_tasks if t.get("confidence")) /
                max(1, len(completed_tasks)))

    return {
        "tasks": {"total": len(tasks), "by_status": by(tasks, "status"), "by_priority": by(tasks, "priority")},
        "requirements": {"total": len(reqs), "by_status": by(reqs, "status"), "by_priority": by(reqs, "priority")},
        "issues": {"total": len(issues), "by_type": by(issues, "type"), "by_severity": by(issues, "severity"),
                   "open": sum(1 for i in issues if i.get("status") == "open")},
        "sprints": {"total": len(sprints), "active": sum(1 for s in sprints if s.get("status") == "active")},
        "avg_confidence": round(avg_conf, 2),
        "velocity_trend": [{"id": s.get("id"), "velocity": s.get("velocity", 0),
                            "planned": s.get("planned_points", 0)} for s in sprints[-5:]],
    }
