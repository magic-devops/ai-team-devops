import json
import os
import subprocess
import sys
from pathlib import Path

from sop_cli.__main__ import app as sop_app
from sop_cli.commands import hermes
from typer.testing import CliRunner

ROOT = Path(__file__).resolve().parents[3]


class ContractClient:
    calls: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def agent_catalog(self):
        self.calls.append(("agent_catalog",))
        return {"ok": True, "items": [{"id": "codex"}]}

    def list_resource(self, resource, **kwargs):
        self.calls.append(("list_resource", resource, kwargs))
        return {"ok": True, "items": [{"id": "squad"}]}

    def create_agent_profile(self, data, **kwargs):
        self.calls.append(("agent", data, kwargs))
        return {"ok": True, "items": []}

    def create_squad(self, data, **kwargs):
        self.calls.append(("squad", data, kwargs))
        return {"ok": True, "items": []}

    def schedule_configure(self, schedule_id, data, **kwargs):
        self.calls.append(("schedule_configure", schedule_id, data, kwargs))
        return {"ok": True, "items": []}

    def schedule_action(self, schedule_id, action, **kwargs):
        self.calls.append(("schedule_action", schedule_id, action, kwargs))
        return {"ok": True, "items": []}

    def schedule_history(self, schedule_id, **kwargs):
        self.calls.append(("schedule_history", schedule_id, kwargs))
        return {"ok": True, "items": []}

    def device_pair(self, device_id, secret):
        self.calls.append(("device_pair", device_id, secret))
        return {"ok": True, "items": []}

    def device_pairing(self, device_id, **kwargs):
        self.calls.append(("device_pairing", device_id, kwargs))
        return {"ok": True, "items": []}

    def device_revoke(self, device_id, **kwargs):
        self.calls.append(("device_revoke", device_id, kwargs))
        return {"ok": True, "items": []}


def _invoke_ok(app, args):
    result = CliRunner().invoke(app, args)
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["ok"]


