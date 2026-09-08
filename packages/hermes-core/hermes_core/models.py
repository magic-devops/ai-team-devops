from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

RESOURCES = frozenset({"workspaces", "sessions", "runs", "tasks", "requirements", "assets", "devices", "schedules", "approvals", "artifacts"})
PERMISSIONS = frozenset({"read", "write", "execute", "approve", "export", "config"})
ACTIONS = [
    {"id": "read", "permission": "read", "method": "GET", "path": "/api/v2/{resource}"},
    {"id": "create", "permission": "write", "method": "POST", "path": "/api/v2/{resource}"},
    {"id": "update", "permission": "write", "method": "PATCH", "path": "/api/v2/{resource}/{id}"},
    *[{"id": action, "permission": "execute", "method": "POST", "path": "/api/v2/runs/{id}/" + action} for action in ("start", "cancel", "retry", "replay")],
    {"id": "decision", "permission": "approve", "method": "POST", "path": "/api/v2/approvals/{id}/decision"},
    {"id": "export", "permission": "export", "method": "POST", "path": "/api/v2/runs/{id}/export"},
]


@dataclass(frozen=True)
class Principal:
    actor: str
    tenant: str = "local"
    business: str = "personal"
    permissions: frozenset[str] = PERMISSIONS
    workspace_ids: frozenset[str] | None = None

    def scope(self, workspace: str = "") -> dict[str, str]:
        return {"tenant_code": self.tenant, "business_code": self.business, "project_code": workspace, "workspace_id": workspace}


class CoreError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


class Mutation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=1, max_length=160)
    expected_version: int | None = Field(default=None, ge=1)


class RunAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=160)
    expected_version: int = Field(ge=1)
    dry_run: bool = True


class Decision(RunAction):
    decision: Literal["approve", "reject"]
    dry_run: bool = False


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_-]{0,63}$")
    title: str = Field(default="", max_length=200)
    kind: Literal["command", "approval"] = "command"
    argv: list[str] = Field(default_factory=list, max_length=128)
    expected_exit_code: int = Field(default=0, ge=0, le=255)
    timeout_seconds: int = Field(default=60, ge=1, le=3600)


class Envelope(BaseModel):
    ok: bool
    scope: dict[str, str]
    summary: dict[str, Any]
    items: list[dict[str, Any]]
    actions: list[dict[str, str]]
    permissions: list[str]
    audit: dict[str, str]
    trace_id: str
    agent_consumption: dict[str, Any]
    cli: dict[str, Any]


def payload(principal: Principal, workspace: str, items: list[dict], *, trace: str, **extra: Any) -> dict:
    return {"ok": True, "scope": principal.scope(workspace), "summary": {"total": len(items)},
        "items": items, "actions": ACTIONS, "permissions": sorted(principal.permissions),
        "audit": {"actor": principal.actor, "trace_id": trace}, "trace_id": trace,
        "agent_consumption": {"workspace_id": workspace, "resource_ids": [item["id"] for item in items if "id" in item]},
        "cli": {"command": "sop workspace list --json", "workspace_id": workspace}, **extra}
