"""CLI original-file protocol definitions, unrun in the deferred window."""
import json
from contextlib import contextmanager
from typer.testing import CliRunner
from sop_cli.commands import delivery


def test_ops_intake_submits_only_the_saved_file(tmp_path, monkeypatch):
    body = {"action": "issue.ops.intake", "expected_version": 7, "idempotency_key": "fixed-cli-ops-key", "payload": {
        "source_id": "ops-one", "source_digest": "a" * 64, "title": "Investigate", "description": "", "severity": "P1"}}
    file = tmp_path / "original.json"; file.write_text(json.dumps(body), encoding="utf-8")
    calls = []
    class Client:
        def delivery_ops_intake(self, value): calls.append(value); return {"project_id": "P", "retained": True}
    @contextmanager
    def client(): yield Client()
    monkeypatch.setattr(delivery, "get_client", client)
    result = CliRunner().invoke(delivery.app, ["ops-intake", "--file", str(file)])
    assert result.exit_code == 0 and calls == [body]
    assert json.loads(file.read_text(encoding="utf-8")) == body


def test_ops_intake_does_not_make_up_a_key_or_version(tmp_path, monkeypatch):
    file = tmp_path / "missing.json"; file.write_text('{"action":"issue.ops.intake"}', encoding="utf-8")
    def forbidden(): raise AssertionError("Network client must not be opened")
    monkeypatch.setattr(delivery, "get_client", forbidden)
    result = CliRunner().invoke(delivery.app, ["ops-intake", "--file", str(file)])
    assert result.exit_code != 0
