import json
from pathlib import Path

from sop_cli.__main__ import app as sop_app
from sop_cli.commands import hermes
from typer.testing import CliRunner

ROOT = Path(__file__).resolve().parents[3]


def test_root_cli_registers_non_colliding_hermes_commands():
    source = (ROOT / "packages/sop-cli/sop_cli/__main__.py").read_text(encoding="utf-8")

    for command in ("workspace", "device", "session", "run", "approval", "asset", "hermes"):
        assert f'name="{command}"' in source
    assert 'build_resource_app("devices")' in source
    assert 'build_resource_app("sessions")' in source
    assert 'build_resource_app("runs")' in source
    assert 'build_resource_app("assets")' in source


def test_root_version_flag_is_eager_and_usable_without_command():
    result = CliRunner().invoke(sop_app, ["--version"])
    assert result.exit_code == 0, result.output
    assert "sop 1.0.0" in result.output


def test_existing_singular_task_requirement_are_preserved_with_v1_subcommands():
    task_source = (ROOT / "packages/sop-cli/sop_cli/commands/task.py").read_text(encoding="utf-8")
    requirement_source = (ROOT / "packages/sop-cli/sop_cli/commands/requirement.py").read_text(encoding="utf-8")

    assert '@app.command(name="list")' in task_source
    assert 'app.add_typer(hermes_cmd.build_resource_app("tasks"), name="v1"' in task_source
    assert '@app.command(name="list")' in requirement_source
    assert 'app.add_typer(hermes_cmd.build_resource_app("requirements"), name="v1"' in requirement_source


def test_hermes_cli_defaults_actions_to_dry_run_until_apply():
    result = CliRunner().invoke(hermes.build_resource_app("runs"), ["start", "--help"])
    assert result.exit_code == 0
    assert "--dry-run" in result.output
    assert "--expected-version" in result.output


def test_task_dispatch_help_exposes_worktree_isolation_options():
    result = CliRunner().invoke(hermes.build_resource_app("tasks"), ["dispatch", "--help"])
    compact_help = "".join(result.output.split())

    assert result.exit_code == 0
    assert "--isolation" in result.output
    assert "workspace|git_wor" in compact_help
    assert "ktree" in compact_help
    assert "--base-commit" in result.output


def test_task_dispatch_passes_isolation_base_commit_and_dry_run(monkeypatch, tmp_path):
    calls = []
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({"nodes": [{"id": "n1"}]}), encoding="utf-8")

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def task_dispatch(self, task_id, nodes, **kwargs):
            calls.append((task_id, nodes, kwargs))
            return {"ok": True, "items": []}

    monkeypatch.setattr(hermes, "get_hermes_client", Client)
    result = CliRunner().invoke(hermes.build_resource_app("tasks"), [
        "dispatch", "task-1",
        "--plan", str(plan),
        "--expected-version", "3",
        "--isolation", "git_worktree",
        "--base-commit", "abc123",
        "--json",
    ])

    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["ok"]
    assert calls == [(
        "task-1",
        [{"id": "n1"}],
        {
            "expected_version": 3,
            "dry_run": True,
            "idempotency_key": None,
            "isolation": "git_worktree",
            "base_commit": "abc123",
        },
    )]


def test_named_run_commands_send_dry_run_and_explicit_apply(monkeypatch):
    calls = []

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def run_action(self, run_id, action, **kwargs):
            calls.append((run_id, action, kwargs))
            return {"ok": True, "items": []}

    monkeypatch.setattr(hermes, "get_hermes_client", Client)
    app = hermes.build_resource_app("runs")
    for action in ("start", "cancel", "retry", "replay", "export"):
        for flags, dry in (([], True), (["--apply"], False)):
            result = CliRunner().invoke(app, [action, "r", "--expected-version", "2", "--json", *flags])
            assert result.exit_code == 0, result.output
            assert json.loads(result.output)["ok"]
            assert calls[-1] == ("r", action, {"expected_version": 2, "dry_run": dry, "idempotency_key": None})


def test_run_changes_command_reads_code_evidence(monkeypatch):
    calls = []

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def run_changes(self, run_id):
            calls.append(run_id)
            return {"ok": True, "items": [{"id": "change-1", "kind": "code_evidence"}]}

    monkeypatch.setattr(hermes, "get_hermes_client", Client)
    result = CliRunner().invoke(hermes.build_resource_app("runs"), ["changes", "run-1", "--json"])

    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["items"][0]["kind"] == "code_evidence"
    assert calls == ["run-1"]


def test_workspace_repository_command_reads_repository(monkeypatch):
    calls = []

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def repository(self, workspace_id):
            calls.append(workspace_id)
            return {"ok": True, "items": [{"id": "repo-1", "kind": "repository"}]}

    monkeypatch.setattr(hermes, "get_hermes_client", Client)
    result = CliRunner().invoke(hermes.workspace_app, ["repository", "ws-1", "--json"])

    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["items"][0]["id"] == "repo-1"
    assert calls == ["ws-1"]


def test_missing_connection_is_machine_readable_non_destructive_failure(monkeypatch):
    monkeypatch.delenv("HERMES_URL", raising=False)
    monkeypatch.delenv("HERMES_TOKEN_FILE", raising=False)
    result = CliRunner().invoke(hermes.build_resource_app("runs"), ["list", "--json"])
    assert result.exit_code != 0
    assert json.loads(result.output)["ok"] is False


def test_actions_without_entity_data_render_safely():
    hermes._print_payload({"ok": True, "items": [{"id": "run.start"}]}, as_json=False)


def test_diagnostics_json_and_failure_exit(monkeypatch):
    class Client:
        ready = True

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def system_diagnostics(self):
            return {"ok": self.ready, "items": [{"id": "store", "status": "passed" if self.ready else "failed"}]}

        def system_readiness(self):
            return self.system_diagnostics()

    monkeypatch.setattr(hermes, "get_hermes_client", Client)
    for ready, exit_code in ((True, 0), (False, 1)):
        Client.ready = ready
        for command in ("diagnostics", "readiness"):
            result = CliRunner().invoke(hermes.system_app, [command, "--json"])
            assert result.exit_code == exit_code, result.output
            assert json.loads(result.output)["ok"] is ready
