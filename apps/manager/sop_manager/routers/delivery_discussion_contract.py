"""Strict independent discussion DTOs; canonical business commands stay separate."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SubjectKind = Literal["requirement", "task", "issue"]
ReferenceKind = Literal["requirement", "task", "issue", "execution"]
ReferenceField = Literal["title", "description", "acceptance_criteria", "summary"]
ID = Annotated[str, Field(min_length=1, max_length=64)]
Basis = Annotated[str, Field(pattern="^[a-f0-9]{64}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RefSelection(Strict):
    kind: ReferenceKind
    id: ID
    field: ReferenceField
    criterion_index: Annotated[int, Field(ge=0, strict=True)] | None = None
    source_content_basis: Basis

    @model_validator(mode="after")
    def selection(self):
        if (self.kind == "execution") != (self.field == "summary"):
            raise ValueError("Execution references use summary; canonical objects use their own fields")
        if (self.field == "acceptance_criteria") != (self.criterion_index is not None):
            raise ValueError("Acceptance references require a fixed criterion index")
        if self.kind == "issue" and self.field == "acceptance_criteria":
            raise ValueError("Issue has no acceptance criteria")
        return self


class Keyed(Strict):
    idempotency_key: Annotated[str, Field(min_length=1, max_length=128)]


class MessageCreate(Keyed):
    body: Annotated[str, Field(min_length=1, max_length=8000)]
    refs: Annotated[list[RefSelection], Field(max_length=8)] = Field(default_factory=list)
    parent_message_id: ID | None = None


class DiscussionCreate(Keyed):
    subject_kind: SubjectKind
    subject_id: ID
    title: Annotated[str, Field(min_length=1, max_length=160)]
    body: Annotated[str, Field(min_length=1, max_length=8000)]
    refs: Annotated[list[RefSelection], Field(max_length=8)] = Field(default_factory=list)


class MessageEdit(Keyed):
    expected_message_revision: Annotated[int, Field(ge=1, strict=True)]
    body: Annotated[str, Field(min_length=1, max_length=8000)]
    refs: Annotated[list[RefSelection], Field(max_length=8)] | None = None


class MessageWithdraw(Keyed):
    expected_message_revision: Annotated[int, Field(ge=1, strict=True)]
    reason: Annotated[str, Field(max_length=2000)] = ""


class DiscussionResolve(Keyed):
    expected_thread_version: Annotated[int, Field(ge=1, strict=True)]
    message_id: ID
    message_revision: Annotated[int, Field(ge=1, strict=True)]
    note: Annotated[str, Field(max_length=2000)] = ""


class DiscussionStateChange(Keyed):
    expected_thread_version: Annotated[int, Field(ge=1, strict=True)]
    reason: Annotated[str, Field(max_length=2000)] = ""


class DiscussionLink(Keyed):
    expected_thread_version: Annotated[int, Field(ge=1, strict=True)]
    resolution_event_id: ID
    message_id: ID
    message_revision: Annotated[int, Field(ge=1, strict=True)]
    target_kind: SubjectKind
    target_id: ID
    target_content_basis: Basis


class Actor(Strict):
    id: str
    name: str


class Subject(Strict):
    kind: SubjectKind
    id: str
    missing: bool
    title: str | None
    current_requirement_id: str | None


class Resolution(Strict):
    event_id: str
    message_id: str
    message_revision: int
    note: str


class DiscussionThread(Strict):
    id: str
    subject: Subject
    title: str
    state: Literal["open", "resolved", "archived"]
    version: int
    created_seq: int
    created_by: Actor
    created_at: str
    last_activity_at: str
    current_resolution: Resolution | None


class RuntimeReference(Strict):
    workspace_id: str
    run_id: str
    attempt: int
    executor_id: str | None


class FixedReference(Strict):
    kind: ReferenceKind
    id: str
    status: Literal["available", "unavailable"]
    field: ReferenceField | None = None
    criterion_index: int | None = None
    source_content_basis: str | None = None
    text: str | None = None
    runtime: RuntimeReference | None = None


class DiscussionMessage(Strict):
    id: str
    thread_id: str
    parent_message_id: str | None
    author: Actor
    created_seq: int
    created_at: str
    revision: int
    state: Literal["active", "withdrawn"]
    body: str | None
    reason: str | None
    refs: list[FixedReference]
    edited_at: str
    can_edit: bool
    can_withdraw: bool


class MessageVersion(Strict):
    revision: int
    state: Literal["active", "withdrawn"]
    body: str | None
    reason: str | None
    refs: list[FixedReference]
    editor: Actor
    created_at: str


class DiscussionAck(Strict):
    project_id: str
    thread_id: str
    thread_version: int
    event_id: str
    message_id: str | None
    message_revision: int | None
    link_id: str | None
    replayed: bool


class Page(Strict):
    project_id: str
    as_of: str
    total: int
    limit: int
    has_more: bool
    next_cursor: str | None


class DiscussionPage(Page):
    discussion_stamp: str
    scope: dict
    items: list[DiscussionThread]


class DiscussionDetail(Strict):
    project_id: str
    discussion_stamp: str
    as_of: str
    thread: DiscussionThread
    permissions: dict[str, bool]
    capabilities: dict[str, bool]


class MessagePage(Page):
    thread_id: str
    thread_version: int
    discussion_stamp: str
    items: list[DiscussionMessage]


class MessageDetail(Strict):
    project_id: str
    thread_id: str
    thread_version: int
    message: DiscussionMessage


class VersionPage(Page):
    thread_id: str
    message_id: str
    upper_revision: int
    items: list[MessageVersion]


class VersionDetail(Strict):
    project_id: str
    thread_id: str
    message_id: str
    version: MessageVersion


class ReferenceDetail(Strict):
    project_id: str
    reference: FixedReference
    target_content_basis: str | None


class SnapshotSubject(Strict):
    kind: SubjectKind
    id: str


class SnapshotThread(Strict):
    id: str
    title: str
    version: int
    subject: SnapshotSubject


class SnapshotMessage(Strict):
    id: str
    revision: int
    body: str
    author: Actor
    refs: list[FixedReference]


class SafeSourceSnapshot(Strict):
    thread: SnapshotThread
    resolution: Resolution
    message: SnapshotMessage


class SourceNavigation(Strict):
    project_id: str
    view: str
    detail: str
    requirement_id: str | None = None
    task_id: str | None = None
    issue_id: str | None = None


class LegacySource(Strict):
    kind: Literal["issue", "diagnosis", "plan"]
    id: str | None
    label: str
    target: SourceNavigation | None
    unavailable: bool


class SourceLink(Strict):
    id: str
    relation: Literal["reference", "adopted"]
    source_kind: Literal["discussion_resolution"]
    source_id: str
    thread_id: str
    thread_version: int
    resolution_event_id: str
    message_id: str
    message_revision: int
    source_snapshot: SafeSourceSnapshot
    source_digest: str
    target_kind: SubjectKind
    target_id: str
    target_missing: bool
    target_title: str | None
    business_event_id: str | None
    applied_fields: list[str]
    applied_by: Actor
    created_at: str
    source_changed: bool


class SourcePage(Page):
    discussion_stamp: str
    items: list[SourceLink]
    legacy_sources: list[LegacySource]
