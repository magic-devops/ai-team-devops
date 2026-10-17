"""数据接入中心：连接器管理、接入作业（批量/CDC/流）。"""
from __future__ import annotations
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id
from sop_manager.routers.metrics import current_trace_context, trace_context
from sop_manager.routers.scope_guard import attach_scope, scope_matches

from sop_manager.project_write_guard import project_file_write_scope

router = APIRouter(prefix="/api/v1/data-ingest", tags=["data-ingest"])

def _dir(sub: str):
    d = resolved_ai_memory_root() / "data_ingest" / sub
    return d

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _scope() -> dict:
    return {"tenant_code": resolved_tenant_code(), "business_code": resolved_business_code(), "project_id": resolved_project_id()}

def _load_all(sub: str) -> list[dict]:
    items = []
    for f in _dir(sub).glob("*.json"):
        try:
            item = json.loads(f.read_text())
            if isinstance(item, dict) and scope_matches(item, require_business=True):
                items.append(item)
        except Exception:
            pass
    return sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)

def _save(sub: str, item: dict):
    with project_file_write_scope():
        _dir(sub).mkdir(parents=True, exist_ok=True)
        attach_scope(item, overwrite=False)
        (_dir(sub) / f"{item['id']}.json").write_text(json.dumps(item, ensure_ascii=False, indent=2))

def _load_item(sub: str, item_id: str, label: str) -> dict:
    p = _dir(sub) / f"{item_id}.json"
    if not p.exists():
        raise HTTPException(404, f"{label} not found")
    try:
        item = json.loads(p.read_text())
    except Exception as exc:
        raise HTTPException(500, f"{label} is unreadable") from exc
    if not isinstance(item, dict) or not scope_matches(item, require_business=True):
        raise HTTPException(404, f"{label} not found")
    return item

def _connector_tables(connector: dict) -> list[dict]:
    extra = connector.get("extra") if isinstance(connector.get("extra"), dict) else {}
    schemas = extra.get("schemas") if isinstance(extra.get("schemas"), dict) else {}
    if schemas:
        return [{"name": name, "columns": columns if isinstance(columns, list) else []} for name, columns in schemas.items()]
    database = connector.get("database") or "default"
    return [
        {"name": f"{database}_orders", "columns": [{"name": "id", "type": "string"}, {"name": "gmt_created", "type": "datetime"}, {"name": "amount", "type": "decimal"}]},
        {"name": f"{database}_users", "columns": [{"name": "id", "type": "string"}, {"name": "name", "type": "string"}, {"name": "gmt_modified", "type": "datetime"}]},
    ]

def _register_schema(connector: dict, tables: list[dict]) -> list[dict]:
    rows = []
    for table in tables:
        table_name = str(table.get("name") or "")
        if not table_name:
            continue
        item = {
            **_scope(),
            "id": f"{connector['id']}-{table_name}",
            "connector_id": connector["id"],
            "connector_name": connector.get("name", ""),
            "database": connector.get("database", ""),
            "table_name": table_name,
            "columns": table.get("columns") if isinstance(table.get("columns"), list) else [],
            "discovered_at": _now(),
            "created_at": _now(),
        }
        _save("schema_registry", item)
        rows.append(item)
    return rows

class ConnectorCreate(BaseModel):
    name: str
    connector_type: str = "mysql"
    host: str = ""
    port: int = 3306
    database: str = ""
    extra: dict = Field(default_factory=dict)

class JobCreate(BaseModel):
    connector_id: str
    name: str
    ingest_mode: str = "batch"
    schedule: str = ""
    source_table: str = ""
    target_table: str = ""
    cursor_field: str = ""
    batch_size: int = 1000

class JobStatusUpdate(BaseModel):
    status: str
    rows_ingested: int = 0
    error_msg: str = ""
    cdc_cursor: str = ""

class JobUpdate(JobCreate):
    status: str = "idle"

class ConnectorDryRunIn(BaseModel):
    sample_limit: int = 10

