"""Explicit lifecycle proposals; Project.status remains the sole current state."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ProjectStatus = Literal['planning', 'active', 'paused', 'archived']
WorkingProjectStatus = Literal['planning', 'active', 'paused']
ProjectRiskCode = Literal[
    'blocked', 'awaiting_review', 'recorded_completed', 'overdue_unverified',
    'acceptance_unavailable', 'owner_unavailable', 'open_issues',
]


class ProjectLifecyclePreviewInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    target_status: ProjectStatus
    reason: str = Field(min_length=1, max_length=2000, strict=True)


class ProjectLifecycleCommand(ProjectLifecyclePreviewInput):
    preview_basis: str = Field(pattern=r'^[0-9a-f]{64}$', strict=True)
