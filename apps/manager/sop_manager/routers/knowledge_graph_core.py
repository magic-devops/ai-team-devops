"""Project knowledge graph core utilities.

The module is intentionally framework-free so routers, CLI, tests, and future
workers can reuse the same graph build/query behavior.
"""
from __future__ import annotations

import hashlib
import re
from collections import deque
from datetime import datetime, timezone
from typing import Any

DEFAULT_ENTITY_TYPES = [
    "requirement",
    "task",
    "issue",
    "code_file",
    "spec",
    "design_doc",
    "agent",
    "metric",
    "tag",
    "knowledge",
]

_ID_RE = re.compile(r"\b((?:REQ|TASK|ISSUE|SPRINT|AGENT|METRIC|TAG|DOC|SPEC)[-_][A-Za-z0-9_.-]+)\b")
_PATH_RE = re.compile(r"(?<![\w/.-])([A-Za-z0-9_@./-]+\.(?:py|ts|tsx|js|jsx|md|sql|yaml|yml|json|java|go))(?![\w/.-])")
_AGENT_RE = re.compile(r"\b([A-Z][A-Za-z0-9_-]{2,}\s+Agent|agent_[A-Za-z0-9_-]+)\b")
_DEP_RE = re.compile(r"(?:depends\s+on|blocked\s+by|依赖|基于|前置)\s+([A-Z][A-Z0-9]+[-_][A-Za-z0-9_.-]+)", re.I)

