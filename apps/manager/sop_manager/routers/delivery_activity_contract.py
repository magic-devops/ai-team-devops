"""Public collaboration contracts contain only explicitly projected business fields."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .delivery_contract import RequirementCreate


class CollaborationContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ActivityActor(CollaborationContract):
    id: str | None
    name: str


class FieldChange(CollaborationContract):
    field: Literal["title", "description", "acceptance_criteria"]
    before: str | list[str]
    after: str | list[str]

    @model_validator(mode="after")
    def definition_field_type(self):
        sequence = self.field == "acceptance_criteria"
        if isinstance(self.before, list) != sequence or isinstance(self.after, list) != sequence:
            raise ValueError("Recorded definition changes must match the canonical field type")
        return self


class ActivityTarget(CollaborationContract):
    kind: Literal["project", "requirement", "task", "execution", "issue", "release_candidate", "deployment", "work_order"]
    id: str | None
    label: str | None
    available: bool
    reason: str | None


class ActivityItem(CollaborationContract):
    id: str
    at: str
    action: str
    actor: ActivityActor
    association: Literal["recorded", "unknown"]
    requirement_ids: list[str]
    target: ActivityTarget | None
    related_targets: list[ActivityTarget]
    changes: list[FieldChange]


class ActivityPage(CollaborationContract):
    project_id: str
    as_of: str
    scope: Literal["project", "requirement"]
    scope_id: str
    items: list[ActivityItem]
    next_cursor: str | None


class ActivityDetail(CollaborationContract):
    project_id: str
    item: ActivityItem


class RequirementDefinition(CollaborationContract):
    id: str
    title: str
    description: str
    acceptance_criteria: list[str]


class RequirementVersion(CollaborationContract):
    id: str
    number: int
    basis: str
    definition: RequirementDefinition
    at: str
    actor: ActivityActor
    source: Literal["delivery_command", "sql_observed"]
    flow_revision: int | None


class RequirementVersionDetail(CollaborationContract):
    project_id: str
    requirement_id: str
    item: RequirementVersion


def _omitted_change_default(schema):
    # Internal None represents omission; explicit JSON null is rejected below.
    schema.pop("default", None)


class DefinitionChanges(CollaborationContract):
    title: str = Field(default=None, min_length=1, max_length=256, json_schema_extra=_omitted_change_default)
    description: str = Field(default=None, max_length=20000, json_schema_extra=_omitted_change_default)
    acceptance_criteria: list[str] = Field(
        default=None, max_length=80, json_schema_extra=_omitted_change_default
    )

    @model_validator(mode="after")
    def canonical_definition_fields(self):
        changes = self.model_dump(exclude_unset=True)
        if any(value is None for value in changes.values()):
            raise ValueError("Omit unchanged definition fields instead of using null")
        RequirementCreate.model_validate({"title": "Preview", **changes})
        return self

    @classmethod
    def normalized(cls, value):
        # Reuse the canonical validation for title, text and acceptance conditions.
        parsed = cls.model_validate(value)
        changes = parsed.model_dump(exclude_unset=True)
        if any(item is None for item in changes.values()):
            raise ValueError("Omit unchanged fields; use empty text or [] to clear a definition")
        canonical = RequirementCreate.model_validate({"title": "Preview", **changes})
        return {key: getattr(canonical, key) for key in changes}


class RequirementChangePreviewInput(CollaborationContract):
    requirement_basis: str = Field(pattern=r"^[0-9a-f]{64}$")
    changes: DefinitionChanges
