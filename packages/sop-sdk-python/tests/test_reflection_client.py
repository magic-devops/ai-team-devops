from __future__ import annotations

import json
from copy import deepcopy

import httpx
import pytest

from sop_sdk import ManagerClient
from sop_sdk.delivery_ack import DeliveryAckError
from sop_sdk.errors import SopConflictError, SopForbiddenError, SopNotFoundError, SopServerError, SopTransportError


def client(handler):
    manager = ManagerClient("https://manager.example", project_id="selected", max_retries=0)
    manager._client.close()
    manager._client = httpx.Client(base_url=manager.base_url, transport=httpx.MockTransport(handler))
    return manager


def call(manager, method, *args, **kwargs):
    selected = getattr(manager, method, None)
    assert callable(selected), f"Canonical {method} client method is missing"
    return selected(*args, **kwargs)


@pytest.mark.parametrize("method,args,options,path,params", [
    ("reflections", (), {}, "/api/v1/reflections", {"limit": "20"}),
    ("reflections", (), {"category": "testing", "occurred_from": "2026-10-19T00:00:00+08:00",
                         "occurred_to": "2026-10-20T00:00:00+08:00", "limit": 1, "cursor": "opaque/+?=:window"},
     "/api/v1/reflections", {"category": "testing", "occurred_from": "2026-10-19T00:00:00+08:00",
                              "occurred_to": "2026-10-20T00:00:00+08:00", "limit": "1", "cursor": "opaque/+?=:window"}),
    ("reflection", ("reflection-original",), {}, "/api/v1/reflections/reflection-original", {}),
    ("reflection_inputs", (), {"limit": 100, "cursor": "original-input-window"},
     "/api/v1/reflections/inputs", {"limit": "100", "cursor": "original-input-window"}),
    ("reflection_input", ("input-original",), {}, "/api/v1/reflections/inputs/input-original", {}),
])
def test_reads_preserve_exact_selection_and_only_fetch_one_explicit_page(method, args, options, path, params):
    seen = []
    original = {"project_id": "selected", "total": 1000, "items": [], "next_cursor": "unrequested-next",
                "available": False, "unavailable_reason": "source_missing"}
    with client(lambda req: seen.append(req) or httpx.Response(200, json=original)) as manager:
        assert call(manager, method, *args, **options) == original
    assert len(seen) == 1 and seen[0].method == "GET"
    assert seen[0].url.path == path and dict(seen[0].url.params) == params
    assert seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize("options", [
    {"limit": 0}, {"limit": 101}, {"limit": True}, {"limit": 1.1},
    {"cursor": None}, {"cursor": 1}, {"cursor": "x" * 4001},
    {"cursor": "x\n"}, {"cursor": "x\x85"}, {"cursor": "\ud800"},
])
@pytest.mark.parametrize("method", ["reflections", "reflection_inputs"])
def test_bad_page_never_reaches_transport(method, options):
    with client(lambda _: pytest.fail("Invalid page reached transport")) as manager:
        with pytest.raises(ValueError):
            call(manager, method, **options)


@pytest.mark.parametrize("options", [
    {"category": "all"}, {"category": None}, {"category": True},
    {"occurred_from": "2026-10-19"}, {"occurred_to": "2026-10-19T00:00:00"},
    {"occurred_from": "2026-10-19T00:00:00+00:60"},
    {"occurred_from": "2026-10-19T00:00:00Z", "occurred_to": "2026-10-19T00:00:00Z"},
    {"occurred_from": "2026-10-19T00:00:00Z", "occurred_to": "2026-10-18T00:00:00Z"},
])
def test_invalid_declared_time_filter_or_category_is_rejected(options):
    with client(lambda _: pytest.fail("Invalid reflection filter reached transport")) as manager:
        with pytest.raises(ValueError):
            call(manager, "reflections", **options)


@pytest.mark.parametrize("value", ["", "../other", "a/b", "a\\b", "a\x85", " a", "a ", "\ud800", "a" * 201])
@pytest.mark.parametrize("method", ["reflection", "reflection_input"])
def test_opaque_exact_identity_cannot_change_route(value, method):
    with client(lambda _: pytest.fail("Invalid reflection ID reached transport")) as manager:
        with pytest.raises(ValueError):
            call(manager, method, value)


@pytest.mark.parametrize("status,error", [(403, SopForbiddenError), (404, SopNotFoundError),
                                         (409, SopConflictError), (503, SopServerError)])
@pytest.mark.parametrize("method,args", [("reflections", ()), ("reflection", ("old",)),
                                        ("reflection_inputs", ()), ("reflection_input", ("old",))])
