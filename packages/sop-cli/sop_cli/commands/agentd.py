"""Project-local daemon lifecycle confirmed through its actual IPC instance."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import textwrap
import time
from pathlib import Path
from typing import Annotated, Any

import typer

from .._util import console, err, kv, ok, warn

app = typer.Typer(help="sop-agentd 守护进程控制")
_PID_FILE = ".sop-runtime/agentd.pid"
_LOG_FILE = ".sop-runtime/logs/agentd.log"


def _read_pid(pidf: Path) -> int | None:
    try:
        pid = int(pidf.read_text(encoding="utf-8").strip())
        return pid if pid > 0 else None
    except (OSError, ValueError):
        return None


def _project(path: Path | None, json_output: bool) -> Path:
    selected = path if path is not None else Path(os.getenv("PROJECT_PATH") or ".")
    try:
        project = Path(os.path.abspath(selected.expanduser()))
        if not project.is_dir():
            raise NotADirectoryError(str(project))
        return project
    except (OSError, RuntimeError) as exc:
        _emit(
            {
                "ok": False,
                "project_path": str(selected),
                "error_code": "project_unavailable",
                "error": str(exc),
            },
            json_output,
        )
        raise typer.Exit(2) from exc


def _runtime(project: Path) -> Path:
    rt = project / ".sop-runtime"
    (rt / "logs").mkdir(parents=True, exist_ok=True)
    return rt


def _binary() -> str | None:
    """Prefer PATH, then the repository's platform-native executable."""
    executable = shutil.which("sop-agentd")
    if executable:
        return os.path.abspath(executable)
    name = "sop-agentd.exe" if sys.platform.startswith("win") else "sop-agentd"
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "apps" / "agent-runtime" / "bin" / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def _client(project: Path, json_output: bool):
    from sop_sdk import AgentdIpcClient

    try:
        return AgentdIpcClient(project_path=project)
    except (ValueError, OSError) as exc:
        _emit(
            {
                "ok": False,
                "project_path": str(project),
                "error_code": "ipc_configuration_error",
                "error": str(exc),
            },
            json_output,
        )
        raise typer.Exit(2) from exc


def _probe(project: Path, ipc) -> dict[str, Any]:
    diagnostic = ipc.diagnose()
    health = ipc.health()
    snapshot = {
        "ok": False,
        "project_path": str(project),
        "pid_file_pid": _read_pid(project / _PID_FILE),
        "transport": diagnostic.get("transport"),
        "endpoint": diagnostic.get("endpoint"),
        "available": bool(diagnostic.get("available")),
        "health": health,
    }
    if not isinstance(health, dict) or health.get("ok") is not True:
        snapshot.update(
            error_code=health.get("error_code", "health_failed")
            if isinstance(health, dict)
            else "invalid_health",
            error=health.get("error", "IPC health check failed")
            if isinstance(health, dict)
            else "IPC health was not an object",
        )
        return snapshot
    snapshot["available"] = True
    result = health.get("result")
    if (
        not isinstance(result, dict)
        or type(result.get("pid")) is not int
        or result["pid"] <= 0
        or not isinstance(result.get("instance_id"), str)
        or not result["instance_id"]
        or not isinstance(result.get("project_path"), str)
        or not result["project_path"]
    ):
        snapshot.update(
            error_code="invalid_health", error="Daemon health lacks a valid project, PID or instance identity"
        )
        return snapshot
    try:
        matches = os.path.samefile(project, result["project_path"])
    except OSError as exc:
        snapshot.update(
            error_code="project_unverified", error=f"Cannot verify daemon project directory: {exc}"
        )
        return snapshot
    if not matches:
        snapshot.update(error_code="project_mismatch", error="The IPC endpoint belongs to another project")
        return snapshot
    snapshot["ok"] = True
    return snapshot


def _emit(snapshot: dict[str, Any], json_output: bool) -> None:
    if json_output:
        typer.echo(json.dumps(snapshot, ensure_ascii=False, indent=2))
        return
    if snapshot["ok"]:
        ok(snapshot.get("message") or "IPC 已确认当前项目守护进程")
    else:
        warn(snapshot.get("error") or "IPC 不可用")
    if "endpoint" in snapshot:
        kv("transport", snapshot["transport"])
        kv("endpoint", snapshot["endpoint"])
        kv("available", snapshot["available"])
        kv("health", snapshot["health"])


def _failed(snapshot, code: str, message: str, **fields):
    return {**snapshot, **fields, "ok": False, "error_code": code, "error": message}


def _cleanup_child(process) -> tuple[bool, str | None]:
    """The Popen object owns this child; never open or signal an arbitrary PID."""
    if process.poll() is not None:
        return True, None
    try:
        process.terminate()
        try:
            process.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=1.0)
        return True, None
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)


