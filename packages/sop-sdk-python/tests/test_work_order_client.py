"""Actual HTTP fault definitions for work orders; execution is deferred."""
from copy import deepcopy
import hashlib
import json

import httpx
import pytest

from sop_sdk.errors import SopTransportError
from sop_sdk.work_order_original import load_work_order_original, work_order_command_body
from test_delivery_task_submissions import client_for


def original(action="work_order.progress"):
    payloads = {
        "work_order.create": {"task_id": "任务 一", "task_basis": "a" * 64, "definition_digest": "b" * 64,
            "native_boundary_digest": "c" * 64, "executor_member_id": "agent-1", "preview_basis": "d" * 64, "instructions": "完整设计与验收条件"},
        "work_order.claim": {"id": "work-order-1", "order_revision": 2},
        "work_order.progress": {"id": "work-order-1", "order_revision": 2, "percent": None, "status": "blocked", "message": "等待实际测试环境"},
        "work_order.cancel": {"id": "work-order-1", "order_revision": 2, "comment": "请先停止外部工作"},
        "work_order.release": {"id": "work-order-1", "order_revision": 2, "stopped_attestation": True, "comment": "已停止外部工具"},
        "work_order.report": {"id": "work-order-1", "order_revision": 2, "submission_id": "submission-1", "submission_digest": "e" * 64, "stopped_attestation": True},
    }
    return {"action": action, "expected_version": 7, "idempotency_key": "fixed-work-order-original", "payload": payloads[action]}


def packet_view():
    packet = {"project_id": "P", "task_id": "任务 一", "design_context": [{"content": "固定设计原文" * 6000}]}
    digest = hashlib.sha256(json.dumps(packet, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
    return {"project_id": "P", "work_order_id": "work-order-1", "packet": packet, "packet_digest": digest,
        "request_digest": "a" * 64, "max_packet_bytes": 524288}


def test_exact_scope_filter_page_and_packet_remain_complete():
    calls = []
    def transport(request):
        calls.append(request)
        return httpx.Response(200, json=packet_view() if request.url.path.endswith("/packet") else {"items": [], "next_cursor": "more"})
    with client_for(transport) as client:
        client.delivery_work_order_current("任务 一")
        client.delivery_work_order_preview("任务 一", {"task_basis": "a" * 64, "executor_member_id": "agent-1", "instructions": ""})
        client.delivery_work_orders(task_id="任务 一", state="claimed", limit=1, cursor="fixed +/=cursor")
        client.delivery_work_order("work-order-1")
        result = client.delivery_work_order_packet("work-order-1")
    assert len(calls) == 5 and all(call.headers["X-Project-Id"] == "P" for call in calls)
    assert calls[0].url.path == "/api/v1/delivery/tasks/任务 一/work-orders/current"
    assert calls[1].method == "POST" and calls[1].url.path.endswith("/work-order-preview")
    assert dict(calls[2].url.params) == {"task_id": "任务 一", "state": "claimed", "limit": "1", "cursor": "fixed +/=cursor"}
    assert result["packet"] == packet_view()["packet"]


@pytest.mark.parametrize("action", ["work_order.create", "work_order.claim", "work_order.progress", "work_order.cancel", "work_order.release", "work_order.report"])
def test_unknown_write_replays_the_exact_same_version_key_payload(action):
    calls = []
    body = original(action)
    def transport(request):
        calls.append(request)
        if len(calls) == 1: raise httpx.ReadError("response lost", request=request)
        return httpx.Response(200, json={"resource": {"kind": "work_order", "id": "work-order-1"}})
    with client_for(transport) as client:
        with pytest.raises(SopTransportError): client.delivery_work_order_command(body)
        client.delivery_work_order_command(deepcopy(body))
    assert len(calls) == 2 and calls[0].content == calls[1].content
    assert json.loads(calls[0].content) == body and body == original(action)


@pytest.mark.parametrize("mutation", ["version", "key", "action", "revision", "percent_bool", "percent_missing", "terminal", "nan", "surrogate", "extra"])
def test_invalid_original_is_refused_before_transport(mutation):
    body = original()
    if mutation == "version": body["expected_version"] = True
    elif mutation == "key": del body["idempotency_key"]
    elif mutation == "action": body["action"] = "task.status"
    elif mutation == "revision": body["payload"]["order_revision"] = True
    elif mutation == "percent_bool": body["payload"]["percent"] = True
    elif mutation == "percent_missing": del body["payload"]["percent"]
    elif mutation == "terminal": body["payload"]["status"] = "success"
    elif mutation == "nan": body["payload"]["percent"] = float("nan")
    elif mutation == "surrogate": body["payload"]["message"] = "\ud800"
    else: body["source_reference"] = {}
    with client_for(lambda _request: pytest.fail("invalid original reached transport")) as client:
        with pytest.raises(ValueError): client.delivery_work_order_command(body)


@pytest.mark.parametrize("mutation", ["body", "project", "order", "digest", "budget"])
def test_packet_is_not_exported_under_wrong_scope_or_after_damage(mutation):
    value = packet_view()
    if mutation == "body": value["packet"]["design_context"][0]["content"] += "changed"
    elif mutation == "project": value["project_id"] = "Other"
    elif mutation == "order": value["work_order_id"] = "Other"
    elif mutation == "digest": value["packet_digest"] = "b" * 64
    else: value["packet"]["content"] = "中" * 200000
    with client_for(lambda _request: httpx.Response(200, json=value)) as client:
        with pytest.raises(ValueError): client.delivery_work_order_packet("work-order-1")


def test_saved_file_is_preserved_and_duplicate_keys_are_not_coerced(tmp_path):
    path = tmp_path / "original.json"
    raw = json.dumps(original(), ensure_ascii=False).encode("utf-8")
    path.write_bytes(raw)
    assert load_work_order_original(path) == original() and path.read_bytes() == raw
    for invalid in [b'{"action":"work_order.claim","action":"work_order.report"}', b'{"x":NaN}', b'\xff']:
        path.write_bytes(invalid)
        with pytest.raises(ValueError): load_work_order_original(path)
        assert path.read_bytes() == invalid


def test_unknown_percentage_and_explicit_stop_remain_distinct():
    assert work_order_command_body(original())["payload"]["percent"] is None
    body = original("work_order.release")
    body["payload"]["stopped_attestation"] = 1
    with pytest.raises(ValueError): work_order_command_body(body)


@pytest.mark.parametrize("member_id", ["agent/team.v2", "..", "工具" * 50])
def test_member_identity_is_a_body_reference_with_the_full_formal_hundred_character_contract(member_id):
    body = original("work_order.create")
    body["payload"]["executor_member_id"] = member_id
    assert work_order_command_body(body)["payload"]["executor_member_id"] == member_id