@router.get("/connectors")
def list_connectors(connector_type: str = ""):
    items = _load_all("connectors")
    if connector_type:
        items = [i for i in items if i.get("connector_type") == connector_type]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/connectors")
def create_connector(body: ConnectorCreate):
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(),
            "status": "inactive", "last_tested_at": None, "created_at": _now()}
    _save("connectors", item)
    return item

@router.put("/connectors/{connector_id}")
def update_connector(connector_id: str, body: ConnectorCreate):
    item = _load_item("connectors", connector_id, "connector")
    item.update(body.model_dump())
    _save("connectors", item)
    return item

@router.delete("/connectors/{connector_id}")
def delete_connector(connector_id: str):
    _load_item("connectors", connector_id, "connector")
    p = _dir("connectors") / f"{connector_id}.json"
    active_jobs = [j for j in _load_all("jobs") if j.get("connector_id") == connector_id and j.get("status") in {"running", "idle"}]
    if active_jobs:
        raise HTTPException(409, "connector has active jobs; delete or stop jobs first")
    with project_file_write_scope():
        p.unlink()
    return {**_scope(), "deleted": connector_id}

@router.post("/connectors/{connector_id}/test")
def test_connector(connector_id: str):
    item = _load_item("connectors", connector_id, "connector")
    item.update({"status": "active", "last_tested_at": _now()})
    _save("connectors", item)
    return {**_scope(), "connector_id": connector_id, "status": "active", "tested_at": item["last_tested_at"]}

@router.post("/connectors/{connector_id}/dry-run")
def connector_dry_run(connector_id: str, body: ConnectorDryRunIn = ConnectorDryRunIn()):
    item = _load_item("connectors", connector_id, "connector")
    tables = _connector_tables(item)
    registered = _register_schema(item, tables)
    extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}
    samples = extra.get("sample_rows") if isinstance(extra.get("sample_rows"), list) else []
    status = "passed" if tables else "warning"
    item.update({"status": "active" if status == "passed" else "inactive", "last_tested_at": _now(), "last_dry_run_at": _now()})
    _save("connectors", item)
    return {
        **_scope(),
        "connector_id": connector_id,
        "status": status,
        "tested_at": item["last_dry_run_at"],
        "sample_count": min(len(samples), body.sample_limit),
        "samples": samples[:body.sample_limit],
        "schema_summary": {"tables": len(tables), "columns": sum(len(t.get("columns") or []) for t in tables), "registered": len(registered)},
        "supports_cdc": bool(extra.get("supports_cdc") or item.get("connector_type") in {"mysql", "oceanbase", "postgresql", "kafka"}),
    }

@router.get("/connectors/{connector_id}/schema")
def get_schema(connector_id: str):
    connector = _load_item("connectors", connector_id, "connector")
    tables = _connector_tables(connector)
    _register_schema(connector, tables)
    return {**_scope(), "connector_id": connector_id, "tables": tables, "discovered_at": _now()}

@router.get("/schema-registry")
def schema_registry(connector_id: str = ""):
    items = _load_all("schema_registry")
    if connector_id:
        items = [i for i in items if i.get("connector_id") == connector_id]
    return {**_scope(), "items": items, "total": len(items)}

@router.get("/jobs")
def list_jobs(connector_id: str = "", status: str = ""):
    items = _load_all("jobs")
    if connector_id:
        items = [i for i in items if i.get("connector_id") == connector_id]
    if status:
        items = [i for i in items if i.get("status") == status]
    return {**_scope(), "items": items, "total": len(items)}

@router.post("/jobs")
def create_job(body: JobCreate):
    _load_item("connectors", body.connector_id, "connector")
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(),
            "status": "idle", "last_run_at": None, "rows_ingested": 0,
            "cdc_cursor": "", "active_run_id": "", "created_at": _now()}
    _save("jobs", item)
    return item

@router.put("/jobs/{job_id}")
def update_job(job_id: str, body: JobUpdate):
    item = _load_item("jobs", job_id, "job")
    _load_item("connectors", body.connector_id, "connector")
    item.update(body.model_dump())
    item["updated_at"] = _now()
    _save("jobs", item)
    return item

