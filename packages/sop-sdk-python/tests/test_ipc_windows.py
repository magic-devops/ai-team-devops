"""Windows endpoint parity vectors are shared with the real Go daemon tests."""

import json
import os
from pathlib import Path

import pytest
from sop_sdk.ipc import AgentdIpcClient

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows native named-pipe contract")


def test_windows_native_pipe_matches_shared_go_vectors(monkeypatch):
    monkeypatch.delenv("SOP_AGENTD_SOCK", raising=False)
    monkeypatch.delenv("SOP_AGENTD_PIPE", raising=False)
    vectors = json.loads((Path(__file__).parent / "fixtures/native_ipc_vectors.json").read_text(encoding="utf-8"))[
        "vectors"
    ]
    for row in vectors:
        client = AgentdIpcClient(row["socket_path"])
        assert str(client.socket_path) == row["canonical"]
        assert client.transport.name == "named_pipe"
        assert client.transport.endpoint == row["pipe"], row["name"]


def test_explicit_local_pipe_override_has_priority_over_socket_locator(monkeypatch, tmp_path):
    monkeypatch.setenv("SOP_AGENTD_PIPE", r"\\.\pipe\native-ipc-test-override")
    client = AgentdIpcClient("custom.sock", project_path=tmp_path)
    assert client.transport.endpoint == r"\\.\pipe\native-ipc-test-override"


@pytest.mark.parametrize(
    "value", ["\\\\remote\\pipe\\name", "\\\\.\\pipe\\", "\\\\.\\pipe\\bad\nname", "\\\\.\\pipe\\folder\\name"]
)
def test_invalid_remote_or_control_pipe_override_is_rejected_before_connect(monkeypatch, value):
    monkeypatch.setenv("SOP_AGENTD_PIPE", value)
    with pytest.raises(ValueError, match="local.*pipe|pipe.*local"):
        AgentdIpcClient()


class NativePipeServer:
    """A real, short-lived byte-mode pipe, with cancellation owned by this fixture."""

    def __init__(self, mode="stall"):
        import _winapi
        import threading
        import uuid

        self.api = _winapi
        self.mode = mode
        self.name = "\\\\.\\pipe\\sop-sdk-test-" + uuid.uuid4().hex
        self.stop = threading.Event()
        self.connected = threading.Event()
        self.error = None
        self.handle = _winapi.CreateNamedPipe(self.name, 3 | _winapi.FILE_FLAG_OVERLAPPED, 0x8, 1, 1024, 1024, 0, 0)
        self.thread = threading.Thread(target=self.run, daemon=True)

    def wait(self, operation):
        try:
            while not self.stop.is_set():
                if self.api.WaitForSingleObject(operation.event, 20) == self.api.WAIT_OBJECT_0:
                    size, error = operation.GetOverlappedResult(True)
                    if error:
                        raise OSError(error, "fixture pipe operation")
                    return size
            raise InterruptedError("fixture stopped")
        finally:
            operation.cancel()
            operation.GetOverlappedResult(True)

    def run(self):
        try:
            self.wait(self.api.ConnectNamedPipe(self.handle, overlapped=True))
            self.connected.set()
            if self.mode == "stall":
                self.stop.wait(4)
            else:
                operation, _ = self.api.ReadFile(self.handle, 4096, overlapped=True)
                self.wait(operation)
                assert operation.getbuffer().endswith(b"\n")
                for chunk in [b'{"ok":', b" true}", b"\n"]:
                    operation, _ = self.api.WriteFile(self.handle, chunk, overlapped=True)
                    self.wait(operation)
        except BaseException as exc:
            if not self.stop.is_set():
                self.error = exc
        finally:
            self.api.CloseHandle(self.handle)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(2)
        assert not self.thread.is_alive(), "Native fixture leaked an active server thread"
        if self.error:
            raise self.error


