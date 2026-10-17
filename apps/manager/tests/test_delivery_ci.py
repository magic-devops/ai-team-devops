"""Strict signed CI evidence contracts and real Ed25519 verification."""

import base64
import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from importlib import import_module

import pytest
from fastapi import HTTPException
from pydantic import ValidationError


def test_ci_contract_requires_fixed_scope_and_public_keys_only():
    dto = import_module("sop_manager.routers.delivery_ci_contract")
    assert dto.ReleasePolicySave(
        repository="https://example.test/team/repo", workflow="build", public_keys=["A" * 43 + "="]
    )
    with pytest.raises(ValidationError):
        dto.ReleasePolicySave(
            repository="https://example.test/repo",
            workflow="build",
            public_keys=["key"],
            private_key="secret",
        )
    with pytest.raises(ValidationError):
        dto.ReleaseCiImport(envelope="{}", requirement_ids=["R", "R"])


def test_pae_uses_utf8_byte_lengths():
    ci = import_module("sop_manager.routers.delivery_ci")
    assert ci.pae("类型", "交付".encode()) == b"DSSEv1 6 " + "类型".encode() + b" 6 " + "交付".encode()


NOW = datetime(2026, 10, 17, 10, tzinfo=timezone.utc)


def ci_module():
    ci = import_module("sop_manager.routers.delivery_ci")
    assert hasattr(ci, "verify_envelope"), "CI signature verifier is not implemented"
    assert hasattr(ci, "policy_value"), "CI trust policy is not implemented"
    return ci


@pytest.fixture
def signed():
    ci = ci_module()
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))
    public = key.public_key().public_bytes_raw()
    policy = ci.policy_value(
        {
            "repository": "https://example.test/team/repo",
            "workflow": "构建 / build",
            "public_keys": [base64.b64encode(public).decode()],
        },
        3,
    )
    statement = {
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{"name": "app.tar.gz", "digest": {"sha256": "a" * 64}}],
        "predicateType": "urn:sop:delivery:ci-evidence:v1",
        "predicate": {
            "tenant_id": "tenant",
            "project_id": "project",
            "policy_generation": 3,
            "repository": policy["repository"],
            "workflow": policy["workflow"],
            "commit_sha": "b" * 40,
            "run_uri": "https://example.test/runs/12",
            "run_number": 12,
            "run_attempt": 2,
            "scope_basis": "c" * 64,
            "build_result": "passed",
            "tests": {"total": 8, "failed": 0, "errors": 0, "skipped": 1},
            "finished_at": NOW.isoformat(),
        },
    }
    return ci, key, policy, statement


def envelope(signed, *, statement=None, raw=None, urlsafe=False):
    ci, key, policy, original = signed
    raw = (
        raw
        if raw is not None
        else json.dumps(statement or original, ensure_ascii=False, indent=1).encode("utf-8") + b"\n"
    )
    encode = base64.urlsafe_b64encode if urlsafe else base64.b64encode
    result = {
        "payloadType": "application/vnd.in-toto+json",
        "payload": encode(raw).decode(),
        "signatures": [
            {
                "keyid": policy["keys"][0]["key_id"],
                "sig": encode(key.sign(ci.pae("application/vnd.in-toto+json", raw))).decode(),
            }
        ],
    }
    return json.dumps(result, ensure_ascii=False)


def verify(signed, text=None, **context):
    ci, _, policy, _ = signed
    return ci.verify_envelope(
        text or envelope(signed),
        policy,
        tenant_id=context.get("tenant_id", "tenant"),
        project_id=context.get("project_id", "project"),
        scope_basis=context.get("scope_basis", "c" * 64),
        now=NOW,
    )


@pytest.mark.parametrize("urlsafe", [False, True])
def test_real_signature_uses_original_utf8_bytes_and_returns_typed_facts(signed, urlsafe):
    source = envelope(signed, urlsafe=urlsafe)
    result = verify(signed, source)
    assert result["passed"] is True and result["statement"] == signed[3]
    assert result["key_id"] == signed[2]["keys"][0]["key_id"]
    assert len(result["envelope_digest"]) == 64 and result["envelope"] == source
    assert (
        verify(signed, json.dumps(json.loads(source), indent=2))["envelope_digest"]
        == result["envelope_digest"]
    )


def test_policy_normalizes_key_bytes_and_rejects_duplicate_trust(signed):
    ci, _, policy, _ = signed
    public = policy["keys"][0]["public_key"]
    duplicate = base64.urlsafe_b64encode(base64.b64decode(public)).decode().rstrip("=")
    assert policy["keys"][0]["key_id"] == hashlib.sha256(base64.b64decode(public)).hexdigest()
    with pytest.raises(HTTPException):
        ci.policy_value(
            {
                "repository": policy["repository"],
                "workflow": policy["workflow"],
                "public_keys": [public, duplicate],
            },
            4,
        )
    for key in ["bad", base64.b64encode(b"short").decode()]:
        with pytest.raises(HTTPException):
            ci.policy_value(
                {"repository": policy["repository"], "workflow": policy["workflow"], "public_keys": [key]}, 4
            )


