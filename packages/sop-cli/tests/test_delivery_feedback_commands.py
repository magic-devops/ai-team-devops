"""Actual CLI file-to-client definitions; user deferred runtime validation."""
from contextlib import contextmanager
from copy import deepcopy
import json

import pytest
from typer.testing import CliRunner

from sop_cli.commands import delivery


@pytest.fixture
def calls(monkeypatch):
    recorded = []

    class Client:
        def __getattr__(self, name):
            def invoke(*args, **kwargs):
                recorded.append((name, deepcopy(args), deepcopy(kwargs)))
                return {"state": "queued"}
            return invoke

    @contextmanager
    def get_client(): yield Client()

    monkeypatch.setattr(delivery, "get_client", get_client)
    return recorded


def feedback():
    return {"submission_id": "SUB-original", "submission_digest": "a" * 64, "decision_id": "DEC-original"}


def test_preview_and_dispatch_keep_explicit_feedback_and_original_files(calls, tmp_path):
    preview = {"task_basis": "b" * 64, "executor_member_id": "agent-1", "instructions": "", "feedback_reference": feedback()}
    command = {"action": "work_order.create", "expected_version": 7, "idempotency_key": "fixed-feedback-dispatch-key",
        "payload": {"task_id": "T", **preview, "definition_digest": "c" * 64, "native_boundary_digest": "d" * 64, "preview_basis": "e" * 64}}
    for name, body, args in [("preview", preview, ["work-order-preview", "--task", "T"]), ("dispatch", command, ["work-order-command"])]:
        path = tmp_path / (name + ".json")
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        path.write_bytes(raw)
        for _ in range(2):
            result = CliRunner().invoke(delivery.app, [*args, "--file", str(path)])
            assert result.exit_code == 0, result.output
        assert path.read_bytes() == raw
    assert calls[:2] == [("delivery_work_order_preview", ("T", preview), {})] * 2
    assert calls[2:] == [("delivery_work_order_command", (command,), {})] * 2


@pytest.mark.parametrize("change", ["missing-decision", "extra-context", "bad-digest", "duplicate-key"])
def test_bad_feedback_files_are_not_replaced_or_forwarded(calls, tmp_path, change):
    ref = feedback()
    if change == "missing-decision": del ref["decision_id"]
    if change == "extra-context": ref["context"] = "unverified caller text"
    if change == "bad-digest": ref["submission_digest"] = False
    body = {"task_basis": "b" * 64, "executor_member_id": "agent-1", "instructions": "", "feedback_reference": ref}
    raw = json.dumps(body).encode()
    if change == "duplicate-key": raw = raw.replace(b'"feedback_reference":', b'"feedback_reference": null, "feedback_reference":')
    path = tmp_path / "feedback.json"
    path.write_bytes(raw)
    result = CliRunner().invoke(delivery.app, ["work-order-preview", "--task", "T", "--file", str(path)])
    assert result.exit_code != 0 and calls == [] and path.read_bytes() == raw
