"""Only stable IDs enter task write requests or offline queues."""

import json
import sqlite3

from sop_cli.commands import task
from sop_sdk.config import AgentConfig
from typer.testing import CliRunner

COMMON = ["--expected-version", "4", "--key", "owner-one", "--time", "2026-10-18T00:00:00Z", "--local"]


def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(task, "get_config", lambda: AgentConfig(project_path=tmp_path, project_id="P"))


def records(tmp_path):
    with sqlite3.connect(tmp_path / ".sop-runtime/outbox.sqlite") as db:
        return [
            json.loads(raw)["data"]["record"]
            for (raw,) in db.execute("SELECT event_json FROM events ORDER BY id")
        ]


def test_task_owner_create_keep_and_clear_are_explicit(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    runner = CliRunner()
    for index, args in enumerate(
        (
            ["create", "A", "--record-id", "T-new", "--owner-id", "user:one"],
            ["update", "T-new", "--title", "B"],
            ["update", "T-new", "--owner-id", "", "--task-basis", "a" * 64],
        )
    ):
        common = [f"owner-{index}" if value == "owner-one" else value for value in COMMON]
        result = runner.invoke(task.app, args + common)
        assert result.exit_code == 0, result.output
    seen = records(tmp_path)
    assert seen[0]["owner_id"] == "user:one"
    assert seen[1] == {"id": "T-new", "title": "B"}
    assert seen[2] == {"id": "T-new", "owner_id": ""}
    assert all("assigned_to" not in body for body in seen)


def test_task_owner_offline_queue_has_no_name_alias(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    result = CliRunner().invoke(
        task.app, ["create", "A", "--record-id", "T-new", "--owner-id", "member-one"] + COMMON
    )
    assert result.exit_code == 0, result.output
    (queued,) = records(tmp_path)
    assert queued["owner_id"] == "member-one"
    assert "assigned_to" not in queued


def test_obsolete_name_option_does_not_contact_or_queue(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
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
    for args in (
        ["schedule", "--owner-pool", "user:one,member-two", "--json"],
        ["schedule-action", "--id", "schedule-one", "--action", "rerun", "--json"],
        ["schedule-insights", "--json"],
        ["dep-tasks", "--owner-id", "user:one", "--json"],
    ):
        result = runner.invoke(task.app, args)
        assert result.exit_code == 0, result.output
    assert seen[0][1]["owner_pool"] == ["user:one", "member-two"]
    assert "owner_pool" not in seen[1][1]
    assert "owner_pool" not in seen[2][1]
    assert seen[3][1]["owner_id"] == "user:one"
    assert all("assigned_to" not in body for _, body in seen)
