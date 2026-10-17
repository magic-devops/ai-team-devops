"""Strict, provider-independent signed CI input. No delivery module dependencies."""

from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

PAYLOAD_TYPE = "application/vnd.in-toto+json"
STATEMENT_TYPE = "https://in-toto.io/Statement/v1"
PREDICATE_TYPE = "urn:sop:delivery:ci-evidence:v1"
HexDigest = Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
CommitSha = Annotated[str, StringConstraints(strict=True, pattern=r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")]
Identity = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200)]
Count = Annotated[int, Field(strict=True, ge=0, le=10_000_000)]


def safe_https(value: str, *, repository=False) -> str:
    """Locations are identifiers; the verifier never fetches them."""
    try:
        value.encode("utf-8")
        parsed = urlsplit(value)
        port = parsed.port
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or "#" in value
            or "?" in value
            or port == 0
            or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
            or "\\" in value
        ):
            raise ValueError
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Use an HTTPS URI without credentials or a fragment") from exc
    return value


class CiInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=False)

    @field_validator("*", mode="after")
    @classmethod
    def string_is_text(cls, value):
        if isinstance(value, str):
            value.encode("utf-8")
            if not value.strip() or any(ord(char) < 32 or ord(char) == 127 for char in value):
                raise ValueError("Expected nonempty text without control characters")
        return value


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
