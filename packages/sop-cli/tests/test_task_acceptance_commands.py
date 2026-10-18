"""Task criteria remain explicit in one immutable SQLite operation."""

import json
import sqlite3

import pytest
from sop_cli.commands import task
from sop_sdk.config import AgentConfig
from typer.testing import CliRunner

COMMON = ["--expected-version", "4", "--key", "criteria-one", "--time", "2026-10-18T00:00:00Z", "--local"]
BASIS = "a" * 64


def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(task, "get_config", lambda: AgentConfig(project_path=tmp_path, project_id="P"))


def records(tmp_path):
    with sqlite3.connect(tmp_path / ".sop-runtime/outbox.sqlite") as db:
        return [
            json.loads(raw)["data"]["record"]
            for (raw,) in db.execute("SELECT event_json FROM events ORDER BY id")
        ]


def test_task_create_sends_repeated_criteria_without_requirement(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    output = CliRunner().invoke(
        task.app,
        [
            "create",
            "Independent",
            "--record-id",
            "T-created",
            "--criterion",
            " Real test passes ",
            "--criterion",
            "Review output",
        ]
        + COMMON,
    )
    assert output.exit_code == 0, output.output
    (record,) = records(tmp_path)
    assert "req_id" not in record
    assert record["acceptance_criteria"] == ["Real test passes", "Review output"]


def test_task_update_keeps_criteria_unless_replaced_or_explicitly_cleared(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    runner = CliRunner()
    assert runner.invoke(task.app, ["update", "T-owned", "--title", "Renamed"] + COMMON).exit_code == 0
    changed_common = ["criteria-two" if value == "criteria-one" else value for value in COMMON]
    changed = runner.invoke(
        task.app,
        ["update", "T-owned", "--criterion", " Real evidence ", "--task-basis", BASIS] + changed_common,
    )
    assert changed.exit_code == 0, changed.output
    cleared_common = ["criteria-three" if value == "criteria-one" else value for value in COMMON]
    cleared = runner.invoke(
        task.app, ["update", "T-owned", "--clear-criteria", "--task-basis", BASIS] + cleared_common
    )
    assert cleared.exit_code == 0, cleared.output
    assert records(tmp_path) == [
        {"id": "T-owned", "title": "Renamed"},
        {"id": "T-owned", "acceptance_criteria": []},
        {"id": "T-owned", "acceptance_criteria": ["Real evidence"]},
    ]


@pytest.mark.parametrize(
    "args",
    [
        ["create", "Independent", "--record-id", "T-created", "--criterion", " "],
        ["update", "T-owned", "--criterion", "x" * 2001],
        ["update", "T-owned", "--criterion", "Pass", "--clear-criteria"],
    ],
)
def test_invalid_criteria_never_contact_manager_or_write_offline_queue(monkeypatch, tmp_path, args):
    setup(monkeypatch, tmp_path)
    monkeypatch.setattr(task, "get_client", lambda: pytest.fail("Invalid criteria must not contact Manager"))
    output = CliRunner().invoke(task.app, args + COMMON)
    assert output.exit_code == 2, output.output
    assert not (tmp_path / ".sop-runtime").exists()


def test_offline_task_keeps_text_criteria_without_speculative_business_files(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    output = CliRunner().invoke(
        task.app, ["create", "Independent", "--record-id", "T-created", "--criterion", "Test passes"] + COMMON
    )
    assert output.exit_code == 0, output.output
    (record,) = records(tmp_path)
    assert record["acceptance_criteria"] == ["Test passes"]
    assert not (tmp_path / ".sop-runtime/local/tasks.json").exists()
    assert not (tmp_path / ".sop-runtime/sync/push_queue.jsonl").exists()
    assert not (tmp_path / "sop/custom/tasks").exists()
