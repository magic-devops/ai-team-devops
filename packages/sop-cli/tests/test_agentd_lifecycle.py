"""CLI lifecycle uses project-scoped IPC facts and never numeric-PID signalling."""

import json
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from sop_cli.commands import agentd
from typer.testing import CliRunner


def health(project, *, pid=123, instance="instance-one", **extra):
    return {
        "ok": True,
        "result": {"project_path": str(project), "pid": pid, "instance_id": instance, **extra},
    }


@pytest.fixture
def project(tmp_path, monkeypatch):
    selected = tmp_path / "selected"
    selected.mkdir()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setenv("PROJECT_PATH", str(selected))
    return selected


def ipc(monkeypatch, project, replies, *, stop_reply=None):
    import sop_sdk

    calls = []

    class Client:
        def diagnose(self):
            return {
                "available": replies[0].get("error_code") != "unavailable",
                "transport": "named_pipe",
                "endpoint": r"\\.\pipe\selected",
                "timeout": 1.0,
            }

        def health(self):
            calls.append(("health", None))
            return replies.pop(0) if len(replies) > 1 else replies[0]

        def send(self, op, **kwargs):
            calls.append((op, kwargs))
            return stop_reply if stop_reply is not None else {"ok": True}

    def client(*args, **kwargs):
        calls.append(("client", {"args": args, "kwargs": kwargs}))
        assert kwargs == {"project_path": project}
        return Client()

    monkeypatch.setattr(sop_sdk, "AgentdIpcClient", client)
    monkeypatch.setattr(agentd.os, "kill", lambda *args: pytest.fail("CLI must never signal a numeric PID"))
    return calls


def invoke(*args):
    result = CliRunner().invoke(agentd.app, list(args))
    return result, json.loads(result.output) if result.output.lstrip().startswith("{") else None


def test_status_discovers_selected_project_without_pid_and_returns_machine_health(project, monkeypatch):
    calls = ipc(monkeypatch, project, [health(project)])
    result, body = invoke("status", "--json")
    assert result.exit_code == 0, result.output
    assert body["ok"] is True and body["project_path"] == str(project)
    assert body["transport"] == "named_pipe" and body["endpoint"].endswith("selected")
    assert body["available"] is True and body["health"]["result"]["instance_id"] == "instance-one"
    assert calls[0][1]["kwargs"]["project_path"] == project
    assert not (project / ".sop-runtime").exists()


def test_status_is_read_only_and_never_uses_a_pid_as_a_health_probe(project, monkeypatch):
    rt = project / ".sop-runtime"
    rt.mkdir()
    pid = rt / "agentd.pid"
    pid.write_text("444")
    ipc(monkeypatch, project, [health(project)])
    result, body = invoke("status", "--json")
    assert result.exit_code == 0, result.output
    assert pid.read_text() == "444"
    assert body["pid_file_pid"] == 444


@pytest.mark.parametrize(
    "reply,code",
    [
        ({"ok": False, "error_code": "unavailable", "error": "offline"}, "unavailable"),
        ({"ok": True, "result": {}}, "invalid_health"),
    ],
)
def test_status_reports_unavailable_or_invalid_health_as_failure(project, monkeypatch, reply, code):
    ipc(monkeypatch, project, [reply])
    result, body = invoke("status", "--json")
    assert result.exit_code == 1, result.output
    assert body["ok"] is False and body["error_code"] == code


