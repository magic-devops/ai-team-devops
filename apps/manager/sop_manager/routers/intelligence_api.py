"""智能与知识域聚合 API（治理中心 Hub）。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from sop_manager.routers.memory_api import memory_health
from sop_manager.routers.sync_api import sync_summary
from sop_manager.routers.usage import _usage_alerts, usage_summary_payload
from sop_manager.routers.worker_jobs import worker_health
from sop_manager.routers.sql_models import get_session

router = APIRouter(prefix="/api/v1/intelligence", tags=["intelligence"])


@router.get("/hub")
def intelligence_hub(db: Session = Depends(get_session)) -> dict[str, Any]:
    mem = memory_health()
    worker = worker_health()
    sync = sync_summary(db)
    usage = usage_summary_payload(limit=500)
    sync_modules = sync.get("modules") or []
    module_total = sum(int(m.get("count") or 0) for m in sync_modules)
    open_alerts = len(_usage_alerts(usage))
    worker_sum = worker.get("summary") or {}
    domains = [
        {
            "id": "knowledge",
            "path": "#/intelligence/kb",
            "capability": "ai.intelligence.knowledge",
            "category": "ai-knowledge",
        },
        {
            "id": "rag",
            "path": "#/intelligence/rag",
            "capability": "ai.intelligence.rag",
            "category": "ai-knowledge",
        },
        {
            "id": "memory",
            "path": "#/intelligence/memory",
            "capability": "ai.intelligence.memory",
            "category": "ai-knowledge",
        },
        {
            "id": "rules",
            "path": "#/intelligence/rules",
            "capability": "ai.intelligence.rules",
            "category": "ai-knowledge",
        },
        {
            "id": "specs",
            "path": "#/intelligence/specs",
            "capability": "ai.intelligence.specs",
            "category": "ai-knowledge",
        },
        {
            "id": "design-docs",
            "path": "#/intelligence/design-docs",
            "capability": "ai.intelligence.design-docs",
            "category": "ai-knowledge",
        },
        {
            "id": "datasources",
            "path": "#/intelligence/datasources",
            "capability": "ai.intelligence.datasources",
            "category": "ai-knowledge",
        },
        {
            "id": "worker",
            "path": "#/intelligence/worker",
            "capability": "ai.intelligence.worker",
            "category": "ai-runtime-ops",
        },
        {
            "id": "sync",
            "path": "#/intelligence/sync",
            "capability": "ai.intelligence.sync",
            "category": "ai-runtime-ops",
        },
        {
            "id": "usage",
            "path": "#/intelligence/usage",
            "capability": "ai.intelligence.usage",
            "category": "ai-runtime-ops",
        },
    ]
    return {
        "ok": True,
        "summary": {
            "memory_backend": mem.get("backend"),
            "memory_scoped": mem.get("scoped"),
            "worker_total": worker_sum.get("total", 0),
            "worker_active": worker_sum.get("active", 0),
            "sync_modules": len(sync_modules),
            "sync_records": module_total,
            "usage_events": usage.get("total", 0),
            "usage_alerts_open": open_alerts,
            "redis_worker": worker.get("redis"),
        },
        "stack_layers": [
            {"id": "knowledge", "name": "Knowledge", "maturity": 86},
            {"id": "memory", "name": "Memory", "maturity": 86},
            {"id": "rules", "name": "Rules & Distill", "maturity": 84},
            {"id": "runtime", "name": "Worker & Sync", "maturity": 82},
        ],
        "domains": domains,
    }
