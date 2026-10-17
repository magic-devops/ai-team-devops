"""Typed execution proposals and observations; runtime remains the evidence authority."""

from typing import Annotated, Any, Literal

from hermes_core.models import Node
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .delivery_team_runtime_contract import ExecutorSnapshot


class ExecutionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ExecutionQueue(ExecutionInput):
    task_id: str = Field(min_length=1, max_length=64)
    task_basis: str = Field(pattern=r"^[0-9a-f]{64}$")
    workspace_id: str = Field(min_length=1, max_length=64)
    target_kind: Literal["local", "device"]
    target_basis: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_device_id: str = Field(default="", max_length=64)
    agent_id: str = Field(default="", max_length=64)
    agent_version: int = Field(default=1, ge=1, strict=True)
    executor_member_id: Annotated[str, StringConstraints(
        strict=True, strip_whitespace=False, max_length=100,
        pattern=r"^(?:|[^\s\x00-\x1f\x7f]+)$",
    )] = ""
    executor_binding_basis: Annotated[str, StringConstraints(
        strict=True, strip_whitespace=False, pattern=r"^(?:|[0-9a-f]{64})$",
    )] = ""
    nodes: list[Node] = Field(default_factory=list, max_length=32)
    test_nodes: list[Node] = Field(default_factory=list, max_length=32)
    test_node_ids: list[str] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def plan_valid(self):
        if bool(self.executor_member_id) != bool(self.executor_binding_basis):
            raise ValueError("Choose an executor member and its fixed binding basis together")
        if self.executor_member_id and not self.agent_id:
            raise ValueError("A team executor requires an explicit Agent configuration")
        if (self.target_kind == "device") != bool(self.target_device_id):
            raise ValueError("Choose an explicit local target or a device ID")
        if bool(self.agent_id) == bool(self.nodes):
            raise ValueError("Choose an agent or a command plan")
        if self.agent_id and self.test_node_ids:
            raise ValueError("Agent test IDs are derived from the explicit test nodes")
        if not self.agent_id and self.test_nodes:
            raise ValueError("Post-agent tests require an agent plan")
        selected = self.test_nodes if self.agent_id else self.nodes
        if any(
            n.kind != "command"
            or not n.argv
            or n.agent_id
            or n.prompt
            or any(not arg or "\x00" in arg for arg in n.argv)
            for n in selected
        ):
            raise ValueError("Command tests require executable command nodes only")
        ids = [n.id for n in selected]
        if len(set(ids)) != len(ids) or len(set(self.test_node_ids)) != len(self.test_node_ids):
            raise ValueError("Plan and test IDs must be unique")
        if not set(self.test_node_ids).issubset(ids):
            raise ValueError("Test IDs must reference command plan nodes")
        if self.agent_id and any(node_id.startswith("agent_") for node_id in ids):
            raise ValueError("Post-agent test IDs must not use the reserved agent_ prefix")
        return self


class ExecutionProvider(ExecutionInput):
    id: Literal["codex", "claude", "opencode"]
    executable_present: bool
    version: str | None
    auth: Literal["unknown"]


class ExecutionPolicy(ExecutionInput):
    allowed_runtimes: list[Literal["command", "agent"]]
    allowed_providers: list[Literal["codex", "claude", "opencode"]]


class ExecutionTarget(ExecutionInput):
    id: str
    kind: Literal["local", "device"]
    name: str
    version: int
    basis: str
    paired: bool | None
    online: bool | None
    last_seen_at: str | None
    expires_at: str | None
    worker_id: str | None
    capability_digest: str
    runtime_capabilities: list[Literal["command", "agent"]]
    providers: list[ExecutionProvider]
    policy: ExecutionPolicy
    can_execute: bool
    reason_codes: list[str]


class ExecutionAgent(ExecutionInput):
    id: str
    version: int
    title: str
    provider: Literal["codex", "claude", "opencode"]


class ExecutionWorkspace(ExecutionInput):
    id: str
    name: str
    version: int
    agents: list[ExecutionAgent]
    local: ExecutionTarget
    devices: list[ExecutionTarget]


class ExecutionTargetsResponse(ExecutionInput):
    project_id: str
    as_of: str
    runtime_configured: bool
    can_execute: bool
    can_configure_policy: bool
    workspaces: list[ExecutionWorkspace]


class ExecutionRequirementSnapshot(ExecutionInput):
    id: str
    title: str
    description: str
    revision: int
    acceptance_criteria: list[str]
    criteria_indices: list[int]


class ExecutionOwnerSnapshot(ExecutionInput):
    id: str
    name: str | None
    kind: Literal["human", "agent", "tool"] | None
    active: bool
    available: bool
    reasons: list[dict[str, str]]


class ExecutionSnapshot(ExecutionInput):
    task_id: str
    title: str
    description: str
    assigned_to: str
    task_acceptance_criteria: list[str]
    acceptance_criteria: list[str]
    owner: ExecutionOwnerSnapshot | None
    dependency_basis: dict[str, str]
    requirement: ExecutionRequirementSnapshot | None


class ExecutionPreviewResponse(ExecutionInput):
    project_id: str
    version: int
    task_basis: str
    plan_basis: str
    workspace_id: str
    workspace_version: int
    snapshot: ExecutionSnapshot
    target: ExecutionTarget
    agent: ExecutionAgent | None
    executor_snapshot: ExecutorSnapshot | None
    nodes: list[Node]
    test_node_ids: list[str]


class ExecutionAgentEvidence(ExecutionInput):
    provider: str
    agent_id: str
    profile_version: int | None
    completed: bool
    usage: dict[str, Any] | None
    usage_truncated: bool
    message: str
    error: str
    event_count: int


class ExecutionNodeResult(ExecutionInput):
    succeeded: bool | None
    exit_code: int | None
    expected_exit_code: int | None
    error: str | None
    stdout: str | None
    stderr: str | None
    duration_ms: int | None
    attempt: int | None
    skipped: bool
    stdout_truncated: bool
    stderr_truncated: bool
    output_source: Literal["completed_node_result"]
    agent: ExecutionAgentEvidence | None


class ExecutionNodeObservation(ExecutionInput):
    id: str
    title: str
    kind: Literal["command", "approval", "agent"]
    is_test: bool
    status: Literal["pending", "running", "passed", "failed", "skipped"]
    result: ExecutionNodeResult | None


class ExecutionObservationEvent(ExecutionInput):
    id: str
    seq: int
    at: str
    type: str
    node_id: str | None
    status: str | None
    message: str
    attempt: int | None
    result: ExecutionNodeResult | None


class ExecutionTestSummary(ExecutionInput):
    total: int
    passed: int
    failed: int
    pending: int
    status: Literal["not_configured", "pending", "passed", "failed"]


class ExecutionPermissions(ExecutionInput):
    can_start: bool
    can_cancel: bool
    can_review: bool
    can_sync: bool


class ExecutionObservationsResponse(ExecutionInput):
    project_id: str
    execution_id: str
    run_id: str
    run_version: int
    attempt: int
    status: str
    stale: bool
    executor_snapshot: ExecutorSnapshot | None
    executor_binding_invalidated: bool
    observed_at: str
    events: list[ExecutionObservationEvent]
    next_cursor: str | None
    more: bool
    nodes: list[ExecutionNodeObservation]
    tests: ExecutionTestSummary
    permissions: ExecutionPermissions
    log_streaming: Literal[False] = False
