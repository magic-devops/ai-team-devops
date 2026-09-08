from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

API_BASE = "/api/hermes/v1"
RESOURCES = frozenset({"workspaces", "sessions", "runs", "tasks", "requirements", "assets", "devices", "schedules", "approvals", "artifacts", "agents", "squads"})
PERMISSIONS = frozenset({"read", "write", "execute", "approve", "export", "config"})
Permission = Literal["read", "write", "execute", "approve", "export", "config"]
RESOURCE_STATUS_OPTIONS = {
    "tasks": ("active", "in_progress", "blocked", "completed", "archived"),
    "requirements": ("active", "draft", "ready", "completed", "archived"),
    "sessions": ("active", "paused", "completed", "archived"),
    "assets": ("active", "archived"),
}
RESOURCE_DATA_FIELDS = {
    "tasks": ("title", "content", "summary", "description", "priority", "assigned_agent", "dev_tool", "acceptance_criteria", "source", "kind"),
    "requirements": ("title", "content", "summary", "description", "priority", "assigned_agent", "dev_tool", "acceptance_criteria", "source", "kind"),
    "sessions": ("title", "content", "summary", "description", "assigned_agent", "dev_tool", "source", "kind", "workspace_root"),
    "assets": ("title", "name", "content", "summary", "description", "source", "kind"),
}


def _action(
    action_id: str,
    permissions: list[Permission],
    method: Literal["GET", "POST", "PATCH", "DELETE"],
    path: str,
    *,
    resource: str = "",
) -> dict[str, Any]:
    action: dict[str, Any] = {"id": action_id, "permissions": permissions, "method": method, "path": path}
    if resource:
        action["resource"] = resource
    return action


_RESOURCE_LABELS = {
    "workspaces": "workspace",
    "sessions": "session",
    "runs": "run",
    "tasks": "task",
    "requirements": "requirement",
    "assets": "asset",
    "devices": "device",
    "agents": "agent",
    "squads": "squad",
}
_CONFIG_RESOURCES = frozenset({"workspaces", "devices", "agents", "squads"})
_CREATABLE_RESOURCES = (
    "workspaces",
    "sessions",
    "runs",
    "tasks",
    "requirements",
    "assets",
    "devices",
    "agents",
    "squads",
)
_PATCHABLE_RESOURCES = ("workspaces", "sessions", "runs", "tasks", "requirements", "assets", "agents", "squads")
ACTIONS = [
    _action("agent.catalog", ["read"], "GET", f"{API_BASE}/agents/catalog"),
    _action(
        "task.agent-dispatch",
        ["write", "execute"],
        "POST",
        f"{API_BASE}/tasks/{{id}}/agent-dispatch",
        resource="tasks",
    ),
    _action(
        "schedule.configure",
        ["config", "execute"],
        "POST",
        f"{API_BASE}/schedules/{{id}}/configure",
        resource="schedules",
    ),
    _action("schedule.trigger", ["execute"], "POST", f"{API_BASE}/schedules/{{id}}/trigger", resource="schedules"),
    _action("schedule.pause", ["config"], "POST", f"{API_BASE}/schedules/{{id}}/pause", resource="schedules"),
    _action(
        "schedule.resume",
        ["config", "execute"],
        "POST",
        f"{API_BASE}/schedules/{{id}}/resume",
        resource="schedules",
    ),
    _action("schedule.history", ["read"], "GET", f"{API_BASE}/schedules/{{id}}/history", resource="schedules"),
    _action(
        "device.pairing",
        ["config", "execute"],
        "POST",
        f"{API_BASE}/devices/{{id}}/pairing",
        resource="devices",
    ),
    _action("device.revoke", ["config"], "POST", f"{API_BASE}/devices/{{id}}/revoke", resource="devices"),
    _action("workspace.repository", ["read"], "GET", f"{API_BASE}/workspaces/{{id}}/repository", resource="workspaces"),
    _action("run.changes", ["read"], "GET", f"{API_BASE}/runs/{{id}}/changes", resource="runs"),
    _action("task.delivery", ["read"], "GET", f"{API_BASE}/tasks/{{id}}/delivery", resource="tasks"),
    _action("task.dispatch", ["write", "execute"], "POST", f"{API_BASE}/tasks/{{id}}/dispatch", resource="tasks"),
    _action("task.review", ["approve"], "POST", f"{API_BASE}/tasks/{{id}}/review", resource="tasks"),
    _action("diagnostics", ["read"], "GET", f"{API_BASE}/system/diagnostics"),
    _action("read", ["read"], "GET", f"{API_BASE}/{{resource}}"),
    *[
        _action(
            f"{_RESOURCE_LABELS[resource]}.create",
            ["config"] if resource in _CONFIG_RESOURCES else ["write"],
            "POST",
            f"{API_BASE}/{resource}",
            resource=resource,
        )
        for resource in _CREATABLE_RESOURCES
    ],
    *[
        _action(
            f"{_RESOURCE_LABELS[resource]}.update",
            ["config"] if resource in _CONFIG_RESOURCES else ["write"],
            "PATCH",
            f"{API_BASE}/{resource}/{{id}}",
            resource=resource,
        )
        for resource in _PATCHABLE_RESOURCES
    ],
    *[
        _action(action, ["execute"], "POST", f"{API_BASE}/runs/{{id}}/" + action, resource="runs")
        for action in ("start", "cancel", "retry", "replay")
    ],
    _action("decision", ["approve"], "POST", f"{API_BASE}/approvals/{{id}}/decision", resource="approvals"),
    _action("export", ["export"], "POST", f"{API_BASE}/runs/{{id}}/export", resource="runs"),
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
    kind: Literal["command", "approval", "agent"] = "command"
    argv: list[str] = Field(default_factory=list, max_length=128)
    expected_exit_code: int = Field(default=0, ge=0, le=255)
    timeout_seconds: int = Field(default=60, ge=1, le=3600)
    agent_id: str = Field(default="", max_length=64)
    prompt: str = Field(default="", max_length=32000)


class TaskDispatch(RunAction):
    nodes: list[Node] = Field(min_length=1, max_length=64)
    isolation: Literal["workspace", "git_worktree"] = "workspace"
    base_commit: str = Field(default="", pattern=r"^(?:[0-9a-f]{40}|[0-9a-f]{64})?$")
    target_device_id: str = Field(default="", max_length=64)


class TaskReview(RunAction):
    run_id: str = Field(min_length=1, max_length=64)
    run_version: int = Field(ge=1)
    decision: Literal["accept", "request_changes"]
    comment: str = Field(min_length=1, max_length=4000)


class Envelope(BaseModel):
    ok: bool
    scope: dict[str, str]
    summary: dict[str, Any]
    items: list[dict[str, Any]]
    actions: list[dict[str, Any]]
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
