"""Bounded, actor-private design suggestions; saving remains a separate command."""
from typing import Literal

from pydantic import Field, model_validator

from .design_contract import Author, Contract, Digest, Identity, Reason


class PreviewInput(Contract):
    base_revision_id: Identity
    base_revision_digest: Digest
    mode: Literal["expand", "review", "diagram", "free"] = "expand"
    instructions: str = Field(default="", max_length=4000)
    idempotency_key: str = Field(min_length=8, max_length=100)

    @model_validator(mode="after")
    def valid_instruction(self):
        if ("\x00" in self.instructions or self.idempotency_key != self.idempotency_key.strip()
                or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in self.idempotency_key)):
            raise ValueError("Provide a valid instruction and an explicit original request key")
        self.instructions.encode("utf-8", errors="strict")
        self.idempotency_key.encode("utf-8", errors="strict")
        if self.mode == "free" and not self.instructions.strip():
            raise ValueError("Describe the requested design change")
        return self


class PreviewError(Contract):
    code: str
    message: str


class PreviewView(Contract):
    project_id: Identity
    document_id: Identity
    id: Identity
    request_key: str
    status: Literal["generating", "succeeded", "failed"]
    mode: Literal["expand", "review", "diagram", "free"]
    instructions: str
    base_revision_id: Identity
    base_revision_digest: Digest
    requested_by: Author
    created_at: str
    model: str
    provider: str
    usage: dict
    content: str | None
    content_sha256: Digest | None
    error: PreviewError | None
    current_basis: bool
    can_save: bool
    reasons: list[Reason]
