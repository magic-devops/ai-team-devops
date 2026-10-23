"""Bounded, explicit acceptance-to-source association shared with the CI producer."""
from typing import Literal
import json

from pydantic import Field, field_validator, model_validator

from .delivery_ci_types import CiInput, CommitSha, HexDigest, Identity, safe_https


class ReleaseSourceMapping(CiInput):
    task_id: Identity
    kind: Literal["change", "no_code_change"]
    base_commit: CommitSha | None = None
    accepted_commit: CommitSha | None = None
    comment: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def explicit_kind(self):
        if self.kind == "change":
            if not self.base_commit or not self.accepted_commit or self.base_commit == self.accepted_commit:
                raise ValueError("Code work requires distinct full base and accepted commits")
            if len(self.base_commit) != len(self.accepted_commit):
                raise ValueError("Use commits from the same repository object format")
        elif self.base_commit is not None or self.accepted_commit is not None:
            raise ValueError("Non-code work cannot carry code commits")
        return self


class ReleaseSourceBinding(ReleaseSourceMapping):
    task_basis: HexDigest
    proof_basis: HexDigest


class ReleaseSourcePacketInput(CiInput):
    requirement_ids: list[Identity] = Field(default_factory=list, max_length=200)
    task_ids: list[Identity] = Field(default_factory=list, max_length=200)
    scope_basis: HexDigest
    policy_generation: int = Field(strict=True, ge=1)
    mappings: list[ReleaseSourceMapping] = Field(min_length=1, max_length=500)


class ReleaseSourcePacket(CiInput):
    schema_version: Literal[1]
    tenant_id: Identity
    project_id: Identity
    repository: str = Field(min_length=1, max_length=2000)
    workflow: Identity
    policy_generation: int = Field(strict=True, ge=1)
    scope_basis: HexDigest
    requirement_ids: list[Identity] = Field(max_length=200)
    task_ids: list[Identity] = Field(max_length=200)
    bindings: list[ReleaseSourceBinding] = Field(min_length=1, max_length=500)

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value):
        if type(value) is not int:
            raise ValueError("Source packet schema version must be an exact integer")
        return value

    @model_validator(mode="after")
    def canonical_packet(self):
        safe_https(self.repository, repository=True)
        for ids in (self.requirement_ids, self.task_ids, [row.task_id for row in self.bindings]):
            if ids != sorted(set(ids)):
                raise ValueError("Packet identities must be distinct and sorted")
        if not self.requirement_ids and not self.task_ids:
            raise ValueError("Choose an explicit scope")
        if len(json.dumps(self.model_dump(mode="json"), ensure_ascii=False).encode("utf-8")) > 1048576:
            raise ValueError("The source packet exceeds 1 MiB")
        return self


class ReleaseSourcePacketResponse(CiInput):
    project_id: Identity
    version: int = Field(strict=True, ge=0)
    query_generation: int = Field(strict=True, ge=0)
    packet: ReleaseSourcePacket
