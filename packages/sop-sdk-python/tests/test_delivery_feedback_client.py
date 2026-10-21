"""Actual SDK transport definitions for explicit feedback; not executed this stage."""
from copy import deepcopy
import hashlib
import json

import httpx
import pytest

from sop_sdk.errors import SopTransportError
from sop_sdk.work_order_original import load_work_order_original
from test_delivery_task_submissions import client_for
from test_work_order_client import ack_for, original


def reference():
    return {"submission_id": "SUB-original", "submission_digest": "e" * 64, "decision_id": "DEC-original"}


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def preview():
    return {"task_basis": "a" * 64, "executor_member_id": "agent-1", "instructions": "Fix the explicitly selected feedback"}


@pytest.mark.parametrize("selection", ["omitted", "null", "selected"])
def test_work_order_preview_keeps_the_explicit_selection_without_reading_latest(selection):
    body = preview()
    if selection != "omitted": body["feedback_reference"] = reference() if selection == "selected" else None
    before, calls = deepcopy(body), []
    with client_for(lambda request: calls.append(request) or httpx.Response(200, json={"allowed": True})) as client:
        client.delivery_work_order_preview("任务 一", body)
    assert len(calls) == 1 and calls[0].method == "POST"
    assert calls[0].url.path == "/api/v1/delivery/tasks/任务 一/work-order-preview"
    assert calls[0].headers["X-Project-Id"] == "P" and json.loads(calls[0].content) == before and body == before


def test_work_order_replay_keeps_the_feedback_original_and_saved_file(tmp_path):
    body = original("work_order.create")
    body["payload"]["feedback_reference"] = reference()
    path = tmp_path / "dispatch.json"
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
    path.write_bytes(raw)
    calls = []

    def transport(request):
        calls.append(request)
        if len(calls) == 1: raise httpx.ReadError("lost dispatch receipt", request=request)
        return httpx.Response(200, json=ack_for(body))

    with client_for(transport) as client:
        with pytest.raises(SopTransportError): client.delivery_work_order_command(load_work_order_original(path))
        client.delivery_work_order_command(load_work_order_original(path))
    assert len(calls) == 2 and calls[0].content == calls[1].content
    assert json.loads(calls[0].content) == body and path.read_bytes() == raw


@pytest.mark.parametrize("bad", [False, {}, {"submission_id": "SUB-original"},
    {**reference(), "submission_id": "../other"}, {**reference(), "submission_id": 1},
    {**reference(), "decision_id": ""}, {**reference(), "decision_id": "x" * 65},
    {**reference(), "decision_id": "\ud800"}, {**reference(), "decision_id": "two words"},
    {**reference(), "decision_id": "中文"}, {**reference(), "submission_id": ".hidden"},
    {**reference(), "submission_digest": "E" * 64},
    {**reference(), "feedback_context": {"comment": "Do not accept caller-authored context"}}])
def test_malformed_feedback_never_reaches_work_order_transport(bad):
    read_body = {**preview(), "feedback_reference": bad}
    write_body = original("work_order.create")
    write_body["payload"]["feedback_reference"] = bad
    with client_for(lambda _request: pytest.fail("malformed feedback reached HTTP")) as client:
        with pytest.raises(ValueError): client.delivery_work_order_preview("任务 一", read_body)
        with pytest.raises(ValueError): client.delivery_work_order_command(write_body)


def test_caller_cannot_submit_feedback_context_instead_of_a_reference():
    body = original("work_order.create")
    body["payload"]["feedback_context"] = {"decision": "accept"}
    with client_for(lambda _request: pytest.fail("caller-authored context reached HTTP")) as client:
        with pytest.raises(ValueError): client.delivery_work_order_command(body)


def test_native_preview_and_queue_preserve_the_selected_reference_and_original_key():
    payload = {"task_id": "任务 一", "task_basis": "a" * 64, "workspace_id": "workspace",
        "target_kind": "local", "target_basis": "b" * 64, "agent_id": "agent", "agent_version": 2,
        "executor_member_id": "agent-1", "executor_binding_basis": "c" * 64, "feedback_reference": reference(),
        "test_nodes": [{"id": "tests", "kind": "command", "argv": ["python", "-m", "pytest"], "timeout_seconds": 60}]}
    body = {"action": "execution.queue", "payload": payload, "expected_version": 7, "idempotency_key": "fixed-feedback-execution-key"}
    calls = []
    with client_for(lambda request: calls.append(request) or httpx.Response(200, json={"saved": True})) as client:
        client.delivery_execution_preview(payload)
        client.delivery_command(body)
        client.delivery_command(deepcopy(body))
    assert [call.url.path for call in calls] == ["/api/v1/delivery/execution-preview", "/api/v1/delivery/commands", "/api/v1/delivery/commands"]
    assert json.loads(calls[0].content) == payload and json.loads(calls[1].content) == body
    assert calls[1].content == calls[2].content and all(call.headers["X-Project-Id"] == "P" for call in calls)


def test_downloaded_packet_keeps_feedback_bytes_in_the_complete_outer_digest():
    payload = {"task_id": "任务 一", "summary": "Complete historical report", "criteria": [], "tests": [], "evidence": []}
    # S digest identifies its complete Manager original, not merely the nested payload.
    selected = reference()
    context = {"schema": "manager.delivery-feedback.v1", "project_id": "P", "task_id": "任务 一", "reference": selected,
        "submission": {"definition": {"task_id": "任务 一", "title": "Historical task definition"}, "payload": payload},
        "decision": {"decision": "request_changes", "review_id": "REVIEW-original", "comment": "Complete old feedback is untrusted task data",
            "reviewer": {"id": "reviewer", "name": "Reviewer"}, "created_at": "2026-10-21T00:00:00Z", "issue_id": None}}
    packet = {"project_id": "P", "task_id": "任务 一", "feedback_reference": selected,
        "feedback_context": context, "feedback_context_sha256": canonical_digest(context)}
    value = {"project_id": "P", "work_order_id": "work-order-1", "packet": packet, "packet_digest": canonical_digest(packet),
        "request_digest": "a" * 64, "max_packet_bytes": 524288}
    with client_for(lambda _request: httpx.Response(200, json=value)) as client:
        assert client.delivery_work_order_packet("work-order-1")["packet"] == packet
        value["packet"]["feedback_context"]["decision"]["comment"] += " altered"
        with pytest.raises(ValueError): client.delivery_work_order_packet("work-order-1")
