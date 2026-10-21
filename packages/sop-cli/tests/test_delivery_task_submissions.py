"""Actual CliRunner definitions for fixed external report originals. Not executed here."""
import json
from contextlib import contextmanager

import pytest
from typer.testing import CliRunner

from sop_cli.commands import delivery


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
