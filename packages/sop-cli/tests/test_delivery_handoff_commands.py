"""CLI canonical reads use the real SDK transport contract (definitions only)."""
import json
from contextlib import contextmanager

import httpx
import pytest
from sop_cli.commands import delivery
from sop_sdk.client import ManagerClient
from typer.testing import CliRunner


def configure(monkeypatch, handler):
    @contextmanager
    def client():
        with ManagerClient("https://manager.example", project_id="selected", max_retries=0) as manager:
            manager._client.close()
            manager._client = httpx.Client(base_url=manager.base_url, transport=httpx.MockTransport(handler))
            yield manager
    monkeypatch.setattr(delivery, "get_client", client)


@pytest.mark.parametrize("arguments,path,params", [
    (["execution-handoff", "--id", "E-one"], "/api/v1/delivery/executions/E-one/handoff", {}),
    (["task-handoffs", "--id", "T-one"], "/api/v1/delivery/tasks/T-one/execution-handoffs", {"limit": "20"}),
    (["task-handoffs", "--id", "T-one", "--limit", "1", "--cursor", "opaque/+?=:window"],
     "/api/v1/delivery/tasks/T-one/execution-handoffs", {"limit": "1", "cursor": "opaque/+?=:window"}),
])
def test_cli_reads_one_exact_handoff_or_page(monkeypatch, arguments, path, params):
    seen = []
    expected = {"project_id": "selected", "next_cursor": "next-window", "items": []}
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json=expected))
    result = CliRunner().invoke(delivery.app, arguments)
    assert result.exit_code == 0, result.output
    assert json.loads(result.output) == expected
    assert len(seen) == 1 and seen[0].method == "GET" and seen[0].url.path == path
    assert dict(seen[0].url.params) == params and seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize("arguments", [
    ["execution-handoff", "--id", "../other"], ["task-handoffs", "--id", "T", "--limit", "101"],
    ["task-handoffs", "--id", "T", "--cursor", "bad\x85cursor"],
])
def test_invalid_cli_handoff_selection_never_reaches_transport(monkeypatch, arguments):
    configure(monkeypatch, lambda _: pytest.fail("Invalid selection reached transport"))
    assert CliRunner().invoke(delivery.app, arguments).exit_code != 0


@pytest.mark.parametrize("status", [403, 404, 409])
def test_cli_handoff_error_remains_error(monkeypatch, status):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(status, json={"detail": "Inaccessible handoff"}))
    result = CliRunner().invoke(delivery.app, ["execution-handoff", "--id", "E-one"])
    assert result.exit_code == 1 and "Inaccessible handoff" in result.output
    assert len(seen) == 1 and seen[0].method == "GET"
