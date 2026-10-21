"""Retired file-backed A2A surface; unique historical files remain untouched."""
from fastapi import APIRouter, HTTPException

METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]


def _retired():
    raise HTTPException(410, {"code": "legacy_agent_execution_retired",
        "message": "Use formal delivery work orders for real Tasks; legacy file execution writes and reported health are retired.",
        "replacement": "/api/v1/delivery/work-orders"})


router = APIRouter(prefix="/api/v1/a2a", tags=["legacy-agent-execution"])


@router.api_route("", methods=METHODS)
@router.api_route("/{legacy_path:path}", methods=METHODS)
def retired_a2a(legacy_path: str = ""):
    return _retired()
