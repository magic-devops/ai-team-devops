from __future__ import annotations

import json
from pathlib import Path

from sop_sdk.ipc import AgentdIpcClient


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
    client = AgentdIpcClient(tmp_path / "missing.sock", timeout=0.1)

    result = client.health()

    assert result["ok"] is False
    assert result["transport"] == "unix"
    assert result["error_code"] == "unavailable"
    assert "missing.sock" in result["endpoint"]


def test_agentd_ipc_sends_ndjson_frame_and_reads_response(tmp_path: Path) -> None:
    transport = FakeTransport(b'{"ok": true, "result": {"version": "test"}}\n')
    client = AgentdIpcClient(tmp_path / "agentd.sock", timeout=1, transport=transport)

    result = client.event("tool.pre", tool="Bash", command="git status")

    assert result == {"ok": True, "result": {"version": "test"}}
    assert json.loads(transport.sent.decode("utf-8")) == {
        "v": 1,
        "op": "event",
        "name": "tool.pre",
        "data": {"tool": "Bash", "command": "git status"},
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
        "max_response_bytes": 65536,
    }
