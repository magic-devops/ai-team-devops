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


@pytest.mark.parametrize("arguments,path,params,expected", [
    (["issue-origins", "ISS-one", "--json"], "/api/v1/delivery/issues/ISS-one/origins", {"limit": "20"},
     {"issue_id": "ISS-one", "items": [], "total": 0, "next_cursor": None}),
    (["issue-origins", "ISS-one", "--limit", "1", "--cursor", "opaque/+?=:window", "--json"],
     "/api/v1/delivery/issues/ISS-one/origins", {"limit": "1", "cursor": "opaque/+?=:window"},
     {"issue_id": "ISS-one", "items": [{"id": "origin-old"}], "total": 500, "next_cursor": "next-window"}),
    (["issue-origins", "ISS-deleted", "--id", "origin-old", "--json"],
     "/api/v1/delivery/issues/ISS-deleted/origins/origin-old", {},
     {"issue_id": "ISS-deleted", "issue_available": False, "origin": {"id": "origin-old"}}),
])
def test_cli_reads_only_one_explicit_origin_or_page(monkeypatch, arguments, path, params, expected):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json=expected))
    output = CliRunner().invoke(delivery.app, arguments)
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert len(seen) == 1 and seen[0].method == "GET"
    assert seen[0].url.path == path and dict(seen[0].url.params) == params
    assert seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize("arguments", [
    ["--id", "origin-old", "--cursor", "window"], ["--limit", "101"], ["--limit", "0"],
    ["--cursor", "bad\x85cursor"], ["--cursor", "x" * 4001], ["--id", "../other"],
])
def test_invalid_origin_selection_never_reaches_transport(monkeypatch, arguments):
    configure(monkeypatch, lambda _: pytest.fail("Invalid selection reached transport"))
    output = CliRunner().invoke(delivery.app, ["issue-origins", "ISS-one", *arguments, "--json"])
    assert output.exit_code != 0


@pytest.mark.parametrize("status", [403, 404, 409])
def test_exact_origin_errors_stay_errors_without_a_fallback(monkeypatch, status):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(
        status, json={"detail": "Original inaccessible"}
    ))
    output = CliRunner().invoke(delivery.app, ["issue-origins", "ISS-one", "--id", "origin-old", "--json"])
    assert output.exit_code == 1 and "Original inaccessible" in output.output
    assert len(seen) == 1 and seen[0].url.path.endswith("/origins/origin-old")


def test_issue_cli_accepts_event_source_and_preserves_page(monkeypatch):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json={"items": []}))
    output = CliRunner().invoke(delivery.app, ["issues", "--source", "event", "--limit", "3"])
    assert output.exit_code == 0, output.output
    assert dict(seen[0].url.params) == {"source": "event", "limit": "3"}
