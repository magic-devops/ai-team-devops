"""向量数据库抽象层 — LanceDB / Milvus / Qdrant / OceanBase(MySQL 模式)，项目级命名空间隔离。"""
from __future__ import annotations
import os
import uuid
from abc import ABC, abstractmethod
from typing import Any

VECTOR_DB_TYPE = os.getenv("VECTOR_DB_TYPE", "lance")


def _ns(project_id: str, table: str) -> str:
    """项目级命名空间：{project_id}_{table}，无 project_id 时直接用 table"""
    if project_id:
        safe = project_id.replace("-", "_").replace(".", "_")
        return f"{safe}_{table}"
    return table


class VectorStore(ABC):
    @abstractmethod
    def table(self, name: str): ...
    @abstractmethod
    def rows(self, name: str, limit: int = 200) -> list: ...
    @abstractmethod
    def upsert(self, name: str, row: dict): ...
    @abstractmethod
    def delete(self, name: str, expr: str): ...
    @abstractmethod
    def search(self, name: str, query: str, limit: int = 10) -> list: ...
    @abstractmethod
    def list_tables(self) -> list: ...
    @abstractmethod
    def table_stats(self, name: str) -> dict: ...

    # 项目级便捷方法
    def project_rows(self, project_id: str, table: str, limit: int = 200) -> list:
        return self.rows(_ns(project_id, table), limit)

    def project_search(self, project_id: str, table: str, query: str, limit: int = 10) -> list:
        return self.search(_ns(project_id, table), query, limit)

    def project_upsert(self, project_id: str, table: str, row: dict):
        return self.upsert(_ns(project_id, table), row)

    def project_delete(self, project_id: str, table: str, expr: str):
        return self.delete(_ns(project_id, table), expr)


# ── LanceDB ───────────────────────────────────────────────────────
class LanceStore(VectorStore):
    def __init__(self, db_path: str):
        import lancedb
        self._db = lancedb.connect(db_path)

    def table(self, name: str):
        try:
            return self._db.open_table(name)
        except Exception:
            return None

    def rows(self, name: str, limit: int = 200) -> list:
        t = self.table(name)
        if t is None:
            return []
        try:
            from datetime import datetime
            import numpy as np
            raw = t.to_pandas().head(limit).to_dict("records")
            def _safe(v: Any) -> Any:
                if v is None or isinstance(v, (bool, str, int, float)): return v
                if isinstance(v, bytes): return v.decode("utf-8", errors="replace")
                if isinstance(v, datetime): return v.isoformat() + "Z"
                try:
                    if isinstance(v, np.ndarray): return v.tolist()
                    if isinstance(v, np.generic): return v.item()
                except Exception: pass
                if isinstance(v, (list, tuple)): return [_safe(x) for x in v]
                if isinstance(v, dict): return {k: _safe(x) for k, x in v.items()}
                if hasattr(v, "tolist"): return v.tolist()
                if hasattr(v, "isoformat"): return v.isoformat()
                return str(v)
            return [{k: _safe(v) for k, v in row.items()} for row in raw]
        except Exception:
            return []

    def upsert(self, name: str, row: dict):
        t = self.table(name)
        if t is None: return
        t.add([row])

    def delete(self, name: str, expr: str):
        t = self.table(name)
        if t: t.delete(expr)

    def search(self, name: str, query: str, limit: int = 10) -> list:
        try:
            from knowledge.lancedb_ops import LanceOps
            return LanceOps().search(name, query, limit=limit)
        except Exception:
            return []

    def list_tables(self) -> list:
        try: return self._db.table_names()
        except Exception: return []

    def table_stats(self, name: str) -> dict:
        t = self.table(name)
        if t is None: return {"table": name, "rows": 0, "columns": []}
        try:
            df = t.to_pandas()
            return {"table": name, "rows": len(df), "columns": list(df.columns)}
        except Exception:
            return {"table": name, "rows": 0, "columns": []}


