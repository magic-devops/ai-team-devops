import json
from pathlib import Path

import pytest
from sop_cli.commands import pages
from typer.testing import CliRunner

ROOT = Path(__file__).resolve().parents[3]


def test_pages_cli_exposes_interaction_analysis_command():
    source = (ROOT / "packages/sop-cli/sop_cli/commands/pages.py").read_text(encoding="utf-8")

    assert '@app.command("interaction-analysis")' in source
    assert '@app.command("interaction-tasks")' in source
    assert '@app.command("interaction-ops")' in source
    assert '@app.command("interaction-ops-tasks")' in source
    assert '@app.command("interaction-ops-memory")' in source
    assert '@app.command("interaction-ops-export")' in source
    assert "pages_interaction_analysis" in source
    assert "pages_interaction_tasks" in source
    assert "pages_interaction_ops" in source
    assert "pages_interaction_ops_tasks" in source
    assert "pages_interaction_ops_memory" in source
    assert "pages_interaction_ops_export" in source
    for option in ("--domain", "--status", "--q", "--limit", "--json"):
        assert option in source
    for option in ("--dry-run/--create", "--include-ready", "--owner-id"):
        assert option in source
    for option in ("--dry-run/--apply", "--include-low", "--idempotency-key", "--write-kb/--memory-only", "--include-events/--no-events"):
        assert option in source


def test_pages_sdk_exposes_interaction_analysis_method():
    source = (ROOT / "packages/sop-sdk-python/sop_sdk/client.py").read_text(encoding="utf-8")

    assert "def pages_interaction_analysis" in source
    assert "def pages_interaction_tasks" in source
    assert "def pages_interaction_ops" in source
    assert "def pages_interaction_ops_tasks" in source
    assert "def pages_interaction_ops_memory" in source
    assert "def pages_interaction_ops_export" in source
    assert "/api/v1/pages/interaction-analysis" in source
    assert "/api/v1/pages/interaction-analysis/tasks" in source
    assert "/api/v1/pages/interaction-ops" in source
    assert "/api/v1/pages/interaction-ops/tasks" in source
    assert "/api/v1/pages/interaction-ops/memory" in source
    assert "/api/v1/pages/interaction-ops/export" in source


@pytest.mark.parametrize("command", ["interaction-tasks", "interaction-ops-tasks"])
def test_interaction_task_help_exposes_stable_owner_identity(command):
    result = CliRunner().invoke(pages.app, [command, "--help"], env={"COLUMNS": "160"})
    assert result.exit_code == 0, result.output
    assert "--owner-id" in result.output
    assert "--assigned-to" not in result.output


@pytest.mark.parametrize(
    ("command", "method", "apply_flag"),
    [
        ("interaction-tasks", "pages_interaction_tasks", "--create"),
        ("interaction-ops-tasks", "pages_interaction_ops_tasks", "--apply"),
    ],
)
def test_interaction_task_command_passes_selected_identity_and_current_flags(
    monkeypatch, command, method, apply_flag
):
    seen = []

    class Client:
        def __getattr__(self, name):
            assert name == method

            def send(**body):
                seen.append(body)
                return {"dry_run": body["dry_run"], "summary": {"created": 1}}

            return send

    monkeypatch.setattr(pages, "get_client", Client)
    result = CliRunner().invoke(
        pages.app,
        [command, apply_flag, "--owner-id", "user:lead", "--ids", "one, two", "--max-items", "3", "--json"],
    )
    assert result.exit_code == 0, result.output
    assert len(seen) == 1
    assert seen[0]["owner_id"] == "user:lead"
    assert "assigned_to" not in seen[0]
    assert seen[0]["dry_run"] is False
    assert seen[0]["ids"] == ["one", "two"]
    assert seen[0]["max_items"] == 3
    assert json.loads(result.output)["summary"]["created"] == 1


@pytest.mark.parametrize("command", ["interaction-tasks", "interaction-ops-tasks"])
def test_interaction_task_default_is_unassigned_preview(monkeypatch, command):
    captured = []

    class Client:
        def pages_interaction_tasks(self, **body):
            captured.append(body)
            return {"dry_run": body["dry_run"]}

        pages_interaction_ops_tasks = pages_interaction_tasks

    monkeypatch.setattr(pages, "get_client", Client)
    result = CliRunner().invoke(pages.app, [command, "--json"])
    assert result.exit_code == 0, result.output
    assert captured[0]["owner_id"] == ""
    assert captured[0]["dry_run"] is True
    assert "assigned_to" not in captured[0]


@pytest.mark.parametrize("command", ["interaction-tasks", "interaction-ops-tasks"])
def test_interaction_task_rejects_display_name_option_before_connecting(monkeypatch, command):
    monkeypatch.setattr(pages, "get_client", lambda: pytest.fail("Invalid options must not contact Manager"))
    result = CliRunner().invoke(pages.app, [command, "--assigned-to", "A display name", "--json"])
    assert result.exit_code == 2
