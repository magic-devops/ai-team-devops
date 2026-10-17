"""Strict inputs and read projections for managed delivery deployments."""

import re
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from hermes_core.execution_targets import ExecutionTarget
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .delivery_ci_contract import HexDigest, safe_https
from .delivery_release_contract import ReleaseActor, ReleaseSnapshot

Identity = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Text = Annotated[str, StringConstraints(min_length=1, max_length=2000)]
TOKENS = frozenset({"artifact_path", "artifact_sha256", "commit_sha", "operation_id", "traffic_percent"})
DeploymentStatus = Literal[
    "pending_dispatch",
    "planned",
    "queued",
    "running",
    "awaiting_promotion",
    "verified",
    "failed",
    "unknown",
    "cancelled",
    "rolled_back",
]


class DeploymentContract(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    @field_validator("*", mode="after")
    @classmethod
    def safe_text(cls, value, info):
        if isinstance(value, str):
            value.encode("utf-8")
            human = info.field_name in {"reason", "comment", "message"}
            if any(
                (ord(char) < 32 and not (human and char in "\n\r\t")) or ord(char) == 127 for char in value
            ):
                raise ValueError("Control characters are not allowed")
        return value


class DeploymentEnvironmentDefinition(DeploymentContract):
    workspace_id: Identity
    target_device_id: str = Field("", max_length=200)
    runner_argv: list[str] = Field(min_length=1, max_length=64)
    apply_argv: list[str] = Field(min_length=1, max_length=128)
    probe_argv: list[str] = Field(min_length=1, max_length=128)
    artifact_origins: list[str] = Field(min_length=1, max_length=8)
    max_artifact_bytes: int = Field(268435456, ge=1, le=268435456)
    timeout_seconds: int = Field(120, ge=3, le=3540)
    observation_seconds: int = Field(10, ge=1, le=600)
    min_samples: int = Field(2, ge=1, le=100)
    traffic_steps: list[Annotated[int, Field(ge=1, le=100)]] = Field(
        default_factory=lambda: [5, 25, 100], min_length=1, max_length=10
    )

    @field_validator("runner_argv", "apply_argv", "probe_argv")
    @classmethod
    def bounded_argv(cls, value, info):
        if sum(len(arg.encode("utf-8")) + 3 for arg in value) > 12000:
            raise ValueError("Command arguments exceed the execution limit")
        for arg in value:
            if not arg or any(ord(char) < 32 or ord(char) == 127 for char in arg):
                raise ValueError("Arguments must be nonempty and contain no control characters")
            tokens = re.findall(r"\{([^{}]*)\}", arg)
            if (
                any(token not in TOKENS for token in tokens)
                or re.sub(r"\{[^{}]*\}", "", arg).count("{")
                or re.sub(r"\{[^{}]*\}", "", arg).count("}")
            ):
                raise ValueError("Only documented deployment argument tokens are allowed")
            if info.field_name == "runner_argv" and tokens:
                raise ValueError("The installed runner prefix must be fixed")
        return value

    @field_validator("artifact_origins")
    @classmethod
    def exact_origins(cls, value):
        for origin in value:
            safe_https(origin)
            parsed = urlsplit(origin)
            if parsed.path or origin != f"https://{parsed.netloc}":
                raise ValueError("Artifact sources must be exact HTTPS origins")
        if len(set(value)) != len(value):
            raise ValueError("Artifact origins must be distinct")
        return value

    @model_validator(mode="after")
    def ordered_observation(self):
        if self.traffic_steps != sorted(set(self.traffic_steps)) or self.traffic_steps[-1] != 100:
            raise ValueError("Traffic steps must strictly increase and finish at 100")
        if self.timeout_seconds <= self.observation_seconds + 1:
            raise ValueError("Timeout must cover the entire observation window")
        return self


class DeploymentEnvironmentSave(DeploymentEnvironmentDefinition):
    id: str = Field("", max_length=200)
    name: str = Field(min_length=1, max_length=80)
    active: bool = True


class DeploymentPreviewInput(DeploymentContract):
    candidate_id: str = Field("", max_length=200)
    environment_id: str = Field("", max_length=200)
    rollback_of: str = Field("", max_length=200)
    reason: Text

    @model_validator(mode="after")
    def explicit_source(self):
        if not self.reason.strip() or not (
            (self.candidate_id and self.environment_id and not self.rollback_of)
            or (self.rollback_of and not self.candidate_id and not self.environment_id)
        ):
            raise ValueError("Select a candidate and environment, or one deployment to roll back")
        return self


class DeploymentCreate(DeploymentPreviewInput):
    preview_basis: HexDigest


class DeploymentAction(DeploymentContract):
    id: Identity
    basis: HexDigest
    comment: Text


class DeploymentSync(DeploymentContract):
    id: Identity


class DeploymentReason(DeploymentContract):
    code: str
    message: str


class DeploymentPermissions(DeploymentContract):
    can_configure: bool
    can_prepare: bool
    can_operate: bool
    can_sync: bool


class DeploymentEnvironment(DeploymentContract):
    id: str
    name: str
    generation: int
    active: bool
    definition: DeploymentEnvironmentDefinition
    created_at: str
    updated_at: str
    locked_by: list[str]
    can_edit: bool
    reasons: list[DeploymentReason]


class DeploymentBaseline(DeploymentContract):
    deployment_id: str
    candidate_id: str
    candidate_snapshot: ReleaseSnapshot
    environment_id: str
    environment_generation: int
    target_snapshot: ExecutionTarget
    verified_at: str


class DeploymentSnapshot(DeploymentContract):
    kind: Literal["deploy", "rollback"]
    candidate_id: str
    candidate_snapshot: ReleaseSnapshot
    environment_id: str
    environment_name: str
    environment_generation: int
    definition: DeploymentEnvironmentDefinition
    target_snapshot: ExecutionTarget
    baseline: DeploymentBaseline | None
    rollback_of: str
    traffic_steps: list[int]
    reason: str


class DeploymentOperation(DeploymentContract):
    id: str
    index: int
    observe: bool
    status: str
    plan: dict[str, Any]
    plan_digest: str
    requested_by: ReleaseActor
    runtime_scope: dict[str, str]
    run_id: str | None
    run_version: int | None
    run_status: str | None
    result: dict[str, Any] | None
    created_at: str
    updated_at: str


class DeploymentActions(DeploymentContract):
    can_dispatch: bool
    can_start: bool
    can_advance: bool
    can_observe: bool
    can_cancel: bool
    can_sync: bool
    can_rollback: bool
    reasons: list[DeploymentReason]


class DeploymentView(DeploymentContract):
    id: str
    candidate_id: str
    environment_id: str
    kind: Literal["deploy", "rollback"]
    status: DeploymentStatus
    requested_by: ReleaseActor
    snapshot: DeploymentSnapshot
    operations: list[DeploymentOperation]
    created_at: str
    updated_at: str
    verified_at: str | None
    actual_traffic: int | None
    issue_id: str | None
    current: bool
    business_valid: bool
    reasons: list[DeploymentReason]
    basis: str
    actions: DeploymentActions


class DeploymentIndex(DeploymentContract):
    project_id: str
    version: int
    as_of: str
    environments: list[DeploymentEnvironment]
    deployments: list[DeploymentView]
    permissions: DeploymentPermissions


class DeploymentDetail(DeploymentContract):
    project_id: str
    version: int
    as_of: str
    deployment: DeploymentView
    environments: list[DeploymentEnvironment]
    permissions: DeploymentPermissions


class DeploymentPreview(DeploymentContract):
    project_id: str
    version: int
    as_of: str
    allowed: bool
    reasons: list[DeploymentReason]
    preview_basis: str
    snapshot: DeploymentSnapshot | None
    permissions: DeploymentPermissions
