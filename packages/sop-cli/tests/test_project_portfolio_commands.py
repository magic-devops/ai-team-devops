import json
from contextlib import contextmanager

from sop_cli.commands import delivery, project
from typer.testing import CliRunner


def test_portfolio_preserves_filters_and_opaque_cursor_without_changing_scope(monkeypatch):
    calls = []

    class Client:
        def project_portfolio(self, **kwargs):
            calls.append(kwargs)
            return {"total": 15, "rows": [], "next_cursor": "next", "summary_scope": "filtered_projects"}

    monkeypatch.setattr(project, "get_client", lambda: Client())
    output = CliRunner().invoke(project.app, ["portfolio", "--status", "active", "--status", "paused", "--risk", "blocked", "--cursor", "opaque", "--limit", "2", "--json"])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output)["total"] == 15
    assert calls[0]["status"] == ["active", "paused"] and calls[0]["cursor"] == "opaque"


def test_lifecycle_preview_only_previews_an_explicit_target_and_reason(monkeypatch):
    calls = []

    class Client:
        def delivery_project_lifecycle_preview(self, body):
            calls.append(body)
            return {"version": 8, "allowed": False, "blockers": [{"code": "project_execution_unclosed"}]}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, ["lifecycle-preview", "--target", "archived", "--reason", "Release finished"])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output)["allowed"] is False
    assert calls == [{"target_status": "archived", "reason": "Release finished"}]
