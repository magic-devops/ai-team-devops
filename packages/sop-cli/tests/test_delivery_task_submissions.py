"""Actual CliRunner definitions for fixed external report originals. Not executed here."""
import json
from contextlib import contextmanager

import pytest
import httpx
from typer.testing import CliRunner

from sop_cli.commands import delivery
from sop_sdk.client import ManagerClient


@pytest.fixture
def client_calls(monkeypatch):
    calls = []

    class Client:
        def delivery_task_submission_current(self, task):
            calls.append(("current", task)); return {"task_id": task, "can_submit": False, "reasons": [{"code": "native_stop_unknown"}]}

        def delivery_task_submissions(self, task, **selection):
            calls.append(("list", task, selection)); return {"items": [], "next_cursor": "next-original-cursor"}

        def delivery_task_submission(self, task, submission):
            calls.append(("exact", task, submission)); return {"submission": {"id": submission, "status": "awaiting_review"}}

        def delivery_task_submit(self, body):
            calls.append(("submit", body)); return {"action": "task.delivery.submit", "accepted": False}

        def delivery_task_submit_review(self, body):
            calls.append(("review", body)); return {"action": "task.delivery.review", "decision": body["payload"].get("decision")}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    return calls


def test_reads_preserve_exact_selection_one_page_and_reasons(client_calls):
    runner = CliRunner()
    current = runner.invoke(delivery.app, ["submission-current", "--id", "任务 一"])
    page = runner.invoke(delivery.app, ["submissions", "--id", "任务 一", "--limit", "1", "--cursor", "original +/=? cursor"])
    exact = runner.invoke(delivery.app, ["submission", "--id", "任务 一", "--submission", "SUB-1"])
    assert current.exit_code == page.exit_code == exact.exit_code == 0
    assert json.loads(current.output)["reasons"] == [{"code": "native_stop_unknown"}]
    assert client_calls == [("current", "任务 一"), ("list", "任务 一", {"limit": 1, "cursor": "original +/=? cursor"}), ("exact", "任务 一", "SUB-1")]


@pytest.mark.parametrize("command", ["task-submit", "task-submit-review"])
def test_writes_use_saved_exact_body_and_do_not_rewrite_file_or_fetch_latest(client_calls, tmp_path, command):
    body = {"expected_version": 7, "idempotency_key": "saved-original-key", "payload": {"task_id": "任务 一", "decision": "request_changes", "comment": "Review exact evidence"}}
    file = tmp_path / "original.json"; raw = json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8"); file.write_bytes(raw)
    runner = CliRunner()
    for _ in range(2):
        result = runner.invoke(delivery.app, [command, "--file", str(file)])
        assert result.exit_code == 0, result.output
    expected = "review" if command.endswith("review") else "submit"
    assert client_calls == [(expected, body), (expected, body)] and file.read_bytes() == raw


@pytest.mark.parametrize("raw", ['{}', '{"expected_version":7,"payload":{}}', '{"expected_version":true,"idempotency_key":"original-key","payload":{}}',
    '{"expected_version":7,"expected_version":8,"idempotency_key":"original-key","payload":{}}'])
def test_malformed_or_incomplete_original_never_reaches_client(client_calls, tmp_path, raw):
    file = tmp_path / "invalid.json"; file.write_text(raw, encoding="utf-8")
    result = CliRunner().invoke(delivery.app, ["task-submit", "--file", str(file)])
    assert result.exit_code != 0 and client_calls == [] and file.read_text(encoding="utf-8") == raw


def test_write_conflict_is_visible_without_current_read_or_file_adoption(monkeypatch, tmp_path):
    calls = []

    class Client:
        def delivery_task_submit_review(self, body):
            calls.append(body)
            raise ValueError("HTTP 409: native boundary changed; explicitly review the new state")

    @contextmanager
    def client(): yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    body = {"expected_version": 7, "idempotency_key": "saved-review-key", "payload": {"task_id": "T", "submission_id": "S"}}
    file = tmp_path / "review.json"; raw = json.dumps(body).encode(); file.write_bytes(raw)
    result = CliRunner().invoke(delivery.app, ["task-submit-review", "--file", str(file)])
    assert result.exit_code != 0 and "409" in result.output and calls == [body] and file.read_bytes() == raw


def test_missing_exact_ids_and_write_file_are_not_inferred(client_calls):
    runner = CliRunner()
    for args in (["submission-current"], ["submission", "--id", "T"], ["task-submit"], ["task-submit-review"], ["submissions", "--id", "T", "--limit", "0"]):
        assert runner.invoke(delivery.app, args).exit_code != 0
    assert client_calls == []


def test_cli_bound_report_uses_actual_client_transport_without_selecting_or_rewriting_handoff(monkeypatch, tmp_path):
    """Actual CLI -> ManagerClient -> HTTP transport definition, currently unrun."""
    body = {"expected_version": 7, "idempotency_key": "fixed-handoff-key", "payload": {
        "task_id": "任务 一", "task_basis": "a" * 64, "definition_digest": "b" * 64, "native_boundary_digest": "c" * 64,
        "source": {"kind": "tool", "name": "Codex"}, "summary": "Reported change; human review remains required",
        "artifacts": [{"id": "diff", "title": "Diff", "content": "Reported evidence"}],
        "criteria": [{"source": "task", "index": 0, "text_digest": "d" * 64, "result": "unknown", "evidence_ids": []}], "tests": [],
        "work_order": {"id": "W1", "order_revision": 2, "stopped_attestation": True}}}
    file = tmp_path / "handoff.json"
    raw = json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8")
    file.write_bytes(raw)
    calls = []

    @contextmanager
    def client():
        actual = ManagerClient(base_url="https://manager.test", project_id="P", max_retries=0)
        actual._client.close()
        actual._client = httpx.Client(base_url="https://manager.test", transport=httpx.MockTransport(
            lambda request: calls.append(request) or httpx.Response(200, json={"result": {"submission_id": "S1", "work_order": {"id": "W1", "order_revision": 3, "state": "reported"}}})))
        with actual:
            yield actual

    monkeypatch.setattr(delivery, "get_client", client)
    for _ in range(2):
        result = CliRunner().invoke(delivery.app, ["task-submit", "--file", str(file)])
        assert result.exit_code == 0, result.output
        assert json.loads(result.output)["result"]["work_order"]["id"] == "W1"
    assert file.read_bytes() == raw and len(calls) == 2 and calls[0].content == calls[1].content
    assert all(call.method == "POST" and call.url.path == "/api/v1/delivery/commands" and call.headers["X-Project-Id"] == "P" for call in calls)
    assert json.loads(calls[0].content) == {"action": "task.delivery.submit", **body}
