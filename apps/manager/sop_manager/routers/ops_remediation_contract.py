"""Strict fixed-source intake; operational reports are never execution proof."""
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

SourceId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")]
Digest = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class OpsIntakeInput(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    source_id: SourceId
    source_digest: Digest
    title: str = Field(min_length=1, max_length=256)
    description: str = Field(max_length=10000)
    severity: Literal["P0", "P1", "P2", "P3"]

    @field_validator("title", "description")
    @classmethod
    def text(cls, value, info):
        value.encode("utf-8")
        if any(ord(c) < 32 and c not in "\n\r\t" or 127 <= ord(c) <= 159 for c in value):
            raise ValueError("Control characters are not allowed")
        if info.field_name == "title" and not value.strip():
            raise ValueError("Nonempty text is required")
        return value


class OpsIntakeView(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    project_id: str
    version: int = Field(ge=0)
    as_of: str
    source_id: SourceId
    source_digest: Digest
    source_kind: Literal["reported_only"]
    source_type: Literal["self_heal", "rca"]
    snapshot: dict[str, Any]
    existing_issue_id: str | None
    existing_issue_available: bool
    can_intake: bool
