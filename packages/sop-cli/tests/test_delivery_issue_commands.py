import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from typer.testing import CliRunner


def test_issue_cli_keeps_explicit_scope_and_original_generation_file(monkeypatch, tmp_path):
    calls = []

    class Client:
        def delivery_issue(self, issue_id):
            calls.append(("detail", issue_id))
            return {"issue_id": issue_id}

        def delivery_issue_diagnoses(self, issue_id, *, cursor):
            calls.append(("history", issue_id, cursor))
            return {"items": []}

        def delivery_issue_diagnose(self, issue_id, body):
            calls.append(("generate", issue_id, body))
            return {"status": "generating", "request_key": body["idempotency_key"]}

        def delivery_issue_diagnosis(self, issue_id, diagnosis_id):
            calls.append(("exact", issue_id, diagnosis_id))
            return {"id": diagnosis_id, "issue_id": issue_id}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    runner = CliRunner()
    assert runner.invoke(delivery.app, ["issue", "--id", "ISS-1"]).exit_code == 0
    assert (
        runner.invoke(
            delivery.app, ["issue-diagnoses", "--id", "ISS-1", "--cursor", "original-cursor"]
        ).exit_code
        == 0
    )
    assert (
        runner.invoke(
            delivery.app, ["issue-diagnoses", "--id", "ISS-1", "--diagnosis-id", "a" * 64]
        ).exit_code
        == 0
    )
    body = {"generator": "rules", "issue_basis": "fixed", "idempotency_key": "original-key"}
    file = tmp_path / "diagnosis.json"
    file.write_text(json.dumps(body), encoding="utf-8")
    result = runner.invoke(delivery.app, ["issue-diagnose", "--id", "ISS-1", "--file", str(file)])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["status"] == "generating"
    assert calls == [
        ("detail", "ISS-1"),
        ("history", "ISS-1", "original-cursor"),
        ("exact", "ISS-1", "a" * 64),
        ("generate", "ISS-1", body),
    ]