def test_status_rejects_an_endpoint_responding_for_another_project(project, monkeypatch, tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    ipc(monkeypatch, project, [health(other)])
    result, body = invoke("status", "--json")
    assert result.exit_code == 1, result.output
    assert body["error_code"] == "project_mismatch"


def test_windows_repository_binary_fallback_finds_exe(tmp_path, monkeypatch):
    repo = tmp_path / "repository"
    source = repo / "packages/sop-cli/sop_cli/commands/agentd.py"
    source.parent.mkdir(parents=True)
    source.write_text("")
    binary = repo / "apps/agent-runtime/bin/sop-agentd.exe"
    binary.parent.mkdir(parents=True)
    binary.write_bytes(b"fixture")
    monkeypatch.setattr(agentd, "__file__", str(source))
    monkeypatch.setattr(agentd.shutil, "which", lambda _: None)
    monkeypatch.setattr(agentd.sys, "platform", "win32")
    assert agentd._binary() == str(binary)


def test_start_uses_selected_project_hidden_windows_process_and_waits_for_real_health(
    project, monkeypatch, tmp_path
):
    ipc(monkeypatch, project, [{"ok": False, "error_code": "unavailable"}, health(project)])
    monkeypatch.setattr(agentd, "_binary", lambda: str(tmp_path / "sop-agentd.exe"))
    launched = []
    monkeypatch.setattr(
        agentd.subprocess,
        "Popen",
        lambda *args, **kwargs: (
            launched.append((args, kwargs)) or SimpleNamespace(pid=123, poll=lambda: None)
        ),
    )
    monkeypatch.setattr(agentd.sys, "platform", "win32")
    result, body = invoke("start", "--json")
    assert result.exit_code == 0, result.output
    assert body["started"] is True and body["health"]["result"]["pid"] == 123
    args, options = launched[0]
    assert options["cwd"] == str(project) and options["env"]["PROJECT_PATH"] == str(project)
    assert options["creationflags"] & agentd.subprocess.CREATE_NO_WINDOW
    assert options["stdout"].closed
    assert not (project / ".sop-runtime/agentd.pid").exists()


def test_start_does_not_call_spawn_when_same_project_is_already_healthy(project, monkeypatch):
    ipc(monkeypatch, project, [health(project)])
    monkeypatch.setattr(agentd.subprocess, "Popen", lambda *args, **kwargs: pytest.fail("duplicate spawn"))
    result, body = invoke("start", "--json")
    assert result.exit_code == 0, result.output
    assert body["started"] is False and body["ok"] is True


def test_start_does_not_claim_success_for_a_child_that_exits_and_keeps_foreign_pid(
    project, monkeypatch, tmp_path
):
    rt = project / ".sop-runtime"
    rt.mkdir()
    pid = rt / "agentd.pid"
    pid.write_text("999")
    ipc(monkeypatch, project, [{"ok": False, "error_code": "unavailable"}])
    monkeypatch.setattr(agentd, "_binary", lambda: str(tmp_path / "sop-agentd.exe"))
    monkeypatch.setattr(
        agentd.subprocess, "Popen", lambda *args, **kwargs: SimpleNamespace(pid=123, poll=lambda: 7)
    )
    result, body = invoke("start", "--json")
    assert result.exit_code == 1, result.output
    assert body["error_code"] == "process_exited" and body["started"] is False
    assert pid.read_text() == "999"


def test_stop_binds_exact_instance_with_no_pid_file_and_confirms_its_departure(project, monkeypatch):
    calls = ipc(monkeypatch, project, [health(project), {"ok": False, "error_code": "unavailable"}])
    result, body = invoke("stop", "--json")
    assert result.exit_code == 0, result.output
    assert body["stopped"] is True and body["stopped_instance_id"] == "instance-one"
    request = next(value for op, value in calls if op == "daemon.stop")
    assert request["data"] == {"instance_id": "instance-one", "project_path": str(project)}
    assert not (project / ".sop-runtime").exists()


def test_stop_never_stops_a_replacement_instance(project, monkeypatch):
    calls = ipc(monkeypatch, project, [health(project), health(project, pid=999, instance="replacement")])
    result, body = invoke("stop", "--json")
    assert result.exit_code == 0, result.output
    assert body["stopped_instance_id"] == "instance-one" and body["replacement_present"] is True
    assert len([op for op, _ in calls if op == "daemon.stop"]) == 1


def test_stop_rejects_another_project_and_keeps_unverified_pid(project, monkeypatch, tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    rt = project / ".sop-runtime"
    rt.mkdir()
    pid = rt / "agentd.pid"
    pid.write_text("999")
    calls = ipc(monkeypatch, project, [health(other)])
    result, body = invoke("stop", "--json")
    assert result.exit_code == 1, result.output
    assert body["error_code"] == "project_mismatch" and pid.read_text() == "999"
    assert not [op for op, _ in calls if op == "daemon.stop"]


def test_stop_does_not_report_success_when_ack_is_rejected_or_daemon_unavailable(project, monkeypatch):
    for replies, ack in [
        ([health(project)], {"ok": False, "error": "instance changed"}),
        ([{"ok": False, "error_code": "unavailable"}], None),
    ]:
        ipc(monkeypatch, project, replies, stop_reply=ack)
        result, body = invoke("stop", "--json")
        assert result.exit_code == 1, result.output
        assert body["stopped"] is False and body["ok"] is False


def test_logs_reads_the_same_selected_project_without_creating_runtime(project, monkeypatch):
    log = project / ".sop-runtime/logs/agentd.log"
    log.parent.mkdir(parents=True)
    log.write_text("selected daemon log", encoding="utf-8")
    monkeypatch.setattr(
        agentd.subprocess, "call", lambda *args, **kwargs: (_ for _ in ()).throw(FileNotFoundError())
    )
    result = CliRunner().invoke(agentd.app, ["logs"])
    assert result.exit_code == 0 and "selected daemon log" in result.output


def test_stop_does_not_treat_a_transport_timeout_as_confirmed_departure(project, monkeypatch):
    ipc(
        monkeypatch,
        project,
        [health(project), {"ok": False, "error_code": "transport_error", "error": "read timed out"}],
    )
    result, body = invoke("stop", "--json", "--timeout", "0.1")
    assert result.exit_code == 1, result.output
    assert body["error_code"] == "stop_timeout" and body["stopped"] is False


def test_invalid_project_and_spawn_permission_failure_are_machine_readable(project, monkeypatch, tmp_path):
    result, body = invoke("status", "--json", "--project", str(tmp_path / "missing"))
    assert result.exit_code == 2 and body["error_code"] == "project_unavailable"
    ipc(monkeypatch, project, [{"ok": False, "error_code": "unavailable"}])
    monkeypatch.setattr(agentd, "_binary", lambda: "sop-agentd.exe")
    monkeypatch.setattr(
        agentd, "_runtime", lambda _: (_ for _ in ()).throw(PermissionError("project denied"))
    )
    result, body = invoke("start", "--json")
    assert result.exit_code == 1 and body["error_code"] == "spawn_failed"


def test_explicit_project_overrides_environment_and_samefile_alias_is_accepted(
    project, monkeypatch, tmp_path
):
    override = tmp_path / "override"
    override.mkdir()
    ipc(monkeypatch, override, [health(override)])
    result, body = invoke("status", "--json", "--project", str(override))
    assert result.exit_code == 0 and body["project_path"] == str(override)
    reported = str(override / "..").replace("/", "\\") + "/override"
    ipc(monkeypatch, override, [health(reported)])
    result, body = invoke("status", "--json", "--project", str(override))
    assert result.exit_code == 0 and body["ok"] is True


def test_start_cleans_only_the_child_it_spawned_when_another_instance_responds(project, monkeypatch):
    ipc(
        monkeypatch,
        project,
        [{"ok": False, "error_code": "unavailable"}, health(project, pid=999, instance="racing-instance")],
    )
    monkeypatch.setattr(agentd, "_binary", lambda: "sop-agentd.exe")
    actions = []
    process = SimpleNamespace(
        pid=123,
        poll=lambda: None,
        terminate=lambda: actions.append("terminate-original-handle"),
        wait=lambda **_: actions.append("wait-original-handle") or 1,
    )
    monkeypatch.setattr(agentd.subprocess, "Popen", lambda *args, **kwargs: process)
    result, body = invoke("start", "--json")
    assert result.exit_code == 1 and body["error_code"] == "instance_changed"
    assert actions == ["terminate-original-handle", "wait-original-handle"]
    assert body["spawned_process_stopped"] is True


def test_stop_ack_without_departure_is_pending_and_does_not_claim_stopped(project, monkeypatch):
    ipc(monkeypatch, project, [health(project)])
    result, body = invoke("stop", "--json", "--timeout", "0.1")
    assert result.exit_code == 1
    assert body["stop_accepted"] is True and body["stopped"] is False


def test_start_refuses_an_endpoint_for_another_project_before_spawning(project, monkeypatch, tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    ipc(monkeypatch, project, [health(other)])
    monkeypatch.setattr(
        agentd.subprocess,
        "Popen",
        lambda *args, **kwargs: pytest.fail("foreign endpoint must not cause spawn"),
    )
    result, body = invoke("start", "--json")
    assert result.exit_code == 1 and body["error_code"] == "project_mismatch"
    assert not (project / ".sop-runtime").exists()


def test_status_reports_invalid_endpoint_configuration_in_json(project, monkeypatch):
    import sop_sdk

    def invalid(**kwargs):
        raise ValueError("Only local named pipes are accepted")

    monkeypatch.setattr(sop_sdk, "AgentdIpcClient", invalid)
    result, body = invoke("status", "--json")
    assert result.exit_code == 2 and body["error_code"] == "ipc_configuration_error"


def test_foreground_start_preserves_selected_project_environment_and_child_exit(project, monkeypatch):
    ipc(monkeypatch, project, [{"ok": False, "error_code": "unavailable"}])
    monkeypatch.setattr(agentd, "_binary", lambda: "sop-agentd.exe")
    calls = []
    monkeypatch.setattr(
        agentd.subprocess,
        "run",
        lambda *args, **kwargs: calls.append((args, kwargs)) or SimpleNamespace(returncode=4),
    )
    result = CliRunner().invoke(agentd.app, ["start", "--foreground"])
    assert result.exit_code == 4
    assert calls[0][1]["cwd"] == str(project) and calls[0][1]["env"]["PROJECT_PATH"] == str(project)
    assert "creationflags" not in calls[0][1]
    assert not (project / ".sop-runtime").exists()


def test_current_directory_is_selected_when_project_environment_is_absent(project, monkeypatch):
    monkeypatch.delenv("PROJECT_PATH")
    monkeypatch.chdir(project)
    ipc(monkeypatch, project, [health(project)])
    result, body = invoke("status", "--json")
    assert result.exit_code == 0 and body["project_path"] == str(project)


def test_successful_health_overrides_an_earlier_unavailable_diagnostic_sample(project):
    client = SimpleNamespace(
        diagnose=lambda: {"available": False, "transport": "named_pipe", "endpoint": "local"},
        health=lambda: health(project),
    )
    snapshot = agentd._probe(project, client)
    assert snapshot["ok"] is True and snapshot["available"] is True


@pytest.mark.parametrize("code", ["timeout", "transport_error"])
def test_start_does_not_duplicate_a_busy_or_unverified_existing_endpoint(project, monkeypatch, code):
    ipc(
        monkeypatch,
        project,
        [{"ok": False, "error_code": code, "error": "endpoint exists but health is not confirmed"}],
    )
    monkeypatch.setattr(agentd, "_binary", lambda: "sop-agentd.exe")
    launches = []
    monkeypatch.setattr(
        agentd.subprocess,
        "Popen",
        lambda *args, **kwargs: launches.append(True) or SimpleNamespace(pid=123, poll=lambda: 7),
    )
    result, body = invoke("start", "--json")
    assert launches == []
    assert result.exit_code == 1 and body["started"] is False
    assert body["error_code"] == code and not (project / ".sop-runtime").exists()


def test_selected_junction_keeps_its_locator_spelling_and_health_checks_the_same_directory(
    project, monkeypatch, tmp_path
):
    alias = tmp_path / "selected-link"
    sentinel = project / "keep.txt"
    sentinel.write_bytes(b"preserve task-owned junction target")
    if os.name == "nt":
        subprocess.run(  # noqa: S603 -- fixed Windows command creates only this test-owned junction
            [
                str(Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe"),
                "/c",
                "mklink",
                "/J",
                str(alias),
                str(project),
            ],
            capture_output=True,
            check=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    else:
        alias.symlink_to(project, target_is_directory=True)
    try:
        assert os.path.samefile(alias, project)
        monkeypatch.setenv("PROJECT_PATH", str(alias))
        ipc(monkeypatch, alias, [health(project)])
        result, body = invoke("status", "--json")
        assert result.exit_code == 0, result.output
        assert body["project_path"] == str(alias) and body["ok"] is True
    finally:
        # Remove only this test-created link. Never traverse or remove its target.
        if os.name == "nt":
            os.rmdir(alias)
        else:
            alias.unlink()
        assert sentinel.read_bytes() == b"preserve task-owned junction target"


def test_path_discovered_binary_is_fixed_before_selected_project_changes_cwd(project, monkeypatch, tmp_path):
    portable = tmp_path / "portable"
    portable.mkdir()
    binary = portable / ("sop-agentd.exe" if os.name == "nt" else "sop-agentd")
    binary.write_bytes(b"discovery fixture only; never executed")
    if os.name != "nt":
        binary.chmod(0o700)
    monkeypatch.chdir(portable)
    monkeypatch.setenv("PATH", ".")
    discovered = agentd._binary()
    assert discovered is not None
    monkeypatch.chdir(project)
    assert Path(discovered).is_absolute()
    assert os.path.samefile(discovered, binary)


def test_start_rejects_late_health_even_when_it_matches_the_spawned_process(project, monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(agentd.time, "monotonic", lambda: clock[0])

    def delayed_health():
        clock[0] = 0.15
        return health(project)

    client = SimpleNamespace(
        diagnose=lambda: {"available": True, "transport": "named_pipe", "endpoint": "local"},
        health=delayed_health,
    )
    result = agentd._await_start(
        project, client, SimpleNamespace(pid=123, poll=lambda: None), {"ok": False}, 0.1
    )
    assert result["ok"] is False and result["error_code"] == "readiness_timeout"
    assert result["health"]["ok"] is True


@pytest.mark.parametrize("departure", ["unavailable", "replacement"])
def test_stop_rejects_late_departure_confirmation(project, monkeypatch, departure):
    response = (
        {"ok": False, "error_code": "unavailable"}
        if departure == "unavailable"
        else health(project, pid=999, instance="replacement")
    )
    ipc(monkeypatch, project, [health(project), response])
    clock = [0.0]
    monkeypatch.setattr(agentd.time, "monotonic", lambda: clock[0])
    original_probe = agentd._probe
    probes = []

    def delayed_probe(*args):
        snapshot = original_probe(*args)
        if probes:
            clock[0] = 0.15
        probes.append(snapshot)
        return snapshot

    monkeypatch.setattr(agentd, "_probe", delayed_probe)
    result, body = invoke("stop", "--json", "--timeout", "0.1")
    assert result.exit_code == 1, result.output
    assert body["error_code"] == "stop_timeout" and body["stopped"] is False
    assert body["stop_accepted"] is True


def test_stop_has_a_failure_snapshot_if_deadline_expires_before_any_departure_probe(project, monkeypatch):
    calls = ipc(monkeypatch, project, [health(project)])
    times = iter([0.0, 0.2])
    monkeypatch.setattr(agentd.time, "monotonic", lambda: next(times, 0.2))
    result, body = invoke("stop", "--json", "--timeout", "0.1")
    assert result.exit_code == 1 and body is not None, repr(result.exception)
    assert body["error_code"] == "stop_timeout" and body["stopped"] is False
    assert body["stop_accepted"] is True
    assert len([op for op, _ in calls if op == "health"]) == 1
