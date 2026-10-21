"""Actual CLI-to-SDK transport definitions; no application execution in this stage."""

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
    (["execution-controls", "--id", "E-one"], "/api/v1/delivery/executions/E-one/control-operations", {"limit": "20"}),
    (["execution-control", "--id", "E-one", "--operation", "C-one"], "/api/v1/delivery/executions/E-one/control-operations/C-one", {}),
    (["execution-controls", "--id", "E-one", "--limit", "1", "--cursor", "opaque/+?=:window"],
     "/api/v1/delivery/executions/E-one/control-operations", {"limit": "1", "cursor": "opaque/+?=:window"}),
])
def test_cli_reads_exact_control_or_single_page(monkeypatch, arguments, path, params):
    seen = []
    expected = {"project_id": "selected", "items": [], "next_cursor": "next-window"}
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json=expected))
    result = CliRunner().invoke(delivery.app, arguments)
    assert result.exit_code == 0, result.output
    assert json.loads(result.output) == expected and len(seen) == 1
    assert seen[0].method == "GET" and seen[0].url.path == path
    assert dict(seen[0].url.params) == params and seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize("arguments", [
    ["execution-control", "--id", "E", "--operation", "../other"],
    ["execution-controls", "--id", "E", "--limit", "101"],
    ["execution-controls", "--id", "E", "--cursor", "bad\x85cursor"],
])
def test_invalid_cli_control_read_never_reaches_transport(monkeypatch, arguments):
    configure(monkeypatch, lambda _: pytest.fail("Invalid control selection reached transport"))
    assert CliRunner().invoke(delivery.app, arguments).exit_code != 0


@pytest.mark.parametrize("status", [403, 404, 409])
def test_cli_control_error_stays_visible_without_fallback(monkeypatch, status):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(status, json={"detail": "Control unavailable"}))
    result = CliRunner().invoke(delivery.app, ["execution-control", "--id", "E-one", "--operation", "C-one"])
    assert result.exit_code == 1 and "Control unavailable" in result.output
    assert len(seen) == 1 and seen[0].method == "GET"
