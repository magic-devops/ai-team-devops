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
import socket
import sys
from pathlib import Path
from typing import Any, Protocol

MAX_FRAME_BYTES = 65536


class IpcTransport(Protocol):
    name: str
    endpoint: str

    def available(self) -> bool: ...

    def request(self, frame: bytes, timeout: float, max_bytes: int) -> bytes: ...


def _socket_path(socket_path: Path | str | None, project_path: Path | str | None) -> tuple[Path, Path]:
    project = Path(project_path if project_path is not None else os.getenv("PROJECT_PATH") or Path.cwd()).expanduser()
    project = Path(os.path.abspath(project))
    locator = Path(
        socket_path
        if socket_path is not None
        else os.getenv("SOP_AGENTD_SOCK") or project / ".sop-runtime" / "agentd.sock"
    ).expanduser()
    if not locator.is_absolute():
        locator = project / locator
    return project, Path(os.path.abspath(locator))


def _local_pipe_name(value: str) -> str:
    import unicodedata

    prefix = "\\\\.\\pipe\\"
    name = value[len(prefix) :]
    if (
        not value[: len(prefix)].lower() == prefix
        or not name
        or "\\" in name
        or "/" in name
        or any(unicodedata.category(char) == "Cc" for char in value)
    ):
        raise ValueError("Use a local named pipe of the form \\\\.\\pipe\\name")
    return value


def _default_pipe_name(socket_path: Path) -> str:
    override = os.getenv("SOP_AGENTD_PIPE")
    if override:
        return _local_pipe_name(override)
    from ._ipc_windows import pipe_name

    return pipe_name(str(socket_path))


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
        self.endpoint = _local_pipe_name(pipe_name)

    def available(self) -> bool:
        if os.name != "nt":
            return False
        from ._ipc_windows import available

        return available(self.endpoint)

    def request(self, frame: bytes, timeout: float, max_bytes: int) -> bytes:
        if os.name != "nt":
            raise OSError(errno.ENOTSUP, "Windows named pipe transport requires Windows")
        from ._ipc_windows import request

        return request(self.endpoint, frame, timeout, max_bytes)


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
        *,
        project_path: Path | str | None = None,
    ) -> None:
        self.project_path, self.socket_path = _socket_path(socket_path, project_path)
        self.timeout = timeout
        self.max_response_bytes = max_response_bytes
        self.transport = (
            transport
            if transport is not None
            else (
                WindowsNamedPipeTransport(_default_pipe_name(self.socket_path))
                if sys.platform.startswith("win")
                else UnixSocketTransport(self.socket_path)
            )
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
                return _ipc_error(
                    "unavailable",
                    f"agentd IPC endpoint 不存在或不可连接: {self.transport.endpoint}",
                    transport=self.transport,
                    op=op,
                )
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
        except TimeoutError as e:
            return _ipc_error("timeout", str(e), transport=self.transport, op=op)
        except FileNotFoundError as e:
            return _ipc_error("unavailable", str(e), transport=self.transport, op=op)
        except (ConnectionError, OSError) as e:
            return _ipc_error("transport_error", str(e), transport=self.transport, op=op)

    # 便捷方法
    def event(self, name: str, **data: Any) -> dict[str, Any]:
        return self.send("event", name=name, data=data)

    def health(self) -> dict[str, Any]:
        return self.send("health")

    def task_done(self, task_id: str, notes: str = "", confidence: float = 0.0) -> dict[str, Any]:
        return self.send(
            "task.update",
            name=task_id,
            data={
                "status": "completed",
                "notes": notes,
                "confidence": confidence,
            },
        )

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
