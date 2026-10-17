import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from typer.testing import CliRunner


def test_deployment_cli_preserves_explicit_id_and_fixed_preview(monkeypatch, tmp_path):
    calls = []

    class Client:
        def delivery_deployments(self):
            calls.append(("index",))
            return {"deployments": []}

        def delivery_deployment(self, deployment_id):
            calls.append(("detail", deployment_id))
            return {"id": deployment_id}

        def delivery_deployment_preview(self, body):
            calls.append(("preview", body))
            return {"allowed": False, "preview_basis": "fixed", "version": 9}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    runner = CliRunner()
    assert runner.invoke(delivery.app, ["deployments"]).exit_code == 0
    assert runner.invoke(delivery.app, ["deployments", "--id", "unknown"]).exit_code == 0
    body = {"rollback_of": "deployment-1", "reason": "Restore the verified baseline"}
    draft = tmp_path / "deployment.json"
    draft.write_text(json.dumps(body), encoding="utf-8")
    result = runner.invoke(delivery.app, ["deployment-preview", "--file", str(draft)])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["allowed"] is False
    assert calls == [("index",), ("detail", "unknown"), ("preview", body)]
