"""
@module: routers.workspace
@purpose: 项目工作台聚合 API（驾驶舱、搜索、规约/知识、知识库 CRUD 等）
@stable: 统一前缀 /api/v1；与领域路由（tasks、sprints…）互补，不重复 Sprint CRUD（见 sprints 路由）
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from path_config import resolved_ai_memory_root, resolved_project_path
from routers.db_sql_compat import rows, table, now

router = APIRouter(prefix="/api/v1", tags=["workspace"])


@router.get("/dashboard")
def dashboard() -> dict[str, Any]:
    tasks_all = rows("tasks")
    reqs = rows("requirements")
    issues_all = rows("issues")
    sprints = rows("sprints")
    active = next((s for s in sprints if s.get("status") == "active"), None)
    sprint_tasks = [t for t in tasks_all if t.get("sprint_id") == (active or {}).get("id")] if active else tasks_all
    total = len(sprint_tasks)
    done = sum(1 for t in sprint_tasks if t.get("status") == "completed")
    return {
        "sprint": active,
        "tasks": {
            "total": total,
            "completed": done,
            "in_progress": sum(1 for t in sprint_tasks if t.get("status") == "in_progress"),
            "blocked": [t for t in sprint_tasks if t.get("status") == "blocked"],
            "pending": sum(1 for t in sprint_tasks if t.get("status") == "pending"),
        },
        "requirements": {
            "total": len(reqs),
            "by_priority": {k: sum(1 for r in reqs if r.get("priority") == k) for k in ["P0", "P1", "P2", "P3"]},
            "by_status": {},
        },
        "issues": {
            "open": [i for i in issues_all if i.get("status") == "open"],
            "critical": [
                i for i in issues_all if i.get("status") == "open" and i.get("severity") in ("P0", "P1")
            ],
        },
        "velocity": [
            {"id": s.get("id"), "velocity": s.get("velocity", 0), "planned": s.get("planned_points", 0)}
            for s in [x for x in sprints if x.get("status") == "completed"][-5:]
        ],
    }


@router.get("/search")
def search(q: str = Query(..., min_length=1)) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for name in ["requirements", "tasks", "issues"]:
        for row in rows(name, 500):
            if q.lower() in f"{row.get('title', '')} {row.get('description', '')}".lower():
                results.append({"type": name, **{k: v for k, v in row.items() if k != "vector"}})
    return results[:50]


@router.get("/state")
def get_state() -> Any:
    f = resolved_project_path() / "memory" / "current_state.json"
    return json.loads(f.read_text()) if f.exists() else {"error": "current_state.json not found"}


@router.patch("/state")
def update_state(body: dict[str, Any]) -> dict[str, str]:
    f = resolved_project_path() / "memory" / "current_state.json"
    if not f.exists():
        raise HTTPException(404, "Not found")
    state = json.loads(f.read_text())
    state.update(body)
    state["updated_at"] = now().isoformat() + "Z"
    f.write_text(json.dumps(state, indent=2, ensure_ascii=False))
    return {"ok": "true"}


@router.get("/analytics")
def analytics() -> dict[str, Any]:
    tasks_all = rows("tasks", 1000)
    reqs = rows("requirements", 1000)
    issues_all = rows("issues", 1000)
    sprints = rows("sprints", 20)

    def by(items: list, field: str) -> dict[str, int]:
        r: dict[str, int] = {}
        for i in items:
            k = i.get(field, "?")
            r[k] = r.get(k, 0) + 1
        return r

    done = [t for t in tasks_all if t.get("status") == "completed"]
    confs = [t.get("confidence", 0) for t in done if t.get("confidence")]
    return {
        "tasks": {
            "total": len(tasks_all),
            "by_status": by(tasks_all, "status"),
            "by_priority": by(tasks_all, "priority"),
        },
        "requirements": {
            "total": len(reqs),
            "by_status": by(reqs, "status"),
            "by_priority": by(reqs, "priority"),
        },
        "issues": {
            "total": len(issues_all),
            "by_type": by(issues_all, "type"),
            "by_severity": by(issues_all, "severity"),
            "open": sum(1 for i in issues_all if i.get("status") == "open"),
        },
        "sprints": {"total": len(sprints), "active": sum(1 for s in sprints if s.get("status") == "active")},
        "avg_confidence": round(sum(confs) / max(1, len(confs)), 2),
        "velocity_trend": [
            {"id": s.get("id"), "velocity": s.get("velocity", 0), "planned": s.get("planned_points", 0)}
            for s in sprints[-5:]
        ],
    }


@router.get("/semantic-search")
def semantic_search(
    q: str = Query(...),
    tables: str = "tasks,requirements,issues,knowledge",
) -> list[dict[str, Any]]:
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from knowledge.lancedb_ops import LanceOps

        ops = LanceOps()
        results: list[dict[str, Any]] = []
        for tbl in tables.split(","):
            for h in ops.search(tbl.strip(), q, limit=3):
                results.append(
                    {
                        "table": tbl.strip(),
                        "id": h.get("id", ""),
                        "title": h.get("title", h.get("rule", h.get("path", ""))),
                        "snippet": str(h.get("description", h.get("content", h.get("rule", ""))))[:200],
                        "status": h.get("status", ""),
                        "priority": h.get("priority", h.get("severity", "")),
                    }
                )
        return results
    except Exception:
        return []


@router.get("/specs")
def list_specs() -> list[dict[str, Any]]:
    specs_dir = Path(__file__).parent.parent.parent / "specs"
    if not specs_dir.exists():
        return []
    return [
        {
            "path": str(f.relative_to(specs_dir)),
            "category": str(f.relative_to(specs_dir)).split("/")[0]
            if "/" in str(f.relative_to(specs_dir))
            else "root",
            "name": f.name,
            "size": f.stat().st_size,
            "ext": f.suffix.lstrip("."),
        }
        for f in sorted(specs_dir.rglob("*"))
        if f.is_file() and not f.name.startswith(".")
    ]


@router.get("/specs/content")
def get_spec_content(path: str = Query(...)) -> dict[str, Any]:
    specs_dir = (Path(__file__).parent.parent.parent / "specs").resolve()
    target = (specs_dir / path).resolve()
    if not str(target).startswith(str(specs_dir)):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "Not found")
    if target.suffix in (".md", ".yaml", ".yml", ".json"):
        return {"content": target.read_text(errors="replace"), "type": "text"}
    return {"content": None, "type": "binary"}


@router.put("/specs/content")
def update_spec(path: str = Query(...), content: str = "") -> dict[str, str]:
    specs_dir = (Path(__file__).parent.parent.parent / "specs").resolve()
    target = (specs_dir / path).resolve()
    if not str(target).startswith(str(specs_dir)):
        raise HTTPException(403, "Access denied")
    target.write_text(content, encoding="utf-8")
    return {"ok": "true"}


@router.get("/custom")
def list_custom() -> list[dict[str, Any]]:
    custom_dir = resolved_project_path() / "sop" / "custom"
    if not custom_dir.exists():
        return []
    return [
        {
            "path": str(f.relative_to(custom_dir)),
            "category": str(f.relative_to(custom_dir)).split("/")[0]
            if "/" in str(f.relative_to(custom_dir))
            else "root",
            "name": f.name,
            "size": f.stat().st_size,
            "ext": f.suffix.lstrip("."),
        }
        for f in sorted(custom_dir.rglob("*"))
        if f.is_file() and not f.name.startswith(".")
    ]


@router.get("/custom/content")
def get_custom_content(path: str = Query(...)) -> dict[str, Any]:
    custom_dir = (resolved_project_path() / "sop" / "custom").resolve()
    target = (custom_dir / path).resolve()
    if not str(target).startswith(str(custom_dir)):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "Not found")
    if target.suffix in (".md", ".txt", ".html", ".json", ".yaml", ".yml", ".java", ".ts", ".tsx", ".py", ".sql"):
        return {"content": target.read_text(errors="replace"), "type": "text"}
    return {"content": None, "type": "binary"}


@router.get("/agent-reflections")
def get_agent_reflections(limit: int = 100) -> Any:
    try:
        from routers.db import rows as lance_rows

        return lance_rows("agent_reflections", limit=limit)
    except Exception:
        return []


@router.get("/rules")
def get_rules() -> Any:
    try:
        from routers.db import rows as lr

        return lr("rules", 200)
    except Exception:
        return []


@router.get("/knowledge")
def get_knowledge() -> Any:
    try:
        from routers.db import rows as lr

        return lr("knowledge", 200)
    except Exception:
        return []


@router.post("/rules")
def create_rule(
    rule: str,
    category: str = "coding",
    source: str = "human",
    confidence: float = 0.75,
) -> dict[str, Any]:
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from knowledge.lancedb_ops import LanceOps

        rid = LanceOps().add_rule(rule, category, source, confidence)
        return {"ok": True, "id": rid}
    except Exception as e:
        raise HTTPException(500, str(e)) from e


class KnowledgeCreate(BaseModel):
    title: str
    content: str
    category: str = "general"
    tags: Optional[List[str]] = []


class KnowledgeAiPolish(BaseModel):
    raw_text: str = Field(..., max_length=200_000)
    mode: str = "summarize"
    category_hint: Optional[str] = None
    title_hint: Optional[str] = None


def _extract_json_obj(text: str) -> dict[str, Any]:
    t = text.strip()
    if "```" in t:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", t, re.I)
        if m:
            t = m.group(1).strip()
    i0, i1 = t.find("{"), t.rfind("}")
    if i0 < 0 or i1 <= i0:
        raise ValueError("模型未返回 JSON")
    return json.loads(t[i0 : i1 + 1])


def _knowledge_ai_polish(body: KnowledgeAiPolish) -> dict[str, Any]:
    try:
        import anthropic
    except ImportError as e:
        raise HTTPException(503, "请安装 anthropic") from e
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(503, "未配置 ANTHROPIC_API_KEY")
    mode = body.mode if body.mode in ("summarize", "polish") else "summarize"
    if mode == "polish":
        sys_p = """你是技术写作编辑。用户给的是知识库 Markdown 正文，请润色：结构清晰、术语统一、删冗余、补全小节标题与列表；不编造事实。
