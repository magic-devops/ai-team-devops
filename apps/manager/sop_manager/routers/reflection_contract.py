"""Typed reflection claims and bounded, source-exact read contracts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Category = Literal["coding", "testing", "security", "workflow", "review", "other"]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ReflectionReference(Strict):
    kind: Literal["task", "execution"]
    id: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def valid_identity(self):
        if (self.id != self.id.strip() or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in self.id)
                or "/" in self.id or "\\" in self.id or self.kind == "task" and len(self.id) > 64):
            raise ValueError("Reference requires a stable, trimmed identity")
        return self


class ReflectionData(Strict):
    schema_version: Literal[1]
    category: Category
    title: str = Field(min_length=1, max_length=160)
    observation: str = Field(min_length=1, max_length=12000)
    lesson: str = Field(default="", max_length=8000)
    references: list[ReflectionReference] = Field(default_factory=list, max_length=8)

    @field_validator("schema_version", mode="before")
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError("Schema version must be integer 1")
        return value

    @field_validator("title", "observation")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Text cannot be blank")
        try:
            value.encode("utf-8")
        except UnicodeError as exc:
            raise ValueError("Text must be valid UTF-8") from exc
        return value

    @field_validator("references")
    @classmethod
    def unique_references(cls, value):
        if len({(r.kind, r.id) for r in value}) != len(value):
            raise ValueError("Duplicate reference")
        return value


class ReflectionSelectionReference(Strict):
    reflection_id: str = Field(min_length=1, max_length=64)
    source_digest: Digest
    attempt_id: str = Field(min_length=1, max_length=64)

    @field_validator("reflection_id", "attempt_id")
    @classmethod
    def utf8_identity(cls, value):
        try:
            value.encode("utf-8")
        except UnicodeError as exc:
            raise ValueError("Identity must be valid UTF-8") from exc
        return value


class ReflectionInputCreate(Strict):
    title: str = Field(min_length=1, max_length=160)
    rationale: str = Field(min_length=1, max_length=2000)
    sources: list[ReflectionSelectionReference] = Field(min_length=1, max_length=32)

    @field_validator("title", "rationale")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Text cannot be blank")
        try:
            value.encode("utf-8")
        except UnicodeError as exc:
            raise ValueError("Text must be valid UTF-8") from exc
        return value

    @field_validator("sources")
    @classmethod
    def unique_sources(cls, value):
        if len({r.reflection_id for r in value}) != len(value):
            raise ValueError("Duplicate reflection")
        return value


class ReflectionPermissions(Strict):
    read: bool
    collect: bool
    prepare: bool


class ReflectionProducer(Strict):
    id: str
    name: str | None


class ReflectionSummary(Strict):
    id: str
    category: Category
    occurred_at: str
    collected_at: str
    producer: ReflectionProducer
    reference_count: int
    intake_status: Literal["collected"]
    original_status: Literal["not_loaded", "available", "restricted", "unavailable"]
    unavailable_reason: str | None


class Page(Strict):
    project_id: str
    as_of: str
    total: int
    limit: int
    has_more: bool
    next_cursor: str | None
    permissions: ReflectionPermissions


class ReflectionPage(Page):
    items: list[ReflectionSummary]


class ReflectionStatement(Strict):
    category: Category
    title: str
    observation: str
    lesson: str
    claimed_occurred_at: str


class ReflectionSource(Strict):
    receipt_id: str
    event_id: str
    digest: Digest
    producer_id: str
    stored_at: str
    event_json: str


class ReflectionVerified(Strict):
    attempt_id: str
    handler: Literal["reflection.record"]
    collected_at: str
    identity_and_references_checked: Literal[True]
    is_acceptance_evidence: Literal[False]


class ReflectionLink(Strict):
    kind: Literal["task", "execution"]
    id: str | None
    label: str | None
    available: bool
    reason: str | None


class ReflectionDetail(Strict):
    project_id: str
    as_of: str
    reflection: ReflectionSummary
    available: bool
    unavailable_reason: str | None
    statement: ReflectionStatement | None
    source: ReflectionSource | None
    verified: ReflectionVerified | None
    links: list[ReflectionLink]
    selection_reference: ReflectionSelectionReference | None


class ReflectionInputSummary(Strict):
    id: str
    title: str
    status: Literal["prepared"]
    source_count: int
    created_at: str
    created_by: ReflectionProducer
    source_version: int


class ReflectionInputsPage(Page):
    items: list[ReflectionInputSummary]


class ReflectionInputSource(ReflectionSelectionReference):
    available: bool
    unavailable_reason: str | None


class ReflectionInputDetail(Strict):
    project_id: str
    as_of: str
    input: ReflectionInputSummary
    rationale: str
    manifest_digest: Digest
    sources: list[ReflectionInputSource]
    available: bool
    is_acceptance_evidence: Literal[False]
