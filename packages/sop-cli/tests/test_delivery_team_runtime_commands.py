import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from typer.testing import CliRunner


def test_team_runtime_directory_is_read_only_and_preserves_unavailable_facts(monkeypatch):
    calls = []
    payload = {"version": 8, "members": [{"member_id": "member-one", "status": "unavailable"}]}

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
