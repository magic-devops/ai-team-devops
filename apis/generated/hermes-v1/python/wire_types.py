from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


@dataclass
class AgentDispatch:
    expected_version: int
    idempotency_key: str
    target_version: int
    agent_id: str | None = None
    base_commit: str | None = None
    dry_run: bool | None = None
    isolation: Literal["workspace", "git_worktree"] | None = None
    prompt: str | None = None
    squad_id: str | None = None
    target_basis: str | None = None
    target_device_id: str | None = None
    test_nodes: list[Node] | None = None

@dataclass
class ChannelConfigure:
    idempotency_key: str
    members: list[str]
    title: str
    archived: bool | None = None
    description: str | None = None
    dry_run: bool | None = None
    expected_version: int | None = None

@dataclass
class CollaborationAction:
    idempotency_key: str
    dry_run: bool | None = None
    expected_version: int | None = None

@dataclass
class Decision:
    decision: Literal["approve", "reject"]
    expected_version: int
    idempotency_key: str
    dry_run: bool | None = None

@dataclass
class DeviceRuntimePolicy:
    allowed_providers: list[Literal["codex", "claude", "opencode"]]
    allowed_runtimes: list[Literal["command", "agent"]]
    expected_version: int
    idempotency_key: str
    dry_run: bool | None = None

@dataclass
class Envelope:
    actions: list[dict[str, Any]]
    agent_consumption: dict[str, Any]
    audit: dict[str, Any]
    cli: dict[str, Any]
    items: list[dict[str, Any]]
    ok: bool
    permissions: list[str]
    scope: dict[str, Any]
    summary: dict[str, Any]
    trace_id: str

@dataclass
class HTTPValidationError:
    detail: list[ValidationError] | None = None

@dataclass
class MarkRead:
    channel_id: str
    cursor: int
    idempotency_key: str
    dry_run: bool | None = None
    expected_version: int | None = None
    thread_id: str | None = None

@dataclass
class MessageEdit:
    body: str
    idempotency_key: str
    dry_run: bool | None = None
    expected_version: int | None = None
    mentions: list[str] | None = None

@dataclass
class MessageSend:
    body: str
    channel_id: str
    idempotency_key: str
    thread_id: str
    dry_run: bool | None = None
    expected_version: int | None = None
    mentions: list[str] | None = None
    parent_id: str | None = None
    recipients: list[str] | None = None

@dataclass
class Mutation:
    idempotency_key: str
    data: dict[str, Any] | None = None
    expected_version: int | None = None

@dataclass
class Node:
    id: str
    agent_id: str | None = None
    argv: list[str] | None = None
    expected_exit_code: int | None = None
    kind: Literal["command", "approval", "agent"] | None = None
    prompt: str | None = None
    timeout_seconds: int | None = None
    title: str | None = None

@dataclass
class PairRedeem:
    device_id: str
    secret: str

@dataclass
class ProviderCapability:
    executable_present: bool
    id: Literal["codex", "claude", "opencode"]
    auth: str | None = None
    version: str | None = None

@dataclass
class RemoteClaim:
    idempotency_key: str
    runtime_capabilities: list[str] | None = None
    worker_id: str | None = None
    worker_version: str | None = None

@dataclass
class RemoteHeartbeat:
    idempotency_key: str
    owner: str
    run_id: str

@dataclass
class RemoteResult:
    idempotency_key: str
    node_id: str
    owner: str
    run_id: str
    result: dict[str, Any] | None = None

@dataclass
class RunAction:
    expected_version: int
    idempotency_key: str
    dry_run: bool | None = None

@dataclass
class ScheduleConfigure:
    idempotency_key: str
    nodes: list[Node]
    title: str
    trigger: ScheduleTrigger
    dry_run: bool | None = None
    enabled: bool | None = None
    expected_version: int | None = None
    misfire_coalesce: bool | None = None

@dataclass
class ScheduleTrigger:
    cron_expression: str | None = None
    interval_seconds: int | None = None
    max_body_bytes: int | None = None
    secret_ref: str | None = None
    starts_at: str | None = None
    timezone: str | None = None
    type: Literal["interval", "cron", "webhook"] | None = None

@dataclass
class TaskDispatch:
    expected_version: int
    idempotency_key: str
    nodes: list[Node]
    base_commit: str | None = None
    dry_run: bool | None = None
    isolation: Literal["workspace", "git_worktree"] | None = None
    target_basis: str | None = None
    target_device_id: str | None = None

@dataclass
class TaskReview:
    comment: str
    decision: Literal["accept", "request_changes"]
    expected_version: int
    idempotency_key: str
    run_id: str
    run_version: int
    dry_run: bool | None = None

@dataclass
class ThreadCreate:
    channel_id: str
    idempotency_key: str
    title: str
    body: str | None = None
    dry_run: bool | None = None
    expected_version: int | None = None
    mentions: list[str] | None = None
    recipients: list[str] | None = None

@dataclass
class ValidationError:
    loc: list[str | int]
    msg: str
    type: str
    ctx: dict[str, Any] | None = None
    input: Any | None = None

@dataclass
class WorkerPresence:
    idempotency_key: str
    providers: list[ProviderCapability]
    runtime_capabilities: list[Literal["command", "agent"]]
    worker_id: str
    worker_version: str
