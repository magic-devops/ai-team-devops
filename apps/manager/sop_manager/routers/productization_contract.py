from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from sop_manager.path_config import resolved_project_path
from sop_manager.routers.scope_guard import current_scope


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def trace_id() -> str:
    try:
        from opentelemetry import trace  # type: ignore[import-not-found]

        ctx = trace.get_current_span().get_span_context()
        if ctx and getattr(ctx, "is_valid", False):
            return f"{ctx.trace_id:032x}"
    except Exception:
        pass
    return uuid.uuid4().hex


def project_file(rel: str) -> Path:
    return resolved_project_path() / rel


def probe_file(rel: str, label: str, *, required: bool = True, evidence: str = "") -> dict[str, Any]:
    path = project_file(rel)
    ok = path.exists()
    return {
        "id": rel.replace("/", ".").replace("-", "_"),
        "label": label,
        "status": "ready" if ok else "missing" if required else "optional",
        "ok": ok or not required,
        "evidence": evidence or str(path),
        "severity": "P1" if required and not ok else "P3",
    }


def probe_call(pid: str, label: str, fn: Callable[[], Any], *, required: bool = True) -> dict[str, Any]:
    try:
        data = fn()
        size = len(data) if isinstance(data, list) else len(data.keys()) if isinstance(data, dict) else 1
        return {
            "id": pid,
            "label": label,
            "status": "ready",
            "ok": True,
            "evidence": {"size": size},
            "severity": "P3",
        }
    except Exception as exc:
        return {
            "id": pid,
            "label": label,
            "status": "error" if required else "optional",
            "ok": not required,
            "evidence": str(exc),
            "severity": "P1" if required else "P3",
        }


def unified_payload(
    *,
    summary: dict[str, Any],
    items: list[dict[str, Any]],
    actions: list[dict[str, Any]],
    cli: list[dict[str, Any]] | dict[str, Any],
    permissions: list[dict[str, Any]] | dict[str, Any],
    audit: dict[str, Any],
    agent_consumption: dict[str, Any],
    ok: bool | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": bool(summary.get("ok", True) if ok is None else ok),
        "scope": current_scope(),
        "summary": summary,
        "items": items,
        "actions": actions,
        "agent_consumption": agent_consumption,
        "cli": cli,
        "permissions": permissions,
        "audit": {
            "event_time": now_iso(),
            "evidence_mode": "readiness_snapshot",
            "retention": "memory/.sop-runtime scoped JSON/JSONL evidence",
            **audit,
        },
        "trace_id": trace_id(),
    }
    if extra:
        payload.update(extra)
    return payload


def summarize_items(items: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(items)
    ready = sum(1 for item in items if item.get("ok") is True or item.get("status") in {"ready", "healthy", "complete"})
    risk = sum(1 for item in items if item.get("status") in {"missing", "error", "risk", "blocked"})
    watch = max(0, total - ready - risk)
    score = round(ready / max(1, total) * 100, 1)
    return {"total": total, "ready": ready, "watch": watch, "risk": risk, "score": score}
