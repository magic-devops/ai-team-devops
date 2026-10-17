"""Only stable IDs enter task write requests or offline queues."""

import json
from types import SimpleNamespace

from sop_cli.commands import task
from typer.testing import CliRunner


def test_task_owner_create_keep_and_clear_are_explicit(monkeypatch):
    seen = []

    class Client:
        def create_task(self, body):
            seen.append(body)
            return {"id": "T-new"}

        def update_task(self, task_id, body):
            seen.append(body)

    monkeypatch.setattr(task, "get_client", Client)
    runner = CliRunner()
    for args in (["create", "A", "--owner-id", "user:one"], ["update", "T-new", "--title", "B"], ["update", "T-new", "--owner-id", ""]):
        result = runner.invoke(task.app, args)
        assert result.exit_code == 0, result.output
    assert seen[0]["owner_id"] == "user:one"
    assert seen[1] == {"title": "B"}
    assert seen[2] == {"owner_id": ""}
    assert all("assigned_to" not in body for body in seen)


def test_task_owner_offline_queue_has_no_name_alias(monkeypatch, tmp_path):
    monkeypatch.setattr(task, "get_config", lambda: SimpleNamespace(project_path=tmp_path))
    result = CliRunner().invoke(task.app, ["create", "A", "--owner-id", "member-one", "--local"])
    assert result.exit_code == 0, result.output
    queued = json.loads((tmp_path / ".sop-runtime/sync/push_queue.jsonl").read_text(encoding="utf-8"))
    assert queued["record"]["owner_id"] == "member-one"
    assert "assigned_to" not in queued["record"]


def test_obsolete_name_option_does_not_contact_or_queue(monkeypatch, tmp_path):
    monkeypatch.setattr(task, "get_config", lambda: SimpleNamespace(project_path=tmp_path))
    monkeypatch.setattr(task, "get_client", lambda: (_ for _ in ()).throw(AssertionError("No request")))
    result = CliRunner().invoke(task.app, ["create", "A", "--assignee", "Same name"])
    assert result.exit_code == 2


def test_schedule_owner_pool_and_other_task_commands_have_no_name_payload(monkeypatch):
    seen = []

    class Client:
        def __getattr__(self, name):
            def call(*args):
                seen.append((name, args[-1]))
                return {"summary": {}}
            return call

    monkeypatch.setattr(task, "get_client", Client)
    runner = CliRunner()
    for args in (["schedule", "--owner-pool", "user:one,member-two", "--json"], ["schedule-action", "--id", "schedule-one", "--action", "rerun", "--json"], ["schedule-insights", "--json"], ["dep-tasks", "--owner-id", "user:one", "--json"]):
        result = runner.invoke(task.app, args)
        assert result.exit_code == 0, result.output
    assert seen[0][1]["owner_pool"] == ["user:one", "member-two"]
    assert "owner_pool" not in seen[1][1]
    assert "owner_pool" not in seen[2][1]
    assert seen[3][1]["owner_id"] == "user:one"
    assert all("assigned_to" not in body for _, body in seen)
