"""Project design originals and explicit, complete-basis adoption contracts."""
import hashlib
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .delivery_proof_contract import RequirementReadBudget, RequirementPreviewImpact

Identity = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=64)]
Digest = Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
Text = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=200)]
Slot = Literal["prd", "prototype", "architecture"]
Category = Literal["product", "ux", "architecture", "general"]
MAX_CONTENT_BYTES = 65536


def design_basis(references):
    return hashlib.sha256(json.dumps(references, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


class Contract(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class Reason(Contract):
    code: str
    message: str


class Author(Contract):
    id: Identity
    name: str


class DocumentContent(Contract):
    title: Text
    category: Category = "architecture"
    tags: list[Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=80)]] = Field(default_factory=list, max_length=24)
    content: str = Field(min_length=1, max_length=MAX_CONTENT_BYTES)
    note: str = Field(default="Saved design", max_length=300)

    @model_validator(mode="after")
    def bounded_source(self):
        if not self.content.strip() or "\x00" in self.content or len(self.content.encode("utf-8")) > MAX_CONTENT_BYTES:
            raise ValueError("Provide a complete nonempty UTF-8 design of at most 64 KiB")
        if len(set(self.tags)) != len(self.tags):
            raise ValueError("Design tags must be distinct")
        return self


class DocumentCreate(DocumentContent):
    pass


class DocumentBase(Contract):
    document_id: Identity
    document_version: int = Field(ge=1)
    base_revision_id: Identity
    base_revision_digest: Digest


class RevisionSave(DocumentContent, DocumentBase):
    preview_id: Identity | None = None


class RevisionRestore(DocumentBase):
    revision_id: Identity
    revision_digest: Digest
    note: str = Field(default="Restored exact revision", max_length=300)


class DocumentArchive(DocumentBase):
    archived: bool


class RevisionMetadata(Contract):
    id: Identity
    document_id: Identity
    number: int = Field(ge=1)
    digest: Digest
    content_sha256: Digest
    content_bytes: int = Field(ge=1, le=MAX_CONTENT_BYTES)
    title: Text
    category: Category
    tags: list[str]
    note: str
    author: Author
    created_at: str
    restored_from: Identity | None
    preview_id: Identity | None


class DocumentHead(Contract):
    id: Identity
    document_version: int = Field(ge=1)
    head_revision_id: Identity
    head_revision_digest: Digest
    revision_number: int = Field(ge=1)
    title: Text
    category: Category
    tags: list[str]
    archived: bool
    created_at: str
    updated_at: str


class Permissions(Contract):
    can_write: bool
    can_generate: bool
    reasons: list[Reason]


class Envelope(Contract):
    project_id: Identity
    version: int = Field(ge=0)
    query_generation: int | None
    as_of: str


class DocumentPage(Envelope):
    items: list[DocumentHead]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    next_cursor: str | None
    permissions: Permissions


class DocumentView(Envelope):
    document: DocumentHead
    permissions: Permissions


class RevisionPage(Envelope):
    document_id: Identity
    items: list[RevisionMetadata]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    next_cursor: str | None


class RevisionView(Envelope):
    document_id: Identity
    revision: RevisionMetadata
    content: str


class RevisionCompare(Envelope):
    document_id: Identity
    from_revision_id: Identity
    to_revision_id: Identity
    added_lines: int
    removed_lines: int
    diff_preview: str
    truncated: bool


class DesignReference(Contract):
    slot: Slot
    adoption_id: Identity
    document_id: Identity
    revision_id: Identity
    revision_number: int = Field(ge=1)
    revision_digest: Digest
    content_sha256: Digest
    content_bytes: int = Field(ge=1, le=MAX_CONTENT_BYTES)
    title: Text
    category: Category
    origin_kind: Literal["requirement", "task"]
    origin_id: Identity


class AdoptionPreviewInput(Contract):
    operation: Literal["adopt", "clear"] = "adopt"
    target_basis: Digest
    design_basis: Digest
    slot: Slot
    document_id: Identity | None = None
    revision_id: Identity | None = None
    revision_digest: Digest | None = None

    @model_validator(mode="after")
    def exact_source(self):
        values = (self.document_id, self.revision_id, self.revision_digest)
        if self.operation == "adopt" and any(value is None for value in values):
            raise ValueError("Adoption requires an exact document revision and digest")
        if self.operation == "clear" and any(value is not None for value in values):
            raise ValueError("Clear identifies the current slot, without a replacement source")
        return self


class AdoptionBase(Contract):
    target_basis: Digest
    design_basis: Digest
    preview_basis: Digest
    slot: Slot
    comment: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=4000)]


class AdoptFields(AdoptionBase):
    document_id: Identity
    revision_id: Identity
    revision_digest: Digest


class RequirementDesignAdopt(AdoptFields):
    requirement_id: Identity


class TaskDesignAdopt(AdoptFields):
    task_id: Identity


class RequirementDesignClear(AdoptionBase):
    requirement_id: Identity


class TaskDesignClear(AdoptionBase):
    task_id: Identity


class DesignCurrent(Envelope):
    target_kind: Literal["requirement", "task"]
    target_id: Identity
    target_basis: Digest
    design_basis: Digest
    own: list[DesignReference] = Field(max_length=3)
    effective: list[DesignReference] = Field(max_length=3)
    can_adopt: bool
    reasons: list[Reason]


class AdoptionPreview(DesignCurrent):
    available: bool
    complete: bool
    allowed: bool
    preview_basis: Digest | None
    next_effective: list[DesignReference] = Field(max_length=3)
    impact: RequirementPreviewImpact
    budget: RequirementReadBudget


COMMANDS = {
    "design.document.create": DocumentCreate,
    "design.revision.save": RevisionSave,
    "design.revision.restore": RevisionRestore,
    "design.document.archive": DocumentArchive,
    "requirement.design.adopt": RequirementDesignAdopt,
    "requirement.design.clear": RequirementDesignClear,
    "task.design.adopt": TaskDesignAdopt,
    "task.design.clear": TaskDesignClear,
}
