"""Tool issue feedback comes from the same persisted receipt, under its bound identity."""

import json
from dataclasses import replace

import httpx
import pytest
from sop_cli import local_intents
from sop_cli.commands import event, task
from sop_sdk import AgentConfig, EventOutbox
from sop_sdk.client import ManagerClient
from sop_sdk.security import BearerAuth
from typer.testing import CliRunner

STAMP = "2026-10-19T00:00:00Z"
ARGS = [
    "issue", "Original issue", "--expected-version", "7", "--id", "opened-original",
    "--time", STAMP, "--severity", "P1", "--desc", "Actual tool finding", "--task", "T-fixed",
]


@pytest.fixture
def receipt_environment(monkeypatch, tmp_path):
    config = AgentConfig(
        project_path=tmp_path, project_id="P", tenant_id="T", manager_url="https://manager.example",
        bearer_token="test-only",
    )
    state = {"config": config, "processing": "processed", "producer": "U", "calls": [], "lost_ack": False}
    clients = []

    def handle(request):
        state["calls"].append(request)
        assert request.headers["X-Project-Id"] == "P"
        assert request.headers["Authorization"] == "Bearer test-only"
        if request.url.path == "/api/v1/events:identity":
            return httpx.Response(200, json={"tenant_id": "T", "project_id": "P", "producer_id": state["producer"]})
        assert request.url.path == "/api/v1/events:ingest" and request.method == "POST"
        (original,) = json.loads(request.content)["events"]
        processing = state["processing"]
        if state["lost_ack"]:
            state["lost_ack"] = False
            raise httpx.ReadTimeout("Original committed; ACK lost", request=request)
        return httpx.Response(200, json={
            "tenant_id": "T", "project_id": "P", "producer": {"kind": "user", "id": "U"}, "as_of": STAMP,
            "results": [{
                "id": original["id"], "digest": original["digest"], "outcome": "stored",
                "receipt_id": "receipt-opened-original", "stored_at": STAMP, "error": None,
                "processing": {
                    "state": processing, "revision": 2, "handler": "issue.opened", "operation_id": "operation-one",
                    "attempts": 1, "updated_at": STAMP, "processed_at": STAMP if processing == "processed" else None,
                    "reason_code": "version_conflict" if processing == "failed" else None, "retryable": False,
                    "result": {"kind": "issue_created", "target_kind": "issue", "target_id": "ISS-actual"}
                    if processing == "processed" else None,
                },
            }],
        })

    def factory(cfg):
        manager = ManagerClient(cfg.manager_url, auth=BearerAuth(cfg.bearer_token), project_id=cfg.project_id, max_retries=0)
        manager._client.close()
        manager._client = httpx.Client(base_url=manager.base_url, transport=httpx.MockTransport(handle))
        clients.append(manager)
        return manager

    monkeypatch.setattr(task, "get_config", lambda: state["config"])
    monkeypatch.setattr(event, "get_config", lambda: state["config"])
    monkeypatch.setattr(event, "get_client", lambda cfg=None: factory(cfg or state["config"]))
    monkeypatch.setattr(local_intents, "build_default_client", factory)
    yield state
    for manager in clients:
        manager.close()


def test_task_issue_local_admission_has_no_business_receipt(receipt_environment):
    state = receipt_environment
    output = CliRunner().invoke(task.app, [*ARGS, "--local"])
    assert output.exit_code == 0, output.output
    result = json.loads(output.output)
    assert result["delivery_state"] == "pending" and result["processing"] is None
    assert result["receipt_id"] is None and result["processing_source"] is None and result["retained"] is True
    assert not state["calls"]
    config = state["config"]
    with EventOutbox(config.project_path / config.outbox_path) as box:
        row = box.inspect("opened-original")
        assert row["state"] == "pending" and row["binding_state"] == "unbound"
        assert json.loads(row["event_json"])["data"] == {
            "expected_version": 7, "title": "Original issue", "severity": "P1",
            "description": "Actual tool finding", "task_id": "T-fixed",
        }


@pytest.mark.parametrize("processing,exit_code,success", [
    ("processed", 0, True), ("pending", 2, False), ("failed", 2, False),
])
def test_task_issue_reports_actual_processing_and_target_from_saved_ack(
    receipt_environment, processing, exit_code, success
):
    state = receipt_environment
    state["processing"] = processing
    runner = CliRunner()
    first = runner.invoke(task.app, ARGS)
    assert first.exit_code == exit_code, first.output
    result = json.loads(first.output)
    assert result["ok"] is success and result["delivery_state"] == "acked"
    assert result["processing_source"] == "original_receipt"
    assert result["processing"]["state"] == processing
    assert result["receipt_id"] == "receipt-opened-original"
    if processing == "processed":
        assert result["processing"]["result"] == {"kind": "issue_created", "target_kind": "issue", "target_id": "ISS-actual"}
    else:
        assert result["processing"]["result"] is None
    config = state["config"]
    with EventOutbox(config.project_path / config.outbox_path) as box:
        saved = box.inspect("opened-original")
        assert json.loads(saved["remote_receipt_json"])["processing"] == result["processing"]
    post_count = len([request for request in state["calls"] if request.method == "POST"])
    second = runner.invoke(task.app, ARGS)
    assert second.exit_code == exit_code, second.output
    replayed = json.loads(second.output)
    assert replayed["replayed"] is True and replayed["processing"] == result["processing"]
    assert len([request for request in state["calls"] if request.method == "POST"]) == post_count == 1
    with EventOutbox(config.project_path / config.outbox_path) as box:
        assert box.inspect("opened-original") == saved


@pytest.mark.parametrize("change", ["manager", "producer", "local"])
def test_saved_task_issue_ack_needs_original_origin_and_current_identity(receipt_environment, change):
    state = receipt_environment
    runner = CliRunner()
    assert runner.invoke(task.app, ARGS).exit_code == 0
    if change == "manager":
        state["config"] = replace(state["config"], manager_url="https://another.example")
    elif change == "producer":
        state["producer"] = "another-user"
    calls_before = len([request for request in state["calls"] if request.method == "POST"])
    result = runner.invoke(task.app, [*ARGS, *(["--local"] if change == "local" else [])])
    assert result.exit_code == 2, result.output
    body = json.loads(result.output)
    assert body["ok"] is False and body["processing"] is None and body["receipt_id"] is None
    assert body["delivery_error"] == ("identity_verification_required" if change == "local" else "scope_mismatch")
    assert len([request for request in state["calls"] if request.method == "POST"]) == calls_before


def test_task_issue_unknown_preserves_original_for_explicit_same_intent_recovery(receipt_environment, monkeypatch):
    from sop_sdk import event_outbox

    state = receipt_environment
    state["lost_ack"] = True
    now = [1_000_000]
    monkeypatch.setattr(event_outbox, "_now", lambda: now[0])
    runner = CliRunner()
    first = runner.invoke(task.app, ARGS)
    assert first.exit_code == 2, first.output
    assert json.loads(first.output)["delivery_state"] == "pending"
    config = state["config"]
    with EventOutbox(config.project_path / config.outbox_path) as box:
        original = box.inspect("opened-original")["event_json"]
    now[0] += 10_000
    recovered = runner.invoke(task.app, ARGS)
    assert recovered.exit_code == 0, recovered.output
    result = json.loads(recovered.output)
    assert result["replayed"] is True and result["processing"]["result"]["target_id"] == "ISS-actual"
    posts = [json.loads(request.content)["events"][0] for request in state["calls"] if request.method == "POST"]
    assert len(posts) == 2 and posts[0] == posts[1]
    assert posts[0]["event_json"] == original
