"""Actual HTTP transport definitions; application/runtime validation is deferred."""
import json
from copy import deepcopy

import httpx
import pytest

from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopTransportError
from sop_sdk.task_submission import MAX_REPORT_BYTES, load_submission_command, submission_command_body


def original(review=False):
    payload = {"task_id": "任务 一", "task_basis": "a" * 64, "definition_digest": "b" * 64, "native_boundary_digest": "c" * 64,
        "source": {"kind": "tool", "name": "External editor"}, "summary": "Reported change; human review required",
        "artifacts": [{"id": "diff", "title": "Code review", "content": "Reported diff; not runtime proof"}],
        "criteria": [{"source": "task", "index": 0, "text_digest": "d" * 64, "result": "met", "evidence_ids": ["diff"]}],
        "tests": [{"id": "check", "title": "Reported test", "status": "passed", "evidence_ids": ["diff"]}]}
    if review:
        payload = {"task_id": "任务 一", "submission_id": "SUB-1", "submission_digest": "b" * 64, "task_basis": "a" * 64,
            "native_boundary_digest": "c" * 64, "decision": "accept", "comment": "Human checked the exact evidence"}
    return {"expected_version": 7, "idempotency_key": "fixed-original-key", "payload": payload}


def client_for(handler):
    client = ManagerClient(base_url="https://manager.test", project_id="P", max_retries=0)
    client._client.close()
    client._client = httpx.Client(base_url="https://manager.test", transport=httpx.MockTransport(handler))
    return client


def ack_for(body, review=False):
    p = body["payload"]
    action = "task.delivery.review" if review else "task.delivery.submit"
    submission_id = p["submission_id"] if review else "S1"
    result = {"task_ids": [p["task_id"]], "submission_id": submission_id,
        "submission_digest": p["submission_digest"] if review else "e" * 64, "issue_id": None}
    resource = {"kind": "task_review" if review else "task_submission", "id": "R1" if review else submission_id}
    refs = [resource, {"kind": "task", "id": p["task_id"]}]
    if review:
        result.update(decision_id="D1", review_id="R1")
        refs.append({"kind": "task_submission", "id": submission_id})
    elif p.get("work_order"):
        w = p["work_order"]
        result["work_order"] = {"id": w["id"], "order_revision": w["order_revision"] + 1, "state": "reported"}
        refs.append({"kind": "work_order", "id": w["id"]})
    return {"project_id": "P", "action": action, "resource": resource, "result": result,
        "affected_refs": refs, "applied_version": 8, "version": 8, "query_generation": 1, "replayed": True}


def test_current_history_exact_reads_keep_unicode_path_scope_cursor_and_one_page():
    calls = []
    with client_for(lambda request: calls.append(request) or httpx.Response(200, json={"next_cursor": "more", "items": []})) as client:
        client.delivery_task_submission_current("任务 一")
        client.delivery_task_submissions("任务 一", limit=1, cursor="original +/=? cursor")
        client.delivery_task_submission("任务 一", "SUB-1")
    assert len(calls) == 3 and all(call.method == "GET" and call.headers["X-Project-Id"] == "P" for call in calls)
    assert [call.url.path for call in calls] == [
        "/api/v1/delivery/tasks/任务 一/delivery-submissions/current", "/api/v1/delivery/tasks/任务 一/delivery-submissions",
        "/api/v1/delivery/tasks/任务 一/delivery-submissions/SUB-1"]
    assert b"%E4%BB%BB%E5%8A%A1%20%E4%B8%80" in calls[0].url.raw_path
    assert dict(calls[1].url.params) == {"limit": "1", "cursor": "original +/=? cursor"}


@pytest.mark.parametrize("task", ["", "../task", "task/other", "task\\other", "task\x00", "task\x85", "x" * 65, "\ud800"])
def test_invalid_task_scope_never_reaches_transport(task):
    calls = []
    with client_for(lambda request: calls.append(request) or httpx.Response(200, json={})) as client:
        for method in (client.delivery_task_submission_current, client.delivery_task_submissions):
            with pytest.raises(ValueError):
                method(task)
    assert calls == []


@pytest.mark.parametrize("selection", [{"limit": True}, {"limit": 0}, {"limit": 101}, {"cursor": "a\x7f"}, {"cursor": "a\x85"}, {"cursor": "x" * 4001}])
def test_invalid_page_does_not_send(selection):
    calls = []
    with client_for(lambda request: calls.append(request) or httpx.Response(200, json={})) as client:
        with pytest.raises(ValueError):
            client.delivery_task_submissions("T", **selection)
    assert calls == []


