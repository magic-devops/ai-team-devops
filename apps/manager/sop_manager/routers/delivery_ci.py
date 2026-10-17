"""DSSE / in-toto Ed25519 evidence for an explicitly configured CI identity."""

import base64
import binascii
import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import HTTPException
from pydantic import ValidationError

from .delivery_ci_contract import CiEnvelope, CiStatement, ReleasePolicySave


def _reject(code, message, status=422):
    raise HTTPException(status, {"code": code, "message": message})


def _json_values(item):
    if isinstance(item, str):
        item.encode("utf-8")
    elif isinstance(item, float) and not math.isfinite(item):
        raise ValueError("Non-finite JSON number")
    elif isinstance(item, dict):
        for key, child in item.items():
            key.encode("utf-8")
            _json_values(child)
    elif isinstance(item, list):
        for child in item:
            _json_values(child)


def strict_json(value: str | bytes):
    """Parse once, preserving the exact verified bytes and rejecting ambiguity."""

    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = item
        return result

    def finite(_value):
        raise ValueError("Non-finite JSON number")

    try:
        if isinstance(value, bytes):
            value = value.decode("utf-8", errors="strict")
        result = json.loads(value, object_pairs_hook=pairs, parse_constant=finite)
        _json_values(result)
        return result
    except (ValueError, TypeError, UnicodeError, RecursionError):
        _reject("ci_json_invalid", "Expected valid UTF-8 JSON without duplicate keys or non-finite numbers")


def decode_base64(value: str, *, size=None, max_size=None) -> bytes:
    if (
        not isinstance(value, str)
        or not value
        or len(value) % 4 == 1
        or not (re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", value) or re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", value))
    ):
        _reject("ci_base64_invalid", "Expected standard or URL-safe Base64")
    try:
        normalized = value.translate(str.maketrans("-_", "+/"))
        decoded = base64.b64decode(normalized + "=" * (-len(normalized) % 4), validate=True)
        if base64.b64encode(decoded).decode().rstrip("=") != normalized.rstrip("="):
            raise ValueError("Noncanonical Base64 bits")
    except (ValueError, binascii.Error):
        _reject("ci_base64_invalid", "Invalid Base64 encoding")
    if (size is not None and len(decoded) != size) or (max_size is not None and len(decoded) > max_size):
        _reject("ci_bytes_invalid", "Decoded evidence length is outside the protocol bounds")
    return decoded


def pae(payload_type: str, payload_bytes: bytes) -> bytes:
    kind = payload_type.encode("utf-8")
    return (
        b"DSSEv1 "
        + str(len(kind)).encode("ascii")
        + b" "
        + kind
        + b" "
        + str(len(payload_bytes)).encode("ascii")
        + b" "
        + payload_bytes
    )


def policy_value(body, generation) -> dict:
    try:
        body = body if isinstance(body, ReleasePolicySave) else ReleasePolicySave.model_validate(body)
        if isinstance(generation, bool) or not isinstance(generation, int) or generation < 1:
            raise ValueError("Invalid policy generation")
    except (ValidationError, ValueError, TypeError):
        _reject("ci_policy_invalid", "Configure an explicit repository, workflow and Ed25519 public keys")
    keys = []
    for encoded in body.public_keys:
        public = decode_base64(encoded, size=32)
        key_id = hashlib.sha256(public).hexdigest()
        if any(item["key_id"] == key_id for item in keys):
            _reject("ci_policy_key_duplicate", "Trusted public keys must be distinct")
        Ed25519PublicKey.from_public_bytes(public)
        keys.append({"key_id": key_id, "public_key": base64.b64encode(public).decode("ascii")})
    return {
        "generation": generation,
        "repository": body.repository,
        "workflow": body.workflow,
        "keys": sorted(keys, key=lambda item: item["key_id"]),
    }


def verify_envelope(envelope: str, policy, *, tenant_id, project_id, scope_basis, now=None) -> dict:
    """Verify configured CI declarations, not a vendor identity or test coverage."""
    if not isinstance(envelope, str) or not 1 <= len(envelope) <= 131072:
        _reject("ci_envelope_invalid", "Supply the original CI envelope JSON text, at most 131072 characters")
    if not isinstance(policy, dict) or not policy.get("keys"):
        _reject("ci_policy_not_configured", "Configure trusted CI public keys before importing evidence", 409)
    try:
        canonical_policy = policy_value(
            {
                "repository": policy["repository"],
                "workflow": policy["workflow"],
                "public_keys": [key["public_key"] for key in policy["keys"]],
            },
            policy["generation"],
        )
        if {(key["key_id"], key["public_key"]) for key in canonical_policy["keys"]} != {
            (key["key_id"], base64.b64encode(decode_base64(key["public_key"], size=32)).decode())
            for key in policy["keys"]
        }:
            raise ValueError("Stored key ID mismatch")
        parsed = CiEnvelope.model_validate(strict_json(envelope))
    except (ValidationError, KeyError, TypeError, ValueError):
        _reject("ci_envelope_invalid", "CI envelope or trust policy does not match the strict protocol")
    payload_bytes = decode_base64(parsed.payload, max_size=65536)
    trusted = {key["key_id"]: decode_base64(key["public_key"], size=32) for key in canonical_policy["keys"]}
    signatures = []
    for signature in parsed.signatures:
        public = trusted.get(signature.keyid)
        if public is None:
            _reject("ci_signer_untrusted", "Every declared CI signer must be explicitly trusted", 401)
        signature_bytes = decode_base64(signature.sig, size=64)
        try:
            Ed25519PublicKey.from_public_bytes(public).verify(
                signature_bytes, pae(parsed.payloadType, payload_bytes)
            )
        except InvalidSignature:
            _reject("ci_signature_invalid", "CI signature does not match the original payload bytes", 401)
        signatures.append(
            {"keyid": signature.keyid, "sig": base64.b64encode(signature_bytes).decode("ascii")}
        )
    try:
        statement = CiStatement.model_validate(strict_json(payload_bytes))
        predicate = statement.predicate
        instant = now or datetime.now(timezone.utc)
        if not isinstance(instant, datetime) or instant.tzinfo is None or instant.utcoffset() is None:
            raise ValueError("Verification clock requires a timezone")
        finished = datetime.fromisoformat(predicate.finished_at.replace("Z", "+00:00"))
        if finished > instant + timedelta(minutes=5):
            raise ValueError("CI completion is in the future")
        matches = (
            predicate.tenant_id == tenant_id
            and predicate.project_id == project_id
            and predicate.scope_basis == scope_basis
            and predicate.policy_generation == policy["generation"]
            and predicate.repository == policy["repository"]
            and predicate.workflow == policy["workflow"]
        )
        if not matches:
            _reject(
                "ci_scope_mismatch",
                "CI evidence must match this tenant, project, quality scope and current policy",
            )
    except (ValidationError, ValueError, TypeError, OverflowError):
        _reject("ci_statement_invalid", "Signed CI statement has invalid or incomplete facts")
    tests = predicate.tests
    passed = (
        predicate.build_result == "passed"
        and tests.total > 0
        and tests.failed == 0
        and tests.errors == 0
        and tests.skipped < tests.total
    )
    normalized = {
        "payloadType": parsed.payloadType,
        "payload": base64.b64encode(payload_bytes).decode("ascii"),
        "signatures": sorted(signatures, key=lambda item: item["keyid"]),
    }
    envelope_digest = hashlib.sha256(
        json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "statement": statement.model_dump(by_alias=True),
        "key_id": min(item["keyid"] for item in signatures),
        "envelope_digest": envelope_digest,
        "passed": passed,
        "envelope": envelope,
    }
