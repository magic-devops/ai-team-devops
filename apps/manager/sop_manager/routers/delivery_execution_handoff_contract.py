"""Small canonical handoff DTOs; acceptance is distinct from actual execution."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class HandoffError(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=1000)


class ExecutionHandoffSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64)
    execution_id: str = Field(min_length=1, max_length=64)
    task_id: str = Field(min_length=1, max_length=64)
    workspace_id: str = Field(min_length=1, max_length=64)
    state: Literal["accepted", "dispatching", "retry_wait", "blocked", "planned", "cancelled"]
    revision: int = Field(ge=1)
    attempt: int = Field(ge=0)
    accepted_at: str
    updated_at: str
    next_attempt_at: str | None
    error: HandoffError | None
    run_id: str | None
    runtime_task_id: str | None

    @model_validator(mode="after")
    def actual_references(self):
        if self.state == "planned":
            if not self.run_id or not self.runtime_task_id:
                raise ValueError("A planned handoff requires actual runtime references")
        elif self.run_id is not None or self.runtime_task_id is not None:
            raise ValueError("Unplanned handoffs cannot claim runtime references")
        return self


class ExecutionHandoffDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str
    execution_id: str
    task_id: str
    handoff: ExecutionHandoffSummary


class TaskHandoffPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str
    task_id: str
    as_of: str
    items: list[ExecutionHandoffSummary]
    total: int = Field(ge=0)
    next_cursor: str | None
    limit: int = Field(ge=1, le=100)
