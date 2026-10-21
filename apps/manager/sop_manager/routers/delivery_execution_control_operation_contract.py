"""Bounded control acceptance/status contracts; no process outcome is inferred."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .delivery_execution_runtime_contract import ExecutionRuntimeControl, Identity, Reason

Digest = Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
ControlOperationAction = Literal[
    "execution.start", "execution.retry", "execution.cancel", "execution.approval", "execution.control.close",
]


class ControlOperationClose(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Identity
    control_operation_id: Identity
    request_digest: Digest
    reason: Reason


class ControlOperationAccepted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_operation_id: Identity
    request_digest: Digest


def command_openapi_contracts():
    """Typed per-action contracts for the shared command endpoint.

    The public wire envelope stays shared with other delivery commands. This
    explicit OpenAPI extension makes its action-specific validation discoverable
    without claiming all other command results have the acceptance shape.
    """
    accepted = ControlOperationAccepted.model_json_schema()
    return {"x-delivery-command-contracts": {
        action: {
            "payload": (ControlOperationClose if action == "execution.control.close" else ExecutionRuntimeControl).model_json_schema(),
            "result": accepted,
            "result_semantics": "durable_acceptance",
            "status_path": "/api/v1/delivery/executions/{execution_id}/control-operations/{control_operation_id}",
        }
        for action in (
            "execution.start", "execution.retry", "execution.cancel", "execution.approval", "execution.control.close",
        )
    }}


class ControlOperationError(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=1000)


class ControlOperationLaunch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Identity
    state: Literal["ready", "claimed", "revoked"]
    claimed_at: str | None


class ControlOperationPermissions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    can_close: bool


class ControlOperationSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Identity
    execution_id: Identity
    task_id: Identity
    workspace_id: Identity
    action: ControlOperationAction
    request_digest: Digest
    state: Literal["accepted", "applying", "retry_wait", "blocked", "awaiting_executor", "applied", "closed"]
    revision: int = Field(ge=1, strict=True)
    attempt: int = Field(ge=0, strict=True)
    accepted_at: str
    updated_at: str
    next_attempt_at: str | None
    error: ControlOperationError | None
    run_id: str | None
    run_attempt: int | None = Field(ge=1, strict=True)
    outcome: Literal["applied", "closed", "needs_review"] | None
    launch: ControlOperationLaunch | None
    target_operation_id: str | None
    permissions: ControlOperationPermissions

    @model_validator(mode="after")
    def exact_target_and_launch(self):
        if (self.action == "execution.control.close") != bool(self.target_operation_id):
            raise ValueError("A close operation must identify its exact target")
        if self.launch and (not self.run_id or self.run_attempt is None):
            raise ValueError("A launch ticket requires an exact run and attempt")
        return self


class ControlOperationDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: Identity
    execution_id: Identity
    task_id: Identity
    version: int = Field(ge=0)
    operation: ControlOperationSummary


class ControlOperationPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: Identity
    execution_id: Identity
    task_id: Identity
    version: int = Field(ge=0)
    as_of: str
    items: list[ControlOperationSummary]
    total: int = Field(ge=0)
    next_cursor: str | None
    limit: int = Field(ge=1, le=100)
