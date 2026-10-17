import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from typer.testing import CliRunner


def test_quality_and_release_commands_do_not_choose_first_scope(monkeypatch, tmp_path):
    calls = []

    class Client:
        def delivery_quality(self, **kwargs):
            calls.append(("quality", kwargs))
            return {"scope_basis": "fixed"}

        def delivery_release(self, release_id):
            calls.append(("detail", release_id))
            return {"id": release_id}

        def delivery_release_preview(self, body):
            calls.append(("preview", body))
            return {"allowed": False, "version": 8}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    runner = CliRunner()
    result = runner.invoke(delivery.app, ["quality", "--requirement-id", "r1", "--requirement-id", "r2", "--task-id", "t1"])
    assert result.exit_code == 0, result.output
    result = runner.invoke(delivery.app, ["releases", "--id", "unknown"])
    assert result.exit_code == 0, result.output
    draft = tmp_path / "release.json"
    draft.write_text(json.dumps({"version": "1.0.0", "ci_evidence_id": "ci-1"}), encoding="utf-8")
    result = runner.invoke(delivery.app, ["release-preview", "--file", str(draft)])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["allowed"] is False
    assert calls == [("quality", {"requirement_ids": ["r1", "r2"], "task_ids": ["t1"]}),
                     ("detail", "unknown"), ("preview", {"version": "1.0.0", "ci_evidence_id": "ci-1"})]