def _await_start(project: Path, ipc, process, before, timeout: float):
    deadline = time.monotonic() + timeout
    snapshot = before
    while time.monotonic() < deadline:
        code = process.poll()
        if code is not None:
            snapshot = _failed(
                snapshot, "process_exited", f"Daemon exited before readiness (exit={code})", started=False
            )
            break
        snapshot = _probe(project, ipc)
        if time.monotonic() >= deadline:
            snapshot = _failed(
                snapshot,
                "readiness_timeout",
                "The spawned daemon did not confirm readiness before the deadline",
                started=False,
            )
            break
        if snapshot["ok"]:
            if snapshot["health"]["result"]["pid"] == process.pid:
                return snapshot
            snapshot = _failed(
                snapshot,
                "instance_changed",
                "Another daemon responded; the spawned process is not confirmed",
                started=False,
            )
            break
        if snapshot["error_code"] not in {"unavailable", "transport_error", "timeout"}:
            break
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))
    else:
        snapshot = _failed(
            snapshot,
            "readiness_timeout",
            "The spawned daemon did not confirm readiness before the deadline",
            started=False,
        )
    return snapshot


@app.command()
def start(
    foreground: bool = typer.Option(False, "--foreground", "-f"),
    project: Annotated[Path | None, typer.Option("--project", "--project-path", "-p")] = None,
    json_output: bool = typer.Option(False, "--json", help="输出实际 IPC 状态"),
    timeout: float = typer.Option(5.0, "--timeout", min=0.1, max=60.0, help="等待健康回执的最长秒数"),
) -> None:
    """Start in the selected project and confirm the newly spawned instance."""
    selected = _project(project, json_output)
    ipc = _client(selected, json_output)
    before = _probe(selected, ipc)
    if before["ok"]:
        _emit({**before, "started": False, "message": "当前项目守护进程已可用"}, json_output)
        return
    if before["error_code"] != "unavailable" or before["available"]:
        _emit({**before, "started": False}, json_output)
        raise typer.Exit(1)
    binary = _binary()
    if not binary:
        _emit(
            _failed(before, "binary_not_found", "未找到 sop-agentd，请先构建当前平台二进制", started=False),
            json_output,
        )
        raise typer.Exit(2)
    env = {**os.environ, "PROJECT_PATH": str(selected)}
    if foreground:
        if json_output:
            _emit(
                _failed(
                    before,
                    "foreground_json_unavailable",
                    "前台进程直接输出日志，请去掉 --json",
                    started=False,
                ),
                True,
            )
            raise typer.Exit(2)
        try:
            completed = subprocess.run([binary], cwd=str(selected), env=env, check=False)  # noqa: S603 - resolved local daemon executable, no shell
        except OSError as exc:
            err(str(exc))
            raise typer.Exit(1) from exc
        raise typer.Exit(completed.returncode)
    options = {"cwd": str(selected), "env": env, "stderr": subprocess.STDOUT}
    if sys.platform.startswith("win"):
        options["creationflags"] = subprocess.CREATE_NO_WINDOW
    else:
        options["start_new_session"] = True
    try:
        runtime = _runtime(selected)
        with (runtime / "logs" / "agentd.log").open("a", encoding="utf-8") as output:
            process = subprocess.Popen([binary], stdout=output, **options)
    except OSError as exc:
        _emit(_failed(before, "spawn_failed", str(exc), started=False), json_output)
        raise typer.Exit(1) from exc
    snapshot = _await_start(selected, ipc, process, before, timeout)
    if snapshot["ok"]:
        _emit({**snapshot, "started": True}, json_output)
        return
    cleaned, cleanup_error = _cleanup_child(process)
    _emit(
        {
            **snapshot,
            "started": False,
            "spawned_pid": process.pid,
            "spawned_process_stopped": cleaned,
            "cleanup_error": cleanup_error,
        },
        json_output,
    )
    raise typer.Exit(1)


