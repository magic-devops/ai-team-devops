"""Task criteria are explicit in remote requests and offline synchronization."""

import json
from types import SimpleNamespace

import pytest
from sop_cli.commands import task
from typer.testing import CliRunner


def test_task_create_sends_repeated_criteria_without_requirement(monkeypatch):
    seen = []

    class Client:
        def create_task(self, body):
            seen.append(body)
            return {"id": "T-created"}

    monkeypatch.setattr(task, "get_client", Client)
    output = CliRunner().invoke(task.app, ["create", "Independent", "--criterion", " Real test passes ", "--criterion", "Review output"])
    assert output.exit_code == 0, output.output
    assert seen[0]["req_id"] == ""
    assert seen[0]["acceptance_criteria"] == ["Real test passes", "Review output"]


def test_task_update_keeps_criteria_unless_replaced_or_explicitly_cleared(monkeypatch):
    seen = []

    class Client:
        def update_task(self, task_id, body):
            seen.append((task_id, body))

    monkeypatch.setattr(task, "get_client", Client)
    runner = CliRunner()
    assert runner.invoke(task.app, ["update", "T-owned", "--title", "Renamed"]).exit_code == 0
    changed = runner.invoke(task.app, ["update", "T-owned", "--criterion", " Real evidence "])
    assert changed.exit_code == 0, changed.output
    cleared = runner.invoke(task.app, ["update", "T-owned", "--clear-criteria"])
    assert cleared.exit_code == 0, cleared.output
    assert seen == [("T-owned", {"title": "Renamed"}), ("T-owned", {"acceptance_criteria": ["Real evidence"]}),
                    ("T-owned", {"acceptance_criteria": []})]


@pytest.mark.parametrize("args", [["create", "Independent", "--criterion", " "],
                                  ["update", "T-owned", "--criterion", "x" * 2001],
                                  ["update", "T-owned", "--criterion", "Pass", "--clear-criteria"]])
def test_invalid_criteria_never_contact_manager_or_write_offline_queue(monkeypatch, args):
    monkeypatch.setattr(task, "get_client", lambda: pytest.fail("Invalid criteria must not contact Manager"))
    monkeypatch.setattr(task, "_save_and_queue", lambda row: pytest.fail("Invalid criteria must not enter sync"))
    output = CliRunner().invoke(task.app, args)
    assert output.exit_code == 2, output.output


def test_offline_task_and_push_queue_keep_text_criteria(monkeypatch, tmp_path):
    monkeypatch.setattr(task, "get_config", lambda: SimpleNamespace(project_path=tmp_path))
    output = CliRunner().invoke(task.app, ["create", "Independent", "--local", "--criterion", "Test passes"])
    assert output.exit_code == 0, output.output
    record = next(iter(json.loads((tmp_path / ".sop-runtime/local/tasks.json").read_text(encoding="utf-8")).values()))
    queued = json.loads((tmp_path / ".sop-runtime/sync/push_queue.jsonl").read_text(encoding="utf-8"))
    assert record["acceptance_criteria"] == ["Test passes"]
    assert queued["record"]["acceptance_criteria"] == ["Test passes"]
    assert "Test passes" in next((tmp_path / "sop/custom/tasks").glob("*.md")).read_text(encoding="utf-8")
