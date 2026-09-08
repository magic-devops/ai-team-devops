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

@dataclass
class Decision:
    decision: Literal["approve", "reject"]
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
class RemoteClaim:
    idempotency_key: str
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
    interval_seconds: int
    nodes: list[Node]
    starts_at: str
    title: str
    dry_run: bool | None = None
    enabled: bool | None = None
    expected_version: int | None = None
    misfire_coalesce: bool | None = None

@dataclass
class TaskDispatch:
    expected_version: int
    idempotency_key: str
    nodes: list[Node]
    base_commit: str | None = None
    dry_run: bool | None = None
    isolation: Literal["workspace", "git_worktree"] | None = None
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
class ValidationError:
    loc: list[str | int]
    msg: str
    type: str
    ctx: dict[str, Any] | None = None
    input: Any | None = None