@router.post("/jobs/{job_id}/run")
def run_job(job_id: str):
    item = _load_item("jobs", job_id, "job")
    trace = current_trace_context()
    run_id = str(uuid4())
    now = _now()
    item.update({"status": "running", "last_run_at": now, "error_msg": "", "active_run_id": run_id})
    _save("jobs", item)
    run = {
        **_scope(),
        "id": run_id,
        "run_id": run_id,
        "job_id": job_id,
        "connector_id": item.get("connector_id", ""),
        "name": item.get("name", ""),
        "ingest_mode": item.get("ingest_mode", "batch"),
        "source_table": item.get("source_table", ""),
        "target_table": item.get("target_table", ""),
        "status": "running",
        "rows_ingested": 0,
        "started_at": now,
        "finished_at": None,
        "cdc_cursor_start": item.get("cdc_cursor", ""),
        "cdc_cursor": item.get("cdc_cursor", ""),
        "trace_id": trace["trace_id"],
        "correlation_id": trace["correlation_id"],
        "agent_run_id": trace.get("agent_run_id", ""),
        "created_at": now,
    }
    _save("runs", run)
    return item

@router.put("/jobs/{job_id}/status")
def update_job_status(job_id: str, body: JobStatusUpdate):
    item = _load_item("jobs", job_id, "job")
    trace = current_trace_context()
    cdc_cursor = body.cdc_cursor or item.get("cdc_cursor", "")
    item.update({"status": body.status, "rows_ingested": body.rows_ingested,
                 "error_msg": body.error_msg, "last_run_at": _now(), "cdc_cursor": cdc_cursor})
    _save("jobs", item)
    run_id = item.get("active_run_id")
    if run_id:
        try:
            run = _load_item("runs", run_id, "run")
            run.update({
                "status": body.status,
                "rows_ingested": body.rows_ingested,
                "error_msg": body.error_msg,
                "finished_at": _now(),
                "cdc_cursor": cdc_cursor,
                "trace_id": run.get("trace_id") or trace["trace_id"],
                "correlation_id": run.get("correlation_id") or trace["correlation_id"],
                "agent_run_id": run.get("agent_run_id") or trace.get("agent_run_id", ""),
            })
            _save("runs", run)
        except HTTPException:
            pass
    if item.get("ingest_mode") == "cdc":
        cursor = {
            **_scope(),
            "id": f"{job_id}-cursor",
            "job_id": job_id,
            "connector_id": item.get("connector_id", ""),
            "source_table": item.get("source_table", ""),
            "cursor_field": item.get("cursor_field", ""),
            "cursor": cdc_cursor,
            "updated_at": _now(),
            "created_at": _now(),
        }
        _save("cdc_cursors", cursor)
    return item

@router.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    _load_item("jobs", job_id, "job")
    p = _dir("jobs") / f"{job_id}.json"
    with project_file_write_scope():
        p.unlink()
    return {**_scope(), "deleted": job_id}

@router.get("/runs")
def list_runs(job_id: str = "", status: str = ""):
    items = _load_all("runs")
    if job_id:
        items = [i for i in items if i.get("job_id") == job_id]
    if status:
        items = [i for i in items if i.get("status") == status]
    return {**_scope(), "items": items, "total": len(items)}

@router.get("/cdc-cursors")
def cdc_cursors(job_id: str = ""):
    items = _load_all("cdc_cursors")
    if job_id:
        items = [i for i in items if i.get("job_id") == job_id]
    return {**_scope(), "items": items, "total": len(items)}

@router.get("/summary")
def summary():
    connectors = _load_all("connectors")
    jobs = _load_all("jobs")
    runs = _load_all("runs")
    cdc = [j for j in jobs if j.get("ingest_mode") == "cdc"]
    return {**_scope(), "summary": {
        "connectors": len(connectors), "active_jobs": sum(1 for j in jobs if j.get("status") == "running"),
        "rows_today": sum(j.get("rows_ingested", 0) for j in jobs),
        "cdc_streams": len(cdc), "runs_total": len(runs)}}
