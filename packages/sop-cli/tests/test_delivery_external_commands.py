import json
from contextlib import contextmanager

from sop_cli.commands import delivery, hermes, task
from sop_sdk.errors import SopConflictError
from typer.testing import CliRunner


def test_external_preview_and_observation_preserve_proposal_and_cursor(monkeypatch, tmp_path):
    seen = []
    body = {
        "task_id": "T-one",
        "task_basis": "a" * 64,
        "target_kind": "device",
        "target_basis": "b" * 64,
        "target_device_id": "device-one",
        "agent_id": "agent-one",
        "test_nodes": [],
    }
    file = tmp_path / "proposal.json"
    file.write_text(json.dumps(body), encoding="utf-8")

    class Client:
        def delivery_execution_preview(self, proposal):
            seen.append(proposal)
            return {"task_basis": proposal["task_basis"], "usage": None}

        def delivery_execution_observations(self, execution_id, **options):
            seen.append((execution_id, options))
            return {"events": [], "more": False, "next_cursor": "opaque", "usage": None}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, ["execution-preview", "--file", str(file)])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output)["usage"] is None and seen == [body]
    output = CliRunner().invoke(
        delivery.app,
        ["execution-observations", "execution-one", "--cursor", "opaque", "--limit", "7", "--json"],
    )
    assert output.exit_code == 0, output.output
    assert json.loads(output.output)["usage"] is None
    assert seen[-1] == ("execution-one", {"cursor": "opaque", "limit": 7})


def test_external_preview_conflict_preserves_file_and_does_not_adopt(monkeypatch, tmp_path):
    file = tmp_path / "proposal.json"
    original = '{"task_id":"T-one","target_basis":"fixed"}'
    file.write_text(original, encoding="utf-8")

    class Client:
        def delivery_execution_preview(self, body):
            raise SopConflictError("Target changed", status=409)

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, ["execution-preview", "--file", str(file)])
    assert output.exit_code == 1 and "Target changed" in output.output
    assert file.read_text(encoding="utf-8") == original


def test_device_policy_uses_exact_file_and_retired_commands_are_absent(monkeypatch, tmp_path):
    body = {
        "expected_version": 2,
        "idempotency_key": "fixed",
        "dry_run": True,
        "allowed_runtimes": ["command"],
        "allowed_providers": [],
    }
    file = tmp_path / "policy.json"
    file.write_text(json.dumps(body), encoding="utf-8")
    seen = []

    class Client:
        def device_runtime_policy(self, device_id, proposal):
            seen.append((device_id, proposal))
            return {"ok": True, "items": [], "summary": {"dry_run": True}}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(hermes, "get_hermes_client", client)
    output = CliRunner().invoke(
        hermes.build_resource_app("devices"), ["runtime-policy", "device-one", "--file", str(file), "--json"]
    )
    assert output.exit_code == 0, output.output
    assert seen == [("device-one", body)]
    for command in ["claim", "heartbeat", "report"]:
        output = CliRunner().invoke(task.app, [command, "--help"])
        assert output.exit_code != 0