# ── Milvus ────────────────────────────────────────────────────────
class MilvusStore(VectorStore):
    def __init__(self, uri: str, token: str = ""):
        from pymilvus import MilvusClient
        self._client = MilvusClient(uri=uri, token=token or None)

    def table(self, name: str):
        return name if self._client.has_collection(name) else None

    def rows(self, name: str, limit: int = 200) -> list:
        if not self._client.has_collection(name): return []
        try:
            return self._client.query(collection_name=name, filter="", limit=limit, output_fields=["*"]) or []
        except Exception: return []

    def upsert(self, name: str, row: dict):
        self._client.upsert(collection_name=name, data=[row])

    def delete(self, name: str, expr: str):
        self._client.delete(collection_name=name, filter=expr)

    def search(self, name: str, query: str, limit: int = 10) -> list:
        try:
            return self._client.query(collection_name=name,
                                      filter=f'content like "%{query}%"',
                                      limit=limit, output_fields=["*"]) or []
        except Exception: return []

    def list_tables(self) -> list:
        try: return self._client.list_collections()
        except Exception: return []

    def table_stats(self, name: str) -> dict:
        try:
            stats = self._client.get_collection_stats(name)
            return {"table": name, "rows": int(stats.get("row_count", 0)), "columns": []}
        except Exception:
            return {"table": name, "rows": 0, "columns": []}


# ── Qdrant（管理面：表清单 / 行浏览 / 克隆带 vector 的 upsert）──────────────
class QdrantAdminStore(VectorStore):
    """与 SaaS compose 中 VECTOR_DB_TYPE=qdrant 对齐；语义检索走 RAG（vector_store_iface）。"""

    def __init__(self, url: str):
        from qdrant_client import QdrantClient

        self._cli = QdrantClient(url=url)

    def table(self, name: str):
        try:
            names = [c.name for c in self._cli.get_collections().collections]
            return name if name in names else None
        except Exception:
            return None

    def rows(self, name: str, limit: int = 200) -> list:
        if not self.table(name):
            return []
        try:
            res, _ = self._cli.scroll(collection_name=name, limit=limit, with_payload=True, with_vectors=False)
            out: list[dict[str, Any]] = []
            for p in res or []:
                pl = dict(p.payload or {})
                pl["id"] = str(pl.pop("_sop_doc_id", p.id))
                out.append(pl)
            return out
        except Exception:
            return []

    def upsert(self, name: str, row: dict):
        from qdrant_client.http import models as qm

        vec = row.get("vector")
        if vec is None:
            return
        pid = str(uuid.uuid5(uuid.NAMESPACE_DNS, str(row.get("id", "")) or "row"))
        payload = {k: v for k, v in row.items() if k not in ("vector", "id")}
        payload["_sop_doc_id"] = str(row.get("id", ""))
        self._cli.upsert(
            collection_name=name,
            points=[qm.PointStruct(id=pid, vector=list(vec), payload=payload)],
        )

    def delete(self, name: str, expr: str):
        _ = (name, expr)

    def search(self, name: str, query: str, limit: int = 10) -> list:
        _ = query
        return self.rows(name, limit=limit)

    def list_tables(self) -> list:
        try:
            return [c.name for c in self._cli.get_collections().collections]
        except Exception:
            return []

    def table_stats(self, name: str) -> dict:
        try:
            info = self._cli.get_collection(name)
            cnt = int(getattr(info, "points_count", 0) or 0)
            return {"table": name, "rows": cnt, "columns": ["id", "payload"]}
        except Exception:
            return {"table": name, "rows": 0, "columns": []}


