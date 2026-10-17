"""项目数据导出 / 导入（与 db_sql_compat 同一租户与 PROJECT_ID 上下文）"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, Integer, Float
from sqlalchemy.orm import Session

from sop_manager.path_config import resolved_project_id, resolved_runtime_dir, resolved_tenant_id
from sop_manager.task_owner import validate_task_owner_values
from sop_manager.task_acceptance import normalize_task_acceptance
from .auth_sql import User, current_user, require_data_hub_import
from .db_sql_compat import rows
from .sql_models import get_session, Requirement, Task, Sprint, Issue

router = APIRouter(prefix="/api/v1/data-exchange", tags=["data-exchange"])

_SQL_TABLES = ("requirements", "tasks", "issues", "sprints")
_MODEL_MAP = {
    "requirements": Requirement,
    "tasks": Task,
    "issues": Issue,
    "sprints": Sprint,
}


def _utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _jobs_file() -> Path:
    p = resolved_runtime_dir() / "data-exchange" / "jobs.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _read_jobs(limit: int = 50) -> list[dict[str, Any]]:
    path = _jobs_file()
    if not path.exists():
        return []
    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except Exception:
            continue
        if item.get("project_id") == resolved_project_id() and item.get("tenant_id") == resolved_tenant_id():
            items.append(item)
    items.sort(key=lambda x: str(x.get("created_at", "")), reverse=True)
    return items[: max(1, min(int(limit), 200))]


def _append_job(job: dict[str, Any]) -> dict[str, Any]:
    path = _jobs_file()
    record = {
        "id": job.get("id") or f"dx-{uuid4().hex[:12]}",
        "tenant_id": resolved_tenant_id(),
        "project_id": resolved_project_id(),
        "created_at": _utc_now(),
        **job,
    }
    path.open("a", encoding="utf-8").write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    return record


def _serialize_rows(raw: List[dict]) -> List[dict]:
    out = []
    for row in raw:
        r = dict(row)
        for k, v in list(r.items()):
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
        out.append(r)
    return out


def _parse_modules_param(modules: Optional[str]) -> List[str]:
    if not modules or not str(modules).strip():
        return list(_SQL_TABLES) + ["agent_reflections"]
    pick: Set[str] = set()
    for x in str(modules).split(","):
        x = x.strip()
        if x in _SQL_TABLES or x == "agent_reflections":
            pick.add(x)
    if not pick:
        return list(_SQL_TABLES) + ["agent_reflections"]
    return sorted(pick, key=lambda n: (0 if n in _SQL_TABLES else 1, n))


def _module_counts() -> dict[str, int]:
    out: dict[str, int] = {}
    for name in _SQL_TABLES:
        out[name] = len(rows(name, 1000))
    try:
        from sop_manager.routers.db import rows as lance_rows

        out["agent_reflections"] = len(lance_rows("agent_reflections", 1000))
    except Exception:
        out["agent_reflections"] = 0
    return out


@router.get("/summary")
def data_exchange_summary():
    counts = _module_counts()
    modules = [
        {"name": "requirements", "label": "需求", "count": counts.get("requirements", 0), "kind": "sql"},
        {"name": "tasks", "label": "任务", "count": counts.get("tasks", 0), "kind": "sql"},
        {"name": "issues", "label": "问题", "count": counts.get("issues", 0), "kind": "sql"},
        {"name": "sprints", "label": "迭代", "count": counts.get("sprints", 0), "kind": "sql"},
        {"name": "agent_reflections", "label": "Agent 反思", "count": counts.get("agent_reflections", 0), "kind": "vector"},
    ]
    return {
        "ok": True,
        "project_id": resolved_project_id(),
        "modules": modules,
        "total": sum(int(x["count"]) for x in modules),
        "export_url": "/api/v1/data-exchange/export",
        "import_mode": ["merge"],
    }


@router.get("/charts")
def data_exchange_charts(_: User = Depends(current_user)) -> dict[str, Any]:
    counts = _module_counts()
    modules = [
        {"name": "requirements", "label": "需求", "count": counts.get("requirements", 0)},
        {"name": "tasks", "label": "任务", "count": counts.get("tasks", 0)},
        {"name": "issues", "label": "问题", "count": counts.get("issues", 0)},
        {"name": "sprints", "label": "迭代", "count": counts.get("sprints", 0)},
        {"name": "agent_reflections", "label": "Agent 反思", "count": counts.get("agent_reflections", 0)},
    ]
    by_module = [{"name": row["label"], "value": row["count"]} for row in modules if row["count"] > 0]
    sql_total = sum(row["count"] for row in modules if row["name"] != "agent_reflections")
    vector_total = counts.get("agent_reflections", 0)
    by_kind = [
        {"name": "SQL 实体", "value": sql_total},
        {"name": "向量反思", "value": vector_total},
    ]
    return {"ok": True, "by_module": by_module, "by_kind": [x for x in by_kind if x["value"] > 0]}


@router.get("/export")
def export_data(
    modules: Optional[str] = Query(
        None,
        description="逗号分隔：requirements,tasks,issues,sprints,agent_reflections；空则全部",
    ),
):
    """匿名可下载（与历史行为一致）；导入写操作需登录。"""
    names = _parse_modules_param(modules)
    data: Dict[str, Any] = {}
    for name in names:
        if name == "agent_reflections":
            try:
                from sop_manager.routers.db import rows as lance_rows

                data["agent_reflections"] = lance_rows("agent_reflections", 1000)
            except Exception:
                data["agent_reflections"] = []
            continue
        raw = rows(name, 1000)
        if name == "tasks":
            raw = [{k: v for k, v in row.items() if k not in {"assigned_to", "owner"}} for row in raw]
        data[name] = _serialize_rows(raw)
    fname = "export.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


def _parse_dt(val: Any) -> Optional[datetime]:
    if val is None or val == "":
        return None
    if isinstance(val, datetime):
        return val
    s = str(val).replace("Z", "").split("+")[0].strip()
    if len(s) >= 19 and "T" in s:
        try:
            return datetime.fromisoformat(s[:19])
        except ValueError:
            return None
    if len(s) == 10:
        try:
            return datetime.fromisoformat(s + "T00:00:00")
        except ValueError:
            return None
    return None


def _json_col(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return val
    return val


def _cast_value(col, raw: Any) -> Any:
    if raw is None and col.nullable:
        return None
    t = col.type
    if isinstance(t, JSON) or "JSON" in type(t).__name__:
        v = _json_col(raw)
        if v is None:
            return [] if col.name in ("tags", "acceptance_criteria") else {}
        return v
    if isinstance(t, Integer):
        try:
            return int(raw) if raw is not None and raw != "" else 0
        except (TypeError, ValueError):
            return 0
    if isinstance(t, Float):
        try:
            return float(raw) if raw is not None and raw != "" else 0.0
        except (TypeError, ValueError):
            return 0.0
    if col.name in ("created_at", "updated_at", "started_at", "ends_at", "resolved_at"):
        return _parse_dt(raw)
    return raw


def _merge_table(db: Session, name: str, items: List[dict], tenant_id: str, project_id: str) -> int:
    model = _MODEL_MAP.get(name)
    if not model or not isinstance(items, list):
        return 0
    if model is Task:
        from .sql_models import Project
        project = db.get(Project, project_id)
        if not project or project.tenant_id != tenant_id:
            raise HTTPException(422, "Task project scope does not exist")
        items = [validate_task_owner_values(db, project, row) for row in items]
        for row in items:
            if "acceptance_criteria" in row:
                try:
                    row["acceptance_criteria"] = normalize_task_acceptance(row["acceptance_criteria"])
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from exc
    n = 0
    for row in items:
        rid = row.get("id")
        if not rid:
            continue
        existing = (
            db.query(model)
            .filter_by(id=str(rid), tenant_id=tenant_id, project_id=project_id)
            .first()
        )
        if existing:
            for col in model.__table__.columns:
                cname = col.name
                if cname in ("id", "tenant_id", "project_id"):
                    continue
                if cname not in row:
                    continue
                setattr(existing, cname, _cast_value(col, row.get(cname)))
            n += 1
        else:
            kwargs: Dict[str, Any] = {}
            for col in model.__table__.columns:
                cname = col.name
                if cname == "tenant_id":
                    kwargs[cname] = tenant_id
                elif cname == "project_id":
                    kwargs[cname] = project_id
                elif cname in row:
                    kwargs[cname] = _cast_value(col, row.get(cname))
            if "id" not in kwargs and rid:
                kwargs["id"] = str(rid)
            try:
                db.add(model(**kwargs))
                n += 1
            except Exception as e:
                raise HTTPException(400, f"{name} 导入行失败 id={rid}: {e}") from e
    return n


class ImportBody(BaseModel):
    """与 /api/export 返回结构相同：各表为数组。仅处理 SQL 四表；忽略 agent_reflections。"""

    model_config = ConfigDict(extra="ignore")

    mode: str = Field("merge", description="merge：按 id 在当前项目下覆盖或新增")
    requirements: Optional[List[dict]] = None
    tasks: Optional[List[dict]] = None
    issues: Optional[List[dict]] = None
    sprints: Optional[List[dict]] = None


class ExportJobBody(BaseModel):
    modules: Optional[List[str]] = None


@router.post("/preview")
def preview_import(body: ImportBody, _: User = Depends(current_user)):
    if body.mode not in ("merge",):
        raise HTTPException(400, "mode 仅支持 merge")
    out: dict[str, Any] = {"ok": True, "mode": body.mode, "modules": {}, "total": 0, "warnings": []}
    for name in ("sprints", "requirements", "tasks", "issues"):
        items = getattr(body, name, None) or []
        if not isinstance(items, list):
            out["warnings"].append(f"{name} 不是数组，导入时会忽略")
            continue
        ids = [str(x.get("id") or "") for x in items if isinstance(x, dict)]
        unique = len({x for x in ids if x})
        missing = len([x for x in items if isinstance(x, dict) and not x.get("id")])
        duplicates = max(0, len([x for x in ids if x]) - unique)
        out["modules"][name] = {
            "rows": len(items),
            "unique_ids": unique,
            "missing_ids": missing,
            "duplicates": duplicates,
        }
        out["total"] += len(items)
        if missing:
            out["warnings"].append(f"{name} 有 {missing} 行缺少 id，将被跳过")
        if duplicates:
            out["warnings"].append(f"{name} 有 {duplicates} 个重复 id，merge 时后写覆盖")
    return out


@router.get("/jobs")
def data_exchange_jobs(limit: int = Query(30, ge=1, le=200), _: User = Depends(current_user)):
    items = _read_jobs(limit)
    status_counts: dict[str, int] = {}
    for item in items:
        status = str(item.get("status") or "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
    return {"ok": True, "items": items, "total": len(items), "status_counts": status_counts}


@router.post("/export-job")
def create_export_job(body: ExportJobBody, user: User = Depends(current_user)):
    modules = _parse_modules_param(",".join(body.modules or []))
    counts = _module_counts()
    selected_counts = {name: counts.get(name, 0) for name in modules}
    job = _append_job(
        {
            "type": "export",
            "status": "ready",
            "actor": getattr(user, "username", "") or getattr(user, "id", ""),
            "modules": modules,
            "counts": selected_counts,
            "total": sum(int(v) for v in selected_counts.values()),
            "download_url": f"/api/v1/data-exchange/export?modules={','.join(modules)}",
            "finished_at": _utc_now(),
        }
    )
    return {"ok": True, "job": job}


@router.post("/import")
def import_data(
    body: ImportBody,
    user: User = Depends(require_data_hub_import),
    db: Session = Depends(get_session),
):
    if body.mode not in ("merge",):
        raise HTTPException(400, "mode 仅支持 merge")
    tid = user.tenant_id
    pid = resolved_project_id()
    counts: Dict[str, int] = {}
    preview = preview_import(body, user)
    order = ("sprints", "requirements", "tasks", "issues")
    try:
        for name in order:
            items = getattr(body, name, None)
            if not items:
                continue
            counts[name] = _merge_table(db, name, items, tid, pid)
        db.commit()
        job = _append_job(
            {
                "type": "import",
                "status": "completed",
                "actor": getattr(user, "username", "") or getattr(user, "id", ""),
                "mode": body.mode,
                "modules": [name for name in order if getattr(body, name, None)],
                "counts": counts,
                "total": sum(int(v) for v in counts.values()),
                "preview": preview,
                "finished_at": _utc_now(),
            }
        )
        return {"ok": True, "counts": counts, "job": job}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        _append_job(
            {
                "type": "import",
                "status": "failed",
                "actor": getattr(user, "username", "") or getattr(user, "id", ""),
                "mode": body.mode,
                "modules": [name for name in order if getattr(body, name, None)],
                "counts": counts,
                "error": str(e),
                "finished_at": _utc_now(),
            }
        )
        raise HTTPException(500, f"导入失败: {e}") from e
