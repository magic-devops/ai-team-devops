"""健康检查 + Prometheus 指标"""
from __future__ import annotations
import os, time
from datetime import datetime
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from path_config import runtime_paths_summary

router = APIRouter(tags=["health"])

_START_TIME = time.time()
_req_count: dict[str, int] = {}
_err_count: dict[str, int] = {}


def record_request(path: str, status: int):
    _req_count[path] = _req_count.get(path, 0) + 1
    if status >= 400:
        _err_count[path] = _err_count.get(path, 0) + 1


@router.get("/api/health/detail")
def health_detail():
    checks = {}

    # SQL DB
    try:
        from .sql_models import engine
        from sqlalchemy import text
        with engine.connect() as c: c.execute(text("SELECT 1"))
        checks["sql_db"] = {"ok": True, "type": os.getenv("DB_TYPE", "sqlite")}
    except Exception as e:
        checks["sql_db"] = {"ok": False, "error": str(e)}

    # Vector DB
    try:
        from .vector_store import get_vector_store
        store = get_vector_store()
        tables = store.list_tables()
        checks["vector_db"] = {"ok": True, "type": os.getenv("VECTOR_DB_TYPE", "lance"), "tables": len(tables)}
    except Exception as e:
        checks["vector_db"] = {"ok": False, "error": str(e)}

    # 系统资源
    try:
        import psutil
        checks["system"] = {
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_percent": psutil.disk_usage("/").percent,
        }
    except ImportError:
        checks["system"] = {"note": "psutil not installed"}

    all_ok = all(v.get("ok", True) for v in checks.values() if isinstance(v, dict) and "ok" in v)
    return {
        "ok": all_ok,
        "uptime_seconds": int(time.time() - _START_TIME),
        "started_at": datetime.utcfromtimestamp(_START_TIME).isoformat() + "Z",
        "admin_mode": os.getenv("ADMIN_MODE", "single"),
        "checks": checks,
        "paths": runtime_paths_summary(),
    }


@router.get("/api/metrics", response_class=PlainTextResponse)
def metrics():
    lines = [
        "# HELP sop_requests_total Total HTTP requests",
        "# TYPE sop_requests_total counter",
    ]
    for path, count in _req_count.items():
        safe = path.replace('"', '')
        lines.append(f'sop_requests_total{{path="{safe}"}} {count}')
    lines += [
        "# HELP sop_errors_total Total HTTP errors (4xx/5xx)",
        "# TYPE sop_errors_total counter",
    ]
    for path, count in _err_count.items():
        safe = path.replace('"', '')
        lines.append(f'sop_errors_total{{path="{safe}"}} {count}')
    lines.append(f'sop_uptime_seconds {int(time.time() - _START_TIME)}')
    return "\n".join(lines) + "\n"


# ── 日志查看 ──────────────────────────────────────────────────────
from fastapi import Query as _Q
from fastapi.responses import PlainTextResponse as _PT
from pathlib import Path as _P

@router.get("/api/logs", response_class=_PT)
def view_logs(name: str = "sop.app", lines: int = _Q(200, ge=1, le=5000)):
    """读取最近 N 行日志（tail）"""
    log_dir = _P(os.getenv("LOG_DIR", _P(os.getenv("PROJECT_PATH", ".")) / "logs"))
    log_file = log_dir / f"{name}.log"
    if not log_file.exists():
        return f"# 日志文件不存在: {log_file}\n"
    try:
        with open(log_file, "rb") as f:
            f.seek(0, 2); size = f.tell()
            # 从末尾读取最多 2MB
            read_size = min(size, 2 * 1024 * 1024)
            f.seek(size - read_size)
            content = f.read().decode("utf-8", errors="replace")
        tail = content.splitlines()[-lines:]
        return "\n".join(tail) + "\n"
    except Exception as e:
        return f"# 读取失败: {e}\n"


@router.get("/api/logs/list")
def list_logs():
    """列出所有日志文件"""
    log_dir = _P(os.getenv("LOG_DIR", _P(os.getenv("PROJECT_PATH", ".")) / "logs"))
    if not log_dir.exists():
        return {"files": []}
    files = []
    for f in sorted(log_dir.glob("*.log*")):
        try:
            st = f.stat()
            files.append({"name": f.name, "size": st.st_size,
                          "modified": datetime.utcfromtimestamp(st.st_mtime).isoformat() + "Z"})
        except OSError:
            pass
    return {"files": files, "log_dir": str(log_dir)}
