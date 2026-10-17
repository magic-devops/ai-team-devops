from __future__ import annotations

import json
import os
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import StringIO
from pathlib import Path
from typing import Any

import pytest
from hermes_core.models import CoreError
from hermes_core.remote_outbox import RECORD_LIMIT_BYTES, OutboxError, OutboxLock, OutboxLocked, RemoteOutbox
from hermes_core.remote_worker import LOG_LIMIT_BYTES, WorkerError, _load_credential, _run_agentd
from hermes_core.remote_worker import main as worker_main
from process_fixtures import install_python_script_launcher


@pytest.fixture(autouse=True)
def python_protocol_fixture_launcher(monkeypatch):
    install_python_script_launcher(monkeypatch)


def _serve(state: dict[str, Any]):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            if self.path == "/api/hermes/v1/remote/presence":
                state.setdefault("presence_requests", []).append(body)
                self._send(200, {"ok": True, "items": [{"worker_id": body["worker_id"]}]})
                return
            if self.path == "/api/hermes/v1/remote/claim":
                state.setdefault("claim_requests", []).append(body)
                items = state.setdefault("claims", [])
                self._send(200, {"items": items[:1], "summary": {"claimed": bool(items)}})
                if items:
                    del items[0]
                return
            if self.path == "/api/hermes/v1/remote/result":
                state.setdefault("result_requests", []).append(body)
                if state.pop("drop_next_result_response", False):
                    self.close_connection = True
                    try:
                        self.connection.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    self.connection.close()
                    return
                status = state.setdefault("result_statuses", [200]).pop(0)
                if status == 200:
                    self._send(200, state.get("result_body", {
                        "ok": True,
                        "items": [{"id": body["run_id"], "status": "completed"}],
                        "summary": {"result_recorded": True},
                    }))
                else:
                    self._send(status, {"error": {"code": state.get("error_code", "remote_error")}})
                return
            self._send(404, {"error": {"code": "not_found"}})

        def log_message(self, *_args):
            return

        def _send(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_port}"


def _credential(server: str, secret: str = "credential-secret") -> dict[str, str]:  # noqa: S107
    return {"server": server, "device_id": "device-1", "workspace_id": "workspace-1", "credential": secret}


def _write_credential(path: Path, credential: dict[str, str]) -> None:
    path.write_text(json.dumps(credential), encoding="utf-8")
    if os.name != "nt":
        path.chmod(0o600)


def _task() -> dict[str, Any]:
    return {
        "run_id": "run-1",
        "run_version": 1,
        "owner": "remote:owner-1234567890",
        "workspace_id": "workspace-1",
        "device_id": "device-1",
        "lease_seconds": 120,
        "node": {"id": "node-1", "kind": "command", "argv": [sys.executable, "-c", "print('ok')"],
                 "timeout_seconds": 60, "expected_exit_code": 0},
        "boundary": {"supports": ["command"]},
    }


def _agent_task() -> dict[str, Any]:
    return {
        **_task(),
        "node": {"id": "agent-1", "kind": "agent", "agent_id": "agent-1", "prompt": "write proof",
                 "timeout_seconds": 60, "expected_exit_code": 0},
        "agent_binding": {
            "agent_id": "agent-1",
            "version": 3,
            "profile": {"title": "Outbox Codex", "provider": "codex", "model": "gpt-5.5",
                        "instructions": "", "timeout_seconds": 60, "status": "active"},
            "sha256": "profile-sha",
        },
        "agent_source": {"resource": "agents", "id": "agent-1", "version": 3},
        "previous_agent_context": [],
        "boundary": {"supports": ["agent"]},
    }


def _agentd(tmp_path: Path) -> Path:
    script = tmp_path / "fake-sop-agentd"
    script.write_text(
        "#!" + sys.executable + "\n"
        "from pathlib import Path\n"
        "import json, sys\n"
        "root = Path(sys.argv[sys.argv.index('--root') + 1])\n"
        "count = root / 'executions.txt'\n"
        "count.write_text(str(int(count.read_text() or '0') + 1) if count.exists() else '1')\n"
        "json.loads(sys.stdin.readline())\n"
        "print(json.dumps({'event':'tool.completed','result':{'exit_code': 0, 'stdout': 'agentd-ok', 'stderr': '', 'duration_ms': 7}}))\n",
        encoding="utf-8",
    )
    script.chmod(0o700)
    return script


