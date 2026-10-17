"""SQL 适配层 — 为 requirements.py / tasks.py 提供与 LanceDB 兼容的 rows()/table() 接口。

租户 / 项目 ID 来自 path_config.resolved_*（JWT + X-Project-Id 中间件注入，或回退环境变量）。
"""
from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy.orm import Session

from sop_manager.path_config import resolved_project_id, resolved_tenant_id

from .sql_models import DeliveryWorkspace, Issue, Requirement, Sprint, Task, get_session


def _to_dict(obj) -> dict:
    d = {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat() + "Z"
    return d


class _SqlTable:
    """模拟 LanceDB table 接口"""

    def __init__(self, model, db: Session):
        self._model = model
        self._db = db

    def _base_q(self):
        return self._db.query(self._model).filter_by(
            tenant_id=resolved_tenant_id(), project_id=resolved_project_id()
        )

    def to_pandas(self):
        import pandas as pd

        rows = [_to_dict(r) for r in self._base_q().all()]
        return pd.DataFrame(rows) if rows else pd.DataFrame()

    def add(self, rows_list: list):
        tid = resolved_tenant_id()
        pid = resolved_project_id()
        for row in rows_list:
            obj = self._model(**{k: v for k, v in row.items() if hasattr(self._model, k)})
            obj.tenant_id = tid
            obj.project_id = pid
            self._db.add(obj)
        self._db.commit()

    def update(self, where: str, values: dict):
        rid = _parse_id(where)
        if not rid:
            return
        obj = self._base_q().filter_by(id=rid).first()
        if obj:
            if self._model is Task and values.get("status") in {"in_progress", "completed"}:
                from fastapi import HTTPException

                from .delivery_plan import require_dependencies
                from .delivery_service import reconcile
                from .sql_models import Project

                workflow = self._db.get(DeliveryWorkspace, obj.project_id)
                project = self._db.get(Project, obj.project_id)
                if workflow:
                    state = reconcile(self._db, project, workflow.data)
                    require_dependencies(self._db, project, state, rid)
                if values.get("status") == "completed" and workflow and any(e["task_id"] == rid for e in workflow.data.get("executions", [])):
                    raise HTTPException(409, "Complete managed executions through delivery evidence review")
            for k, v in values.items():
                if hasattr(obj, k):
                    setattr(obj, k, v)
            self._db.commit()

    def delete(self, where: str):
        rid = _parse_id(where)
        if not rid:
            return
        obj = self._base_q().filter_by(id=rid).first()
        if obj:
            self._db.delete(obj)
            self._db.commit()


def _parse_id(where: str) -> str | None:
    m = re.search(r"id\s*=\s*'([^']+)'", where)
    return m.group(1) if m else None


_MODEL_MAP = {
    "requirements": Requirement,
    "tasks": Task,
    "sprints": Sprint,
    "issues": Issue,
}


def table(name: str) -> _SqlTable | None:
    model = _MODEL_MAP.get(name)
    if model is None:
        return None
    db = next(get_session())
    return _SqlTable(model, db)


def rows(name: str, limit: int = 500) -> list:
    model = _MODEL_MAP.get(name)
    if model is None:
        return []
    db = next(get_session())
    objs = (
        db.query(model)
        .filter_by(tenant_id=resolved_tenant_id(), project_id=resolved_project_id())
        .limit(limit)
        .all()
    )
    return [_to_dict(o) for o in objs]


def now() -> datetime:
    return datetime.utcnow()
