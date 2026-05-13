"""数据库配置管理 — 可视化配置 SQL 和向量数据库连接"""
from __future__ import annotations
import os
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from .auth_sql import require_role, ADMIN_MODE
from .sql_models import User

from path_config import ai_memory_root

router = APIRouter(prefix="/api/db-config", tags=["db-config"])

_ALLOWED_VECTOR_DBS = ("lance", "milvus")
_ALLOWED_SQL_DBS = ("sqlite", "mysql")


@router.get("")
def get_db_config(user: User = Depends(require_role("tenant_admin"))):
    return {
        "sql": {
            "type": os.getenv("DB_TYPE", "sqlite"),
            "url_masked": _mask_url(os.getenv("DATABASE_URL", "sqlite:///./sop.db")),
        },
        "vector": {
            "type": os.getenv("VECTOR_DB_TYPE", "lance"),
            "lance_path": os.getenv("LANCE_DB_PATH", str(ai_memory_root() / "lancedb")),
            "milvus_uri": os.getenv("MILVUS_URI", "http://localhost:19530"),
        },
        "admin_mode": os.getenv("ADMIN_MODE", "single"),
    }


class VectorDbTest(BaseModel):
    type: str
    uri: Optional[str] = None
    token: Optional[str] = None
    path: Optional[str] = None


@router.post("/vector/test")
def test_vector_connection(body: VectorDbTest,
                           user: User = Depends(require_role("tenant_admin"))):
    if body.type not in _ALLOWED_VECTOR_DBS:
        raise HTTPException(400, f"不支持的向量数据库类型: {body.type}")
    try:
        if body.type == "milvus":
            from pymilvus import MilvusClient
            client = MilvusClient(uri=body.uri or "http://localhost:19530",
                                  token=body.token or None)
            client.list_collections()
            return {"ok": True, "message": "Milvus 连接成功"}
        else:
            import lancedb
            path = body.path or str(ai_memory_root() / "lancedb")
            db = lancedb.connect(path)
            tables = db.table_names()
            return {"ok": True, "message": f"LanceDB 连接成功，{len(tables)} 个表"}
    except Exception as e:
        raise HTTPException(503, f"连接失败: {e}")


class SqlDbTest(BaseModel):
    type: str
    url: str


@router.post("/sql/test")
def test_sql_connection(body: SqlDbTest,
                        user: User = Depends(require_role("super_admin"))):
    if body.type not in _ALLOWED_SQL_DBS:
        raise HTTPException(400, f"不支持的数据库类型: {body.type}")
    try:
        from sqlalchemy import create_engine, text
        engine = create_engine(body.url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "message": f"{body.type} 连接成功"}
    except Exception as e:
        raise HTTPException(503, f"连接失败: {e}")


@router.get("/vector/tables")
def list_vector_tables(user: User = Depends(require_role("developer"))):
    from .vector_store import get_vector_store
    store = get_vector_store()
    tables = store.list_tables()
    stats = [store.table_stats(t) for t in tables]
    return {"tables": stats}


def _mask_url(url: str) -> str:
    """隐藏密码部分"""
    import re
    return re.sub(r"://([^:]+):([^@]+)@", r"://\1:***@", url)
