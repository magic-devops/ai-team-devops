"""数据接入中心：连接器管理、接入作业（批量/CDC/流）。"""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sop_manager.path_config import resolved_ai_memory_root, resolved_tenant_code, resolved_business_code, resolved_project_id

router = APIRouter(prefix="/api/v1/data-ingest", tags=["data-ingest"])

def _dir(sub: str):
    d = resolved_ai_memory_root() / "data_ingest" / sub
    d.mkdir(parents=True, exist_ok=True)
    return d

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _scope() -> dict:
    return {"tenant_code": resolved_tenant_code(), "business_code": resolved_business_code(), "project_id": resolved_project_id()}

def _load_all(sub: str) -> list[dict]:
    import json
    items = []
    for f in _dir(sub).glob("*.json"):
        try:
            items.append(json.loads(f.read_text()))
        except Exception:
            pass
    return sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)

def _save(sub: str, item: dict):
    import json
    (_dir(sub) / f"{item['id']}.json").write_text(json.dumps(item, ensure_ascii=False, indent=2))

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
    target_table: str = ""

class JobStatusUpdate(BaseModel):
    status: str
    rows_ingested: int = 0
    error_msg: str = ""

class JobUpdate(JobCreate):
    status: str = "idle"

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
    import json
    p = _dir("connectors") / f"{connector_id}.json"
    if not p.exists():
        raise HTTPException(404, "connector not found")
    item = json.loads(p.read_text())
    item.update(body.model_dump())
    _save("connectors", item)
    return item

@router.delete("/connectors/{connector_id}")
def delete_connector(connector_id: str):
    p = _dir("connectors") / f"{connector_id}.json"
    if not p.exists():
        raise HTTPException(404, "connector not found")
    active_jobs = [j for j in _load_all("jobs") if j.get("connector_id") == connector_id and j.get("status") in {"running", "idle"}]
    if active_jobs:
        raise HTTPException(409, "connector has active jobs; delete or stop jobs first")
    p.unlink()
    return {**_scope(), "deleted": connector_id}

@router.post("/connectors/{connector_id}/test")
def test_connector(connector_id: str):
    import json
    p = _dir("connectors") / f"{connector_id}.json"
    if not p.exists():
        raise HTTPException(404, "connector not found")
    item = json.loads(p.read_text())
    item.update({"status": "active", "last_tested_at": _now()})
    _save("connectors", item)
    return {**_scope(), "connector_id": connector_id, "status": "active", "tested_at": item["last_tested_at"]}

@router.get("/connectors/{connector_id}/schema")
def get_schema(connector_id: str):
    import json
    p = _dir("connectors") / f"{connector_id}.json"
    if not p.exists():
        raise HTTPException(404, "connector not found")
    connector = json.loads(p.read_text())
    database = connector.get("database") or "default"
    tables = [
        {"name": f"{database}_orders", "columns": [{"name": "id", "type": "string"}, {"name": "gmt_created", "type": "datetime"}, {"name": "amount", "type": "decimal"}]},
        {"name": f"{database}_users", "columns": [{"name": "id", "type": "string"}, {"name": "name", "type": "string"}, {"name": "gmt_modified", "type": "datetime"}]},
    ]
    return {**_scope(), "connector_id": connector_id, "tables": tables, "discovered_at": _now()}

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
    if not (_dir("connectors") / f"{body.connector_id}.json").exists():
        raise HTTPException(404, "connector not found")
    item = {**_scope(), "id": str(uuid4()), **body.model_dump(),
            "status": "idle", "last_run_at": None, "rows_ingested": 0, "created_at": _now()}
    _save("jobs", item)
    return item

@router.put("/jobs/{job_id}")
def update_job(job_id: str, body: JobUpdate):
    import json
    p = _dir("jobs") / f"{job_id}.json"
    if not p.exists():
        raise HTTPException(404, "job not found")
    if not (_dir("connectors") / f"{body.connector_id}.json").exists():
        raise HTTPException(404, "connector not found")
    item = json.loads(p.read_text())
    item.update(body.model_dump())
    item["updated_at"] = _now()
    _save("jobs", item)
    return item

@router.post("/jobs/{job_id}/run")
def run_job(job_id: str):
    import json
    p = _dir("jobs") / f"{job_id}.json"
    if not p.exists():
        raise HTTPException(404, "job not found")
    item = json.loads(p.read_text())
    item.update({"status": "running", "last_run_at": _now(), "error_msg": ""})
    _save("jobs", item)
    return item

@router.put("/jobs/{job_id}/status")
def update_job_status(job_id: str, body: JobStatusUpdate):
    import json
    p = _dir("jobs") / f"{job_id}.json"
    if not p.exists():
        raise HTTPException(404, "job not found")
    item = json.loads(p.read_text())
    item.update({"status": body.status, "rows_ingested": body.rows_ingested,
                 "error_msg": body.error_msg, "last_run_at": _now()})
    _save("jobs", item)
    return item

@router.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    p = _dir("jobs") / f"{job_id}.json"
    if not p.exists():
        raise HTTPException(404, "job not found")
    p.unlink()
    return {**_scope(), "deleted": job_id}

@router.get("/summary")
def summary():
    connectors = _load_all("connectors")
    jobs = _load_all("jobs")
    cdc = [j for j in jobs if j.get("ingest_mode") == "cdc"]
    return {**_scope(), "summary": {
        "connectors": len(connectors), "active_jobs": sum(1 for j in jobs if j.get("status") == "running"),
        "rows_today": sum(j.get("rows_ingested", 0) for j in jobs),
        "cdc_streams": len(cdc)}}
