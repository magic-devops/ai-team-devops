"""数据库配置管理 — 可视化配置 SQL / 多模数据库 / 向量数据库连接"""
from __future__ import annotations
import json, os, uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Any, Optional

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


class MetadataPreviewIn(BaseModel):
    sample_limit: int = Field(20, ge=1, le=200)


class MetadataSyncIn(BaseModel):
    create_ingest_connector: bool = True
    sample_limit: int = Field(20, ge=1, le=200)
    owner: str = "DataOps"


@router.get("/connections")
def list_db_connections(user: User = Depends(require_role("tenant_admin"))):
    rows = _load_configs()
    return {"items": [_public_config(c) for c in rows], "total": len(rows)}


@router.get("/connections/summary")
def db_connections_summary(user: User = Depends(require_role("tenant_admin"))):
    rows = [_public_config(c) for c in _load_configs()]
    by_role: dict[str, int] = {}
    by_type: dict[str, int] = {}
    capability_counts: dict[str, int] = {}
    readiness = []
    for row in rows:
        role = str(row.get("role") or "business")
        db_type = str(row.get("type") or "unknown")
        by_role[role] = by_role.get(role, 0) + 1
        by_type[db_type] = by_type.get(db_type, 0) + 1
        for cap in row.get("capabilities") or []:
            capability_counts[str(cap)] = capability_counts.get(str(cap), 0) + 1
        readiness.append(_connection_readiness(row))
    score = round(sum(item["score"] for item in readiness) / len(readiness), 1) if readiness else 0
    return {
        "ok": True,
        "summary": {
            "total": len(rows),
            "ready": sum(1 for item in readiness if item["status"] == "ready"),
            "watch": sum(1 for item in readiness if item["status"] == "watch"),
            "risk": sum(1 for item in readiness if item["status"] == "risk"),
            "readiness_score": score,
            "by_role": by_role,
            "by_type": by_type,
            "capabilities": capability_counts,
        },
        "readiness": readiness,
        "agent_consumption": {
            "api": "/api/v1/db-config/connections/summary",
            "uses": ["select_source_for_metadata_scan", "validate_secret_ref", "plan_ingest_connector"],
        },
    }


