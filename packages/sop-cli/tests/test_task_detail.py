import json
from contextlib import contextmanager

import pytest
from sop_cli.commands import task
from sop_sdk.errors import SopForbiddenError
from typer.testing import CliRunner


def test_task_show_uses_remote_detail_and_preserves_json(monkeypatch):
    seen = []
    result = {"id": "T-detail", "title": "Review", "status": "pending", "project_id": "selected"}

    class Client:
        def get_task(self, task_id):
            seen.append(task_id)
            return result

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(task, "get_client", client)
    monkeypatch.setattr(task, "_local_items", lambda **kw: pytest.fail("No offline fallback"))
    output = CliRunner().invoke(task.app, ["show", "T-detail", "--json"])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == result
    assert seen == ["T-detail"]


def test_task_show_reports_permission_failure_without_local_fallback(monkeypatch):
    class Client:
        def get_task(self, task_id):
            raise SopForbiddenError("Project read permission required", status=403)

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(task, "get_client", client)
    monkeypatch.setattr(task, "_local_items", lambda **kw: pytest.fail("No offline fallback"))
    output = CliRunner().invoke(task.app, ["show", "T-detail", "--json"])
    assert output.exit_code == 1
    assert "Project read permission required" in output.output


def test_task_show_requires_id_without_constructing_client(monkeypatch):
    monkeypatch.setattr(task, "get_client", lambda: pytest.fail("Missing ID must not create a client"))
    output = CliRunner().invoke(task.app, ["show"])
    assert output.exit_code == 2
    assert "Missing argument" in output.output
    assert "task_id" in output.output.lower()
