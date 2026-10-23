import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from typer.testing import CliRunner


def test_team_runtime_directory_is_read_only_and_preserves_unavailable_facts(monkeypatch):
    calls = []
    payload = {"version": 8, "members": [{"member_id": "member-one", "member_name": "Tool", "member_kind": "tool", "status": "unavailable"}]}

    class Client:
        def delivery_team_runtime_bindings(self):
            calls.append("read")
            return payload

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, ["team-runtime", "--json"])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == payload
    assert calls == ["read"]


def test_tool_binding_uses_explicit_command_file_without_inference_or_rebase(monkeypatch, tmp_path):
    calls = []
    body = {"action": "member.runtime.bind", "payload": {
        "member_id": "member-tool", "workspace_id": "W", "agent_id": "A", "agent_version": 3,
    }, "expected_version": 8, "idempotency_key": "fixed-tool-binding"}
    path = tmp_path / "bind-tool.json"
    original = json.dumps(body).encode("utf-8")
    path.write_bytes(original)

    class Client:
        def delivery_command(self, request):
            calls.append(request)
            return {"action": request["action"], "resource_id": "member-tool", "applied_version": 9}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    for _ in range(2):
        output = CliRunner().invoke(delivery.app, ["command", "--file", str(path)])
        assert output.exit_code == 0, output.output
        assert json.loads(output.output)["resource_id"] == "member-tool"
    assert calls == [body, body]
    assert path.read_bytes() == original