@pytest.mark.parametrize(
    "field,value",
    [
        ("tenant_id", "foreign"),
        ("project_id", "foreign"),
        ("scope_basis", "d" * 64),
        ("policy_generation", 2),
        ("repository", "https://example.test/other"),
        ("workflow", "other"),
        ("run_number", True),
        ("run_attempt", 0),
        ("commit_sha", "b" * 39),
        ("commit_sha", "B" * 40),
        ("finished_at", "2026-10-17T10:00:00"),
        ("finished_at", "2026-10-17T10:05:01Z"),
        ("run_uri", "http://example.test/run"),
        ("run_uri", "https://user:password@example.test/run"),
        ("run_uri", "https://example.test/run#fragment"),
        ("unknown", "value"),
    ],
)
def test_trusted_signer_cannot_claim_invalid_or_foreign_scope(signed, field, value):
    statement = deepcopy(signed[3])
    statement["predicate"][field] = value
    with pytest.raises(HTTPException) as raised:
        verify(signed, envelope(signed, statement=statement))
    assert raised.value.status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"build_result": "failed"},
        {"tests": {"total": 0, "failed": 0, "errors": 0, "skipped": 0}},
        {"tests": {"total": 3, "failed": 1, "errors": 0, "skipped": 0}},
        {"tests": {"total": 3, "failed": 0, "errors": 1, "skipped": 0}},
        {"tests": {"total": 3, "failed": 0, "errors": 0, "skipped": 3}},
    ],
)
def test_failed_or_empty_checks_are_valid_audit_evidence_but_never_pass(signed, changes):
    statement = deepcopy(signed[3])
    statement["predicate"].update(changes)
    assert verify(signed, envelope(signed, statement=statement))["passed"] is False


@pytest.mark.parametrize(
    "counts",
    [
        {"total": 1, "failed": 1, "errors": 1, "skipped": 0},
        {"total": True, "failed": 0, "errors": 0, "skipped": 0},
        {"total": 3, "failed": -1, "errors": 0, "skipped": 0},
        {"total": 10_000_001, "failed": 0, "errors": 0, "skipped": 0},
        {"total": 3, "failed": 0, "errors": 0},
    ],
)
def test_impossible_or_incomplete_test_counts_are_rejected(signed, counts):
    statement = deepcopy(signed[3])
    statement["predicate"]["tests"] = counts
    with pytest.raises(HTTPException):
        verify(signed, envelope(signed, statement=statement))


@pytest.mark.parametrize("mode", ["tampered", "keyid", "signature", "untrusted_extra"])
def test_signature_and_each_declared_signer_must_be_trusted(signed, mode):
    value = json.loads(envelope(signed))
    if mode == "tampered":
        raw = base64.b64decode(value["payload"]).replace(b"app.tar.gz", b"new.tar.gz")
        value["payload"] = base64.b64encode(raw).decode()
    elif mode == "keyid":
        value["signatures"][0]["keyid"] = "0" * 64
    elif mode == "signature":
        value["signatures"][0]["sig"] = base64.b64encode(b"0" * 64).decode()
    else:
        value["signatures"].append({"keyid": "0" * 64, "sig": value["signatures"][0]["sig"]})
    with pytest.raises(HTTPException) as raised:
        verify(signed, json.dumps(value))
    assert raised.value.status_code == 401


@pytest.mark.parametrize(
    "raw",
    [
        b'{"_type":1,"_type":2}',
        b'{"value":NaN}',
        b'{"value":Infinity}',
        b'{"value":1e999}',
        b'{"x":"\xff"}',
        b'{"x":"\\ud800"}',
    ],
)
def test_signed_payload_rejects_duplicate_json_nonfinite_and_invalid_unicode(signed, raw):
    with pytest.raises(HTTPException) as raised:
        verify(signed, envelope(signed, raw=raw))
    assert raised.value.status_code == 422


@pytest.mark.parametrize(
    "mode",
    ["object", "duplicate", "unknown", "bad64", "empty_signatures", "duplicate_signature", "wrong_type"],
)
def test_envelope_has_one_strict_shape(signed, mode):
    raw = envelope(signed)
    value = json.loads(raw)
    if mode == "object":
        raw = value
    elif mode == "duplicate":
        raw = raw[:-1] + ', "payload":"ignored"}'
    elif mode == "unknown":
        value["extension"] = "ignored"
        raw = json.dumps(value)
    elif mode == "bad64":
        value["payload"] = "ab$="
        raw = json.dumps(value)
    elif mode == "empty_signatures":
        value["signatures"] = []
        raw = json.dumps(value)
    elif mode == "duplicate_signature":
        value["signatures"] *= 2
        raw = json.dumps(value)
    else:
        value["payloadType"] = "application/json"
        raw = json.dumps(value)
    with pytest.raises(HTTPException):
        verify(signed, raw)


def test_payload_limits_and_missing_policy_fail_closed(signed):
    with pytest.raises(HTTPException):
        verify(signed, envelope(signed, raw=b" " * 65537))
    with pytest.raises(HTTPException):
        signed[0].verify_envelope(
            envelope(signed), None, tenant_id="tenant", project_id="project", scope_basis="c" * 64, now=NOW
        )


@pytest.mark.parametrize(
    "uri",
    [
        "https://example.test/runs/1?token=value",
        "https://example.test/runs/1?",
        "https://example.test\\@other.test/run",
    ],
)
def test_run_locations_cannot_disclose_credentials_or_change_url_interpretation(signed, uri):
    statement = deepcopy(signed[3])
    statement["predicate"]["run_uri"] = uri
    with pytest.raises(HTTPException):
        verify(signed, envelope(signed, statement=statement))


def test_strict_json_rejects_numeric_overflow_to_nonfinite():
    with pytest.raises(HTTPException):
        ci_module().strict_json('{"value":1e999}')