def _agentd_executes_argv(tmp_path: Path) -> Path:
    script = tmp_path / "fake-agentd-exec"
    script.write_text(
        "#!" + sys.executable + "\n"
        "from pathlib import Path\n"
        "import json, subprocess, sys\n"
        "root = Path(sys.argv[sys.argv.index('--root') + 1])\n"
        "count = root / 'agent-executions.txt'\n"
        "count.write_text(str(int(count.read_text() or '0') + 1) if count.exists() else '1')\n"
        "payload = json.loads(sys.stdin.readline())\n"
        "proc = subprocess.run(payload['argv'], cwd=root, text=True, capture_output=True, timeout=payload['timeout_seconds'])\n"
        "print(json.dumps({'event':'tool.completed','result':{'ok': proc.returncode == 0, 'exit_code': proc.returncode, 'stdout': proc.stdout, "
        "'stderr': proc.stderr, 'duration_ms': 9}}))\n",
        encoding="utf-8",
    )
    script.chmod(0o700)
    return script


def _codex_provider(tmp_path: Path) -> Path:
    script = tmp_path / "codex"
    script.write_text(
        "#!" + sys.executable + "\n"
        "import json\n"
        "print(json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'agent outbox ok'}}))\n"
        "print(json.dumps({'type': 'turn.completed', 'usage': {'total_tokens': 5}}))\n",
        encoding="utf-8",
    )
    script.chmod(0o700)
    return script


def _argv(server: str, credential_file: Path, outbox_dir: Path, workspace_root: Path,
          agentd: Path | None = None, *extra: str) -> list[str]:
    argv = [
        "--server", server,
        "--credential-file", str(credential_file),
        "--outbox-dir", str(outbox_dir),
        "--workspace-map", f"workspace-1={workspace_root}",
        "--poll-interval", "0.01",
    ]
    if agentd is not None:
        argv.extend(["--agentd", str(agentd)])
    argv.extend(extra)
    return argv


def test_net_failure_then_restart_retries_without_reexecution(tmp_path: Path) -> None:
    state = {"claims": [_task()], "result_statuses": [503, 200]}
    server, server_url = _serve(state)
    try:
        credential_file = tmp_path / "credential.json"
        outbox_dir = tmp_path / "credential.json.outbox"
        _write_credential(credential_file, _credential(server_url))
        agentd = _agentd(tmp_path)

        first = worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, agentd, "--once"))
        assert first == 1
        assert (tmp_path / "executions.txt").read_text(encoding="utf-8") == "1"
        assert RemoteOutbox(outbox_dir, _credential(server_url)).status()["counts"] == {"pending": 1}

        second = worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, agentd, "--once"))
        assert second == 0
        assert (tmp_path / "executions.txt").read_text(encoding="utf-8") == "1"
        assert len(state["result_requests"]) == 2
        assert state["result_requests"][0]["idempotency_key"] == state["result_requests"][1]["idempotency_key"]
        assert RemoteOutbox(outbox_dir, _credential(server_url)).status()["counts"] == {"acknowledged": 1}
    finally:
        server.shutdown()


def test_lost_success_response_retries_same_result_until_ack(tmp_path: Path) -> None:
    state = {"claims": [_task()], "drop_next_result_response": True, "result_statuses": [200]}
    server, server_url = _serve(state)
    try:
        credential_file = tmp_path / "credential.json"
        outbox_dir = tmp_path / "outbox"
        _write_credential(credential_file, _credential(server_url))
        agentd = _agentd(tmp_path)

        assert worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, agentd, "--once")) == 1
        assert worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, agentd, "--once")) == 0
        assert len(state["result_requests"]) == 2
        first, second = state["result_requests"]
        assert first["run_id"] == second["run_id"]
        assert first["owner"] == second["owner"]
        assert first["node_id"] == second["node_id"]
        assert first["idempotency_key"] == second["idempotency_key"]
        assert first["result"] == second["result"]
    finally:
        server.shutdown()


