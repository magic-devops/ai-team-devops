import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from typer.testing import CliRunner


def test_runtime_cli_requires_explicit_node_attempt_and_fixed_control_file(monkeypatch, tmp_path):
    calls = []

    class Client:
        def delivery_execution_runtime(self, id):
            calls.append(("runtime", id))
            return {"run_id": "RUN-1"}

        def delivery_execution_output(self, id, node, **selection):
            calls.append(("output", id, node, selection))
            return {"chunks": [], "source": "unavailable"}

        def delivery_execution_control_preview(self, body):
            calls.append(("preview", body))
            return {"allowed": False, "payload": body}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    runner = CliRunner()
    assert runner.invoke(delivery.app, ["execution-runtime", "--id", "EXEC-1"]).exit_code == 0
    args = [
        "execution-output",
        "--id",
        "EXEC-1",
        "--node",
        "tests",
        "--attempt",
        "2",
        "--stream",
        "stderr",
        "--cursor",
        "original",
    ]
    assert runner.invoke(delivery.app, args).exit_code == 0
    assert (
        runner.invoke(delivery.app, ["execution-output", "--id", "EXEC-1", "--node", "tests"]).exit_code != 0
    )
    body = {"id": "EXEC-1", "action": "execution.cancel", "reason": "Explicit human intent"}
    file = tmp_path / "control.json"
    file.write_bytes(json.dumps(body).encode())
    result = runner.invoke(delivery.app, ["execution-control-preview", "--file", str(file)])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["allowed"] is False
    assert calls == [
        ("runtime", "EXEC-1"),
        ("output", "EXEC-1", "tests", {"attempt": 2, "stream": "stderr", "cursor": "original", "limit": 50}),
        ("preview", body),
    ]
