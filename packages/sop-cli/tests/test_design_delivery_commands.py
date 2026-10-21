"""Actual CliRunner definitions; runtime execution remains deferred."""
from contextlib import contextmanager
import json

import pytest
from typer.testing import CliRunner

from sop_cli.commands import delivery


@pytest.fixture
def calls(monkeypatch):
    result = []
    class Client:
        def __getattr__(self, name):
            def invoke(*args, **kwargs):
                result.append((name, args, kwargs))
                return {"status": "generating", "next_cursor": "original-next", "can_save": False}
            return invoke
    @contextmanager
    def client(): yield Client()
    monkeypatch.setattr(delivery, "get_client", client)
    return result


def test_exact_reads_and_page_preserve_selection(calls):
    runner = CliRunner()
    selections = [["designs", "--limit", "1", "--cursor", "cursor +/=?", "--include-archived"],
        ["design-revision", "--id", "D-1", "--revision", "R-1"],
        ["design-current", "--target", "task", "--id", "任务 一"],
        ["design-preview", "--id", "D-1", "--preview", "G-1"]]
    for args in selections:
        response = runner.invoke(delivery.app, args)
        assert response.exit_code == 0, response.output
    assert calls[0] == ("design_documents", (), {"q": "", "include_archived": True, "limit": 1, "cursor": "cursor +/=?"})
    assert calls[1][1] == ("D-1", "R-1") and calls[2][1] == ("task", "任务 一")
    assert len(calls) == 4


@pytest.mark.parametrize("command", ["design-command", "design-generate"])
def test_saved_original_replay_keeps_bytes_key_and_basis(calls, tmp_path, command):
    body = {"base_revision_id": "R-1", "base_revision_digest": "a" * 64, "mode": "expand", "instructions": "",
        "idempotency_key": "original-request"} if command == "design-generate" else {
        "action": "task.design.clear", "expected_version": 7, "idempotency_key": "original-request",
        "payload": {"task_id": "T", "slot": "prd", "preview_basis": "b" * 64}}
    file = tmp_path / "saved.json"
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8"); file.write_bytes(raw)
    args = [command, "--file", str(file)] + (["--id", "D-1"] if command == "design-generate" else [])
    for _ in range(2):
        response = CliRunner().invoke(delivery.app, args)
        assert response.exit_code == 0, response.output
    assert calls[0] == calls[1] and calls[0][1][-1] == body and file.read_bytes() == raw


def test_invalid_duplicate_original_is_rejected_before_client(calls, tmp_path):
    file = tmp_path / "bad.json"
    file.write_text('{"action":"design.document.create","action":"design.revision.save"}', encoding="utf-8")
    assert CliRunner().invoke(delivery.app, ["design-command", "--file", str(file)]).exit_code != 0
    assert calls == []
