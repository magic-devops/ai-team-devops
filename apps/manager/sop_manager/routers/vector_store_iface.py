"""
@module: routers.vector_store_iface
@purpose: VectorStore 接口（Ports & Adapters）；统一 LanceDB / Qdrant / Milvus / OceanBase(JSON 向量) / pgvector
@stable: VectorStore 协议方法名稳定（v1）
@ai_safe_edit:
  - 新增 backend：实现协议 + 注册到 get_store()
  - 改 chunk 策略：仅改 utils.chunk_text；其他不变
@deps_in: pydantic, numpy（可选）, lancedb / qdrant-client / psycopg（按 backend）
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterable, Sequence

_log = logging.getLogger("sop.vector_store")


# ── 数据结构 ─────────────────────────────────────────────────────
@dataclass
class Doc:
    id: str
    text: str
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass
class Hit:
    id: str
    score: float
    text: str
    metadata: dict[str, object] = field(default_factory=dict)


# ── 协议 ─────────────────────────────────────────────────────────
class VectorStore(ABC):
    """所有向量存储后端的统一接口。"""

    @abstractmethod
    def ensure_collection(self, name: str, dim: int) -> None: ...

    @abstractmethod
    def upsert(self, collection: str, docs: Sequence[Doc], embeddings: Sequence[Sequence[float]]) -> None: ...

    @abstractmethod
    def search(self, collection: str, embedding: Sequence[float], *, limit: int = 8,
               where: dict[str, object] | None = None) -> list[Hit]: ...

    @abstractmethod
    def delete(self, collection: str, ids: Iterable[str]) -> None: ...

    def hybrid_search(
        self,
        collection: str,
        embedding: Sequence[float],
        keyword_query: str,
        *,
        limit: int = 8,
        rerank: bool = True,
    ) -> list[Hit]:
        """默认实现：纯向量 + 关键词二次过滤。各 backend 可覆盖以使用原生 hybrid。"""
        hits = self.search(collection, embedding, limit=limit * 2)
        if keyword_query:
            pat = re.compile(re.escape(keyword_query), re.IGNORECASE)
            scored = []
            for h in hits:
                bonus = 0.2 if pat.search(h.text or "") else 0.0
                scored.append(Hit(id=h.id, score=h.score + bonus, text=h.text, metadata=h.metadata))
            hits = sorted(scored, key=lambda x: x.score, reverse=True)
        return hits[:limit]


# ── 工具：chunking ──────────────────────────────────────────────
def chunk_text(text: str, *, max_chars: int = 1200, overlap: int = 200) -> list[str]:
    """简单按字符切片；后续可换成基于 token 的更精细方案。"""
    text = text or ""
    if len(text) <= max_chars:
        return [text]
    chunks: list[str] = []
    i = 0
    while i < len(text):
        chunks.append(text[i:i + max_chars])
        i += max_chars - overlap
    return chunks


def stable_id(*parts: object) -> str:
    import hashlib
    h = hashlib.sha1()
    for p in parts:
        h.update(str(p).encode("utf-8"))
        h.update(b"|")
    return h.hexdigest()[:24]


_QDRANT_ID_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def _qdrant_point_uuid(doc_id: str) -> str:
    """Qdrant 点 ID 需为 UUID；业务 chunk id 映射为确定性 UUID。"""
    return str(uuid.uuid5(_QDRANT_ID_NS, doc_id))


# ── Adapter: LanceDB ─────────────────────────────────────────────
class LanceDBStore(VectorStore):
    def __init__(self, path: str) -> None:
        try:
            import lancedb  # type: ignore[import-not-found]
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("lancedb 未安装") from e
        self._db = lancedb.connect(path)

    def ensure_collection(self, name: str, dim: int) -> None:
        if name in self._db.table_names():
            return
        import pyarrow as pa  # type: ignore[import-not-found]
        schema = pa.schema([
            pa.field("id", pa.string()),
            pa.field("text", pa.string()),
            pa.field("metadata_json", pa.string()),
            pa.field("vector", pa.list_(pa.float32(), dim)),
        ])
        self._db.create_table(name, schema=schema)

    def upsert(self, collection: str, docs, embeddings) -> None:
        import json
        tbl = self._db.open_table(collection)
        rows = []
        for d, v in zip(docs, embeddings, strict=True):
            rows.append({
                "id": d.id, "text": d.text,
                "metadata_json": json.dumps(d.metadata, ensure_ascii=False, default=str),
                "vector": list(v),
            })
        # LanceDB merge_insert 替代 upsert
        tbl.merge_insert("id").when_matched_update_all().when_not_matched_insert_all().execute(rows)

    def search(self, collection, embedding, *, limit=8, where=None) -> list[Hit]:
        import json
        tbl = self._db.open_table(collection)
        q = tbl.search(list(embedding)).limit(limit)
        if where:
            q = q.where(self._where_clause(where))
        df = q.to_list()
        out: list[Hit] = []
        for r in df:
            meta = {}
            try:
                meta = json.loads(r.get("metadata_json") or "{}")
            except Exception:
                pass
            out.append(Hit(
                id=r.get("id", ""), score=float(r.get("_distance", 0.0)) * -1,
                text=r.get("text", "") or "", metadata=meta,
            ))
        return out

    def delete(self, collection, ids) -> None:
        tbl = self._db.open_table(collection)
        for i in ids:
            tbl.delete(f"id = '{i}'")

    @staticmethod
    def _where_clause(d: dict[str, object]) -> str:
        parts = []
        for k, v in d.items():
            if isinstance(v, str):
                parts.append(f"{k} = '{v}'")
            else:
                parts.append(f"{k} = {v}")
        return " AND ".join(parts)


# ── Adapter: Qdrant（仅给出最小骨架，依赖按需安装） ──────────────
class QdrantStore(VectorStore):  # pragma: no cover - 需要外部依赖
    def __init__(self, url: str) -> None:
        try:
            from qdrant_client import QdrantClient  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError("qdrant-client 未安装") from e
        self._cli = QdrantClient(url=url)

    def ensure_collection(self, name: str, dim: int) -> None:
        from qdrant_client.http import models as qm  # type: ignore[import-not-found]
        existed = [c.name for c in self._cli.get_collections().collections]
        if name in existed:
            return
        self._cli.create_collection(
            collection_name=name,
            vectors_config=qm.VectorParams(size=dim, distance=qm.Distance.COSINE),
        )

    def upsert(self, collection, docs, embeddings) -> None:
        from qdrant_client.http import models as qm  # type: ignore[import-not-found]
        points = []
        for d, v in zip(docs, embeddings, strict=True):
            pid = _qdrant_point_uuid(d.id)
            meta = dict(d.metadata or {})
            meta["_sop_doc_id"] = d.id
            points.append(
                qm.PointStruct(
                    id=pid,
                    vector=list(v),
                    payload={"text": d.text, **meta},
                )
            )
        self._cli.upsert(collection_name=collection, points=points)

    def search(self, collection, embedding, *, limit=8, where=None) -> list[Hit]:
        from qdrant_client.http import models as qm  # type: ignore[import-not-found]
        flt = None
        if where:
            must = [qm.FieldCondition(key=k, match=qm.MatchValue(value=v)) for k, v in where.items()]
            flt = qm.Filter(must=must)
        res = self._cli.search(collection_name=collection, query_vector=list(embedding),
                               limit=limit, query_filter=flt)
        out: list[Hit] = []
        for r in res:
            payload = dict(r.payload or {})
            text = payload.pop("text", "")
            doc_id = str(payload.pop("_sop_doc_id", r.id))
            out.append(Hit(id=doc_id, score=float(r.score), text=text, metadata=payload))
        return out

    def delete(self, collection, ids) -> None:
        from qdrant_client.http import models as qm  # type: ignore[import-not-found]
        uuids = [_qdrant_point_uuid(str(i)) for i in ids]
        self._cli.delete(
            collection_name=collection,
            points_selector=qm.PointIdsList(points=uuids),
        )


# ── Adapter: Milvus（RAG 语义检索；需 pymilvus）────────────────────
class MilvusVectorStore(VectorStore):  # pragma: no cover
    def __init__(self, uri: str, token: str = "") -> None:
        try:
            from pymilvus import DataType, MilvusClient  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError("pymilvus 未安装，请安装 extras: vector-milvus") from e
        self._cli = MilvusClient(uri=uri, token=token or None)
        self._DataType = DataType

    def ensure_collection(self, name: str, dim: int) -> None:
        from pymilvus import MilvusClient  # type: ignore[import-not-found]

        if self._cli.has_collection(name):
            return
        schema = MilvusClient.create_schema(auto_id=False, enable_dynamic_field=False)
        schema.add_field(field_name="id", datatype=self._DataType.VARCHAR, is_primary=True, max_length=256)
        schema.add_field(field_name="vector", datatype=self._DataType.FLOAT_VECTOR, dim=dim)
        schema.add_field(field_name="text", datatype=self._DataType.VARCHAR, max_length=65535)
        schema.add_field(field_name="metadata_json", datatype=self._DataType.VARCHAR, max_length=65535)
        idx = MilvusClient.prepare_index_params()
        idx.add_index(field_name="vector", metric_type="COSINE", index_type="AUTOINDEX")
        self._cli.create_collection(collection_name=name, schema=schema, index_params=idx)

    def upsert(self, collection, docs, embeddings) -> None:
        rows = []
        for d, v in zip(docs, embeddings, strict=True):
            rows.append({
                "id": d.id,
                "vector": list(v),
                "text": (d.text or "")[:65000],
                "metadata_json": json.dumps(d.metadata or {}, ensure_ascii=False, default=str)[:65000],
            })
        self._cli.upsert(collection_name=collection, data=rows)

    def search(self, collection, embedding, *, limit=8, where=None) -> list[Hit]:
        _ = where
        res = self._cli.search(
            collection_name=collection,
            data=[list(embedding)],
            limit=limit,
            output_fields=["text", "metadata_json"],
            consistency_level="Strong",
        )
        out: list[Hit] = []
        for batch in res or []:
            for h in batch:
                if not isinstance(h, dict):
                    continue
                ent = h.get("entity") or {}
                try:
                    md = json.loads(ent.get("metadata_json") or "{}")
                except Exception:
                    md = {}
                dist = float(h.get("distance") or 0.0)
                out.append(Hit(
                    id=str(h.get("id", "")),
                    score=-dist,
                    text=str(ent.get("text") or ""),
                    metadata=md,
                ))
        return out

    def delete(self, collection, ids) -> None:
        ids_list = [str(i) for i in ids]
        if not ids_list:
            return
        try:
            self._cli.delete(collection_name=collection, ids=ids_list)
        except TypeError:
            esc = ", ".join(f'"{i}"' for i in ids_list)
            self._cli.delete(collection_name=collection, filter=f"id in [{esc}]")


# ── Adapter: OceanBase / MySQL（JSON 存向量 + 内存余弦；适合中小语料）────────
class OceanBaseJsonVectorStore(VectorStore):  # pragma: no cover
    """OceanBase MySQL 模式或 MySQL 8：单表 JSON 向量；大规模请改用 Milvus/Qdrant 或 OB 原生 VECTOR 索引。"""

    _TABLE = "sop_rag_chunks"

    def __init__(self, url: str | None = None) -> None:
        from sqlalchemy import create_engine

        u = (url or os.getenv("OCEANBASE_VECTOR_URL") or os.getenv("DATABASE_URL") or "").strip()
        if not u or u.startswith("sqlite"):
            raise RuntimeError(
                "VECTOR_DB_TYPE=oceanbase 需要 OCEANBASE_VECTOR_URL 或 mysql+pymysql 的 DATABASE_URL（勿用 sqlite）"
            )
        self._engine = create_engine(u, pool_pre_ping=True, pool_recycle=3600)
        self._scan_cap = int(os.getenv("OCEANBASE_VECTOR_SCAN_CAP", "2500"))

    def ensure_collection(self, name: str, dim: int) -> None:
        from sqlalchemy import text

        _ = name, dim
        ddl = text(
            f"CREATE TABLE IF NOT EXISTS {self._TABLE} ("
            " collection VARCHAR(128) NOT NULL,"
            " chunk_id VARCHAR(256) NOT NULL,"
            " text_body MEDIUMTEXT,"
            " metadata_json TEXT,"
            " embedding_dim INT NOT NULL,"
            " embedding_json TEXT NOT NULL,"
            " gmt_created DATETIME DEFAULT CURRENT_TIMESTAMP,"
            " PRIMARY KEY (collection, chunk_id),"
            " KEY ix_sop_rag_coll (collection)"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        )
        with self._engine.begin() as conn:
            conn.execute(ddl)

    def upsert(self, collection, docs, embeddings) -> None:
        from sqlalchemy import text

        sql = text(
            f"REPLACE INTO {self._TABLE} "
            "(collection, chunk_id, text_body, metadata_json, embedding_dim, embedding_json) "
            "VALUES (:collection, :chunk_id, :text_body, :metadata_json, :embedding_dim, :embedding_json)"
        )
        with self._engine.begin() as conn:
            for d, v in zip(docs, embeddings, strict=True):
                conn.execute(
                    sql,
                    {
                        "collection": collection[:128],
                        "chunk_id": d.id[:256],
                        "text_body": d.text or "",
                        "metadata_json": json.dumps(d.metadata or {}, ensure_ascii=False, default=str),
                        "embedding_dim": len(v),
                        "embedding_json": json.dumps(list(map(float, v)), separators=(",", ":")),
                    },
                )

    def search(self, collection, embedding, *, limit=8, where=None) -> list[Hit]:
        from sqlalchemy import text

        _ = where
        qv = [float(x) for x in embedding]
        sql = text(
            f"SELECT chunk_id, text_body, metadata_json, embedding_json FROM {self._TABLE} "
            "WHERE collection = :c LIMIT :lim"
        )
        with self._engine.connect() as conn:
            rows = conn.execute(sql, {"c": collection, "lim": self._scan_cap}).mappings().all()

        def _cos(a: list[float], b: list[float]) -> float:
            dot = sum(x * y for x, y in zip(a, b, strict=True))
            na = math.sqrt(sum(x * x for x in a))
            nb = math.sqrt(sum(y * y for y in b))
            if na <= 0 or nb <= 0:
                return 0.0
            return dot / (na * nb)

        scored: list[tuple[float, Hit]] = []
        for r in rows:
            try:
                ev = json.loads(r["embedding_json"] or "[]")
                if not isinstance(ev, list) or len(ev) != len(qv):
                    continue
                emb = [float(x) for x in ev]
            except Exception:
                continue
            try:
                md = json.loads(r["metadata_json"] or "{}")
            except Exception:
                md = {}
            sim = _cos(qv, emb)
            scored.append(
                (
                    sim,
                    Hit(
                        id=str(r["chunk_id"]),
                        score=sim,
                        text=str(r["text_body"] or ""),
                        metadata=md if isinstance(md, dict) else {},
                    ),
                )
            )
        scored.sort(key=lambda x: x[0], reverse=True)
        return [h for _, h in scored[:limit]]

    def delete(self, collection, ids) -> None:
        from sqlalchemy import text

        sql = text(f"DELETE FROM {self._TABLE} WHERE collection = :c AND chunk_id = :id")
        with self._engine.begin() as conn:
            for i in ids:
                conn.execute(sql, {"c": collection, "id": str(i)})


# ── 工厂 ──────────────────────────────────────────────────────────
_store_singleton: VectorStore | None = None
_store_cache_key: str | None = None


def get_store() -> VectorStore:
    """根据 VECTOR_DB_TYPE 与相关 URL 构造进程内单例（可配置 / 可替换后端）。"""
    global _store_singleton, _store_cache_key
    backend = (os.getenv("VECTOR_DB_TYPE") or "lance").lower()
    cache_key = "|".join(
        [
            backend,
            os.getenv("LANCE_DB_PATH", ""),
            os.getenv("QDRANT_URL", ""),
            os.getenv("MILVUS_URI", ""),
            os.getenv("MILVUS_TOKEN", ""),
            os.getenv("OCEANBASE_VECTOR_URL", ""),
            os.getenv("DATABASE_URL", ""),
        ]
    )
    if _store_singleton is not None and _store_cache_key == cache_key:
        return _store_singleton

    if backend == "lance":
        path = os.getenv("LANCE_DB_PATH") or os.path.expanduser("~/.sop-runtime/ai-memory/lancedb")
        inst: VectorStore = LanceDBStore(path)
    elif backend == "qdrant":
        inst = QdrantStore(os.getenv("QDRANT_URL", "http://localhost:6333"))
    elif backend == "milvus":
        inst = MilvusVectorStore(
            os.getenv("MILVUS_URI", "http://localhost:19530"),
            os.getenv("MILVUS_TOKEN", ""),
        )
    elif backend == "oceanbase":
        inst = OceanBaseJsonVectorStore()
    else:
        raise RuntimeError(f"不支持的 VECTOR_DB_TYPE={backend}（支持: lance|qdrant|milvus|oceanbase）")

    _store_singleton = inst
    _store_cache_key = cache_key
    _log.info("vector store backend=%s", backend)
    return inst
