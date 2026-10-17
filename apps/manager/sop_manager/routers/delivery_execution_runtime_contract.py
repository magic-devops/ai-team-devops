"""Strict contracts for scoped runtime evidence and immutable operator intent."""

from typing import Annotated, Literal

from pydantic import AfterValidator, Field, StringConstraints, model_validator

from .delivery_execution_contract import ExecutionInput
from .delivery_issue_contract import human_text

Identity = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=100,
                                            pattern=r"^[^\s\x00-\x1f\x7f]+$")]
Reason = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=2000),
                   AfterValidator(human_text)]
ControlAction = Literal["execution.start", "execution.retry", "execution.cancel", "execution.approval"]


class ExecutionRuntimeControl(ExecutionInput):
    id: Identity
    run_id: str = Field(max_length=64, strict=True)
    run_version: int = Field(ge=0, strict=True)
    attempt: int = Field(ge=1, strict=True)
    control_basis: str = Field(pattern=r"^[0-9a-f]{64}$", strict=True)
    reason: Reason
    approval_id: Identity | None = None
    approval_version: int | None = Field(default=None, ge=1, strict=True)
    decision: Literal["approve", "reject"] | None = None

    @model_validator(mode="after")
    def fixed_identity(self):
        if bool(self.run_id) != bool(self.run_version):
            raise ValueError("A run identity and its observed version must be fixed together")
        approval = (self.approval_id is not None, self.approval_version is not None, self.decision is not None)
        if any(approval) and not all(approval):
            raise ValueError("Fix the approval, version and decision together")
        return self


class ExecutionControlPreviewInput(ExecutionInput):
    id: Identity
    action: ControlAction
    reason: Reason
    approval_id: Identity | None = None
    decision: Literal["approve", "reject"] | None = None

    @model_validator(mode="after")
    def approval_identity(self):
        if self.action == "execution.approval":
            if self.approval_id is None or self.decision is None:
                raise ValueError("Choose the exact approval and decision")
        elif self.approval_id is not None or self.decision is not None:
            raise ValueError("Approval fields require an approval operation")
        return self


class ExecutionControlReason(ExecutionInput):
    code: str
    message: str


class ExecutionControlCapability(ExecutionInput):
    allowed: bool
    reasons: list[ExecutionControlReason]


class ExecutionRuntimeControls(ExecutionInput):
    start: ExecutionControlCapability
    retry: ExecutionControlCapability
    cancel: ExecutionControlCapability
    approval: ExecutionControlCapability
    approval_reject: ExecutionControlCapability


class ExecutionStopFact(ExecutionInput):
    id: str
    state: Literal["requested", "confirmed", "unknown", "not_started"]
    node_id: str | None
    attempt: int
    reason: str
    requested_at: str | None
    confirmed_at: str | None
    evidence: str


class ExecutionRuntimeApproval(ExecutionInput):
    id: str
    version: int
    node_id: str
    attempt: int
    status: str
    title: str


class ExecutionRuntimeNode(ExecutionInput):
    id: str
    title: str
    kind: Literal["command", "approval", "agent"]
    is_test: bool
    status: Literal["pending", "running", "passed", "failed", "skipped"]
    available_attempts: list[int]
    result_attempt: int | None
    reused_result: bool


class ExecutionRuntimeResponse(ExecutionInput):
    project_id: str
    execution_id: str
    run_id: str
    run_version: int
    attempt: int
    status: str
    runtime_status: str | None
    stale: bool
    active_node_id: str | None
    observed_at: str
    recovery_requires_review: bool
    stop: ExecutionStopFact | None
    approval: ExecutionRuntimeApproval | None
    nodes: list[ExecutionRuntimeNode]
    controls: ExecutionRuntimeControls


class ExecutionOutputChunk(ExecutionInput):
    seq: int
    source_seq: int
    node_id: str
    attempt: int
    stream: Literal["stdout", "stderr"]
    text: Annotated[str, StringConstraints(strip_whitespace=False)]
    observed_at: str
    truncated: bool


class ExecutionOutputGap(ExecutionInput):
    after_seq: int
    before_seq: int | None
    reason: str


class ExecutionNodeOutputResponse(ExecutionInput):
    project_id: str
    execution_id: str
    run_id: str
    node_id: str
    attempt: int
    stream: Literal["stdout", "stderr"]
    source: Literal["live_capture", "completed_node_result", "unavailable"]
    availability: Literal["available", "missing", "restricted", "unavailable", "pending"]
    available_attempts: list[int]
    chunks: list[ExecutionOutputChunk]
    next_cursor: str | None
    more: bool
    complete: bool
    truncated: bool
    sanitized: bool
    gaps: list[ExecutionOutputGap]


class ExecutionControlPreviewResponse(ExecutionInput):
    project_id: str
    execution_id: str
    version: int
    action: ControlAction
    allowed: bool
    reasons: list[ExecutionControlReason]
    payload: ExecutionRuntimeControl