@app.command()
def stop(
    project: Annotated[Path | None, typer.Option("--project", "--project-path", "-p")] = None,
    json_output: bool = typer.Option(False, "--json", help="输出实际 IPC 状态"),
    timeout: float = typer.Option(5.0, "--timeout", min=0.1, max=60.0, help="等待原实例离开的最长秒数"),
) -> None:
    """Stop only the instance that identifies the selected project through IPC."""
    selected = _project(project, json_output)
    ipc = _client(selected, json_output)
    snapshot = _probe(selected, ipc)
    if not snapshot["ok"]:
        _emit({**snapshot, "stopped": False, "stop_accepted": False}, json_output)
        raise typer.Exit(1)
    original = snapshot["health"]["result"]
    reply = ipc.send(
        "daemon.stop", data={"instance_id": original["instance_id"], "project_path": original["project_path"]}
    )
    if not isinstance(reply, dict) or reply.get("ok") is not True:
        _emit(
            _failed(
                snapshot,
                "stop_rejected",
                str(reply.get("error", "Stop request rejected"))
                if isinstance(reply, dict)
                else "Invalid stop response",
                stopped=False,
                stop_accepted=False,
            ),
            json_output,
        )
        raise typer.Exit(1)
    deadline = time.monotonic() + timeout
    current = snapshot
    while time.monotonic() < deadline:
        current = _probe(selected, ipc)
        if time.monotonic() >= deadline:
            break
        health = current["health"]
        result = health.get("result") if isinstance(health, dict) else None
        replacement = (
            isinstance(health, dict)
            and health.get("ok") is True
            and isinstance(result, dict)
            and bool(result.get("instance_id"))
            and (current["ok"] or current.get("error_code") in {"project_mismatch", "project_unverified"})
            and result["instance_id"] != original["instance_id"]
        )
        absent = (
            isinstance(health, dict)
            and health.get("ok") is False
            and health.get("error_code") == "unavailable"
            and not current["available"]
        )
        if replacement or absent:
            current.pop("error_code", None)
            current.pop("error", None)
            _emit(
                {
                    **current,
                    "ok": True,
                    "stopped": True,
                    "stop_accepted": True,
                    "stopped_instance_id": original["instance_id"],
                    "replacement_present": replacement,
                    "message": "原守护实例已离开",
                },
                json_output,
            )
            return
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))
    _emit(
        _failed(
            current,
            "stop_timeout",
            "The original daemon instance has not confirmed departure",
            stopped=False,
            stop_accepted=True,
        ),
        json_output,
    )
    raise typer.Exit(1)


@app.command()
def status(
    project: Annotated[Path | None, typer.Option("--project", "--project-path", "-p")] = None,
    json_output: bool = typer.Option(False, "--json", help="输出实际 IPC 状态"),
) -> None:
    """Report actual transport and same-project health, independent of PID files."""
    selected = _project(project, json_output)
    snapshot = _probe(selected, _client(selected, json_output))
    _emit(snapshot, json_output)
    if not snapshot["ok"]:
        raise typer.Exit(1)


@app.command()
def logs(
    tail: int = typer.Option(80, "-n", min=1),
    project: Annotated[Path | None, typer.Option("--project", "--project-path", "-p")] = None,
) -> None:
    """Read the selected project's daemon log."""
    log = _project(project, False) / _LOG_FILE
    if not log.is_file():
        warn(f"日志不存在：{log}")
        raise typer.Exit(1)
    try:
        subprocess.call(["tail", "-n", str(tail), str(log)])
    except FileNotFoundError:  # pragma: no cover
        console.print(log.read_text(encoding="utf-8")[-(tail * 200) :])

@app.command()
def install() -> None:
    """安装 launchd（macOS）/ systemd（Linux）user unit。"""
    project = Path.cwd().resolve()
    bin_path = _binary() or "/usr/local/bin/sop-agentd"
    if sys.platform == "darwin":
        plist_path = Path.home() / "Library" / "LaunchAgents" / "dev.sop.agentd.plist"
        plist_path.parent.mkdir(parents=True, exist_ok=True)
        plist_path.write_text(textwrap.dedent(f"""\
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0"><dict>
              <key>Label</key><string>dev.sop.agentd</string>
              <key>ProgramArguments</key><array><string>{bin_path}</string></array>
              <key>WorkingDirectory</key><string>{project}</string>
              <key>RunAtLoad</key><true/>
              <key>KeepAlive</key><true/>
              <key>StandardOutPath</key><string>{project}/.sop-runtime/logs/agentd.log</string>
              <key>StandardErrorPath</key><string>{project}/.sop-runtime/logs/agentd.err</string>
            </dict></plist>
        """))
        subprocess.call(["launchctl", "load", str(plist_path)])
        ok(f"launchd 已安装：{plist_path}")
    elif sys.platform.startswith("linux"):
        unit_dir = Path.home() / ".config" / "systemd" / "user"
        unit_dir.mkdir(parents=True, exist_ok=True)
        unit = unit_dir / "sop-agentd.service"
        unit.write_text(textwrap.dedent(f"""\
            [Unit]
            Description=sop agentd
            After=network-online.target

            [Service]
            ExecStart={bin_path}
            WorkingDirectory={project}
            Restart=on-failure
            RestartSec=5

            [Install]
            WantedBy=default.target
        """))
        subprocess.call(["systemctl", "--user", "daemon-reload"])
        subprocess.call(["systemctl", "--user", "enable", "--now", "sop-agentd.service"])
        ok(f"systemd user unit 已安装：{unit}")
    else:
        warn(f"暂不支持自动安装：{sys.platform}（请使用 `sop agentd start` 前台运行）")
