"""项目数据导出 / 导入（与 db_sql_compat 同一租户与 PROJECT_ID 上下文）"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, Integer, Float
from sqlalchemy.orm import Session

from .auth_sql import User, require_data_hub_import
from .db_sql_compat import rows, _PROJECT_ID
from .sql_models import get_session, Requirement, Task, Sprint, Issue

router = APIRouter(prefix="/api", tags=["data-exchange"])

_SQL_TABLES = ("requirements", "tasks", "issues", "sprints")
_MODEL_MAP = {
    "requirements": Requirement,
    "tasks": Task,
    "issues": Issue,
    "sprints": Sprint,
}


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
                from routers.db import rows as lance_rows

                data["agent_reflections"] = lance_rows("agent_reflections", 1000)
            except Exception:
                data["agent_reflections"] = []
            continue
        raw = rows(name, 1000)
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


@router.post("/import")
def import_data(
    body: ImportBody,
    user: User = Depends(require_data_hub_import),
    db: Session = Depends(get_session),
):
    if body.mode not in ("merge",):
        raise HTTPException(400, "mode 仅支持 merge")
    tid = user.tenant_id
    pid = _PROJECT_ID
    counts: Dict[str, int] = {}
    order = ("sprints", "requirements", "tasks", "issues")
    try:
        for name in order:
            items = getattr(body, name, None)
            if not items:
                continue
            counts[name] = _merge_table(db, name, items, tid, pid)
        db.commit()
        return {"ok": True, "counts": counts}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"导入失败: {e}") from e
