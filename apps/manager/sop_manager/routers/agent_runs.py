"""Retired mutable Agent runs; private trace reads remain explicitly unverified."""
import json

from sop_manager.path_config import resolved_ai_memory_root
from .scope_guard import scope_matches

from fastapi import APIRouter, HTTPException

METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]


def _retired():
    raise HTTPException(410, {"code": "legacy_agent_execution_retired",
        "message": "Use formal delivery work orders for real Tasks; legacy file execution writes and reported health are retired.",
        "replacement": "/api/v1/delivery/work-orders"})


router = APIRouter(prefix="/api/v1/agent-runs", tags=["legacy-agent-execution"])


def _runs_dir():
    return resolved_ai_memory_root() / "agent_runs"


def _all_runs():
    """Existing trace diagnostics only; these records never supply delivery proof."""
    rows, size = [], 0
    for number, path in enumerate(_runs_dir().glob("run_*.json"), 1):
        if number > 1000 or path.stat().st_size > 1024 * 1024:
            raise HTTPException(413, "Legacy trace files exceed their explicit read budget")
        raw = path.read_bytes(); size += len(raw)
        if size > 16 * 1024 * 1024:
            raise HTTPException(413, "Legacy trace files exceed their explicit read budget")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            continue
        if isinstance(value, dict) and scope_matches(value, require_business=True):
            rows.append({**value, "legacy_unverified": True, "evidence_source": "legacy_reported"})
    return sorted(rows, key=lambda row: row.get("started_at", ""), reverse=True)


@router.api_route("", methods=METHODS)
@router.api_route("/{legacy_path:path}", methods=METHODS)
def retired_agent_runs(legacy_path: str = ""):
    return _retired()
