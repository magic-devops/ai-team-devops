"""SQL 适配层 — 为 requirements.py / tasks.py 提供与 LanceDB 兼容的 rows()/table() 接口
保留原有 UI 状态逻辑不变，只替换底层存储。
"""
from __future__ import annotations
import os, re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from sqlalchemy.orm import Session
from path_config import ai_memory_root, project_path, runtime_dir
from .sql_models import get_session, Requirement, Task, Sprint, Issue

PROJECT_PATH = project_path()
AI_MEMORY_ROOT = ai_memory_root()
RUNTIME_DIR = runtime_dir()
_PROJECT_ID = os.getenv("PROJECT_ID", "default")
_TENANT_ID = os.getenv("TENANT_ID", "t-default")


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
            tenant_id=_TENANT_ID, project_id=_PROJECT_ID
        )

    def to_pandas(self):
        import pandas as pd
        rows = [_to_dict(r) for r in self._base_q().all()]
        return pd.DataFrame(rows) if rows else pd.DataFrame()

    def add(self, rows_list: list):
        for row in rows_list:
            obj = self._model(**{
                k: v for k, v in row.items()
                if hasattr(self._model, k)
            })
            obj.tenant_id = _TENANT_ID
            obj.project_id = _PROJECT_ID
            self._db.add(obj)
        self._db.commit()

    def update(self, where: str, values: dict):
        # where 格式: "id = 'xxx'"
        rid = _parse_id(where)
        if not rid:
            return
        obj = self._base_q().filter_by(id=rid).first()
        if obj:
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


def _parse_id(where: str) -> Optional[str]:
    """从 "id = 'xxx'" 提取 id 值"""
    import re
    m = re.search(r"id\s*=\s*'([^']+)'", where)
    return m.group(1) if m else None


_MODEL_MAP = {
    "requirements": Requirement,
    "tasks": Task,
    "sprints": Sprint,
    "issues": Issue,
}


def table(name: str) -> Optional[_SqlTable]:
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
    objs = db.query(model).filter_by(
        tenant_id=_TENANT_ID, project_id=_PROJECT_ID
    ).limit(limit).all()
    return [_to_dict(o) for o in objs]


def now() -> datetime:
    return datetime.utcnow()