def test_unavailable_or_restricted_reads_remain_errors_without_fallback(status, error, method, args):
    seen = []
    with client(lambda req: seen.append(req) or httpx.Response(status, json={"detail": "Original unavailable"})) as manager:
        with pytest.raises(error):
            call(manager, method, *args)
    assert len(seen) == 1 and seen[0].method == "GET"


def input_command():
    return {"action": "reflection.input.create", "expected_version": 7, "idempotency_key": "original-input-key",
            "payload": {"title": "固定输入", "rationale": "人工核对这些原件", "sources": [
                {"reflection_id": "older", "source_digest": "a" * 64, "attempt_id": "attempt-old"},
                {"reflection_id": "newer", "source_digest": "b" * 64, "attempt_id": "attempt-new"},
            ]}}


def input_ack():
    return {"project_id": "selected", "action": "reflection.input.create",
            "resource": {"kind": "reflection_input", "id": "saved"},
            "result": {"status": "prepared", "source_count": 2},
            "affected_refs": [{"kind": "reflection_input", "id": "saved"}],
            "applied_version": 8, "version": 8, "query_generation": None, "replayed": False}


@pytest.mark.parametrize("version,generation,replayed", [(8, None, False), (12, 3, True), (12, None, True)])
def test_prepared_input_uses_existing_original_delivery_command_protocol(version, generation, replayed):
    seen = []
    body = input_command()
    ack = {**input_ack(), "version": version, "query_generation": generation, "replayed": replayed}
    original = json.dumps(body, ensure_ascii=False)
    with client(lambda req: seen.append(req) or httpx.Response(200, json=ack)) as manager:
        result = manager.delivery_command(body)
    assert result == ack
    assert len(seen) == 1 and seen[0].method == "POST" and seen[0].url.path == "/api/v1/delivery/commands"
    assert seen[0].headers["X-Project-Id"] == "selected"
    assert json.loads(seen[0].content) == body and json.dumps(body, ensure_ascii=False) == original


@pytest.mark.parametrize("field,value", [
    ("project_id", "another"), ("action", "task.delivery.submit"),
    ("applied_version", 7), ("applied_version", True), ("version", 7), ("version", 8.0),
    ("query_generation", 0), ("query_generation", True), ("replayed", 1),
    ("resource", {"kind": "task", "id": "saved"}),
    ("resource", {"kind": "reflection_input", "id": ""}),
    ("resource", {"kind": "reflection_input", "id": "different"}),
    ("resource", {"kind": "reflection_input", "id": "saved", "title": "leaked"}),
    ("affected_refs", []), ("affected_refs", [{"kind": "reflection_input", "id": "different"}]),
    ("affected_refs", [{"kind": "reflection_input", "id": "saved"}, {"kind": "reflection", "id": "older"}]),
    ("affected_refs", [{"kind": "reflection_input", "id": "saved", "title": "leaked"}]),
    ("result", {"status": "prepared"}), ("result", {"status": "processed", "source_count": 2}),
    ("result", {"status": "prepared", "source_count": 1}),
    ("result", {"status": "prepared", "source_count": 2.0}),
    ("result", {"status": "prepared", "source_count": True}),
    ("result", {"status": "prepared", "source_count": 2, "sources": ["older"]}),
    ("unexpected", "leaked"),
])
def test_prepared_input_rejects_mismatched_or_overbroad_ack(field, value):
    seen = []
    ack = {**input_ack(), field: value}
    with client(lambda req: seen.append(req) or httpx.Response(200, json=ack)) as manager:
        with pytest.raises(DeliveryAckError):
            manager.delivery_command(input_command())
    assert len(seen) == 1 and seen[0].method == "POST"


@pytest.mark.parametrize("field", ["project_id", "action", "resource", "result", "affected_refs",
                                    "applied_version", "version", "query_generation", "replayed"])
def test_prepared_input_requires_every_public_command_ack_field(field):
    ack = input_ack()
    del ack[field]
    with client(lambda _: httpx.Response(200, json=ack)) as manager:
        with pytest.raises(DeliveryAckError):
            manager.delivery_command(input_command())


@pytest.mark.parametrize("raw", [
    b"{}", b"null", b"[]", b"", b'{}' + b' ' * 65535,
    b'{"project_id":"selected","project_id":"selected"}', b'{"value":NaN}', b'\xff',
])
def test_prepared_input_requires_complete_bounded_strict_json_ack(raw):
    with client(lambda _: httpx.Response(200, content=raw, headers={"Content-Type": "application/json"})) as manager:
        with pytest.raises(DeliveryAckError):
            manager.delivery_command(input_command())