def _run_top_level_help(*args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    paths = [ROOT / "packages/hermes-core", ROOT / "packages/sop-sdk-python", ROOT / "packages/sop-cli"]
    env["PYTHONPATH"] = os.pathsep.join([*(str(path) for path in paths), env.get("PYTHONPATH", "")])
    return subprocess.run(  # noqa: S603
        [sys.executable, "-m", "sop_cli", *args, "--help"],
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=30,
        check=False,
    )


def test_root_cli_registers_non_colliding_hermes_commands():
    source = (ROOT / "packages/sop-cli/sop_cli/__main__.py").read_text(encoding="utf-8")

    for command in ("workspace", "device", "agent", "squad", "schedule", "session", "run", "approval", "asset", "hermes"):
        assert f'name="{command}"' in source
    assert 'build_resource_app("devices")' in source
    assert 'build_resource_app("agents")' in source
    assert 'build_resource_app("squads")' in source
    assert 'build_resource_app("schedules")' in source
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


def test_task_agent_dispatch_help_exposes_versioned_leader_routing_contract():
    result = CliRunner().invoke(hermes.build_resource_app("tasks"), ["agent-dispatch", "--help"])
    compact_help = " ".join(result.output.split())

    assert result.exit_code == 0
    assert "--target-version" in result.output
    assert "--agent-id" in result.output
    assert "--squad-id" in result.output
    assert "leader wakes" in compact_help
    assert "routes members" in compact_help


def test_cli_only_exposes_supported_delete_and_dedicated_lifecycle_actions():
    assert CliRunner().invoke(hermes.build_resource_app("assets"), ["delete", "--help"]).exit_code == 0
    for resource in ("agents", "squads", "schedules", "devices"):
        result = CliRunner().invoke(hermes.build_resource_app(resource), ["delete", "--help"])
        assert result.exit_code != 0

    assert CliRunner().invoke(hermes.build_resource_app("agents"), ["patch", "--help"]).exit_code == 0
    assert CliRunner().invoke(hermes.build_resource_app("squads"), ["patch", "--help"]).exit_code == 0
    assert CliRunner().invoke(hermes.build_resource_app("schedules"), ["create", "--help"]).exit_code != 0
    assert CliRunner().invoke(hermes.build_resource_app("schedules"), ["patch", "--help"]).exit_code != 0
    assert CliRunner().invoke(hermes.build_resource_app("devices"), ["patch", "--help"]).exit_code != 0
    assert CliRunner().invoke(hermes.build_resource_app("schedules"), ["pause", "--help"]).exit_code == 0
    assert CliRunner().invoke(hermes.build_resource_app("devices"), ["revoke", "--help"]).exit_code == 0


def test_top_level_readiness_commands_are_registered_by_subprocess():
    for command in (
        ("agent", "catalog"),
        ("agent", "create"),
        ("agent", "patch"),
        ("squad", "catalog"),
        ("squad", "create"),
        ("squad", "patch"),
        ("schedule", "configure"),
        ("schedule", "trigger"),
        ("schedule", "pause"),
        ("schedule", "resume"),
        ("schedule", "history"),
        ("device", "pairing"),
        ("device", "pair"),
        ("device", "revoke"),
        ("system", "remote-worker"),
        ("task", "v1", "agent-dispatch"),
    ):
        result = _run_top_level_help(*command)
        assert result.returncode == 0, result.stdout

    for command in (
        ("squad", "delete"),
        ("schedule", "create"),
        ("schedule", "patch"),
        ("device", "patch"),
    ):
        result = _run_top_level_help(*command)
        assert result.returncode != 0, result.stdout


def test_readiness_invokes_real_hermes_cli_contracts_only():
    source = (ROOT / "scripts/hermes-readiness.py").read_text(encoding="utf-8")

    for expected in (
        '("agent", "catalog")',
        '("agent", "create")',
        '("agent", "patch")',
        '("squad", "catalog")',
        '("squad", "create")',
        '("squad", "patch")',
        '("schedule", "configure")',
        '("schedule", "trigger")',
        '("schedule", "pause")',
        '("schedule", "resume")',
        '("schedule", "history")',
        '("device", "pairing")',
        '("device", "pair")',
        '("device", "revoke")',
        '("system", "remote-worker")',
    ):
        assert expected in source
    for invalid in ("squads/catalog", "worker-health", "worker-jobs", "worker-enqueue", "jobs/enqueue", "/remote/worker"):
        assert invalid not in source


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
        "--device-id", "device-1",
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
            "target_device_id": "device-1",
        },
    )]


def test_task_agent_dispatch_passes_selected_target_version_and_dry_run(monkeypatch):
    calls = []

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def task_agent_dispatch(self, task_id, **kwargs):
            calls.append((task_id, kwargs))
            return {"ok": True, "items": []}

    monkeypatch.setattr(hermes, "get_hermes_client", Client)
    result = CliRunner().invoke(hermes.build_resource_app("tasks"), [
        "agent-dispatch", "task-1",
        "--agent-id", "agent-1",
        "--target-version", "4",
        "--prompt", "Implement it",
        "--expected-version", "3",
        "--isolation", "git_worktree",
        "--base-commit", "abc123",
        "--json",
    ])

    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["ok"]
    assert calls == [("task-1", {
        "expected_version": 3,
        "target_version": 4,
        "prompt": "Implement it",
        "agent_id": "agent-1",
        "squad_id": "",
        "dry_run": True,
        "idempotency_key": None,
        "isolation": "git_worktree",
        "base_commit": "abc123",
    })]


