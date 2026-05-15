"""数据库配置管理 — 可视化配置 SQL / 多模数据库 / 向量数据库连接"""
from __future__ import annotations
import json, os, uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional

from .auth_sql import require_role, ADMIN_MODE
from .sql_models import User

from sop_manager.path_config import resolved_ai_memory_root

router = APIRouter(prefix="/api/v1/db-config", tags=["db-config"])

_ALLOWED_VECTOR_DBS = ("lance", "milvus", "qdrant", "oceanbase")
_ALLOWED_SQL_DBS = ("sqlite", "mysql", "postgres", "postgresql", "oceanbase")
_ALLOWED_DB_ROLES = ("metadata", "business", "analytics", "vector", "memory", "audit")
_ALLOWED_CAPABILITIES = ("sql", "vector", "json", "graph", "analytics", "memory", "audit")


@router.get("")
def get_db_config(user: User = Depends(require_role("tenant_admin"))):
    configs = _load_configs()
    return {
        "sql": {
            "type": os.getenv("DB_TYPE", "sqlite"),
            "url_masked": _mask_url(os.getenv("DATABASE_URL", "sqlite:///./sop.db")),
        },
        "vector": {
            "type": os.getenv("VECTOR_DB_TYPE", "lance"),
            "lance_path": os.getenv("LANCE_DB_PATH", str(resolved_ai_memory_root() / "lancedb")),
            "milvus_uri": os.getenv("MILVUS_URI", "http://localhost:19530"),
            "qdrant_url": os.getenv("QDRANT_URL", "http://localhost:6333"),
            "oceanbase_vector_url_masked": _mask_url(os.getenv("OCEANBASE_VECTOR_URL", "")),
        },
        "remote_configs": [_public_config(c) for c in configs],
        "admin_mode": os.getenv("ADMIN_MODE", "single"),
    }


def _config_file() -> Path:
    base = resolved_ai_memory_root() / "db-config-v1"
    base.mkdir(parents=True, exist_ok=True)
    return base / "connections.json"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _load_configs() -> list[dict]:
    p = _config_file()
    if not p.is_file():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = data.get("connections") if isinstance(data, dict) else []
    return rows if isinstance(rows, list) else []