@pytest.mark.parametrize("change", [
    "missing-version", "boolean-version", "negative-version", "extra-envelope",
    "blank-key", "short-key", "long-key", "missing-title", "blank-title", "long-title",
    "blank-rationale", "long-rationale", "extra-payload", "no-sources", "too-many-sources",
    "duplicate-source", "missing-attempt", "blank-source-id", "long-source-id", "long-attempt-id",
    "bad-digest", "extra-source", "invalid-utf8",
])
def test_prepared_input_rejects_invalid_original_before_any_transport(change):
    body = input_command()
    p, source = body["payload"], body["payload"]["sources"][0]
    if change == "missing-version": del body["expected_version"]
    elif change == "boolean-version": body["expected_version"] = True
    elif change == "negative-version": body["expected_version"] = -1
    elif change == "extra-envelope": body["source_reference"] = {}
    elif change == "blank-key": body["idempotency_key"] = " " * 8
    elif change == "short-key": body["idempotency_key"] = "short"
    elif change == "long-key": body["idempotency_key"] = "k" * 101
    elif change == "missing-title": del p["title"]
    elif change == "blank-title": p["title"] = " "
    elif change == "long-title": p["title"] = "题" * 161
    elif change == "blank-rationale": p["rationale"] = " "
    elif change == "long-rationale": p["rationale"] = "由" * 2001
    elif change == "extra-payload": p["runtime_scopes"] = []
    elif change == "no-sources": p["sources"] = []
    elif change == "too-many-sources": p["sources"] = [dict(source, reflection_id=f"id-{i}") for i in range(33)]
    elif change == "duplicate-source": p["sources"][1]["reflection_id"] = source["reflection_id"]
    elif change == "missing-attempt": del source["attempt_id"]
    elif change == "blank-source-id": source["reflection_id"] = ""
    elif change == "long-source-id": source["reflection_id"] = "r" * 65
    elif change == "long-attempt-id": source["attempt_id"] = "a" * 65
    elif change == "bad-digest": source["source_digest"] = "A" * 64
    elif change == "extra-source": source["title"] = "not-part-of-reference"
    elif change == "invalid-utf8": p["title"] = "\ud800"
    original = deepcopy(body)
    with client(lambda _: pytest.fail("Invalid original reached transport")) as manager:
        with pytest.raises(ValueError):
            manager.delivery_command(body)
    assert body == original


def test_prepared_input_preserves_all_32_ordered_sources_at_unicode_character_limits():
    body = input_command()
    body["payload"] = {"title": "😀" * 160, "rationale": "据" * 2000, "sources": [
        {"reflection_id": "反" * 62 + f"{i:02d}", "source_digest": "a" * 64, "attempt_id": "始" * 64}
        for i in range(32)
    ]}
    ack = {**input_ack(), "result": {"status": "prepared", "source_count": 32}}
    seen = []
    with client(lambda req: seen.append(req) or httpx.Response(200, json=ack)) as manager:
        assert manager.delivery_command(body) == ack
    assert len(seen) == 1 and json.loads(seen[0].content) == body


@pytest.mark.parametrize("key", ["original-input-key", " original-key ", "original\u0001key", "原始请求身份123"])
def test_prepared_input_lost_ack_replays_same_body_version_key_without_source_or_latest_reads(key):
    seen = []

    def handle(request):
        assert request.method == "POST" and request.url.path == "/api/v1/delivery/commands"
        seen.append(request.content)
        if len(seen) == 1:
            raise httpx.ReadError("ACK lost after commit", request=request)
        return httpx.Response(200, json={**input_ack(), "version": 20, "replayed": True})

    body = input_command()
    body["idempotency_key"] = key
    original = deepcopy(body)
    with client(handle) as manager:
        manager.max_retries = 3
        with pytest.raises(SopTransportError):
            manager.delivery_command(body)
        assert len(seen) == 1
        assert manager.delivery_command(body)["replayed"] is True
    assert len(seen) == 2 and seen[0] == seen[1] and json.loads(seen[0]) == original
    assert body == original


@pytest.mark.parametrize("version", [7, 9007199254740992, 9223372036854775806])
def test_prepared_input_preserves_legal_python_versions_and_explicit_null_provenance(version):
    body = {**input_command(), "expected_version": version, "source_reference": None}
    ack = {**input_ack(), "applied_version": version + 1, "version": version + 1}
    seen = []
    with client(lambda req: seen.append(req) or httpx.Response(200, json=ack)) as manager:
        assert manager.delivery_command(body) == ack
    assert json.loads(seen[0].content) == body


def test_legacy_distillation_methods_are_retired_without_aliases():
    for name in ["reflection_distill", "reflection_proposals", "reflection_review_proposal"]:
        assert not hasattr(ManagerClient, name), f"Retired {name} method still exposes the global legacy pipeline"
