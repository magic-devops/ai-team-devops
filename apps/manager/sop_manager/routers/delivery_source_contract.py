"""Explicit immutable provenance selected for an existing business command."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

SourceIdentifier = Annotated[str, Field(min_length=1, max_length=64)]
SOURCE_ACTIONS = frozenset(
    {"requirement.update", "task.update", "tasks.plan", "issue.promote", "issue.diagnosis.adopt"}
)


class DiscussionSourceReference(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    thread_id: SourceIdentifier
    expected_thread_version: int = Field(ge=1, strict=True)
    resolution_event_id: SourceIdentifier
    message_id: SourceIdentifier
    message_revision: int = Field(ge=1, strict=True)
