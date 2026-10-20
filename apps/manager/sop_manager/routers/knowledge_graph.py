"""Knowledge Graph / Graph RAG control plane."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from sop_manager.memory_store import get_memory_store
from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_id,
    resolved_project_path,
    resolved_tenant_code,
    sop_dir,
)
from sop_manager.project_write_guard import project_file_write_scope
from sop_manager.routers.business_access import read_business_access, require_business_access
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
    allowed_sources: list[str] = Field(default_factory=list)
    denied_sources: list[str] = Field(default_factory=list)


class QueryIn(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=10, ge=1, le=50)


class LineageIn(BaseModel):
    entity_id: str = Field(..., min_length=1)
    depth: int = Field(default=2, ge=1, le=4)


class EntityProfileMergeIn(BaseModel):
    entity_id: str = Field(..., min_length=1)
    memory_query: str = Field("", max_length=1000)
    memory_limit: int = Field(default=10, ge=1, le=50)
    depth: int = Field(default=1, ge=1, le=3)


def _scope() -> dict[str, str]:
    return {
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
    }


def _kg_dir() -> Path:
    root = resolved_ai_memory_root() / "knowledge_graph"
    return root


def _graph_path() -> Path:
    return _kg_dir() / "graph.json"


def _profiles_path() -> Path:
    return _kg_dir() / "entity_profiles.json"


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
    # An absent optional source is empty. Connecting an absent LanceDB would
    # create its directory during a GET, so only open an existing knowledge table.
    db_dir = resolved_ai_memory_root() / "lancedb"
    if not (db_dir / "knowledge.lance").exists():
        return []
    try:
        import lancedb
    except ImportError as exc:
        raise HTTPException(503, "已配置的项目知识源暂不可用，请检查 LanceDB 依赖") from exc

    # Do not use db.rows here: its catch-all fallback would hide failures of a
    # configured source as a successful empty knowledge graph.
    source = lancedb.connect(str(db_dir)).open_table("knowledge")
    items = source.to_pandas().head(limit).to_dict("records")
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
        for item in items
    ]


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


def _listify(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _document_permission(doc: dict[str, Any], *, allowed_sources: list[str], denied_sources: list[str]) -> tuple[bool, str]:
    source = str(doc.get("source") or doc.get("path") or doc.get("type") or "local")
    if denied_sources and source in denied_sources:
        return False, "source_denied"
    if allowed_sources and source not in allowed_sources:
        return False, "source_not_allowed"

    scope = _scope()
    checks = [
        ("allowed_tenant_codes", scope["tenant_code"]),
        ("allowed_business_codes", scope["business_code"]),
        ("allowed_project_ids", scope["project_id"]),
        ("allowed_project_codes", scope["project_id"]),
    ]
    for key, current in checks:
        allowed_values = _listify(doc.get(key))
        if allowed_values and current not in allowed_values:
            return False, f"{key}_mismatch"

    denied_projects = set(_listify(doc.get("denied_project_ids")))
    if denied_projects and scope["project_id"] in denied_projects:
        return False, "project_denied"
    return True, ""


def _filter_documents(docs: list[dict[str, Any]], body: BuildIn | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    allowed_sources = [str(item).strip() for item in ((body.allowed_sources if body else []) or []) if str(item).strip()]
    denied_sources = [str(item).strip() for item in ((body.denied_sources if body else []) or []) if str(item).strip()]
    accepted: list[dict[str, Any]] = []
    denied: list[dict[str, Any]] = []
    for doc in docs:
        ok, reason = _document_permission(doc, allowed_sources=allowed_sources, denied_sources=denied_sources)
        if ok:
            accepted.append(doc)
        else:
            denied.append(
                {
                    "id": doc.get("id") or doc.get("path") or doc.get("title"),
                    "source": doc.get("source") or doc.get("path") or doc.get("type") or "local",
                    "reason": reason,
                }
            )
    return accepted, {
        "checked": len(docs),
        "accepted_documents": len(accepted),
        "denied_documents": len(denied),
        "allowed_sources": allowed_sources,
        "denied_sources": denied_sources,
        "denied": denied[:50],
    }


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
    with project_file_write_scope():
        path = _graph_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")


def _entity_evidence(entity: dict[str, Any]) -> list[dict[str, Any]]:
    props = entity.get("properties") if isinstance(entity.get("properties"), dict) else {}
    content = str(entity.get("content") or "")
    sources = entity.get("sources") if isinstance(entity.get("sources"), list) else []
    if not sources:
        sources = [props.get("path") or entity.get("type") or "local"]
    evidence: list[dict[str, Any]] = []
    for source in sources[:6]:
        evidence.append(
            {
                "entity_id": entity.get("id"),
                "source": source,
                "path": props.get("path") or "",
                "title": entity.get("title") or entity.get("label") or entity.get("id"),
                "snippet": content[:260],
            }
        )
    return evidence


def _edge_evidence(edge: dict[str, Any]) -> dict[str, Any]:
    return {
        "edge_id": edge.get("id"),
        "source": edge.get("edge_source") or "graph",
        "relationship": edge.get("type"),
        "from": edge.get("source"),
        "to": edge.get("target"),
    }


def _decorate_query_results(out: dict[str, Any]) -> dict[str, Any]:
    for row in out.get("results") or []:
        entity = row.get("entity") if isinstance(row.get("entity"), dict) else {}
        evidence = _entity_evidence(entity)
        evidence.extend(_edge_evidence(edge) for edge in (row.get("edges") or [])[:6])
        row["evidence"] = evidence
        row["evidence_count"] = len(evidence)
    return out


def _response(kg: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "ok": True,
        **_scope(),
        "summary": kg.get("summary") or {},
        "documents": kg.get("documents") or 0,
        "graph_path": str(_graph_path()),
        **extra,
    }


@router.get("/summary", dependencies=[Depends(read_business_access)])
def summary() -> dict[str, Any]:
    graph = _load_graph()
    return _response(
        graph,
        graph_built=bool(graph.get("built_at")),
        source_documents=len(load_source_documents()),
        entity_types=DEFAULT_ENTITY_TYPES,
    )


@router.post("/build", dependencies=[Depends(require_business_access)])
def build(body: BuildIn) -> dict[str, Any]:
    docs = load_source_documents(body.documents)
    docs, permission = _filter_documents(docs, body)
    if not docs:
        raise HTTPException(400, "没有可构建图谱的项目知识源")
    graph = build_graph_from_documents(docs, entity_types=body.entity_types or DEFAULT_ENTITY_TYPES)
    graph["scope"] = _scope()
    graph["build_options"] = {
        "entity_types": body.entity_types,
        "rebuild": body.rebuild,
        "allowed_sources": body.allowed_sources,
        "denied_sources": body.denied_sources,
    }
    graph["permission"] = permission
    graph["updated_at"] = now_iso()
    _save_graph(graph)
    return _response(graph, graph=graph, permission=permission)


@router.post("/query", dependencies=[Depends(read_business_access)])
def query(body: QueryIn) -> dict[str, Any]:
    graph = _load_graph()
    if not graph.get("built_at"):
        raise HTTPException(409, {
            "code": "knowledge_graph_not_built",
            "message": "项目知识图谱尚未构建，请由有项目写权限的成员先执行构建",
        })
    out = _decorate_query_results(query_graph(graph, body.query, top_k=body.top_k))
    return _response(graph, **out)


@router.post("/lineage", dependencies=[Depends(read_business_access)])
def lineage(body: LineageIn) -> dict[str, Any]:
    graph = _load_graph()
    out = lineage_for_entity(graph, body.entity_id, depth=body.depth)
    return _response(graph, **out)


@router.get("/entities", dependencies=[Depends(read_business_access)])
def entities(limit: int = 200, entity_type: str = "") -> dict[str, Any]:
    graph = _load_graph()
    items = graph.get("entities") or []
    if entity_type:
        items = [item for item in items if item.get("type") == entity_type]
    return _response(graph, items=items[: max(1, min(limit, 1000))], total=len(items))


@router.get("/edges", dependencies=[Depends(read_business_access)])
def edges(limit: int = 300, edge_type: str = "") -> dict[str, Any]:
    graph = _load_graph()
    items = graph.get("edges") or []
    if edge_type:
        items = [item for item in items if item.get("type") == edge_type]
    return _response(graph, items=items[: max(1, min(limit, 1000))], total=len(items))


@router.post("/entity-profiles/merge", dependencies=[Depends(require_business_access)])
def merge_entity_profile(body: EntityProfileMergeIn) -> dict[str, Any]:
    graph = _load_graph()
    entity_map = {str(item.get("id")): item for item in graph.get("entities") or []}
    entity = entity_map.get(body.entity_id)
    if not entity:
        raise HTTPException(404, "实体不存在，请先构建知识图谱")

    lineage = lineage_for_entity(graph, body.entity_id, depth=body.depth)
    neighbors = [item for item in (lineage.get("nodes") or []) if item.get("id") != body.entity_id]
    memory_query = body.memory_query.strip() or str(entity.get("label") or entity.get("id") or "")
    memory_items: list[dict[str, Any]] = []
    store = get_memory_store()
    candidates = store.search(memory_query, limit=min(body.memory_limit * 4, 100))
    for item in candidates:
        md = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        state = str(md.get("lifecycle_state") or "active")
        if state not in ("active", "pinned"):
            continue
        if md.get("entity_id") == body.entity_id or memory_query.lower() in str(item.get("content") or "").lower():
            memory_items.append(item)
        if len(memory_items) >= body.memory_limit:
            break

    evidence_links = _entity_evidence(entity)
    evidence_links.extend(_edge_evidence(edge) for edge in (lineage.get("edges") or [])[:12])
    profile = {
        "entity": entity,
        "neighbors": neighbors,
        "edges": lineage.get("edges") or [],
        "memory_items": memory_items,
        "evidence_links": evidence_links,
        "profile_state": "merged",
        "merged_at": now_iso(),
        "scope": _scope(),
        "agent_consumption": {
            "purpose": "entity_profile_context",
            "suggested_use": "在回答 Graph RAG 问题、生成任务包或做影响分析前注入该实体画像。",
        },
    }

    with project_file_write_scope():
        profiles: dict[str, Any] = {}
        path = _profiles_path()
        if path.exists():
            try:
                profiles = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                profiles = {}
        profiles[body.entity_id] = profile
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8")
    return _response(graph, profile=profile)
