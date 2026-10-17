import json
from contextlib import contextmanager

import pytest
from sop_cli.commands import delivery
from sop_sdk.errors import SopForbiddenError
from typer.testing import CliRunner


def test_delivery_inbox_cli_returns_server_projection_without_rewriting_it(monkeypatch):
    seen = []
    expected = {"project_id": "selected", "scope": "team", "counts": {"total": 1}, "items": [{"id": "task:T-one", "categories": ["blocked"]}]}

    class Client:
        def delivery_inbox(self, *, scope):
            seen.append(scope)
            return expected

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, ["inbox", "--scope", "team", "--json"])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert seen == ["team"]


def test_delivery_inbox_cli_rejects_scope_and_preserves_access_failure(monkeypatch):
    monkeypatch.setattr(delivery, "get_client", lambda: pytest.fail("Invalid scope must not construct client"))
    invalid = CliRunner().invoke(delivery.app, ["inbox", "--scope", "everything"])
    assert invalid.exit_code != 0 and "scope" in invalid.output

    class Client:
        def delivery_inbox(self, *, scope):
            raise SopForbiddenError("Project access denied", status=403)

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    forbidden = CliRunner().invoke(delivery.app, ["inbox", "--json"])
    assert forbidden.exit_code == 1
    assert "Project access denied" in forbidden.output
