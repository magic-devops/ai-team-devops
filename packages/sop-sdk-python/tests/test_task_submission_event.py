"""Actual existing event/outbox protocol consumers; definitions await validation window."""
import json
from copy import deepcopy

import pytest
from sop_sdk.event_envelope import EventProtocolError, matching_receipts
from sop_sdk.event_outbox import EventOutbox
from sop_sdk.task_submission_event import task_delivery_event
from test_event_handoff import identity, receipt, response


def original(**changes):
    return task_delivery_event({"task_id": "任务", "summary": "Reported only", **changes},
        expected_version=4, event_id="external-event", time="2026-10-21T00:00:00Z", source="codex-local")


def saved(event):
    item = receipt(event)
    item["processing"].update(state="processed", handler="task.delivery.submit", attempts=1,
        processed_at="2026-10-21T00:00:00Z", reason_code=None,
        result={"kind": "task_delivery_submitted", "target_kind": "task_submission", "target_id": "submission-1"})
    return item


def test_original_event_freezes_report_subject_version_and_bytes(tmp_path):
    event = original()
    parsed = json.loads(event.event_json)
    assert parsed["type"] == "sop.task.delivery_submitted" and parsed["subject"] == "任务"
    assert parsed["data"] == {"expected_version": 4, "report": {"task_id": "任务", "summary": "Reported only"}}
    with EventOutbox(tmp_path / "queue.sqlite") as queue:
        queue.enqueue(event, intended_project_id="P")
        assert queue.inspect(event.id)["event_json"] == event.event_json


def test_report_saved_receipt_is_valid_without_claiming_task_acceptance():
    event = original()
    value = matching_receipts([event], response(saved(event)), identity())[event.id]
    assert value.processing_state == "processed"
    assert json.loads(value.result_json)["processing"]["result"]["target_id"] == "submission-1"
    assert "accepted" not in value.result_json


@pytest.mark.parametrize("change", [
    {"state": "pending"}, {"attempts": 0}, {"processed_at": None}, {"handler": "task.update"},
    {"result": {"kind": "task_delivery_submitted", "target_kind": "task", "target_id": "T"}},
    {"result": {"kind": "task_delivery_submitted", "target_kind": "task_submission", "target_id": "../other"}},
    {"result": {"kind": "task_updated", "target_kind": "task_submission", "target_id": "submission-1"}},
])
def test_malformed_saved_report_proof_does_not_acknowledge_original(change):
    event = original()
    item = saved(event)
    item["processing"].update(deepcopy(change))
    with pytest.raises(EventProtocolError):
        matching_receipts([event], response(item), identity())


@pytest.mark.parametrize("changes", [{"summary": "中" * 17000}, {"value": float("nan")}, {"task_id": ""}])
def test_report_event_rejects_oversize_nonfinite_or_missing_identity(changes):
    with pytest.raises(ValueError):
        original(**changes)


def test_report_event_never_infers_a_missing_timestamp():
    with pytest.raises(ValueError):
        task_delivery_event({"task_id": "T"}, expected_version=1, event_id="E", time=None, source="tool")
