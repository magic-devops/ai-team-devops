from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


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
    argv: list[str] | None = None
    expected_exit_code: int | None = None
    kind: Literal["command", "approval"] | None = None
    timeout_seconds: int | None = None
    title: str | None = None

@dataclass
class RunAction:
    expected_version: int
    idempotency_key: str
    dry_run: bool | None = None

@dataclass
class TaskDispatch:
    expected_version: int
    idempotency_key: str
    nodes: list[Node]
    dry_run: bool | None = None

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
