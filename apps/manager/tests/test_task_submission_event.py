"""Real typed event intake -> canonical submission -> exact report navigation.

Definitions only until the shared validation window is available.
"""
from copy import deepcopy

import pytest
from sop_manager.routers import sql_models as m
from sop_manager.routers.delivery_task_submission_model import DeliveryTaskSubmission
from test_delivery_workbench import command
from test_event_handoff import env as env
from test_event_handoff import frozen, result, send, version
from test_event_handoff_business import flow_client


def report_for(env):
    client = flow_client(env)
    task = next(item for item in client.get("/api/v1/delivery/workspace").json()["tasks"] if item["id"] == "T-task")
    changed = command(client, "task.update", {"id": "T-task", "owner_id": "user:lead", "task_basis": task["basis"]})
    assert changed.status_code == 200, changed.text
    response = client.get("/api/v1/delivery/tasks/T-task/delivery-submissions/current")
    assert response.status_code == 200, response.text
    current = response.json()
    assert current["can_submit"], current["reasons"]
    report = {"task_id": "T-task", "task_basis": current["task_basis"],
        "definition_digest": current["definition_digest"], "native_boundary_digest": current["native_boundary_digest"],
        "source": {"kind": "tool", "name": "Codex report", "url": ""}, "summary": "Reported work for human review",
        "artifacts": [{"id": "evidence-1", "title": "Reported check", "content": "Reported output", "url": "", "sha256": None}],
        "criteria": [{"source": item["source"], "index": item["index"], "text_digest": item["text_digest"],
            "result": "met", "evidence_ids": ["evidence-1"]} for item in current["criteria"]],
        "tests": [{"id": "check-1", "title": "Reported check", "status": "passed", "evidence_ids": ["evidence-1"]}]}
    return client, report


def event_for(env, report, *, event_id="delivery-original", subject="T-task", expected=None):
    return frozen(event_id, "sop.task.delivery_submitted", {
        "expected_version": version(env[1]) if expected is None else expected, "report": report}, subject)


def test_saved_report_event_replays_same_original_without_completing_task(env):
    client, report = report_for(env)
    event = event_for(env, report)
    first = result(send(client, event))
    assert first["processing"]["state"] == "processed", first
    effect = first["processing"]["result"]
    assert effect["kind"] == "task_delivery_submitted" and effect["target_kind"] == "task_submission"
    submission_id = effect["target_id"]
    second = result(send(client, event))
    assert second["outcome"] == "duplicate" and second["processing"]["result"] == effect
    with env[1]() as db:
        assert db.query(DeliveryTaskSubmission).count() == 1
        assert db.get(m.Task, "T-task").status != "completed"
        assert db.query(m.DeliveryTaskReview).count() == 0
    locator = client.get(f"/api/v1/delivery/delivery-submissions/{submission_id}/locator")
    assert locator.status_code == 200 and locator.json() == {"project_id": "project", "task_id": "T-task", "submission_id": submission_id}
    detail = client.get(f"/api/v1/delivery/tasks/T-task/delivery-submissions/{submission_id}")
    assert detail.status_code == 200 and detail.json()["submission"]["status"] == "awaiting_review"
    assert detail.json()["decision"] is None


def test_failed_report_event_creates_one_real_issue_per_original(env):
    client, report = report_for(env)
    report["tests"][0]["status"] = "failed"
    event = event_for(env, report)
    for _ in range(2):
        receipt = result(send(client, event))
        assert receipt["processing"]["state"] == "processed", receipt
    with env[1]() as db:
        row = db.query(DeliveryTaskSubmission).one()
        assert row.issue_id and db.get(m.Issue, row.issue_id).task_id == "T-task"
        assert db.query(m.Issue).count() == 1 and db.query(m.DeliveryTaskReview).count() == 0


@pytest.mark.parametrize("fault", ["wrong_subject", "missing_evidence", "wrong_version"])
def test_saved_intake_does_not_claim_submission_when_business_report_is_rejected(env, fault):
    client, report = report_for(env)
    report = deepcopy(report)
    subject = "another" if fault == "wrong_subject" else "T-task"
    if fault == "missing_evidence":
        report["tests"][0]["evidence_ids"] = ["missing"]
    original_version = version(env[1])
    event = event_for(env, report, subject=subject, expected=original_version - 1 if fault == "wrong_version" else original_version)
    receipt = result(send(client, event))
    assert receipt["outcome"] == "stored" and receipt["processing"]["state"] == "failed", receipt
    assert receipt["processing"]["result"] is None
    assert version(env[1]) == original_version
    with env[1]() as db:
        assert db.query(DeliveryTaskSubmission).count() == 0 and db.query(m.Issue).count() == 0


def test_submission_routes_and_nested_commands_are_real_resolved_openapi(env):
    client = flow_client(env)
    schema = client.app.openapi()
    base = "/api/v1/delivery/tasks/{task_id}/delivery-submissions"
    for route in (base, base + "/current", base + "/{submission_id}", "/api/v1/delivery/delivery-submissions/{submission_id}/locator"):
        assert "get" in schema["paths"][route]
    contracts = schema["paths"]["/api/v1/delivery/commands"]["post"]["x-delivery-command-contracts"]
    for action in ("task.delivery.submit", "task.delivery.review"):
        payload = contracts[action]["payload"]
        assert payload["additionalProperties"] is False
        assert "#/$defs/" not in str(payload)
    report = contracts["task.delivery.submit"]["payload"]
    assert report["properties"]["artifacts"]["items"]["additionalProperties"] is False
    assert report["properties"]["tests"]["items"]["properties"]["status"]["enum"] == ["passed", "failed", "skipped", "not_run", "unknown"]
