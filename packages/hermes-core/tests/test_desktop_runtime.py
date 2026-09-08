import json
import os
import subprocess
import sys
import time
import urllib.request

import pytest
from fastapi.testclient import TestClient
from hermes_core.api import create_app
from hermes_core.models import Principal


@pytest.mark.parametrize(
    "script",
    [
        "import os; os.write(1, b'x' * 1000000)",
        "import time; time.sleep(20)",
        "import os, time; os.write(1, b'1.0.0'); time.sleep(20)",
    ],
)
def test_version_probe_bounds_output_and_terminates_children(script):
    from hermes_core.diagnostics import _version_matches

    started = time.monotonic()
    assert _version_matches([sys.executable, "-c", script], timeout=0.3) is False
    assert time.monotonic() - started < 3


def test_version_probe_requires_exact_version_and_success():
    from hermes_core.diagnostics import _version_matches

    assert _version_matches([sys.executable, "-c", "print('1.0.0')"])
    assert not _version_matches([sys.executable, "-c", "print('1.0.0'); raise SystemExit(1)"])
    assert not _version_matches([sys.executable, "-c", "print('wrong')"])


def test_data_directory_lock_excludes_other_processes_and_releases(tmp_path):
    from hermes_core.runtime import InstanceLock

    command = [
        sys.executable,
        "-c",
        "from pathlib import Path; from hermes_core.runtime import InstanceLock; "
        "lock = InstanceLock(Path(__import__('sys').argv[1])); lock.__enter__(); lock.__exit__(None, None, None)",
        str(tmp_path),
    ]
    with InstanceLock(tmp_path):
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)  # noqa: S603 - fixed test interpreter argv
        assert result.returncode != 0
        assert "already running" in result.stderr
    assert subprocess.run(command, capture_output=True, timeout=10).returncode == 0  # noqa: S603 - fixed test interpreter argv
    assert (tmp_path / "core.lock").is_file()


@pytest.mark.skipif(os.name == "nt", reason="POSIX file permissions and symlinks")
def test_lock_rejects_link_and_does_not_change_target(tmp_path):
    from hermes_core.runtime import InstanceLock

    target = tmp_path / "private"
    target.write_text("untouched")
    (tmp_path / "core.lock").symlink_to(target)
    with pytest.raises(OSError):
        with InstanceLock(tmp_path):
            pass
    assert target.read_text() == "untouched"


def test_diagnostics_requires_read_and_never_exposes_credentials_or_paths(tmp_path):
    app = create_app(
        tmp_path,
        "secret-token",
        principals={
            "reader": Principal("reader", tenant="one", permissions=frozenset({"read"})),
            "writer": Principal("writer", permissions=frozenset({"write"})),
        },
    )
    client = TestClient(app)
    route = "/api/hermes/v1/system/diagnostics"
    assert client.get(route).status_code == 401
    assert client.get(route, headers={"Authorization": "Bearer writer"}).status_code == 403
    response = client.get(route, headers={"Authorization": "Bearer reader"})
    assert response.status_code == 200
    data = response.json()
    assert data["summary"]["version"] == "1.0.0"
    assert data["scope"]["tenant_code"] == "one"
    assert data["cli"]["command"] == "sop hermes diagnostics --json"
    checks = {item["id"]: item for item in data["items"]}
    assert checks["store"]["status"] == "passed"
    assert checks["executor"]["status"] == "failed"
    assert data["ok"] is False
    assert str(tmp_path) not in json.dumps(data)
    assert "secret-token" not in json.dumps(data)


def test_diagnostics_detects_non_executable_agentd(tmp_path):
    binary = tmp_path / "agentd"
    binary.write_text("not a binary")
    app = create_app(tmp_path / "db", "token", agentd=str(binary))
    client = TestClient(app, headers={"Authorization": "Bearer token"})
    data = client.get("/api/hermes/v1/system/diagnostics").json()
    assert next(item for item in data["items"] if item["id"] == "executor")["status"] == "failed"
    assert app.state.hermes_execution.available() is (os.name == "nt")


def test_real_agentd_diagnostics(tmp_path):
    binary = os.environ.get("HERMES_TEST_AGENTD")
    if not binary:
        pytest.skip("HERMES_TEST_AGENTD not provided")
    client = TestClient(
        create_app(tmp_path, "token", agentd=binary), headers={"Authorization": "Bearer token"}
    )
    data = client.get("/api/hermes/v1/system/diagnostics").json()
    assert data["ok"] is True
    assert data["summary"]["failed"] == 0
    assert next(item for item in data["items"] if item["id"] == "executor")["detail"] == "agentd 1.0.0"


def test_real_core_duplicate_start_and_crash_recovery(tmp_path):
    command = [
        sys.executable,
        "-m",
        "hermes_core",
        "--data-dir",
        str(tmp_path / "data"),
        "--token-file",
        str(tmp_path / "access-token"),
        "--port",
        "0",
    ]
    saved_token = None
    for attempt in range(2):
        startup = tmp_path / f"startup-{attempt}.json"
        errors = tmp_path / f"stderr-{attempt}.log"
        with startup.open("w") as stdout, errors.open("w") as stderr:
            process = subprocess.Popen(command, stdout=stdout, stderr=stderr)  # noqa: S603 - isolated test Core argv
            try:
                deadline = time.monotonic() + 15
                ready = None
                while time.monotonic() < deadline:
                    if startup.stat().st_size:
                        ready = json.loads(startup.read_text())
                        try:
                            with urllib.request.urlopen(  # noqa: S310 - loopback URL from the owned test Core
                                ready["url"] + "/api/hermes/v1/health", timeout=1
                            ) as response:
                                assert json.load(response)["version"] == "1.0.0"
                            break
                        except OSError:
                            pass
                    if process.poll() is not None:
                        pytest.fail(errors.read_text())
                    time.sleep(0.05)
                else:
                    pytest.fail("Core did not become healthy")
                assert ready["pid"] == process.pid
                token = (tmp_path / "access-token").read_text()
                if saved_token is not None:
                    assert token == saved_token
                saved_token = token
                duplicate = subprocess.run(command, capture_output=True, text=True, timeout=15)  # noqa: S603 - isolated test Core argv
                assert duplicate.returncode == 2
                assert not duplicate.stdout
                assert json.loads(duplicate.stderr)["error"]["code"] == "core_already_running"
                assert process.poll() is None
            finally:
                process.kill()
                process.wait(timeout=10)
    assert (tmp_path / "data" / "workspace.sqlite").is_file()
