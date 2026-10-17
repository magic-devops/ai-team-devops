"""Strict, credential-free protocol shared by Manager, runtime and deployment runner."""

from __future__ import annotations

import json
import math
import re
import subprocess
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

JSON_LIMIT = 16384
ARGV_LIMIT = 30000
TOKENS = frozenset({"artifact_path", "artifact_sha256", "commit_sha", "operation_id", "traffic_percent"})


def strict_json(raw: str | bytes, *, max_bytes=JSON_LIMIT) -> dict:
    if len(raw.encode("utf-8") if isinstance(raw, str) else raw) > max_bytes:
        raise ValueError(f"Deployment JSON exceeds {max_bytes} UTF-8 bytes")

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    def constant(_):
        raise ValueError("Non-finite JSON number")

    def finite(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("Non-finite JSON number")
        return number

    value = json.loads(
        raw.decode("utf-8") if isinstance(raw, bytes) else raw,
        object_pairs_hook=pairs,
        parse_constant=constant,
        parse_float=finite,
    )
    if not isinstance(value, dict):
        raise ValueError("Deployment JSON must be an object")
    return value


def https_origin(value: str, *, origin_only=False) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or "\\" in value
        or any(ord(char) <= 32 for char in value)
        or (origin_only and parsed.path not in {"", "/"})
    ):
        raise ValueError("Use an HTTPS URL without credentials, query, fragment or redirects")
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("Invalid HTTPS port")
    return "https://" + parsed.netloc.lower()


def validate_argv(value: list[str], *, tokens=True) -> list[str]:
    if (
        not isinstance(value, list)
        or not value
        or len(value) > 128
        or any(not isinstance(arg, str) for arg in value)
        or not value[0].strip()
    ):
        raise ValueError("Choose an explicit executable argument list")
    for arg in value:
        if "\x00" in arg or len(arg) > JSON_LIMIT:
            raise ValueError("Invalid command argument")
        if tokens is not None:
            placeholders = re.findall(r"\{([^{}]*)\}", arg)
            leftover = re.sub(r"\{[^{}]*\}", "", arg)
            if (
                any(token not in TOKENS or not tokens for token in placeholders)
                or "{" in leftover
                or "}" in leftover
            ):
                raise ValueError("Unknown or malformed command placeholder")
    if len(subprocess.list2cmdline(value).encode("utf-16-le")) // 2 > ARGV_LIMIT:
        raise ValueError("Command exceeds the Windows argument limit")
    return value


class StrictContract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


def utc_timestamp(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None or result.utcoffset() != timezone.utc.utcoffset(result):
        raise ValueError("Deployment evidence requires an aware UTC timestamp")
    return result


class ProbeReport(StrictContract):
    healthy: bool
    artifact_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    traffic_percent: int = Field(ge=1, le=100)
    operation_id: str = Field(min_length=1, max_length=160)
    sample_count: int = Field(ge=1)
    observed_at: str = Field(max_length=64)

    @field_validator("observed_at")
    @classmethod
    def timestamp(cls, value):
        utc_timestamp(value)
        return value


class ProbeEvidence(ProbeReport):
    exit_code: int
    duration_ms: int = Field(ge=0)


class ProbeFailure(StrictContract):
    exit_code: int | None
    duration_ms: int = Field(ge=0)
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool
    error: str = Field(min_length=1, max_length=2000)
    observed_at: str = Field(max_length=64)

    @field_validator("observed_at")
    @classmethod
    def timestamp(cls, value):
        utc_timestamp(value)
        return value


class ApplyEvidence(StrictContract):
    executed: bool
    reused: bool
    exit_code: int | None
    duration_ms: int = Field(default=0, ge=0)
    stdout: str = ""
    stderr: str = ""
    error: str = ""
    stdout_truncated: bool = False
    stderr_truncated: bool = False


class OperationPlan(StrictContract):
    protocol: Literal["sop.deployment.v1"]
    operation_id: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
    tenant_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    environment_id: str = Field(min_length=1, max_length=128)
    environment_generation: int = Field(ge=1)
    candidate_id: str = Field(min_length=1, max_length=160)
    kind: Literal["deploy", "rollback"]
    artifact_url: str = Field(min_length=1, max_length=2000)
    artifact_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    commit_sha: str = Field(pattern=r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
    traffic_percent: int = Field(ge=1, le=100)
    apply_argv: list[str] = Field(min_length=1, max_length=128)
    probe_argv: list[str] = Field(min_length=1, max_length=128)
    artifact_origins: list[str] = Field(min_length=1, max_length=8)
    max_artifact_bytes: int = Field(ge=1, le=268435456)
    timeout_seconds: int = Field(ge=3, le=3540)
    observation_seconds: int = Field(ge=1, le=600)
    min_samples: int = Field(ge=1, le=100)

    @field_validator("apply_argv", "probe_argv")
    @classmethod
    def argv(cls, value):
        return validate_argv(value)

    @model_validator(mode="after")
    def coherent(self):
        origins = [https_origin(value, origin_only=True) for value in self.artifact_origins]
        if len(set(origins)) != len(origins) or https_origin(self.artifact_url) not in origins:
            raise ValueError("Artifact origin is not explicitly allowed")
        if self.timeout_seconds <= self.observation_seconds + 1:
            raise ValueError("Total timeout must exceed the observation window plus one second")
        for value in (self.tenant_id, self.project_id, self.environment_id, self.candidate_id):
            if not value.strip() or any(ord(char) < 32 for char in value):
                raise ValueError("Invalid deployment identity")
        strict_json(self.model_dump_json())
        return self


class OperationResult(StrictContract):
    protocol: Literal["sop.deployment.result.v1"]
    operation_id: str = Field(min_length=1, max_length=160)
    request_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    status: Literal["verified", "failed", "unknown"]
    artifact_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    traffic_percent: int = Field(ge=1, le=100)
    apply: dict
    probes: list[dict]
    started_at: str
    finished_at: str
    observation_seconds: float | int = Field(ge=0)
    error: str = Field(max_length=2000)

    @model_validator(mode="after")
    def evidence(self):
        started, finished = utc_timestamp(self.started_at), utc_timestamp(self.finished_at)
        if finished < started or len(self.probes) > 100:
            raise ValueError("Invalid deployment observation window or sample count")
        apply = ApplyEvidence.model_validate(self.apply)
        probes = [
            (
                ProbeFailure.model_validate(value)
                if self.status != "verified" and "error" in value
                else ProbeEvidence.model_validate(value)
            )
            for value in self.probes
        ]
        if self.status == "verified":
            if not apply.executed or not probes or self.observation_seconds < 1 or self.error:
                raise ValueError("Verified deployment requires actual execution and health evidence")
            if apply.exit_code not in (None, 0) or (
                not apply.reused and (apply.exit_code != 0 or apply.error)
            ):
                raise ValueError("Verified deployment requires a successful actual apply")
            for probe in probes:
                if (
                    not probe.healthy
                    or probe.exit_code != 0
                    or probe.operation_id != self.operation_id
                    or probe.artifact_sha256 != self.artifact_sha256
                    or probe.traffic_percent != self.traffic_percent
                    or not started <= utc_timestamp(probe.observed_at) <= finished
                ):
                    raise ValueError("Deployment health evidence does not match its operation")
        strict_json(self.model_dump_json(), max_bytes=65536)
        return self
