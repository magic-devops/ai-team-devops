"""共享 LanceDB 工具函数"""
import os
from pathlib import Path
from datetime import datetime
from typing import Any

PROJECT_PATH = Path(os.getenv("PROJECT_PATH", "."))
DB_PATH = PROJECT_PATH / ".ai-memory" / "lancedb"

_db = None
def get_db():
    global _db
    if _db is None:
        try:
            import lancedb
            _db = lancedb.connect(str(DB_PATH))
        except Exception:
            _db = None
    return _db

def table(name: str):
    db = get_db()
    if db is None: return None
    try: return db.open_table(name)
    except Exception: return None

def _json_safe_value(v: Any) -> Any:
    """将 pandas / numpy / Arrow 等转为 FastAPI JSON 可序列化类型。"""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    if isinstance(v, datetime):
        return v.isoformat() + ("Z" if v.tzinfo is None else "")
    try:
        import numpy as np
        if isinstance(v, np.ndarray):
            return v.tolist()
        if isinstance(v, np.generic):
            return v.item()
    except ImportError:
        pass
    if isinstance(v, dict):
        return {k: _json_safe_value(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_json_safe_value(x) for x in v]
    if hasattr(v, "tolist") and callable(getattr(v, "tolist", None)):
        try:
            return v.tolist()
        except Exception:
            pass
    if hasattr(v, "isoformat") and callable(getattr(v, "isoformat", None)):
        try:
            return v.isoformat()
        except Exception:
            pass
    return str(v)

def rows(name: str, limit: int = 200) -> list:
    t = table(name)
    if t is None: return []
    try:
        raw = t.to_pandas().head(limit).to_dict("records")
        return [{k: _json_safe_value(v) for k, v in row.items()} for row in raw]
    except Exception: return []

def now(): return datetime.utcnow()