def test_lost_success_response_preserves_remote_agent_result_until_ack(tmp_path: Path,
                                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    state = {"claims": [_agent_task()], "drop_next_result_response": True, "result_statuses": [200]}
    server, server_url = _serve(state)
    try:
        credential_file = tmp_path / "credential.json"
        outbox_dir = tmp_path / "outbox"
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        credential = _credential(server_url)
        _write_credential(credential_file, credential)
        agentd = _agentd_executes_argv(tmp_path)
        provider = _codex_provider(bin_dir)
        monkeypatch.setattr("hermes_core.remote_worker.provider_command", lambda profile, prompt: [sys.executable, str(provider), prompt])
        monkeypatch.setenv("PATH", str(bin_dir) + os.pathsep + os.environ.get("PATH", ""))

        assert worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, agentd,
                                 "--once", "--runtime-capability", "agent")) == 1
        assert (tmp_path / "agent-executions.txt").read_text(encoding="utf-8") == "1"
        assert worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, agentd,
                                 "--once", "--runtime-capability", "agent")) == 0
        assert (tmp_path / "agent-executions.txt").read_text(encoding="utf-8") == "1"
        first, second = state["result_requests"]
        assert first["idempotency_key"] == second["idempotency_key"]
        assert first["result"] == second["result"]
        assert second["result"]["agent"]["completed"] is True
        assert second["result"]["agent"]["message"] == "agent outbox ok"
        assert second["result"]["agent"]["profile_version"] == 3
        assert RemoteOutbox(outbox_dir, credential).status()["counts"] == {"acknowledged": 1}
    finally:
        server.shutdown()


def test_expired_lease_result_is_quarantined_and_stops_claims(tmp_path: Path) -> None:
    state = {"claims": [_task()], "result_statuses": [409], "error_code": "lease_expired"}
    server, server_url = _serve(state)
    try:
        credential_file = tmp_path / "credential.json"
        outbox_dir = tmp_path / "outbox"
        credential = _credential(server_url)
        _write_credential(credential_file, credential)
        outbox = RemoteOutbox(outbox_dir, credential)
        record = outbox.journal_claim(_task(), claim_idempotency_key="claim-1")
        outbox.save_result(record, {"exit_code": 0, "stdout": "late", "stderr": "", "duration_ms": 1})

        assert worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, None, "--flush-only")) == 1
        status = RemoteOutbox(outbox_dir, credential).status()
        assert status["counts"] == {"quarantined": 1}
        assert status["records"][0]["last_status"] == 409
        assert state.get("claim_requests", []) == []
    finally:
        server.shutdown()


def test_malformed_success_ack_keeps_pending_for_retry(tmp_path: Path) -> None:
    state = {"claims": [_task()], "result_statuses": [200], "result_body": {"items": []}}
    server, server_url = _serve(state)
    try:
        credential_file = tmp_path / "credential.json"
        outbox_dir = tmp_path / "outbox"
        credential = _credential(server_url)
        _write_credential(credential_file, credential)
        outbox = RemoteOutbox(outbox_dir, credential)
        record = outbox.journal_claim(_task(), claim_idempotency_key="claim-bad-ack")
        outbox.save_result(record, {"exit_code": 0, "stdout": "done", "stderr": "", "duration_ms": 1})

        assert worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, None, "--flush-only")) == 1
        status = RemoteOutbox(outbox_dir, credential).status()
        assert status["counts"] == {"pending": 1}
        assert status["records"][0]["last_status"] == 200
        assert "Malformed remote result acknowledgement" in status["records"][0]["last_error"]
    finally:
        server.shutdown()


