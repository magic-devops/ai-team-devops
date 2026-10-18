from __future__ import annotations

import json
from pathlib import Path

from sop_sdk.ipc import AgentdIpcClient, UnixSocketTransport


class FakeTransport:
    name = "fake"
    endpoint = "memory://agentd"

    def __init__(self, response: bytes, available: bool = True) -> None:
        self.response = response
        self._available = available
        self.sent: bytes = b""

    def available(self) -> bool:
        return self._available

    def request(self, frame: bytes, timeout: float, max_bytes: int) -> bytes:
        self.sent = frame
        return self.response


def test_agentd_ipc_missing_socket_returns_structured_error(tmp_path: Path) -> None:
    client = AgentdIpcClient(
        tmp_path / "missing.sock", timeout=0.1, transport=UnixSocketTransport(tmp_path / "missing.sock")
    )

    result = client.health()

    assert result["ok"] is False
    assert result["transport"] == "unix"
    assert result["error_code"] == "unavailable"
    assert "missing.sock" in result["endpoint"]


def test_agentd_ipc_sends_ndjson_frame_and_reads_response(tmp_path: Path) -> None:
    transport = FakeTransport(b'')
    client = AgentdIpcClient(tmp_path / "agentd.sock", timeout=1, transport=transport)

    from sop_sdk.event_envelope import FrozenEvent
    event = FrozenEvent.create("tool.pre", {"tool": "Bash", "command": "git status"}, event_id="fixed", time="2026-10-18T00:00:00Z")
    expected = {"ok": True, "op": "event.enqueue", "id": event.id, "result": {"id": event.id, "digest": event.digest, "state": "pending", "revision": 1, "replayed": False}}
    transport.response = json.dumps(expected).encode() + b"\n"
    result = client.enqueue_event(event, intended_project_id="P")

    assert result == expected
    assert json.loads(transport.sent.decode("utf-8")) == {
        "v": 1,
        "op": "event.enqueue",
        "name": "",
        "data": {**event.item(), "intended_project_id": "P"},
    }


def test_agentd_ipc_invalid_json_response_is_diagnostic(tmp_path: Path) -> None:
    client = AgentdIpcClient(tmp_path / "agentd.sock", timeout=1, transport=FakeTransport(b"not-json\n"))

    result = client.health()

    assert result["ok"] is False
    assert result["error_code"] == "invalid_response"
    assert result["transport"] == "fake"


def test_agentd_ipc_diagnose_exposes_transport_state(tmp_path: Path) -> None:
    client = AgentdIpcClient(tmp_path / "agentd.sock", timeout=1.5, transport=FakeTransport(b"{}\n"))

    assert client.diagnose() == {
        "available": True,
        "transport": "fake",
        "endpoint": "memory://agentd",
        "timeout": 1.5,
        "max_response_bytes": 524288,
    }


def test_default_native_endpoint_is_project_scoped_with_explicit_project_over_cwd(tmp_path, monkeypatch):
    import sys

    monkeypatch.delenv("SOP_AGENTD_PIPE", raising=False)
    monkeypatch.delenv("SOP_AGENTD_SOCK", raising=False)
    project = tmp_path / "项目_ΟΣ_İ"
    project.mkdir()
    other = tmp_path / "other"
    other.mkdir()
    monkeypatch.setenv("PROJECT_PATH", str(other))
    first = AgentdIpcClient(project_path=project)
    monkeypatch.chdir(other)
    second = AgentdIpcClient(project_path=project)
    assert first.transport.endpoint == second.transport.endpoint
    assert first.socket_path == project / ".sop-runtime" / "agentd.sock"
    assert first.transport.name == ("named_pipe" if sys.platform == "win32" else "unix")
    assert AgentdIpcClient(project_path=other).transport.endpoint != first.transport.endpoint


def test_logical_socket_overrides_are_relative_to_the_selected_project(tmp_path, monkeypatch):
    monkeypatch.delenv("SOP_AGENTD_PIPE", raising=False)
    monkeypatch.setenv("SOP_AGENTD_SOCK", "custom/../endpoint.sock")
    project = tmp_path / "project"
    project.mkdir()
    expected = AgentdIpcClient(socket_path=project / "endpoint.sock", project_path=project)
    actual = AgentdIpcClient(project_path=project)
    assert actual.socket_path == expected.socket_path == project / "endpoint.sock"
    assert actual.transport.endpoint == expected.transport.endpoint
    explicit = AgentdIpcClient("explicit.sock", project_path=project)
    assert explicit.socket_path == project / "explicit.sock"
    assert explicit.transport.endpoint != actual.transport.endpoint


def test_explicit_transport_wins_even_when_it_is_falsey(tmp_path, monkeypatch):
    class FalseyTransport(FakeTransport):
        def __bool__(self):
            return False

    transport = FalseyTransport(b'{"ok": true}\n')
    monkeypatch.setenv("SOP_AGENTD_PIPE", r"\\.\pipe\override")
    monkeypatch.setenv("SOP_AGENTD_SOCK", "environment.sock")
    client = AgentdIpcClient("explicit.sock", transport=transport, project_path=tmp_path)
    assert client.transport is transport
    assert client.health() == {"ok": True}