def _save_configs(rows: list[dict]) -> None:
    _config_file().write_text(json.dumps({"connections": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _public_config(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in {"url", "password", "token"}}


class RemoteDbConfig(BaseModel):
    name: str = Field(..., min_length=1)
    type: str = Field(..., description="sqlite|mysql|postgres|postgresql|oceanbase")
    role: str = Field("business", description="metadata|business|analytics|vector|memory|audit")
    capabilities: list[str] = Field(default_factory=lambda: ["sql"], description="sql|vector|json|graph|analytics|memory|audit")
    driver: str = Field("", description="SQLAlchemy/DBAPI 驱动提示，如 psycopg/pymysql")
    host: str = ""
    port: int | None = None
    database: str = ""
    username: str = ""
    schema_name: str = ""
    ssl_mode: str = ""
    readonly: bool = False
    pool_size: int | None = None
    url_env: str = Field("", description="连接串环境变量名，避免明文保存")
    secret_ref: str = Field("", description="密钥引用，如 env://DB_URL 或 vault://...")
    options: dict = Field(default_factory=dict)


@router.get("/connections")
def list_db_connections(user: User = Depends(require_role("tenant_admin"))):
    rows = _load_configs()
    return {"items": [_public_config(c) for c in rows], "total": len(rows)}


@router.get("/drivers")
def list_db_drivers(user: User = Depends(require_role("developer"))):
    return {
        "sql": {
            "supported": list(_ALLOWED_SQL_DBS),
            "examples": {
                "oceanbase": "mysql+pymysql://user:***@ob.example.com:2881/app",
                "postgres": "postgresql+psycopg://user:***@pg.example.com:5432/app",
                "mysql": "mysql+pymysql://user:***@mysql.example.com:3306/app",
                "sqlite": "sqlite:///./sop.db",
            },
        },
        "vector": {
            "supported": list(_ALLOWED_VECTOR_DBS),
            "examples": {
                "lance": "local LanceDB path",
                "milvus": "http://milvus.example.com:19530",
                "qdrant": "http://qdrant.example.com:6333",
                "oceanbase": "OceanBase/MySQL compatible vector table",
            },
        },
        "roles": list(_ALLOWED_DB_ROLES),
        "capabilities": list(_ALLOWED_CAPABILITIES),
        "secret_refs": ["env://APP_DB_URL", "vault://secret/data/app-db"],
    }


@router.put("/connections/{name}")
def upsert_db_connection(name: str, body: RemoteDbConfig,
                         user: User = Depends(require_role("tenant_admin"))):
    if body.type not in _ALLOWED_SQL_DBS:
        raise HTTPException(400, f"不支持的数据库类型: {body.type}")
    if body.role not in _ALLOWED_DB_ROLES:
        raise HTTPException(400, f"不支持的数据库角色: {body.role}")
    invalid_caps = [c for c in body.capabilities if c not in _ALLOWED_CAPABILITIES]
    if invalid_caps:
        raise HTTPException(400, f"不支持的数据能力: {', '.join(invalid_caps)}")
    rows = _load_configs()
    now = _now()
    row = {
        "id": f"dbc-{uuid.uuid4().hex[:12]}",
        "name": name,
        "type": body.type,
        "role": body.role,
        "capabilities": body.capabilities or ["sql"],
        "driver": body.driver,
        "host": body.host,
        "port": body.port,
        "database": body.database,
        "username": body.username,
        "schema_name": body.schema_name,
        "ssl_mode": body.ssl_mode,
        "readonly": body.readonly,
        "pool_size": body.pool_size,
        "url_env": body.url_env,
        "secret_ref": body.secret_ref,
        "options": body.options,
        "updated_at": now,
    }
    replaced = False
    for i, old in enumerate(rows):
        if old.get("name") == name:
            row["id"] = old.get("id") or row["id"]
            row["created_at"] = old.get("created_at") or now
            rows[i] = row
            replaced = True
            break
    if not replaced:
        row["created_at"] = now
        rows.append(row)
    _save_configs(rows)
    return {"ok": True, "config": _public_config(row)}


@router.delete("/connections/{name}")
def delete_db_connection(name: str, user: User = Depends(require_role("tenant_admin"))):
    rows = _load_configs()
    new_rows = [r for r in rows if r.get("name") != name]
    if len(new_rows) == len(rows):
        raise HTTPException(404, "数据库配置不存在")
    _save_configs(new_rows)
    return {"ok": True}


@router.post("/connections/{name}/test")
def test_saved_db_connection(name: str, url: str = Query("", description="临时连接串，仅用于测试，不保存"),
                             user: User = Depends(require_role("tenant_admin"))):
    row = next((r for r in _load_configs() if r.get("name") == name), None)
    if not row:
        raise HTTPException(404, "数据库配置不存在")
    conn_url = url.strip() or _resolve_url_from_config(row)
    if not conn_url:
        raise HTTPException(400, "未提供连接串；请传 url 或配置 url_env/secret_ref")
    return _test_sql_url(str(row.get("type") or ""), conn_url)


class VectorDbTest(BaseModel):
    type: str
    uri: Optional[str] = None
    token: Optional[str] = None
    path: Optional[str] = None
    url: Optional[str] = None


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
        if body.type == "qdrant":
            from qdrant_client import QdrantClient
            url = body.url or body.uri or os.getenv("QDRANT_URL", "http://localhost:6333")
            c = QdrantClient(url=url)
            n = len(c.get_collections().collections)
            return {"ok": True, "message": f"Qdrant 连接成功，{n} 个 collection"}
        if body.type == "oceanbase":
            from sqlalchemy import create_engine, text
            u = (body.url or body.uri or os.getenv("OCEANBASE_VECTOR_URL") or os.getenv("DATABASE_URL") or "").strip()
            if not u or u.startswith("sqlite"):
                raise ValueError("oceanbase 测试需要 mysql+pymysql 或 OceanBase 连接串（勿用 sqlite）")
            engine = create_engine(u, pool_pre_ping=True)
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"ok": True, "message": "OceanBase/MySQL 连通；RAG 表 sop_rag_chunks 在首次 /rag/index 时创建"}
        import lancedb
        path = body.path or str(resolved_ai_memory_root() / "lancedb")
        db = lancedb.connect(path)
        tables = db.table_names()
        return {"ok": True, "message": f"LanceDB 连接成功，{len(tables)} 个表"}
    except Exception as e:
        raise HTTPException(503, f"连接失败: {e}") from e


class SqlDbTest(BaseModel):
    type: str
    url: str


@router.post("/sql/test")
def test_sql_connection(body: SqlDbTest,
                        user: User = Depends(require_role("super_admin"))):
    if body.type not in _ALLOWED_SQL_DBS:
        raise HTTPException(400, f"不支持的数据库类型: {body.type}")
    return _test_sql_url(body.type, body.url)


def _resolve_url_from_config(row: dict) -> str:
    env_name = str(row.get("url_env") or "").strip()
    if env_name and os.getenv(env_name):
        return os.getenv(env_name, "")
    secret_ref = str(row.get("secret_ref") or "").strip()
    if secret_ref.startswith("env://"):
        return os.getenv(secret_ref[len("env://"):], "")
    return ""


def _test_sql_url(db_type: str, url: str) -> dict:
    try:
        from sqlalchemy import create_engine, text
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as conn:
            version = conn.execute(text("SELECT 1")).scalar()
        return {"ok": True, "message": f"{db_type} 连接成功", "probe": version, "url_masked": _mask_url(url)}
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
