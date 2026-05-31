"""Three-code scope helpers for file-backed router stores."""
from __future__ import annotations

from typing import Any, Iterable

from sop_manager.path_config import (
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
    resolved_tenant_id,
)


SCOPE_FIELDS = ("tenant_id", "tenant_code", "business_code", "project_id", "project_code")


def current_scope() -> dict[str, str]:
    return {
        "tenant_id": resolved_tenant_id(),
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
    }


def attach_scope(row: dict[str, Any], *, overwrite: bool = False) -> dict[str, Any]:
    scope = current_scope()
    for key, value in scope.items():
        if overwrite or not str(row.get(key) or "").strip():
            row[key] = value
    nested = row.get("scope") if isinstance(row.get("scope"), dict) else {}
    if overwrite or not nested:
        row["scope"] = dict(scope)
    else:
        for key, value in scope.items():
            nested.setdefault(key, value)
        row["scope"] = nested
    return row


def scope_matches(row: dict[str, Any], *, require_business: bool = True) -> bool:
    scope = current_scope()
    nested = row.get("scope") if isinstance(row.get("scope"), dict) else {}
    required = ("tenant_id", "tenant_code", "project_id", "project_code")
    if require_business:
        required = (*required, "business_code")
    for key in required:
        expected = str(scope.get(key) or "")
        actual = str(row.get(key) or nested.get(key) or "")
        if actual != expected:
            return False
    return True


def filter_scope(rows: Iterable[dict[str, Any]], *, require_business: bool = True) -> list[dict[str, Any]]:
    return [row for row in rows if scope_matches(row, require_business=require_business)]