只输出一个 JSON 对象（不要 Markdown 围栏）：{"title":"精炼标题","content":"完整 Markdown","category":"general|specs|examples|design|interaction|daily|rules 之一","tags":["标签"]}"""
        user = f"标题参考: {body.title_hint or ''}\n分类参考: {body.category_hint or ''}\n\n--- 正文 ---\n{body.raw_text[:180_000]}"
    else:
        sys_p = """你是知识工程师。用户粘贴的是原始素材（文档摘录、会议记录、杂乱笔记等），请整理为**团队知识库条目**。
只输出一个 JSON 对象（不要 Markdown 围栏）：{"title":"20字内中文标题","content":"结构化 Markdown 正文（概述/要点/可选步骤/注意）","category":"general|specs|examples|design|interaction|daily|rules 之一","tags":["3-10个短标签，小写英文或中文词"]}
规则：去重、保留可核查事实；缺信息处用「待补充」占位，不要杜撰业务数据。"""
        user = f"标题参考: {body.title_hint or ''}\n分类参考: {body.category_hint or ''}\n\n--- 原始素材 ---\n{body.raw_text[:180_000]}"
    model = os.getenv("KNOWLEDGE_AI_MODEL", "claude-3-5-sonnet-20241022")
    client = anthropic.Anthropic(api_key=key)
    msg = client.messages.create(
        model=model,
        max_tokens=8192,
        system=sys_p,
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


@router.post("/knowledge")
def create_knowledge(body: KnowledgeCreate) -> dict[str, Any]:
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from knowledge.lancedb_ops import LanceOps

        doc_id = LanceOps().index_document(
            path=f"manual/{body.category}/{body.title}",
            content=body.content,
            category=body.category,
            metadata={"title": body.title, "tags": body.tags or [], "source": "human"},
        )
        return {"ok": True, "id": doc_id}
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@router.post("/knowledge/ai-polish")
def knowledge_ai_polish(body: KnowledgeAiPolish) -> dict[str, Any]:
    try:
        return {"ok": True, **_knowledge_ai_polish(body)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI 处理失败: {e}") from e


@router.post("/knowledge/extract-text")
async def knowledge_extract_text(file: UploadFile = File(...)) -> dict[str, Any]:
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


@router.delete("/knowledge/{doc_id}")
def delete_knowledge(doc_id: str) -> dict[str, str]:
    t = table("knowledge")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    try:
        t.delete(f"id = '{doc_id}'")
        return {"ok": "true"}
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@router.post("/knowledge/index")
def index_knowledge() -> dict[str, Any]:
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from knowledge.lancedb_ops import LanceOps

        n = LanceOps().index_custom_dir()
        return {"ok": True, "count": n}
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@router.get("/knowledge/search")
def search_knowledge(q: str = Query(...), category: Optional[str] = None) -> list[dict[str, Any]]:
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from knowledge.lancedb_ops import LanceOps

        return [
            {
                "id": r.get("id"),
                "path": r.get("path"),
                "category": r.get("category"),
                "content": r.get("content", "")[:300],
            }
            for r in LanceOps().search_knowledge(q, category=category, limit=10)
        ]
    except Exception:
        return []
