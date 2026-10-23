"""Strict, provider-independent signed CI input. No delivery module dependencies."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .delivery_ci_types import CiInput, CommitSha, Count, HexDigest, Identity, safe_https
from .delivery_release_sources_contract import ReleaseSourcePacket

PAYLOAD_TYPE = "application/vnd.in-toto+json"
STATEMENT_TYPE = "https://in-toto.io/Statement/v1"
PREDICATE_TYPE = "urn:sop:delivery:ci-evidence:v1"


class ReleasePolicySave(CiInput):
    repository: str = Field(min_length=1, max_length=2000)
    workflow: Identity
    public_keys: list[str] = Field(min_length=1, max_length=8)

    @field_validator("repository")
    @classmethod
    def repository_uri(cls, value):
        return safe_https(value, repository=True)


class ReleaseCiImport(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    envelope: str = Field(min_length=1, max_length=131072)
    requirement_ids: list[Identity] = Field(default_factory=list, max_length=200)
    task_ids: list[Identity] = Field(default_factory=list, max_length=200)
    source_packet: ReleaseSourcePacket

    @field_validator("requirement_ids", "task_ids")
    @classmethod
    def distinct_scope(cls, value):
        if len(value) != len(set(value)) or any(not item.strip() for item in value):
            raise ValueError("Select distinct nonempty scope IDs")
        return value


class CiSignature(CiInput):
    keyid: HexDigest
    sig: str = Field(min_length=1, max_length=88)


class CiEnvelope(CiInput):
    payloadType: Literal[PAYLOAD_TYPE]
    payload: str = Field(min_length=1, max_length=87384)
    signatures: list[CiSignature] = Field(min_length=1, max_length=8)

    @field_validator("signatures")
    @classmethod
    def distinct_signatures(cls, value):
        if len({item.keyid for item in value}) != len(value):
            raise ValueError("Duplicate signature key IDs")
        return value


class CiTests(CiInput):
    total: Count
    failed: Count
    errors: Count
    skipped: Count

    @model_validator(mode="after")
    def compatible_counts(self):
        if self.failed + self.errors + self.skipped > self.total:
            raise ValueError("JUnit counts exceed total tests")
        return self


class CiDigest(CiInput):
    sha256: HexDigest


class CiSubject(CiInput):
    name: Identity
    digest: CiDigest


class CiSourceTrace(CiInput):
    packet_digest: HexDigest
    verified_bindings: int = Field(strict=True, ge=1, le=500)
    checked_paths: int = Field(strict=True, ge=0, le=10000)
    tree_digest: HexDigest


class CiPredicate(CiInput):
    tenant_id: Identity
    project_id: Identity
    policy_generation: int = Field(strict=True, ge=1)
    repository: str = Field(min_length=1, max_length=2000)
    workflow: Identity
    commit_sha: CommitSha
    run_uri: str = Field(min_length=1, max_length=2000)
    run_number: int = Field(strict=True, ge=1)
    run_attempt: int = Field(strict=True, ge=1)
    scope_basis: HexDigest
    # Historical signed originals remain readable; release admission requires it.
    source_trace: CiSourceTrace | None = None
    build_result: Literal["passed", "failed"]
    tests: CiTests
    finished_at: str = Field(min_length=1, max_length=100)

    @field_validator("repository")
    @classmethod
    def repository_uri(cls, value):
        return safe_https(value, repository=True)

    @field_validator("run_uri")
    @classmethod
    def run_location(cls, value):
        return safe_https(value)

    @field_validator("finished_at")
    @classmethod
    def aware_timestamp(cls, value):
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if instant.tzinfo is None or instant.utcoffset() is None:
            raise ValueError("CI completion requires a timezone")
        return value


class CiStatement(CiInput):
    statement_type: Literal[STATEMENT_TYPE] = Field(alias="_type")
    subject: list[CiSubject] = Field(min_length=1, max_length=1)
    predicateType: Literal[PREDICATE_TYPE]
    predicate: CiPredicate
