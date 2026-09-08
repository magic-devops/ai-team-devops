import subprocess
import sys


def test_bundled_core_exposes_remote_worker_without_server_arguments():
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "hermes_core", "remote-worker", "--help"],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "--credential-file" in result.stdout
    assert "--workspace-map" in result.stdout
    assert "--agentd" in result.stdout
    assert "--data-dir" not in result.stdout
