"""Discussion reads, immutable writes and provenance use exact project routes."""

import json

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError


@pytest.fixture
def wire():
    seen = []
    with ManagerClient("https://manager.test", project_id="selected", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(
            base_url=client.base_url,
            transport=httpx.MockTransport(
                lambda request: (
                    seen.append(request)
                    or httpx.Response(200, json={"original": True, "next_cursor": "opaque"})
                )
            ),
        )
        yield client, seen


@pytest.mark.parametrize(
    "method,args,options,path,params",
    [
        (
            "delivery_discussions",
            (),
            {
                "subject_kind": "task",
                "subject_id": "task-one",
                "state": "resolved",
                "limit": 7,
                "cursor": "opaque+/=?",
            },
            "/discussions",
            {
                "subject_kind": "task",
                "subject_id": "task-one",
                "state": "resolved",
                "limit": "7",
                "cursor": "opaque+/=?",
            },
        ),
        ("delivery_discussion", ("thread-one",), {}, "/discussions/thread-one", {}),
        (
            "delivery_discussion_messages",
            ("thread-one",),
            {"limit": 7, "cursor": "opaque"},
            "/discussions/thread-one/messages",
            {"limit": "7", "cursor": "opaque"},
        ),
        (
            "delivery_discussion_message",
            ("thread-one", "message-one"),
            {},
            "/discussions/thread-one/messages/message-one",
            {},
        ),
        (
            "delivery_discussion_message_versions",
            ("thread-one", "message-one"),
            {"limit": 7},
            "/discussions/thread-one/messages/message-one/versions",
            {"limit": "7"},
        ),
        (
            "delivery_discussion_message_version",
            ("thread-one", "message-one", 3),
            {},
            "/discussions/thread-one/messages/message-one/versions/3",
            {},
        ),
        (
            "delivery_discussion_reference",
            ("task", "task-one"),
            {"field": "acceptance_criteria", "criterion_index": 0},
            "/discussion-references/task/task-one",
            {"field": "acceptance_criteria", "criterion_index": "0"},
        ),
        (
            "delivery_discussion_links",
            ("thread-one",),
            {"resolution_event_id": "resolution-one", "limit": 7},
            "/discussions/thread-one/links",
            {"resolution_event_id": "resolution-one", "limit": "7"},
        ),
        (
            "delivery_sources",
            ("task", "task-one"),
            {"limit": 7},
            "/sources",
            {"target_kind": "task", "target_id": "task-one", "limit": "7"},
        ),
    ],
)
def test_exact_reads_keep_selection_cursor_and_full_server_result(wire, method, args, options, path, params):
    client, seen = wire
    assert getattr(client, method)(*args, **options) == {"original": True, "next_cursor": "opaque"}
    assert len(seen) == 1 and seen[0].method == "GET"
    assert seen[0].url.path == "/api/v1/delivery" + path
    assert dict(seen[0].url.params) == params
    assert seen[0].headers["X-Project-Id"] == "selected"


CREATE = {
    "subject_kind": "task",
    "subject_id": "task-one",
    "title": "Review",
    "body": "明确原文",
    "idempotency_key": "original-key",
}
WRITES = [
    ("delivery_discussion_create", (), CREATE, "POST", "/discussions"),
    (
        "delivery_discussion_reply",
        ("thread-one",),
        {"body": "Reply", "parent_message_id": "message-one", "idempotency_key": "original-key"},
        "POST",
        "/discussions/thread-one/messages",
    ),
    (
        "delivery_discussion_edit",
        ("thread-one", "message-one"),
        {"body": "Edit", "expected_message_revision": 1, "idempotency_key": "original-key"},
        "PATCH",
        "/discussions/thread-one/messages/message-one",
    ),
    (
        "delivery_discussion_withdraw",
        ("thread-one", "message-one"),
        {"expected_message_revision": 1, "reason": "Human withdrawal", "idempotency_key": "original-key"},
        "POST",
        "/discussions/thread-one/messages/message-one/withdraw",
    ),
    (
        "delivery_discussion_resolve",
        ("thread-one",),
        {
            "expected_thread_version": 2,
            "message_id": "message-one",
            "message_revision": 1,
            "idempotency_key": "original-key",
        },
        "POST",
        "/discussions/thread-one/resolve",
    ),
    *[
        (
            "delivery_discussion_" + action,
            ("thread-one",),
            {"expected_thread_version": 2, "reason": "Explicit", "idempotency_key": "original-key"},
            "POST",
            "/discussions/thread-one/" + action,
        )
        for action in ("reopen", "archive", "restore")
    ],
    (
        "delivery_discussion_link",
        ("thread-one",),
        {
            "expected_thread_version": 2,
            "resolution_event_id": "resolution-one",
            "message_id": "message-one",
            "message_revision": 1,
            "target_kind": "task",
            "target_id": "task-two",
            "target_content_basis": "a" * 64,
            "idempotency_key": "original-key",
        },
        "POST",
        "/discussions/thread-one/links",
    ),
]


@pytest.mark.parametrize("method,args,body,verb,path", WRITES)
def test_writes_preserve_original_body_key_and_result(wire, method, args, body, verb, path):
    client, seen = wire
    before = json.dumps(body, sort_keys=True)
    assert getattr(client, method)(*args, body) == {"original": True, "next_cursor": "opaque"}
    assert seen[0].method == verb and seen[0].url.path == "/api/v1/delivery" + path
    assert json.loads(seen[0].content) == body
    assert json.dumps(body, sort_keys=True) == before


@pytest.mark.parametrize(
    "method,args,options",
    [
        ("delivery_discussions", (), {"limit": True}),
        ("delivery_discussions", (), {"limit": 1.5}),
        ("delivery_discussions", (), {"limit": 51}),
        ("delivery_discussions", (), {"state": "complete"}),
        ("delivery_discussions", (), {"subject_kind": "task"}),
        ("delivery_discussions", (), {"subject_id": "task-one"}),
        ("delivery_discussions", (), {"subject_kind": "project", "subject_id": "project"}),
        ("delivery_discussion", ("../bad",), {}),
        ("delivery_discussion_message", ("thread-one", "bad/id"), {}),
        ("delivery_discussion_message_version", ("thread-one", "message-one", True), {}),
        ("delivery_discussion_message_version", ("thread-one", "message-one", "3"), {}),
        ("delivery_discussion_message_version", ("thread-one", "message-one", 0), {}),
        ("delivery_sources", ("execution", "run-one"), {}),
        ("delivery_discussion_reference", ("execution", "execution-one"), {"field": "description"}),
        ("delivery_discussion_reference", ("task", "task-one"), {"field": "acceptance_criteria"}),
        (
            "delivery_discussion_reference",
            ("task", "task-one"),
            {"field": "acceptance_criteria", "criterion_index": True},
        ),
        (
            "delivery_discussion_reference",
            ("issue", "issue-one"),
            {"field": "acceptance_criteria", "criterion_index": 0},
        ),
    ],
)
def test_invalid_reads_fail_before_transport(wire, method, args, options):
    client, seen = wire
    with pytest.raises(ValueError):
        getattr(client, method)(*args, **options)
    assert seen == []


@pytest.mark.parametrize(
    "change",
    [
        {"idempotency_key": None},
        {"idempotency_key": ""},
        {"author_id": "forged"},
        {"body": "   "},
        {
            "refs": [
                {
                    "kind": "execution",
                    "id": "execution-one",
                    "field": "summary",
                    "text": "forged",
                    "source_content_basis": "a" * 64,
                }
            ]
        },
        {"refs": [{"kind": "execution", "id": "execution-one", "field": "summary"}]},
        {
            "refs": [
                {
                    "kind": "execution",
                    "id": "execution-one",
                    "field": "summary",
                    "source_content_basis": "X" * 64,
                }
            ]
        },
    ],
)
def test_invalid_writes_never_create_identity_basis_or_retry_key(wire, change):
    client, seen = wire
    with pytest.raises(ValueError):
        client.delivery_discussion_create({**CREATE, **change})
    assert seen == []


SOURCE = {
    "thread_id": "thread-one",
    "expected_thread_version": 2,
    "resolution_event_id": "resolution-one",
    "message_id": "message-one",
    "message_revision": 1,
}


@pytest.mark.parametrize(
    "action", ["requirement.update", "task.update", "tasks.plan", "issue.promote", "issue.diagnosis.adopt"]
)
def test_command_keeps_optional_root_source_and_original_retry_file(wire, action):
    client, seen = wire
    body = {
        "action": action,
        "payload": {"id": "selected"},
        "expected_version": 9,
        "idempotency_key": "fixed-business-key",
        "source_reference": SOURCE,
    }
    client.delivery_command(body)
    assert json.loads(seen[0].content) == body


@pytest.mark.parametrize(
    "source,action,extra",
    [
        (SOURCE, "execution.review", {}),
        ({**SOURCE, "message_revision": True}, "task.update", {}),
        ({**SOURCE, "expected_thread_version": "2"}, "task.update", {}),
        ({**SOURCE, "author": "forged"}, "task.update", {}),
        (SOURCE, "task.update", {"unexpected": True}),
    ],
)
def test_invalid_business_source_is_rejected_before_transport(wire, source, action, extra):
    client, seen = wire
    with pytest.raises(ValueError):
        client.delivery_command(
            {
                "action": action,
                "payload": {},
                "expected_version": 1,
                "idempotency_key": "original-key",
                "source_reference": source,
                **extra,
            }
        )
    assert seen == []


def test_stale_discussion_is_not_retried_or_replaced_with_workspace(wire):
    client, seen = wire
    client._client.close()
    client._client = httpx.Client(
        base_url=client.base_url,
        transport=httpx.MockTransport(
            lambda request: (
                seen.append(request)
                or httpx.Response(
                    409, json={"detail": {"code": "discussion_cursor_stale", "message": "Reload"}}
                )
            )
        ),
    )
    with pytest.raises(SopConflictError):
        client.delivery_discussion_messages("thread-one", cursor="pinned")
    assert len(seen) == 1 and seen[0].url.params["cursor"] == "pinned"


def test_source_command_transport_retry_keeps_identical_original_input():
    seen = []

    def handle(request):
        seen.append(request)
        if len(seen) == 1:
            raise httpx.ReadError("Response lost", request=request)
        return httpx.Response(
            200, json={"replayed": True, "resource": {"kind": "task", "id": "original-task"}}
        )

    body = {
        "action": "task.update",
        "payload": {"id": "task-one"},
        "expected_version": 9,
        "idempotency_key": "original-request-key",
        "source_reference": SOURCE,
    }
    with ManagerClient("https://manager.test", project_id="selected", max_retries=1) as client:
        client._client.close()
        client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(handle))
        assert client.delivery_command(body)["resource"]["id"] == "original-task"
    assert len(seen) == 2 and seen[0].content == seen[1].content
    assert json.loads(seen[0].content) == body


def test_null_source_keeps_existing_business_command_contract(wire):
    client, seen = wire
    body = {
        "action": "execution.sync",
        "payload": {"id": "execution-one"},
        "expected_version": 9,
        "idempotency_key": "original-request-key",
        "source_reference": None,
    }
    client.delivery_command(body)
    assert json.loads(seen[0].content) == body
