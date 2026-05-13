"""向量数据库抽象层 — 支持 LanceDB / Milvus，项目级命名空间隔离"""
from __future__ import annotations
import os
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


# ── 工厂 ──────────────────────────────────────────────────────────
_store: VectorStore | None = None

def get_vector_store(project_id: str = "",
                     project_vector_db: str | None = None,
                     project_vector_config: dict | None = None) -> VectorStore:
    """获取向量存储实例。project 级配置优先于全局环境变量。"""
    global _store
    db_type = project_vector_db or VECTOR_DB_TYPE
    cfg = project_vector_config or {}

    if db_type == "milvus":
        uri = cfg.get("uri") or os.getenv("MILVUS_URI", "http://localhost:19530")
        token = cfg.get("token") or os.getenv("MILVUS_TOKEN", "")
        return MilvusStore(uri=uri, token=token)

    if _store is None:
        from path_config import ai_memory_root
        db_path = cfg.get("path") or os.getenv("LANCE_DB_PATH") or str(ai_memory_root() / "lancedb")
        _store = LanceStore(db_path)
    return _store



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
                if v is None or isinstance(v, (bool, str, int, float)):
                    return v
                if isinstance(v, bytes):
                    return v.decode("utf-8", errors="replace")
                if isinstance(v, datetime):
                    return v.isoformat() + "Z"
                try:
                    if isinstance(v, np.ndarray):
                        return v.tolist()
                    if isinstance(v, np.generic):
                        return v.item()
                except Exception:
                    pass
                if isinstance(v, (list, tuple)):
                    return [_safe(x) for x in v]
                if isinstance(v, dict):
                    return {k: _safe(x) for k, x in v.items()}
                if hasattr(v, "tolist"):
                    return v.tolist()
                if hasattr(v, "isoformat"):
                    return v.isoformat()
                return str(v)
            return [{k: _safe(v) for k, v in row.items()} for row in raw]
        except Exception:
            return []

    def upsert(self, name: str, row: dict):
        t = self.table(name)
        if t is None:
            return
        t.add([row])

    def delete(self, name: str, expr: str):
        t = self.table(name)
        if t:
            t.delete(expr)

    def search(self, name: str, query: str, limit: int = 10) -> list:
        try:
            from knowledge.lancedb_ops import LanceOps
            return LanceOps().search(name, query, limit=limit)
        except Exception:
            return []

    def list_tables(self) -> list:
        try:
            return self._db.table_names()
        except Exception:
            return []

    def table_stats(self, name: str) -> dict:
        t = self.table(name)
        if t is None:
            return {"table": name, "rows": 0, "columns": []}
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
        if not self._client.has_collection(name):
            return []
        try:
            res = self._client.query(collection_name=name, filter="", limit=limit, output_fields=["*"])
            return res or []
        except Exception:
            return []

    def upsert(self, name: str, row: dict):
        self._client.upsert(collection_name=name, data=[row])

    def delete(self, name: str, expr: str):
        self._client.delete(collection_name=name, filter=expr)

    def search(self, name: str, query: str, limit: int = 10) -> list:
        # 需要 embedding；此处返回关键词过滤结果作为降级
        try:
            res = self._client.query(collection_name=name,
                                     filter=f'content like "%{query}%"',
                                     limit=limit, output_fields=["*"])
            return res or []
        except Exception:
            return []

    def list_tables(self) -> list:
        try:
            return self._client.list_collections()
        except Exception:
            return []

    def table_stats(self, name: str) -> dict:
        try:
            stats = self._client.get_collection_stats(name)
            return {"table": name, "rows": int(stats.get("row_count", 0)), "columns": []}
        except Exception:
            return {"table": name, "rows": 0, "columns": []}


# ── 工厂 ──────────────────────────────────────────────────────────
_store: VectorStore | None = None

def get_vector_store(project_vector_db: str | None = None,
                     project_vector_config: dict | None = None) -> VectorStore:
    """获取向量存储实例。project 级配置优先于全局环境变量。"""
    global _store
    db_type = project_vector_db or VECTOR_DB_TYPE
    cfg = project_vector_config or {}

    if db_type == "milvus":
        uri = cfg.get("uri") or os.getenv("MILVUS_URI", "http://localhost:19530")
        token = cfg.get("token") or os.getenv("MILVUS_TOKEN", "")
        return MilvusStore(uri=uri, token=token)

    # 默认 lance
    if _store is None:
        from path_config import ai_memory_root
        db_path = cfg.get("path") or os.getenv("LANCE_DB_PATH") or str(ai_memory_root() / "lancedb")
        _store = LanceStore(db_path)
    return _store
