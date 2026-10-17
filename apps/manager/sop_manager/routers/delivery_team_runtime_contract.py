"""Project associations describe configuration, never runtime authorization."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

RuntimeMemberId = Annotated[str, StringConstraints(
    strict=True, strip_whitespace=False, min_length=1, max_length=100,
    pattern=r"^[^\s\x00-\x1f\x7f]+$",
)]
RuntimeResourceId = Annotated[str, StringConstraints(
    strict=True, strip_whitespace=False, min_length=1, max_length=64,
    pattern=r"^[^\s\x00-\x1f\x7f]+$",
)]


class RuntimeContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MemberRuntimeUnbind(RuntimeContract):
    member_id: RuntimeMemberId


class MemberRuntimeBind(MemberRuntimeUnbind):
    workspace_id: RuntimeResourceId
    agent_id: RuntimeResourceId
    agent_version: int = Field(ge=1, strict=True)


class RuntimeBindingSource(RuntimeContract):
    workspace_name: str
    agent_title: str
    provider: str


class RuntimeBinding(RuntimeContract):
    workspace_id: str
    agent_id: str
    agent_version: int
    profile_digest: str
    source: RuntimeBindingSource
    bound_by: str
    bound_at: str


class ExecutorSnapshot(RuntimeContract):
    member_id: str
    member_name: str
    binding_basis: str
    binding_generation: int
    workspace_id: str
    workspace_name: str
    agent_id: str
    agent_version: int
    agent_title: str
    profile_digest: str
    provider: str
    recorded_at: str
    recorded_by: str


class RuntimeBindingReason(RuntimeContract):
    code: str
    message: str


class RuntimeBindingPermissions(RuntimeContract):
    can_bind: bool
    can_unbind: bool


class MemberRuntimeState(RuntimeContract):
    member_id: str
    binding_basis: str
    generation: int
    binding: RuntimeBinding | None
    status: Literal["unbound", "current", "stale", "unavailable"]
    reasons: list[RuntimeBindingReason]
    permissions: RuntimeBindingPermissions


class RuntimeBindingAgent(RuntimeContract):
    id: str
    version: int
    title: str
    provider: str


class RuntimeBindingWorkspace(RuntimeContract):
    id: str
    name: str
    agents: list[RuntimeBindingAgent]


class TeamRuntimeBindingsResponse(RuntimeContract):
    project_id: str
    version: int
    as_of: str
    runtime_configured: bool
    workspaces: list[RuntimeBindingWorkspace]
    members: list[MemberRuntimeState]
