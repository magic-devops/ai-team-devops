"""
@module: routers.rag
@purpose: RAG 检索流水线 —— /api/v1/rag/{search,index} —— 嵌入 + 向量库 + 关键词 + (rerank 留 M11)
@stable: 路径与入出参与 apis/openapi/openapi.yaml 一致
@ai_safe_edit:
  - 改 chunking：vector_store_iface.chunk_text
  - 改后端：VECTOR_DB_TYPE 环境变量切换；不动 router 代码
  - 加 rerank：当前先按混合检索；M11 接入 cross-encoder
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .vector_store_iface import Doc, Hit, chunk_text, get_store, stable_id

router = APIRouter(prefix="/api/v1/rag", tags=["rag"])
_log = logging.getLogger("sop.rag")


class SearchIn(BaseModel):
    query: str
    collections: list[str] = Field(default_factory=lambda: ["tasks", "knowledge", "rules"])
    limit: int = 8
    hybrid: bool = True
    rerank: bool = True


class SearchHit(BaseModel):
    collection: str
    id: str
    score: float
    title: str = ""
    snippet: str = ""
    source: str = ""


class SearchOut(BaseModel):
    items: list[SearchHit] = Field(default_factory=list)


class IndexIn(BaseModel):
    collection: str
    docs: list[dict]
    """docs[i] = {id?, text, title?, metadata?}"""


@router.post("/search", response_model=SearchOut)
def search(body: SearchIn) -> SearchOut:
    if not body.query.strip():
        raise HTTPException(400, "query 不能为空")
    store = get_store()
    try:
        from .llm_gateway import EmbeddingsIn, llm_embeddings
    except Exception:  # pragma: no cover
        raise HTTPException(503, "LLM Gateway 未启用")
    emb = llm_embeddings(EmbeddingsIn(input=body.query))
    if not emb.vectors:
        return SearchOut()
    vec = emb.vectors[0]
    items: list[SearchHit] = []
    per = max(2, body.limit // max(1, len(body.collections)))
    for col in body.collections:
        try:
            hits = (store.hybrid_search(col, vec, body.query, limit=per)
                    if body.hybrid else store.search(col, vec, limit=per))
        except Exception as e:
            _log.warning("rag.search backend error in %s: %s", col, e)
            continue
        for h in hits:
            items.append(_to_hit(col, h))
    items.sort(key=lambda x: x.score, reverse=True)
    return SearchOut(items=items[:body.limit])


def _to_hit(collection: str, h: Hit) -> SearchHit:
    md = h.metadata or {}
    title = str(md.get("title") or md.get("name") or "")
    snippet = (h.text or "")[:300]
    source = str(md.get("source") or md.get("path") or "")
    return SearchHit(collection=collection, id=h.id, score=h.score, title=title, snippet=snippet, source=source)


@router.post("/index")
def index(body: IndexIn) -> dict:
    """把任意文档批量切块 + 嵌入 + upsert 到向量库。"""
    if not body.docs:
        raise HTTPException(400, "docs 不能为空")
    store = get_store()
    try:
        from .llm_gateway import EmbeddingsIn, llm_embeddings
    except Exception:  # pragma: no cover
        raise HTTPException(503, "LLM Gateway 未启用")

    # 准备 docs
    flat_docs: list[Doc] = []
    for d in body.docs:
        raw_id = str(d.get("id") or "")
        text = (d.get("text") or "").strip()
        if not text:
            continue
        metadata = dict(d.get("metadata") or {})
        title = d.get("title")
        if title and "title" not in metadata:
            metadata["title"] = title
        for chunk_idx, chunk in enumerate(chunk_text(text)):
            cid = raw_id or stable_id(body.collection, title or "", chunk_idx, chunk[:40])
            flat_docs.append(Doc(id=f"{cid}-{chunk_idx}", text=chunk, metadata=metadata))

    if not flat_docs:
        return {"ok": True, "count": 0}

    emb_out = llm_embeddings(EmbeddingsIn(input=[d.text for d in flat_docs]))
    if not emb_out.vectors:
        raise HTTPException(503, "嵌入服务不可用")
    dim = len(emb_out.vectors[0])
    store.ensure_collection(body.collection, dim)
    store.upsert(body.collection, flat_docs, emb_out.vectors)
    return {"ok": True, "count": len(flat_docs), "dim": dim}


@router.get("/health")
def rag_health() -> dict:
    return {
        "backend": os.getenv("VECTOR_DB_TYPE", "lance"),
        "sql_db": os.getenv("DB_TYPE", "sqlite"),
        "oceanbase_scan_cap": os.getenv("OCEANBASE_VECTOR_SCAN_CAP", "2500"),
        "qdrant_url_set": bool(os.getenv("QDRANT_URL")),
        "milvus_uri_set": bool(os.getenv("MILVUS_URI")),
    }