def test_new_credential_rejects_old_pending_without_upload(tmp_path: Path) -> None:
    state = {"claims": [], "result_statuses": [200]}
    server, server_url = _serve(state)
    try:
        old_credential = _credential(server_url, "old-secret")
        new_credential = _credential(server_url, "new-secret")
        credential_file = tmp_path / "credential.json"
        outbox_dir = tmp_path / "outbox"
        outbox = RemoteOutbox(outbox_dir, old_credential)
        record = outbox.journal_claim(_task(), claim_idempotency_key="claim-old")
        outbox.save_result(record, {"exit_code": 0, "stdout": "old", "stderr": "", "duration_ms": 1})
        _write_credential(credential_file, new_credential)

        assert worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, None, "--flush-only")) == 1
        assert state.get("result_requests", []) == []
        assert RemoteOutbox(outbox_dir, new_credential).status()["counts"] == {"quarantined": 1}
    finally:
        server.shutdown()


def test_outbox_status_hides_logs_and_credentials(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    server_url = "http://127.0.0.1:1"
    credential = _credential(server_url, "very-secret-credential")
    credential_file = tmp_path / "credential.json"
    outbox_dir = tmp_path / "outbox"
    _write_credential(credential_file, credential)
    outbox = RemoteOutbox(outbox_dir, credential)
    record = outbox.journal_claim(_task(), claim_idempotency_key="claim-status")
    outbox.save_result(record, {"exit_code": 0, "stdout": "secret-log", "stderr": "", "duration_ms": 1})

    assert worker_main(_argv(server_url, credential_file, outbox_dir, tmp_path, None, "--outbox-status")) == 0
    output = capsys.readouterr().out
    assert "very-secret-credential" not in output
    assert "secret-log" not in output
    parsed = json.loads(output)
    assert parsed["counts"] == {"pending": 1}
    assert parsed["records"][0]["run_id"] == "run-1"
    assert "owner" not in parsed["records"][0]


def test_outbox_rejects_corrupt_oversized_and_symlink_records(tmp_path: Path) -> None:
    credential = _credential("http://127.0.0.1:1")
    outbox = RemoteOutbox(tmp_path / "outbox", credential)

    corrupt = outbox.path / "corrupt.json"
    corrupt.write_text("{", encoding="utf-8")
    corrupt.chmod(0o600)
    with pytest.raises(OutboxError, match="valid JSON"):
        outbox.load_records()
    corrupt.unlink()

    oversized = outbox.path / "oversized.json"
    oversized.write_text("x" * (RECORD_LIMIT_BYTES + 1), encoding="utf-8")
    oversized.chmod(0o600)
    with pytest.raises(OutboxError, match="exceeds"):
        outbox.load_records()
    oversized.unlink()

    invalid = outbox.journal_claim(_task(), claim_idempotency_key="claim-invalid")
    outbox.save({**invalid, "state": "mystery"})
    with pytest.raises(OutboxError, match="state is unsupported"):
        outbox.load_records()
    (outbox.path / invalid["record_id"]).unlink()

    invalid = outbox.journal_claim(_task(), claim_idempotency_key="claim-result-type")
    outbox.save({**invalid, "state": "pending", "result": "not-a-dict"})
    with pytest.raises(OutboxError, match="missing result body"):
        outbox.load_records()
    (outbox.path / invalid["record_id"]).unlink()

    if os.name == "nt" or not hasattr(os, "symlink"):
        return
    fifo = outbox.path / "fifo.json"
    if hasattr(os, "mkfifo"):
        os.mkfifo(fifo, 0o600)
        with pytest.raises(OutboxError, match="regular file"):
            outbox.load_records()
        fifo.unlink()

    target = outbox.path / "target.json"
    target.write_text("{}", encoding="utf-8")
    target.chmod(0o600)
    link = outbox.path / "link.json"
    os.symlink(target, link)
    with pytest.raises(OutboxError, match="Unexpected outbox entry"):
        outbox.load_records()


def test_outbox_preserves_max_unicode_and_control_logs_with_compact_utf8(tmp_path: Path) -> None:
    credential = _credential("http://127.0.0.1:1")
    outbox = RemoteOutbox(tmp_path / "outbox", credential)
    record = outbox.journal_claim(_task(), claim_idempotency_key="claim-unicode")
    stdout = "汉" * LOG_LIMIT_BYTES
    stderr = "\x01" * LOG_LIMIT_BYTES
    saved = outbox.save_result(record, {"exit_code": 0, "stdout": stdout, "stderr": stderr, "duration_ms": 1})

    path = outbox.path / saved["record_id"]
    assert path.stat().st_size < RECORD_LIMIT_BYTES
    loaded = outbox.pending_records()[0]
    assert loaded["result"]["stdout"] == stdout
    assert loaded["result"]["stderr"] == stderr


def test_agentd_overlong_raw_data_is_bounded_before_outbox_or_http(tmp_path: Path) -> None:
    agentd = tmp_path / "agentd-overlong"
    agentd.write_text(
        "#!" + sys.executable + "\n"
        "import json, sys\n"
        "json.loads(sys.stdin.readline())\n"
        "print(json.dumps({'exit_code': 0, 'stdout': '汉' * 300000, 'stderr': 'e' * 300000, "
        "'duration_ms': 1, 'raw': 'x' * 9000000}))\n",
        encoding="utf-8",
    )
    agentd.chmod(0o700)
    with pytest.raises(CoreError, match="protocol limit"):
        _run_agentd(str(agentd), tmp_path, _task(), "http://127.0.0.1:1", _credential("http://127.0.0.1:1"))


def test_credential_loader_rejects_fifo_before_read(tmp_path: Path) -> None:
    if os.name == "nt" or not hasattr(os, "mkfifo"):
        pytest.skip("FIFO credential checks are POSIX-only")
    fifo = tmp_path / "credential.json"
    os.mkfifo(fifo, 0o600)
    with pytest.raises(WorkerError, match="regular file"):
        _load_credential(fifo)


def test_credential_loader_rejects_non_string_identity(tmp_path: Path) -> None:
    path = tmp_path / "credential.json"
    for key in ("device_id", "credential", "workspace_id", "server"):
        credential = {**_credential("http://127.0.0.1:1"), key: 42}
        path.write_text(json.dumps(credential), encoding="utf-8")
        path.chmod(0o600)
        with pytest.raises(WorkerError, match=f"non-empty string for {key}"):
            _load_credential(path)


def test_outbox_single_worker_lock(tmp_path: Path) -> None:
    outbox_dir = tmp_path / "outbox"
    outbox_dir.mkdir()
    with OutboxLock(outbox_dir):
        lock = OutboxLock(outbox_dir)
        with pytest.raises(OutboxLocked):
            lock.__enter__()


def test_cli_mode_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    assert worker_main(["--server", "http://127.0.0.1:1", "--credential-file", "unused",
                        "--pair-secret", "secret", "--device-id", "device", "--once"]) == 1
    assert worker_main(["--server", "http://127.0.0.1:1", "--credential-file", "unused",
                        "--flush-only", "--once"]) == 1
    assert worker_main(["--server", "http://127.0.0.1:1", "--credential-file", "unused",
                        "--outbox-status", "--once"]) == 1
    monkeypatch.setattr(sys, "stdin", StringIO(""))
    assert worker_main(["--server", "http://127.0.0.1:1", "--credential-file", "unused",
                        "--pair-secret-stdin"]) == 1
    assert worker_main(["--server", "http://127.0.0.1:1", "--credential-file", "unused",
                        "--poll-interval", "0"]) == 1


def test_main_reports_raw_outbox_oserror_without_traceback_or_io(tmp_path: Path,
                                                                 capsys: pytest.CaptureFixture[str]) -> None:
    server_url = "http://127.0.0.1:1"
    credential_file = tmp_path / "credential.json"
    blocked_parent = tmp_path / "not-a-dir"
    blocked_parent.write_text("file", encoding="utf-8")
    _write_credential(credential_file, _credential(server_url))

    result = worker_main([
        "--server", server_url,
        "--credential-file", str(credential_file),
        "--outbox-dir", str(blocked_parent / "outbox"),
        "--outbox-status",
    ])

    captured = capsys.readouterr()
    assert result == 1
    assert captured.out == ""
    assert captured.err.startswith("error: filesystem error:")
    assert "Traceback" not in captured.err
