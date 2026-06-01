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
            "id": "knowledge_assets",
            "path": "#/intelligence/kb",
            "capability": "ai.intelligence.knowledge",
            "category": "ai-knowledge",
            "links": [
                {"id": "knowledge", "path": "#/intelligence/kb", "capability": "ai.intelligence.knowledge"},
            ],
        },
        {
            "id": "retrieval_memory",
            "path": "#/intelligence/rag",
            "capability": "ai.intelligence.rag",
            "category": "ai-knowledge",
            "links": [
                {"id": "rag", "path": "#/intelligence/rag", "capability": "ai.intelligence.rag"},
                {"id": "memory", "path": "#/intelligence/memory", "capability": "ai.intelligence.memory"},
            ],
        },
        {
            "id": "rules_distill",
            "path": "#/intelligence/rules",
            "capability": "ai.intelligence.rules",
            "category": "ai-knowledge",
            "links": [
                {"id": "rules", "path": "#/intelligence/rules", "capability": "ai.intelligence.rules"},
                {"id": "distill", "path": "#/intelligence/distill", "capability": "ai.intelligence.distill"},
            ],
        },
        {
            "id": "runtime_ops",
            "path": "#/intelligence/worker",
            "capability": "ai.intelligence.worker",
            "category": "ai-runtime-ops",
            "links": [
                {"id": "worker", "path": "#/intelligence/worker", "capability": "ai.intelligence.worker"},
                {"id": "sync", "path": "#/intelligence/sync", "capability": "ai.intelligence.sync"},
                {"id": "events", "path": "#/intelligence/events", "capability": "ai.intelligence.events"},
                {"id": "usage", "path": "#/intelligence/usage", "capability": "ai.intelligence.usage"},
            ],
        },
        {
            "id": "spec_designs",
            "path": "#/intelligence/specs",
            "capability": "ai.intelligence.specs",
            "category": "ai-knowledge",
            "links": [
                {"id": "specs", "path": "#/intelligence/specs", "capability": "ai.intelligence.specs"},
                {"id": "design-docs", "path": "#/intelligence/design-docs", "capability": "ai.intelligence.design-docs"},
            ],
        },
        {
            "id": "data_context",
            "path": "#/data/sources",
            "capability": "data.sources",
            "category": "data-source-governance",
            "links": [
                {"id": "datasources", "path": "#/data/sources", "capability": "data.sources"},
                {"id": "datasources-security", "path": "#/data/sources/security", "capability": "data.sources.security"},
            ],
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
            {"id": "knowledge_assets", "name": "Knowledge assets", "maturity": 88},
            {"id": "retrieval_memory", "name": "Retrieval & Memory", "maturity": 88},
            {"id": "rules_distill", "name": "Rules & Distill", "maturity": 86},
            {"id": "runtime_ops", "name": "Runtime Ops", "maturity": 84},
            {"id": "spec_designs", "name": "Specs & Designs", "maturity": 86},
            {"id": "data_context", "name": "Data Context", "maturity": 90},
        ],
        "domains": domains,
    }