@pytest.mark.parametrize("submission", ["", "../other", "other/path", "外部报告", "x" * 65, "S\n"])
def test_invalid_exact_submission_reference_does_not_send(submission):
    with client_for(lambda _request: pytest.fail("Invalid submission must not reach transport")) as client:
        with pytest.raises(ValueError):
            client.delivery_task_submission("任务 一", submission)


@pytest.mark.parametrize("review", [False, True])
def test_exact_report_and_human_review_write_do_not_fetch_or_adopt_current_versions(review):
    calls = []
    body = original(review)
    with client_for(lambda request: calls.append(request) or httpx.Response(200, json=ack_for(body, review))) as client:
        method = client.delivery_task_submit_review if review else client.delivery_task_submit
        method(body)
        method(deepcopy(body))
    assert len(calls) == 2 and calls[0].content == calls[1].content
    assert all(call.method == "POST" and call.url.path == "/api/v1/delivery/commands" for call in calls)
    assert json.loads(calls[0].content) == {"action": "task.delivery.review" if review else "task.delivery.submit", **body}
    assert all(call.headers["X-Project-Id"] == "P" for call in calls)


def test_transport_loss_reuses_original_without_implicit_replacement_and_conflict_is_visible():
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadError("Reply lost", request=request)
        return httpx.Response(409, json={"detail": "task basis changed"})

    body = original()
    with client_for(handler) as client:
        with pytest.raises(SopTransportError):
            client.delivery_task_submit(body)
        with pytest.raises(SopConflictError):
            client.delivery_task_submit(body)
    assert len(calls) == 2 and calls[0].content == calls[1].content


def test_bound_report_preserves_exact_work_order_stop_statement_in_one_command_and_replay():
    """Actual ManagerClient transport definition; not executed in this source stage."""
    body = original()
    body["payload"]["work_order"] = {"id": "W1", "order_revision": 2, "stopped_attestation": True}
    captured = deepcopy(body)
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadError("Lost handoff receipt", request=request)
        return httpx.Response(200, json=ack_for(body))

    with client_for(handler) as client:
        with pytest.raises(SopTransportError):
            client.delivery_task_submit(body)
        result = client.delivery_task_submit(body)
    assert len(calls) == 2 and calls[0].content == calls[1].content
    assert all(call.method == "POST" and call.url.path == "/api/v1/delivery/commands" for call in calls)
    assert json.loads(calls[0].content) == {"action": "task.delivery.submit", **captured}
    assert result["result"]["work_order"] == {"id": "W1", "order_revision": 3, "state": "reported"}
    assert body == captured


def test_current_handoff_context_is_one_read_and_report_only_does_not_acquire_it_implicitly():
    calls = []
    context = {"id": "W1", "order_revision": 2, "executor": {"id": "tool:codex", "name": "Codex", "kind": "tool", "tool": "codex", "active": True, "available": True, "reasons": []}}

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"work_order": context} if request.method == "GET" else ack_for(body))

    body = original()
    with client_for(handler) as client:
        assert client.delivery_task_submission_current("T")["work_order"] == context
        client.delivery_task_submit(body)
    assert len(calls) == 2 and [call.method for call in calls] == ["GET", "POST"]
    assert "work_order" not in json.loads(calls[1].content)["payload"]


@pytest.mark.parametrize("change", ["version_missing", "key_missing", "payload_missing", "bool_version", "action_extra", "source_extra", "short_key", "nan", "object_key"])
def test_original_envelope_is_strict_and_never_infers_values(change):
    body = original()
    if change.endswith("missing"):
        body.pop({"version_missing": "expected_version", "key_missing": "idempotency_key", "payload_missing": "payload"}[change])
    elif change == "bool_version": body["expected_version"] = True
    elif change == "action_extra": body["action"] = "task.delivery.submit"
    elif change == "source_extra": body["source_reference"] = {}
    elif change == "short_key": body["idempotency_key"] = "short"
    elif change == "nan": body["payload"]["untrusted"] = float("nan")
    else: body["payload"][1] = "not a string key"
    with pytest.raises(ValueError):
        submission_command_body(body)


def test_file_rejects_duplicate_keys_invalid_unicode_and_complete_utf8_budget(tmp_path):
    file = tmp_path / "original.json"
    for raw in [b'{"expected_version":7,"expected_version":8,"idempotency_key":"original-key","payload":{}}', b'\xff',
                b'{"expected_version":7,"idempotency_key":"original-key","payload":{"number":NaN}}']:
        file.write_bytes(raw)
        with pytest.raises(ValueError):
            load_submission_command(file)
        assert file.read_bytes() == raw
    body = original(); body["payload"]["summary"] = "界" * (MAX_REPORT_BYTES // 3)
    with pytest.raises(ValueError, match="48 KiB"):
        submission_command_body(body)