@router.get("/drivers")
def list_db_drivers(user: User = Depends(require_role("developer"))):
    drivers = sorted(set(_ALLOWED_SQL_DBS + _ALLOWED_VECTOR_DBS))
    return {
        "drivers": drivers,
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


@router.post("/connections/{name}/metadata-preview")
def preview_connection_metadata(
    name: str,
    body: MetadataPreviewIn = MetadataPreviewIn(),
    user: User = Depends(require_role("tenant_admin")),
):
    row = _load_connection(name)
    tables = _metadata_tables_from_config(row)[: body.sample_limit]
    return {
        "ok": True,
        "connection": _public_config(row),
        "metadata": _metadata_summary(row, tables),
        "tables": tables,
        "agent_consumption": {
            "api": f"/api/v1/db-config/connections/{name}/metadata-preview",
            "next_actions": ["review_schema", "sync_to_data_ingest", "bind_owner_and_quality_rules"],
        },
    }


@router.post("/connections/{name}/metadata-sync")
def sync_connection_metadata(
    name: str,
    body: MetadataSyncIn = MetadataSyncIn(),
    user: User = Depends(require_role("tenant_admin")),
):
    row = _load_connection(name)
    tables = _metadata_tables_from_config(row)[: body.sample_limit]
    connector = None
    registry = {"items": [], "total": 0}
    if body.create_ingest_connector:
        from sop_manager.routers import data_ingest

        schemas = {str(table.get("name")): table.get("columns") or [] for table in tables if table.get("name")}
        connector_type = "postgresql" if row.get("type") == "postgres" else str(row.get("type") or "mysql")
        existing = next(
            (
                item
                for item in data_ingest.list_connectors().get("items", [])
                if (item.get("extra") or {}).get("source_connection_name") == name
            ),
            None,
        )
        payload = data_ingest.ConnectorCreate(
            name=f"{row.get('name') or name} metadata connector",
            connector_type=connector_type,
            host=str(row.get("host") or ""),
            port=int(row.get("port") or _default_port(connector_type)),
            database=str(row.get("database") or ""),
            extra={
                "source": "db-config",
                "source_connection_name": name,
                "schemas": schemas,
                "capabilities": row.get("capabilities") or [],
                "owner": body.owner,
                "readonly": bool(row.get("readonly")),
            },
        )
        connector = data_ingest.update_connector(existing["id"], payload) if existing else data_ingest.create_connector(payload)
        data_ingest.get_schema(connector["id"])
        registry = data_ingest.schema_registry(connector_id=connector["id"])
    return {
        "ok": True,
        "connection": _public_config(row),
        "metadata": _metadata_summary(row, tables),
        "tables": tables,
        "ingest_connector": connector,
        "schema_registry": {"total": registry.get("total", 0), "items": registry.get("items", [])},
        "agent_consumption": {
            "api": f"/api/v1/db-config/connections/{name}/metadata-sync",
            "produces": ["data_ingest_connector", "schema_registry"],
        },
    }


@router.post("/connections/{name}/test")
def test_saved_db_connection(name: str, url: str = Query("", description="临时连接串，仅用于测试，不保存"),
                             user: User = Depends(require_role("tenant_admin"))):
    row = _load_connection(name)
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


def _load_connection(name: str) -> dict[str, Any]:
    row = next((r for r in _load_configs() if r.get("name") == name), None)
    if not row:
        raise HTTPException(404, "数据库配置不存在")
    return row


def _default_port(db_type: str) -> int:
    return {
        "mysql": 3306,
        "oceanbase": 2881,
        "postgres": 5432,
        "postgresql": 5432,
        "sqlite": 0,
    }.get(db_type, 3306)


def _connection_readiness(row: dict[str, Any]) -> dict[str, Any]:
    gaps: list[str] = []
    score = 100
    if not row.get("secret_ref") and not row.get("url_env"):
        gaps.append("missing_secret_ref")
        score -= 28
    if not row.get("role"):
        gaps.append("missing_role")
        score -= 12
    if not row.get("capabilities"):
        gaps.append("missing_capabilities")
        score -= 12
    if str(row.get("type") or "") != "sqlite" and not row.get("host"):
        gaps.append("missing_host")
        score -= 12
    if not _metadata_tables_from_config(row):
        gaps.append("metadata_not_declared")
        score -= 16
    score = max(score, 0)
    status = "ready" if score >= 85 else "watch" if score >= 60 else "risk"
    return {"name": row.get("name"), "type": row.get("type"), "role": row.get("role"), "score": score, "status": status, "gaps": gaps}


def _metadata_tables_from_config(row: dict[str, Any]) -> list[dict[str, Any]]:
    options = row.get("options") if isinstance(row.get("options"), dict) else {}
    schemas = options.get("schemas") if isinstance(options.get("schemas"), dict) else {}
    if schemas:
        return [
            {
                "name": str(name),
                "columns": columns if isinstance(columns, list) else [],
                "source": row.get("name"),
                "schema_name": row.get("schema_name") or options.get("schema_name") or "",
            }
            for name, columns in schemas.items()
            if str(name).strip()
        ]
    database = str(row.get("database") or row.get("schema_name") or row.get("name") or "default").replace("-", "_")
    role = str(row.get("role") or "business")
    return [
        {
            "name": f"{database}_{role}_fact",
            "columns": [
                {"name": "id", "type": "string", "primary_key": True},
                {"name": "tenant_code", "type": "string"},
                {"name": "business_code", "type": "string"},
                {"name": "project_id", "type": "string"},
                {"name": "updated_at", "type": "datetime"},
            ],
            "source": row.get("name"),
            "schema_name": row.get("schema_name") or "",
        },
        {
            "name": f"{database}_{role}_dim",
            "columns": [
                {"name": "id", "type": "string", "primary_key": True},
                {"name": "name", "type": "string"},
                {"name": "status", "type": "string"},
                {"name": "gmt_modified", "type": "datetime"},
            ],
            "source": row.get("name"),
            "schema_name": row.get("schema_name") or "",
        },
    ]


def _metadata_summary(row: dict[str, Any], tables: list[dict[str, Any]]) -> dict[str, Any]:
    columns = sum(len(table.get("columns") or []) for table in tables)
    pii_candidates = [
        column.get("name")
        for table in tables
        for column in table.get("columns") or []
        if any(token in str(column.get("name") or "").lower() for token in ("email", "phone", "mobile", "name", "id_card"))
    ]
    return {
        "connection_name": row.get("name"),
        "tables": len(tables),
        "columns": columns,
        "pii_candidates": len(pii_candidates),
        "pii_fields": sorted({str(x) for x in pii_candidates if x})[:20],
        "readonly": bool(row.get("readonly")),
        "capabilities": row.get("capabilities") or [],
        "generated_at": _now(),
    }


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
