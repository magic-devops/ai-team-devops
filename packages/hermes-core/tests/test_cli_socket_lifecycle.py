from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

import pytest


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _core_env() -> dict[str, str]:
    env = os.environ.copy()
    package_root = str(Path(__file__).resolve().parents[1])
    env["PYTHONPATH"] = (
        package_root if not env.get("PYTHONPATH") else package_root + os.pathsep + env["PYTHONPATH"]
    )
    return env


def _core_command(tmp_path: Path, *, data_name: str, credential_filename: str, port: int) -> list[str]:
    return [
        sys.executable,
        "-m",
        "hermes_core",
        "--data-dir",
        str(tmp_path / data_name),
        "--token-file",
        str(tmp_path / credential_filename),
        "--port",
        str(port),
    ]


def _start_core(tmp_path: Path, command: list[str], name: str) -> tuple[subprocess.Popen[bytes], dict[str, Any]]:
    startup = tmp_path / f"{name}-stdout.json"
    errors = tmp_path / f"{name}-stderr.log"
    stdout = startup.open("wb")
    stderr = errors.open("wb")
    process = subprocess.Popen(  # noqa: S603 - fixed test Core argv
        command, stdout=stdout, stderr=stderr, env=_core_env()
    )
    stdout.close()
    stderr.close()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if startup.stat().st_size:
            return process, json.loads(startup.read_text())
        if process.poll() is not None:
            pytest.fail(errors.read_text())
        time.sleep(0.05)
    _stop_core(process)
    pytest.fail("Core did not print startup metadata")


def _stop_core(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def _assert_healthy(url: str) -> None:
    with urllib.request.urlopen(  # noqa: S310 - loopback URL from the owned test Core
        url + "/api/hermes/v1/health", timeout=5
    ) as response:
        assert json.load(response)["version"] == "1.0.0"


def test_core_restarts_same_port_after_http_connection_and_sigterm(tmp_path: Path) -> None:
    port = _free_port()
    command = _core_command(tmp_path, data_name="data", credential_filename="token", port=port)

    first, first_ready = _start_core(tmp_path, command, "first")
    try:
        assert first_ready["url"] == f"http://127.0.0.1:{port}"
        _assert_healthy(first_ready["url"])
    finally:
        _stop_core(first)

    second, second_ready = _start_core(tmp_path, command, "second")
    try:
        assert second_ready["url"] == first_ready["url"]
        _assert_healthy(second_ready["url"])
    finally:
        _stop_core(second)


def test_core_reuseaddr_keeps_live_port_collision_rejected(tmp_path: Path) -> None:
    port = _free_port()
    first_command = _core_command(tmp_path, data_name="data-a", credential_filename="token-a", port=port)
    second_command = _core_command(tmp_path, data_name="data-b", credential_filename="token-b", port=port)

    first, first_ready = _start_core(tmp_path, first_command, "first")
    try:
        _assert_healthy(first_ready["url"])
        duplicate = subprocess.run(  # noqa: S603 - fixed test Core argv
            second_command,
            capture_output=True,
            text=True,
            timeout=15,
            env=_core_env(),
            check=False,
        )
        assert duplicate.returncode == 2
        assert duplicate.stdout == ""
        error = json.loads(duplicate.stderr)
        assert error["error"]["code"] == "local_startup_failed"
        assert error["error"]["type"] == "OSError"
        assert first.poll() is None
    finally:
        _stop_core(first)