def test_agent_squad_catalog_and_create_commands(monkeypatch):
    ContractClient.calls = []
    monkeypatch.setattr(hermes, "get_hermes_client", ContractClient)

    _invoke_ok(hermes.build_resource_app("agents"), ["catalog", "--json"])
    _invoke_ok(hermes.build_resource_app("squads"), ["catalog", "--json"])
    _invoke_ok(hermes.build_resource_app("agents"), [
        "create", "--field", "title=Codex", "--field", "provider=codex", "--field", "model=gpt-5.5",
        "--field", "instructions=Implement", "--field", "timeout_seconds=1200", "--json",
    ])
    _invoke_ok(hermes.build_resource_app("squads"), [
        "create", "--data", json.dumps({
            "title": "Squad",
            "members": [{"agent_id": "agent-1", "role": "leader", "instructions": "Route members"}],
        }), "--json",
    ])

    assert ContractClient.calls == [
        ("agent_catalog",),
        ("list_resource", "squads", {"q": "", "status": "", "kind": "", "limit": 50, "cursor": ""}),
        ("agent", {
            "title": "Codex",
            "provider": "codex",
            "model": "gpt-5.5",
            "instructions": "Implement",
            "timeout_seconds": 1200,
        }, {"idempotency_key": None}),
        ("squad", {
            "title": "Squad",
            "members": [{"agent_id": "agent-1", "role": "leader", "instructions": "Route members"}],
        }, {"idempotency_key": None}),
    ]


def test_schedule_and_device_pairing_commands(monkeypatch):
    ContractClient.calls = []
    monkeypatch.setattr(hermes, "get_hermes_client", ContractClient)

    _invoke_ok(hermes.build_resource_app("schedules"), [
        "configure", "sch-1", "--field", "title=Nightly", "--expected-version", "1", "--json",
    ])
    _invoke_ok(hermes.build_resource_app("schedules"), [
        "trigger", "sch-1", "--expected-version", "2", "--apply", "--json",
    ])
    _invoke_ok(hermes.build_resource_app("schedules"), ["history", "sch-1", "--limit", "5", "--json"])
    _invoke_ok(hermes.build_resource_app("devices"), ["pairing", "dev-1", "--expected-version", "3", "--json"])
    _invoke_ok(hermes.build_resource_app("devices"), ["pair", "dev-1", "--secret", "pair-secret", "--json"])
    _invoke_ok(hermes.build_resource_app("devices"), ["revoke", "dev-1", "--expected-version", "3", "--json"])

    assert ContractClient.calls == [
        ("schedule_configure", "sch-1", {"title": "Nightly"}, {
            "expected_version": 1,
            "dry_run": True,
            "idempotency_key": None,
        }),
        ("schedule_action", "sch-1", "trigger", {"expected_version": 2, "dry_run": False, "idempotency_key": None}),
        ("schedule_history", "sch-1", {"limit": 5, "cursor": ""}),
        ("device_pairing", "dev-1", {"expected_version": 3, "dry_run": True, "idempotency_key": None}),
        ("device_pair", "dev-1", "pair-secret"),
        ("device_revoke", "dev-1", {"expected_version": 3, "dry_run": True, "idempotency_key": None}),
    ]


def test_remote_worker_command_invokes_real_worker_module(monkeypatch, tmp_path):
    calls = []
    credential = tmp_path / "credential.json"

    class Result:
        returncode = 0

    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))
        return Result()

    monkeypatch.setattr(hermes.subprocess, "run", fake_run)
    result = CliRunner().invoke(hermes.system_app, [
        "remote-worker",
        "--server", "https://hermes.example",
        "--credential-file", str(credential),
        "--device-id", "dev-1",
        "--pair-secret", "pair-secret",
        "--workspace-id", "ws-1",
        "--target-root", str(tmp_path),
        "--agentd", "/bin/echo",
        "--once",
        "--poll-interval", "1.5",
    ])

    assert result.exit_code == 0, result.output
    assert calls == [([
        hermes.sys.executable,
        "-m",
        "hermes_core.remote_worker",
        "--server",
        "https://hermes.example",
        "--credential-file",
        str(credential),
        "--poll-interval",
        "1.5",
        "--device-id",
        "dev-1",
        "--pair-secret",
        "pair-secret",
        "--workspace-map",
        f"ws-1={tmp_path}",
        "--agentd",
        "/bin/echo",
        "--once",
    ], {"check": False})]


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