@pytest.mark.parametrize("mode", ["read", "write", "health"])
def test_real_pipe_stall_obeys_the_request_deadline_instead_of_hanging(mode):
    import queue
    import subprocess
    import sys
    import threading

    script = r"""import json, sys, time
startup_started = time.monotonic()
from sop_sdk.ipc import AgentdIpcClient, WindowsNamedPipeTransport
from sop_sdk import _ipc_windows
transport = WindowsNamedPipeTransport(sys.argv[1])
client = AgentdIpcClient(transport=transport, timeout=.12)
frame = b'x' * 65536 if sys.argv[2] == 'write' else b'{"v":1,"op":"health"}\n'
print(json.dumps({'phase': 'ready', 'startup_seconds': time.monotonic()-startup_started}), flush=True)
if sys.stdin.readline() != 'request\n':
    raise SystemExit('Parent did not release the request phase')
started = time.monotonic()
if sys.argv[2] == 'health':
    result = client.health()
    print(json.dumps({'timeout': result.get('error_code') == 'timeout', 'seconds': time.monotonic()-started}), flush=True)
    raise SystemExit(0)
try:
    transport.request(frame, .12, 65536)
except TimeoutError:
    print(json.dumps({'timeout': True, 'seconds': time.monotonic()-started}), flush=True)
else:
    raise SystemExit('Native pipe request did not time out')
"""
    with NativePipeServer() as server:
        child = subprocess.Popen(  # noqa: S603 - Only this test executable, code and generated pipe name are used.
            [sys.executable, "-c", script, server.name, mode],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        ready_lines = queue.Queue()
        ready_reader = threading.Thread(target=lambda: ready_lines.put(child.stdout.readline()))
        ready_reader.start()
        try:
            try:
                ready_line = ready_lines.get(timeout=10)
            except queue.Empty:
                pytest.fail("Native pipe test child startup/import did not become ready within 10 seconds")
            ready_reader.join(2)
            assert not ready_reader.is_alive(), "Readiness reader did not finish after receiving the ready line"
            assert ready_line, "Native pipe test child exited during startup/import before readiness"
            assert json.loads(ready_line)["phase"] == "ready"
            try:
                output, error = child.communicate(input="request\n", timeout=2)
            except subprocess.TimeoutExpired:
                pytest.fail("Real native pipe request exceeded its 2 second watchdog after readiness")
            assert child.returncode == 0, error or output
            result = json.loads(output)
            assert result["timeout"] and 0.08 <= result["seconds"] < 1
        finally:
            if child.poll() is None:
                child.kill()
            ready_reader.join(2)
            assert not ready_reader.is_alive(), "Native fixture leaked its child readiness reader"
            child.communicate(timeout=2)


def test_available_does_not_consume_a_real_server_connection():
    from sop_sdk.ipc import WindowsNamedPipeTransport

    with NativePipeServer() as server:
        transport = WindowsNamedPipeTransport(server.name)
        assert transport.available()
        assert not server.connected.wait(0.05), "Availability probe consumed the server connection"


def test_real_fragmented_ndjson_response_preserves_the_protocol(monkeypatch, tmp_path):
    with NativePipeServer(mode="respond") as server:
        monkeypatch.setenv("SOP_AGENTD_PIPE", server.name)
        client = AgentdIpcClient(project_path=tmp_path, timeout=0.5)
        assert client.health() == {"ok": True}


def test_busy_real_pipe_remains_available_and_health_reports_timeout_not_absence():
    import _winapi

    with NativePipeServer() as server:
        held = _winapi.CreateFile(
            server.name,
            _winapi.GENERIC_READ | _winapi.GENERIC_WRITE,
            0,
            0,
            _winapi.OPEN_EXISTING,
            _winapi.FILE_FLAG_OVERLAPPED,
            0,
        )
        try:
            assert server.connected.wait(1)
            from sop_sdk.ipc import WindowsNamedPipeTransport

            transport = WindowsNamedPipeTransport(server.name)
            assert transport.available()
            result = AgentdIpcClient(transport=transport, timeout=0.12).health()
            assert result["ok"] is False and result["error_code"] == "timeout"
            assert result["transport"] == "named_pipe" and result["endpoint"] == server.name
        finally:
            _winapi.CloseHandle(held)


def test_nonexistent_real_pipe_is_distinct_from_busy_and_timeout():
    import uuid

    from sop_sdk.ipc import WindowsNamedPipeTransport

    name = "\\\\.\\pipe\\sop-sdk-missing-" + uuid.uuid4().hex
    result = AgentdIpcClient(transport=WindowsNamedPipeTransport(name), timeout=0.12).health()
    assert result["ok"] is False and result["error_code"] == "unavailable"
