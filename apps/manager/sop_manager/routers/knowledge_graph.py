"""Knowledge Graph / Graph RAG control plane."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_id,
    resolved_project_path,
    resolved_tenant_code,
    sop_dir,
)
from sop_manager.routers.db_sql_compat import rows
from sop_manager.routers.knowledge_graph_core import (
    DEFAULT_ENTITY_TYPES,
    build_graph_from_documents,
    lineage_for_entity,
    now_iso,
    query_graph,
)

router = APIRouter(prefix="/api/v1/knowledge-graph", tags=["knowledge-graph"])


class BuildIn(BaseModel):
    entity_types: list[str] = Field(default_factory=lambda: ["requirement", "task", "code_file", "spec", "design_doc", "agent", "tag"])
    rebuild: bool = False
    documents: list[dict[str, Any]] | None = None


class QueryIn(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=10, ge=1, le=50)


class LineageIn(BaseModel):
    entity_id: str = Field(..., min_length=1)
    depth: int = Field(default=2, ge=1, le=4)


def _scope() -> dict[str, str]:
    return {
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
    }


def _kg_dir() -> Path:
    root = resolved_ai_memory_root() / "knowledge_graph"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _graph_path() -> Path:
    return _kg_dir() / "graph.json"


def _safe_read_text(path: Path, limit: int = 6000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[:limit]
    except Exception:
        return ""


def _jsonl_rows(path: Path, limit: int = 80) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not path.exists():
        return items
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if len(items) >= limit:
                break
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if isinstance(obj, dict):
                items.append(obj)
    except Exception:
        return items
    return items


def _load_lance_knowledge(limit: int = 80) -> list[dict[str, Any]]:
    try:
        from sop_manager.routers.db import rows as lance_rows

        return [
            {
                "id": item.get("id") or item.get("path"),
                "type": "knowledge",
                "title": item.get("title") or item.get("path") or item.get("id"),
                "content": item.get("content") or item.get("description") or "",
                "category": item.get("category") or "knowledge",
                "path": item.get("path") or "",
                "source": "workspace.knowledge",
            }
            for item in lance_rows("knowledge", limit=limit)
        ]
    except Exception:
        return []


def _load_file_documents() -> list[dict[str, Any]]:
    project_root = resolved_project_path()
    docs: list[dict[str, Any]] = []

    for base in [project_root / "docs" / "architecture", project_root / "docs"]:
        if not base.exists():
            continue
        for path in sorted(base.glob("*.md"))[:60]:
            docs.append(
                {
                    "id": str(path.relative_to(project_root)),
                    "type": "design_doc" if "architecture" in path.parts else "spec",
                    "title": path.stem.replace("_", " "),
                    "content": _safe_read_text(path),
                    "path": str(path.relative_to(project_root)),
                    "source": "project.docs",
                }
            )

    try:
        spec_root = sop_dir() / "specs"
        for path in sorted(spec_root.rglob("*.md"))[:80]:
            docs.append(
                {
                    "id": str(path.relative_to(sop_dir())),
                    "type": "spec",
                    "title": path.stem.replace("_", " "),
                    "content": _safe_read_text(path, 4000),
                    "path": str(path),
                    "source": "ai-sop.specs",
                }
            )
    except Exception:
        pass
    return docs


def _load_runtime_documents() -> list[dict[str, Any]]:
    root = resolved_ai_memory_root()
    runtime = root.parent
    docs: list[dict[str, Any]] = []

    for path in sorted((root / "agents").glob("*.json"))[:60]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        docs.append(
            {
                "id": data.get("id") or path.stem,
                "type": "agent",
                "title": data.get("name") or data.get("id") or path.stem,
                "content": json.dumps(data, ensure_ascii=False)[:5000],
                "tags": data.get("capabilities") or [],
                "path": str(path),
                "source": "ai-memory.agents",
            }
        )

    for idx, item in enumerate(_jsonl_rows(runtime / "kb" / "outbox.jsonl", limit=80)):
        payload = item.get("payload") if isinstance(item.get("payload"), dict) else item
        docs.append(
            {
                "id": payload.get("id") or f"kb-outbox-{idx}",
                "type": "knowledge",
                "title": payload.get("title") or payload.get("path") or f"知识条目 {idx + 1}",
                "content": payload.get("content") or payload.get("text") or json.dumps(payload, ensure_ascii=False)[:4000],
                "category": payload.get("category") or "knowledge",
                "tags": payload.get("tags") or [],
                "source": "kb.outbox",
            }
        )
    return docs


def _load_sql_documents() -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    for table_name, entity_type in [("requirements", "requirement"), ("tasks", "task"), ("issues", "issue")]:
        for item in rows(table_name, 500):
            docs.append(
                {
                    "id": item.get("id"),
                    "type": entity_type,
                    "title": item.get("title") or item.get("id"),
                    "content": item.get("description") or item.get("acceptance_criteria") or "",
                    "status": item.get("status") or "",
                    "priority": item.get("priority") or item.get("severity") or "",
                    "tags": item.get("tags") or [],
                    "source": f"sql.{table_name}",
                }
            )
    return docs


def load_source_documents(extra: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    docs.extend(_load_sql_documents())
    docs.extend(_load_lance_knowledge())
    docs.extend(_load_file_documents())
    docs.extend(_load_runtime_documents())
    if extra:
        docs.extend(extra)
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for item in docs:
        key = f"{item.get('type')}:{item.get('id') or item.get('path') or item.get('title')}"
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _empty_graph() -> dict[str, Any]:
    return {
        "version": "1.0",
        "built_at": None,
        "documents": 0,
        "entities": [],
        "edges": [],
        "summary": {"nodes": 0, "edges": 0, "entity_types": 0, "type_counts": {}, "last_built_at": None},
    }


def _load_graph() -> dict[str, Any]:
    path = _graph_path()
    if not path.exists():
        return _empty_graph()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _empty_graph()


def _save_graph(graph: dict[str, Any]) -> None:
    _graph_path().write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")


def _response(kg: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "ok": True,
        **_scope(),
        "summary": kg.get("summary") or {},
        "documents": kg.get("documents") or 0,
        "graph_path": str(_graph_path()),
        **extra,
    }


@router.get("/summary")
def summary() -> dict[str, Any]:
    graph = _load_graph()
    return _response(
        graph,
        graph_built=bool(graph.get("built_at")),
        source_documents=len(load_source_documents()),
        entity_types=DEFAULT_ENTITY_TYPES,
    )


@router.post("/build")
def build(body: BuildIn) -> dict[str, Any]:
    docs = load_source_documents(body.documents)
    if not docs:
        raise HTTPException(400, "没有可构建图谱的项目知识源")
    graph = build_graph_from_documents(docs, entity_types=body.entity_types or DEFAULT_ENTITY_TYPES)
    graph["scope"] = _scope()
    graph["build_options"] = {"entity_types": body.entity_types, "rebuild": body.rebuild}
    graph["updated_at"] = now_iso()
    _save_graph(graph)
    return _response(graph, graph=graph)


@router.post("/query")
def query(body: QueryIn) -> dict[str, Any]:
    graph = _load_graph()
    if not graph.get("built_at"):
        docs = load_source_documents()
        graph = build_graph_from_documents(docs, entity_types=DEFAULT_ENTITY_TYPES) if docs else _empty_graph()
        if docs:
            graph["scope"] = _scope()
            graph["updated_at"] = now_iso()
            _save_graph(graph)
    out = query_graph(graph, body.query, top_k=body.top_k)
    return _response(graph, **out)


@router.post("/lineage")
def lineage(body: LineageIn) -> dict[str, Any]:
    graph = _load_graph()
    out = lineage_for_entity(graph, body.entity_id, depth=body.depth)
    return _response(graph, **out)


@router.get("/entities")
def entities(limit: int = 200, entity_type: str = "") -> dict[str, Any]:
    graph = _load_graph()
    items = graph.get("entities") or []
    if entity_type:
        items = [item for item in items if item.get("type") == entity_type]
    return _response(graph, items=items[: max(1, min(limit, 1000))], total=len(items))


@router.get("/edges")
def edges(limit: int = 300, edge_type: str = "") -> dict[str, Any]:
    graph = _load_graph()
    items = graph.get("edges") or []
    if edge_type:
        items = [item for item in items if item.get("type") == edge_type]
    return _response(graph, items=items[: max(1, min(limit, 1000))], total=len(items))
