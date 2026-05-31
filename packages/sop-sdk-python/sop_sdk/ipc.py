"""
@module: sop_sdk.ipc
@purpose: 与本地 sop-agentd 守护进程的 IPC（Unix socket / Windows named pipe）
@stable: send() 协议帧格式稳定（NDJSON + v=1）
@ai_safe_edit: 新增 op 类型 → 不破坏旧客户端（agentd 端忽略未知）
"""
from __future__ import annotations

import errno
import json
import os
import sys
import socket
from pathlib import Path
from typing import Any, Protocol


MAX_FRAME_BYTES = 65536


class IpcTransport(Protocol):
    name: str
    endpoint: str

    def available(self) -> bool: ...

    def request(self, frame: bytes, timeout: float, max_bytes: int) -> bytes: ...


def _default_unix_socket_path() -> Path:
    return (
        Path(os.getenv("SOP_AGENTD_SOCK", "")).expanduser()
        if os.getenv("SOP_AGENTD_SOCK")
        else Path(os.getenv("PROJECT_PATH", ".")).expanduser() / ".sop-runtime" / "agentd.sock"
    )


def _default_pipe_name() -> str:
    return os.getenv("SOP_AGENTD_PIPE", r"\\.\pipe\sop-agentd")


class UnixSocketTransport:
    name = "unix"

    def __init__(self, socket_path: Path | str) -> None:
        self.socket_path = Path(socket_path).expanduser()
        self.endpoint = str(self.socket_path)

    def available(self) -> bool:
        return self.socket_path.exists()

    def request(self, frame: bytes, timeout: float, max_bytes: int) -> bytes:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect(str(self.socket_path))
            sock.sendall(frame)
            return _read_until_newline(sock.recv, max_bytes)


class WindowsNamedPipeTransport:
    name = "named_pipe"

    def __init__(self, pipe_name: str) -> None:
        self.endpoint = pipe_name

    def available(self) -> bool:
        if os.name != "nt":
            return False
        try:
            with open(self.endpoint, "r+b", buffering=0):
                return True
        except OSError:
            return False

    def request(self, frame: bytes, timeout: float, max_bytes: int) -> bytes:
        if os.name != "nt":
            raise OSError(errno.ENOTSUP, "Windows named pipe transport requires Windows")
        # Windows named pipes are exposed as file handles. The server side is responsible
        # for request/response framing; this client keeps the same NDJSON contract.
        with open(self.endpoint, "r+b", buffering=0) as pipe:
            pipe.write(frame)
            pipe.flush()
            return _read_until_newline(lambda n: pipe.read(n), max_bytes)


def _read_until_newline(reader, max_bytes: int) -> bytes:
    buf = b""
    while not buf.endswith(b"\n") and len(buf) < max_bytes:
        chunk = reader(min(4096, max_bytes - len(buf)))
        if not chunk:
            break
        buf += chunk
    return buf


def _ipc_error(code: str, message: str, *, transport: IpcTransport, op: str) -> dict[str, Any]:
    return {
        "ok": False,
        "error": message,
        "error_code": code,
        "transport": transport.name,
        "endpoint": transport.endpoint,
        "op": op,
    }


class AgentdIpcClient:
    """Hook / CLI → sop-agentd 的轻量同步客户端。

    协议：单 NDJSON 帧请求 → 单 NDJSON 帧响应（< 64 KB）。
    超时 1 秒，连接失败立即返回结构化错误（fall through，由调用方决定降级）。
    """

    def __init__(
        self,
        socket_path: Path | str | None = None,
        timeout: float = 1.0,
        transport: IpcTransport | None = None,
        max_response_bytes: int = MAX_FRAME_BYTES,
    ) -> None:
        self.socket_path = Path(socket_path).expanduser() if socket_path is not None else _default_unix_socket_path()
        self.timeout = timeout
        self.max_response_bytes = max_response_bytes
        self.transport = transport or (
            WindowsNamedPipeTransport(_default_pipe_name()) if sys.platform.startswith("win") else UnixSocketTransport(self.socket_path)
        )

    def available(self) -> bool:
        return self.transport.available()

    def diagnose(self) -> dict[str, Any]:
        return {
            "available": self.available(),
            "transport": self.transport.name,
            "endpoint": self.transport.endpoint,
            "timeout": self.timeout,
            "max_response_bytes": self.max_response_bytes,
        }

    def send(self, op: str, name: str = "", data: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = {"v": 1, "op": op, "name": name, "data": data or {}}
        frame = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        try:
            if not self.available():
                return _ipc_error("unavailable", f"agentd IPC endpoint 不存在或不可连接: {self.transport.endpoint}", transport=self.transport, op=op)
            buf = self.transport.request(frame, self.timeout, self.max_response_bytes)
            if not buf.strip():
                return _ipc_error("empty_response", "agentd IPC 返回空响应", transport=self.transport, op=op)
            try:
                out = json.loads(buf.decode("utf-8").strip())
            except (UnicodeDecodeError, json.JSONDecodeError) as e:
                return _ipc_error("invalid_response", f"agentd IPC 返回无法解析: {e}", transport=self.transport, op=op)
            if isinstance(out, dict):
                return out
            return _ipc_error("invalid_response", "agentd IPC 返回不是 JSON object", transport=self.transport, op=op)
        except (FileNotFoundError, ConnectionError, TimeoutError, OSError) as e:
            return _ipc_error("transport_error", str(e), transport=self.transport, op=op)

    # 便捷方法
    def event(self, name: str, **data: Any) -> dict[str, Any]:
        return self.send("event", name=name, data=data)

    def health(self) -> dict[str, Any]:
        return self.send("health")

    def task_done(self, task_id: str, notes: str = "", confidence: float = 0.0) -> dict[str, Any]:
        return self.send("task.update", name=task_id, data={
            "status": "completed", "notes": notes, "confidence": confidence,
        })

    def task_fail(self, task_id: str, notes: str = "") -> dict[str, Any]:
        return self.send("task.update", name=task_id, data={"status": "blocked", "notes": notes})

    def report_issue(self, title: str, severity: str = "P2", description: str = "") -> dict[str, Any]:
        return self.send("issue.report", data={"title": title, "severity": severity, "description": description})

    def sync_pull(self, modules: str = "") -> dict[str, Any]:
        data: dict[str, Any] = {}
        if modules:
            data["modules"] = modules
        return self.send("sync.pull", data=data)

    def sync_push(self, module: str, record: dict[str, Any], action: str = "upsert") -> dict[str, Any]:
        return self.send("sync.push", data={"module": module, "action": action, "record": record})
