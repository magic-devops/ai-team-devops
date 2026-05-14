"""健康检查 + 简易计数指标（与 Prometheus /metrics 分离）。"""
from __future__ import annotations

import os
import time
from datetime import datetime

from fastapi import APIRouter, Query
from fastapi.responses import PlainTextResponse

from sop_manager.path_config import request_scope_active, resolved_ai_memory_root, resolved_project_id, resolved_tenant_id
from sop_manager.path_config import runtime_paths_summary

router = APIRouter(tags=["health"])

_START_TIME = time.time()
APP_STARTED_AT_ISO = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
_req_count: dict[str, int] = {}
_err_count: dict[str, int] = {}


def record_request(path: str, status: int) -> None:
    _req_count[path] = _req_count.get(path, 0) + 1
    if status >= 400:
        _err_count[path] = _err_count.get(path, 0) + 1


@router.get("/api/v1/health")
def health_v1() -> dict[str, object]:
    """统一探活：OpenAPI / 前端 / 负载均衡均使用此路径。"""
    display_version = "2.0"
    notes_val: str | None = None
    updated_at: str | None = None
    rp = resolved_ai_memory_root() / "admin_release.json"
    if rp.is_file():
        try:
            import json

            d = json.loads(rp.read_text(encoding="utf-8"))
            display_version = str(d.get("displayVersion") or d.get("display_version") or display_version)[:64]
            raw_notes = d.get("notes")
            if raw_notes is not None and str(raw_notes).strip():
                notes_val = str(raw_notes)[:800]
            updated_at = d.get("updatedAt") or d.get("updated_at")
            if updated_at is not None:
                updated_at = str(updated_at)[:40]
        except Exception:
            pass
    envv = (os.getenv("ADMIN_RELEASE_VERSION") or "").strip()
    if envv:
        display_version = envv[:64]
    out: dict[str, object] = {
        "ok": True,
        "service": "ai-team-devops-manager",
        "version": display_version,
        "notes": notes_val,
        "updatedAt": updated_at,
        "startedAt": APP_STARTED_AT_ISO,
        "pid": os.getpid(),
        "admin_mode": os.getenv("ADMIN_MODE", "single"),
    }
    if request_scope_active():
        out["scopedTenantId"] = resolved_tenant_id()
        out["scopedProjectId"] = resolved_project_id()
    return out


@router.get("/api/v1/health/detail")
def health_detail() -> dict[str, object]:
    checks: dict[str, object] = {}

    try:
        from .sql_models import engine
        from sqlalchemy import text

        with engine.connect() as c:
            c.execute(text("SELECT 1"))
        checks["sql_db"] = {"ok": True, "type": os.getenv("DB_TYPE", "sqlite")}
    except Exception as e:
        checks["sql_db"] = {"ok": False, "error": str(e)}

    try:
        from .vector_store import get_vector_store

        store = get_vector_store()
        tables = store.list_tables()
        checks["vector_db"] = {"ok": True, "type": os.getenv("VECTOR_DB_TYPE", "lance"), "tables": len(tables)}
    except Exception as e:
        checks["vector_db"] = {"ok": False, "error": str(e)}

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


@router.get("/api/v1/health/counters", response_class=PlainTextResponse)
def health_counters_text() -> str:
    """进程内请求计数（文本）；生产指标请用 GET /metrics。"""
    lines = [
        "# HELP sop_requests_total Total HTTP requests",
        "# TYPE sop_requests_total counter",
    ]
    for path, count in _req_count.items():
        safe = path.replace('"', "")
        lines.append(f'sop_requests_total{{path="{safe}"}} {count}')
    lines += [
        "# HELP sop_errors_total Total HTTP errors (4xx/5xx)",
        "# TYPE sop_errors_total counter",
    ]
    for path, count in _err_count.items():
        safe = path.replace('"', "")
        lines.append(f'sop_errors_total{{path="{safe}"}} {count}')
    lines.append(f"sop_uptime_seconds {int(time.time() - _START_TIME)}")
    return "\n".join(lines) + "\n"


@router.get("/api/v1/logs", response_class=PlainTextResponse)
def view_logs(name: str = "sop.app", lines: int = Query(200, ge=1, le=5000)) -> str:
    from pathlib import Path as _P

    log_dir = _P(os.getenv("LOG_DIR", _P(os.getenv("PROJECT_PATH", ".")) / "logs"))
    log_file = log_dir / f"{name}.log"
    if not log_file.exists():
        return f"# 日志文件不存在: {log_file}\n"
    try:
        with open(log_file, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            read_size = min(size, 2 * 1024 * 1024)
            f.seek(size - read_size)
            content = f.read().decode("utf-8", errors="replace")
        tail = content.splitlines()[-lines:]
        return "\n".join(tail) + "\n"
    except Exception as e:
        return f"# 读取失败: {e}\n"


@router.get("/api/v1/logs/list")
def list_logs() -> dict[str, object]:
    from pathlib import Path as _P

    log_dir = _P(os.getenv("LOG_DIR", _P(os.getenv("PROJECT_PATH", ".")) / "logs"))
    if not log_dir.exists():
        return {"files": []}
    files: list[dict[str, object]] = []
    for f in sorted(log_dir.glob("*.log*")):
        try:
            st = f.stat()
            files.append(
                {
                    "name": f.name,
                    "size": st.st_size,
                    "modified": datetime.utcfromtimestamp(st.st_mtime).isoformat() + "Z",
                }
            )
        except OSError:
            pass
    return {"files": files, "log_dir": str(log_dir)}