_PREFIX_TYPE = {
    "REQ": "requirement",
    "TASK": "task",
    "ISSUE": "issue",
    "AGENT": "agent",
    "METRIC": "metric",
    "TAG": "tag",
    "DOC": "design_doc",
    "SPEC": "spec",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_hash(*parts: Any) -> str:
    raw = "|".join(str(part) for part in parts if part is not None)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def normalize_entity_type(value: str | None) -> str:
    t = (value or "knowledge").strip().lower().replace("-", "_")
    if t in ("requirements", "req"):
        return "requirement"
    if t in ("tasks",):
        return "task"
    if t in ("issues",):
        return "issue"
    if t in ("file", "path", "code"):
        return "code_file"
    if t in ("design", "architecture"):
        return "design_doc"
    if t in DEFAULT_ENTITY_TYPES:
        return t
    return "knowledge"


def entity_id(entity_type: str, raw_id: Any) -> str:
    value = str(raw_id or "").strip()
    return f"{normalize_entity_type(entity_type)}:{value or stable_hash(entity_type)}"


def _type_from_external_id(value: str) -> str:
    prefix = value.split("-", 1)[0].split("_", 1)[0].upper()
    return _PREFIX_TYPE.get(prefix, "knowledge")


def _type_from_path(path: str) -> str:
    p = path.lower()
    if p.endswith((".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".go")):
        return "code_file"
    if "/architecture/" in p or "/design" in p:
        return "design_doc"
    return "spec"


def _clean_path(path: str) -> str:
    return path.strip().strip("`'\"“”‘’，,.;:()[]{}<>")


def _doc_text(doc: dict[str, Any]) -> str:
    tags = " ".join(str(x) for x in (doc.get("tags") or []) if x)
    return "\n".join(
        str(doc.get(key) or "")
        for key in ("id", "title", "name", "description", "content", "path", "category", "type")
    ) + f"\n{tags}"


def _add_entity(entities: dict[str, dict[str, Any]], item: dict[str, Any]) -> None:
    current = entities.get(item["id"])
    if not current:
        entities[item["id"]] = item
        return
    current["sources"] = sorted(set(current.get("sources") or []) | set(item.get("sources") or []))
    current["tags"] = sorted(set(current.get("tags") or []) | set(item.get("tags") or []))
    if len(str(item.get("content") or "")) > len(str(current.get("content") or "")):
        current["content"] = item.get("content") or current.get("content", "")


def _add_edge(edges: dict[str, dict[str, Any]], source: str, target: str, edge_type: str, **props: Any) -> None:
    if not source or not target or source == target:
        return
    key = f"{source}|{target}|{edge_type}"
    edge = edges.get(key)
    if edge:
        edge["weight"] = int(edge.get("weight") or 1) + 1
        return
    edges[key] = {
        "id": stable_hash(source, target, edge_type),
        "source": source,
        "target": target,
        "type": edge_type,
        "weight": 1,
        **{k: v for k, v in props.items() if v not in (None, "", [])},
    }


def _references_from_doc(doc: dict[str, Any], allowed: set[str]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    text = _doc_text(doc)
    seen: set[str] = set()

    for match in _ID_RE.findall(text):
        ref_type = _type_from_external_id(match)
        if ref_type not in allowed:
            continue
        rid = entity_id(ref_type, match)
        if rid in seen:
            continue
        seen.add(rid)
        refs.append({"id": rid, "type": ref_type, "label": match, "raw": match})

    for raw_path in _PATH_RE.findall(text):
        path = _clean_path(raw_path)
        ref_type = _type_from_path(path)
        if ref_type not in allowed:
            continue
        rid = entity_id(ref_type, path)
        if rid in seen:
            continue
        seen.add(rid)
        refs.append({"id": rid, "type": ref_type, "label": path.split("/")[-1], "raw": path, "path": path})

    for agent in _AGENT_RE.findall(text):
        if "agent" not in allowed:
            continue
        rid = entity_id("agent", agent.replace(" ", "-").lower())
        if rid in seen:
            continue
        seen.add(rid)
        refs.append({"id": rid, "type": "agent", "label": agent, "raw": agent})

    if "tag" in allowed:
        for tag in doc.get("tags") or []:
            value = str(tag).strip()
            if not value:
                continue
            rid = entity_id("tag", value.lower())
            if rid in seen:
                continue
            seen.add(rid)
            refs.append({"id": rid, "type": "tag", "label": value, "raw": value})
    return refs


def build_graph_from_documents(
    documents: list[dict[str, Any]],
    entity_types: list[str] | None = None,
) -> dict[str, Any]:
    allowed = {normalize_entity_type(t) for t in (entity_types or DEFAULT_ENTITY_TYPES)}
    if not allowed:
        allowed = set(DEFAULT_ENTITY_TYPES)
    entities: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}

    for index, doc in enumerate(documents):
        doc_type = normalize_entity_type(str(doc.get("type") or doc.get("category") or "knowledge"))
        if doc_type not in allowed:
            doc_type = "knowledge" if "knowledge" in allowed else doc_type
        raw_id = doc.get("id") or doc.get("path") or stable_hash(index, doc.get("title"), doc.get("content"))
        doc_entity_id = entity_id(doc_type, raw_id)
        title = str(doc.get("title") or doc.get("name") or doc.get("path") or raw_id)
        content = str(doc.get("content") or doc.get("description") or "")
        source = str(doc.get("source") or doc.get("path") or doc.get("type") or "local")
        if doc_type in allowed:
            _add_entity(
                entities,
                {
                    "id": doc_entity_id,
                    "type": doc_type,
                    "label": title,
                    "title": title,
                    "content": content[:4000],
                    "tags": [str(x) for x in (doc.get("tags") or []) if x],
                    "sources": [source],
                    "properties": {
                        "raw_id": raw_id,
                        "status": doc.get("status") or "",
                        "priority": doc.get("priority") or doc.get("severity") or "",
                        "path": doc.get("path") or "",
                    },
                },
            )

        refs = _references_from_doc(doc, allowed)
        for ref in refs:
            _add_entity(
                entities,
                {
                    "id": ref["id"],
                    "type": ref["type"],
                    "label": ref["label"],
                    "title": ref["label"],
                    "content": "",
                    "tags": [],
                    "sources": [source],
                    "properties": {"raw": ref.get("raw", ""), "path": ref.get("path", "")},
                },
            )
            if doc_type in allowed:
                _add_edge(edges, doc_entity_id, ref["id"], "mentions", edge_source=source)

        text = _doc_text(doc)
        for dep in _DEP_RE.findall(text):
            target = entity_id(_type_from_external_id(dep), dep)
            if target in entities and doc_type in allowed:
                _add_edge(edges, doc_entity_id, target, "depends_on", edge_source=source)

        ref_ids = [ref["id"] for ref in refs if ref["type"] != "tag"][:8]
        for left_idx, left in enumerate(ref_ids):
            for right in ref_ids[left_idx + 1 :]:
                _add_edge(edges, left, right, "co_occurs", edge_source=source)

    entity_list = sorted(entities.values(), key=lambda item: (item["type"], item["label"]))
    edge_list = sorted(edges.values(), key=lambda item: (item["type"], item["source"], item["target"]))
    type_counts: dict[str, int] = {}
    for item in entity_list:
        type_counts[item["type"]] = type_counts.get(item["type"], 0) + 1

    return {
        "version": "1.0",
        "built_at": now_iso(),
        "documents": len(documents),
        "entities": entity_list,
        "edges": edge_list,
        "summary": {
            "nodes": len(entity_list),
            "edges": len(edge_list),
            "entity_types": len(type_counts),
            "type_counts": type_counts,
            "last_built_at": now_iso(),
        },
    }


def _tokenize(text: str) -> list[str]:
    raw = re.split(r"[\s,，。;；:：/\\|()\[\]{}<>]+", text.lower())
    return [item for item in raw if len(item) >= 2]


def _score_entity(entity: dict[str, Any], query: str, tokens: list[str]) -> float:
    blob = " ".join(
        str(entity.get(key) or "")
        for key in ("id", "type", "label", "title", "content")
    ).lower()
    blob += " " + " ".join(str(x).lower() for x in entity.get("tags") or [])
    score = 0.0
    needle = query.lower().strip()
    if needle and needle in blob:
        score += 1.0
    for token in tokens:
        if token in blob:
            score += 0.42
    if entity.get("type") in tokens:
        score += 0.2
    return round(min(score, 1.0), 3)


def _adjacency(graph: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for edge in graph.get("edges") or []:
        out.setdefault(str(edge.get("source")), []).append(edge)
        out.setdefault(str(edge.get("target")), []).append(edge)
    return out


def query_graph(graph: dict[str, Any], query: str, top_k: int = 10) -> dict[str, Any]:
    tokens = _tokenize(query)
    entities = {str(item.get("id")): item for item in graph.get("entities") or []}
    adjacency = _adjacency(graph)
    ranked: list[dict[str, Any]] = []
    for entity in entities.values():
        score = _score_entity(entity, query, tokens)
        if score <= 0:
            continue
        nearby_edges = adjacency.get(str(entity.get("id")), [])[:8]
        neighbor_ids = {
            str(edge.get("target")) if edge.get("source") == entity.get("id") else str(edge.get("source"))
            for edge in nearby_edges
        }
        ranked.append(
            {
                "entity": entity,
                "score": score,
                "neighbors": [entities[nid] for nid in neighbor_ids if nid in entities],
                "edges": nearby_edges,
            }
        )
    ranked.sort(key=lambda item: (item["score"], len(item["neighbors"])), reverse=True)
    return {"query": query, "results": ranked[: max(1, top_k)], "summary": graph.get("summary") or {}}


def lineage_for_entity(graph: dict[str, Any], entity: str, depth: int = 2) -> dict[str, Any]:
    entities = {str(item.get("id")): item for item in graph.get("entities") or []}
    if entity not in entities:
        return {"entity_id": entity, "nodes": [], "edges": [], "summary": {"nodes": 0, "edges": 0}}
    max_depth = max(1, min(depth, 4))
    adjacency = _adjacency(graph)
    visited = {entity}
    edge_ids: set[str] = set()
    queue: deque[tuple[str, int]] = deque([(entity, 0)])

    while queue:
        current, level = queue.popleft()
        if level >= max_depth:
            continue
        for edge in adjacency.get(current, []):
            edge_ids.add(str(edge.get("id")))
            other = str(edge.get("target")) if edge.get("source") == current else str(edge.get("source"))
            if other in entities and other not in visited:
                visited.add(other)
                queue.append((other, level + 1))

    edges = [edge for edge in graph.get("edges") or [] if str(edge.get("id")) in edge_ids]
    nodes = [entities[nid] for nid in sorted(visited)]
    return {
        "entity_id": entity,
        "depth": max_depth,
        "nodes": nodes,
        "edges": edges,
        "summary": {"nodes": len(nodes), "edges": len(edges)},
    }