# ── OceanBase / MySQL（与 RAG 共用 sop_rag_chunks；管理面克隆/浏览）──────────
class OceanBaseChunksAdminStore(VectorStore):
    """与 VECTOR_DB_TYPE=oceanbase 及 OceanBaseJsonVectorStore 使用同一逻辑表。"""

    _TABLE = "sop_rag_chunks"

    def __init__(self, cfg: dict | None = None) -> None:
        from sqlalchemy import create_engine

        c = cfg or {}
        u = (c.get("url") or os.getenv("OCEANBASE_VECTOR_URL") or os.getenv("DATABASE_URL") or "").strip()
        if not u or u.startswith("sqlite"):
            raise RuntimeError("oceanbase 向量库需要 OCEANBASE_VECTOR_URL 或非 sqlite 的 DATABASE_URL")
        self._engine = create_engine(u, pool_pre_ping=True, pool_recycle=3600)
        self._ensure_table()

    def _ensure_table(self) -> None:
        from sqlalchemy import text

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
        try:
            with self._engine.begin() as conn:
                conn.execute(ddl)
        except Exception:
            pass

    def table(self, name: str):
        from sqlalchemy import text

        with self._engine.connect() as conn:
            n = conn.execute(
                text(f"SELECT 1 FROM {self._TABLE} WHERE collection = :c LIMIT 1"),
                {"c": name},
            ).scalar()
        return name if n else None

    def rows(self, name: str, limit: int = 200) -> list:
        from sqlalchemy import text

        with self._engine.connect() as conn:
            rws = conn.execute(
                text(
                    f"SELECT chunk_id AS id, text_body AS content, metadata_json, embedding_json "
                    f"FROM {self._TABLE} WHERE collection = :c LIMIT :lim"
                ),
                {"c": name, "lim": limit},
            ).mappings().all()
        out = []
        for r in rws:
            row = {"id": r["id"], "content": r.get("content")}
            try:
                import json
                row["metadata"] = json.loads(r["metadata_json"] or "{}")
            except Exception:
                row["metadata"] = {}
            try:
                import json
                row["vector"] = json.loads(r["embedding_json"] or "[]")
            except Exception:
                row["vector"] = []
            out.append(row)
        return out

    def upsert(self, name: str, row: dict):
        from sqlalchemy import text
        import json

        rid = str(row.get("id", ""))
        if not rid:
            return
        vec = row.get("vector")
        emb_json = json.dumps(list(map(float, vec)), separators=(",", ":")) if isinstance(vec, list) else "[]"
        meta = {k: v for k, v in row.items() if k not in ("vector", "id", "content")}
        txt = str(row.get("content") or row.get("text") or "")
        sql = text(
            f"REPLACE INTO {self._TABLE} "
            "(collection, chunk_id, text_body, metadata_json, embedding_dim, embedding_json) "
            "VALUES (:collection, :chunk_id, :text_body, :metadata_json, :embedding_dim, :embedding_json)"
        )
        dim = len(vec) if isinstance(vec, list) else 0
        with self._engine.begin() as conn:
            conn.execute(
                sql,
                {
                    "collection": name[:128],
                    "chunk_id": rid[:256],
                    "text_body": txt,
                    "metadata_json": json.dumps(meta, ensure_ascii=False, default=str),
                    "embedding_dim": dim,
                    "embedding_json": emb_json,
                },
            )

    def delete(self, name: str, expr: str):
        _ = (name, expr)

    def search(self, name: str, query: str, limit: int = 10) -> list:
        _ = query
        return self.rows(name, limit=limit)

    def list_tables(self) -> list:
        from sqlalchemy import text

        try:
            with self._engine.connect() as conn:
                rws = conn.execute(
                    text(f"SELECT DISTINCT collection AS c FROM {self._TABLE} LIMIT 500"),
                ).mappings().all()
            return [str(r["c"]) for r in rws if r.get("c")]
        except Exception:
            return []

    def table_stats(self, name: str) -> dict:
        from sqlalchemy import text

        try:
            with self._engine.connect() as conn:
                n = conn.execute(
                    text(f"SELECT COUNT(*) FROM {self._TABLE} WHERE collection = :c"),
                    {"c": name},
                ).scalar()
            return {"table": name, "rows": int(n or 0), "columns": ["chunk_id", "text_body", "metadata_json"]}
        except Exception:
            return {"table": name, "rows": 0, "columns": []}


# ── 工厂 ──────────────────────────────────────────────────────────
_store: VectorStore | None = None

def get_vector_store(project_id: str = "",
                     project_vector_db: str | None = None,
                     project_vector_config: dict | None = None) -> VectorStore:
    """获取向量存储实例。project 级配置优先于全局环境变量。"""
    global _store
    _ = project_id
    db_type = (project_vector_db or VECTOR_DB_TYPE or "lance").lower()
    cfg = project_vector_config or {}

    if db_type == "milvus":
        uri = cfg.get("uri") or os.getenv("MILVUS_URI", "http://localhost:19530")
        token = cfg.get("token") or os.getenv("MILVUS_TOKEN", "")
        return MilvusStore(uri=uri, token=token)

    if db_type == "qdrant":
        url = cfg.get("url") or os.getenv("QDRANT_URL", "http://localhost:6333")
        return QdrantAdminStore(url)

    if db_type == "oceanbase":
        return OceanBaseChunksAdminStore(cfg)

    if _store is None:
        from path_config import resolved_ai_memory_root
        db_path = cfg.get("path") or os.getenv("LANCE_DB_PATH") or str(resolved_ai_memory_root() / "lancedb")
        _store = LanceStore(db_path)
    return _store
