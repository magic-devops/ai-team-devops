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

MAX_FRAME_BYTES = 512 * 1024


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

    协议：单 NDJSON 帧请求 → 单 NDJSON 帧响应（最多 512 KiB）。
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
        if len(frame) > MAX_FRAME_BYTES:
            return _ipc_error("frame_too_large", "IPC 请求超过 512 KiB", transport=self.transport, op=op)
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
            if len(buf) > self.max_response_bytes or not buf.endswith(b"\n"):
                return _ipc_error(
                    "invalid_response", "agentd IPC 响应帧不完整或超过上限", transport=self.transport, op=op
                )
            try:
                from .event_envelope import strict_json

                out = strict_json(buf.decode("utf-8").strip())
            except (UnicodeError, ValueError) as e:
                return _ipc_error(
                    "invalid_response", f"agentd IPC 返回无法解析: {e}", transport=self.transport, op=op
                )
            if isinstance(out, dict) and type(out.get("ok")) is bool:
                return out
            return _ipc_error("invalid_response", "agentd IPC 响应必须含布尔 ok", transport=self.transport, op=op)
        except TimeoutError as e:
            return _ipc_error("timeout", str(e), transport=self.transport, op=op)
        except FileNotFoundError as e:
            return _ipc_error("unavailable", str(e), transport=self.transport, op=op)
        except (ConnectionError, OSError) as e:
            return _ipc_error("transport_error", str(e), transport=self.transport, op=op)

    # 便捷方法
    def enqueue_event(self, event, *, intended_project_id: str) -> dict[str, Any]:
        from .event_envelope import FrozenEvent, text_field

        if not isinstance(event, FrozenEvent):
            raise ValueError("FrozenEvent required")
        text_field(intended_project_id, "intended_project_id", maximum=64)
        out = self.send("event.enqueue", data={**event.item(), "intended_project_id": intended_project_id})
        if out.get("ok") is True:
            result = out.get("result")
            if (
                out.get("op") != "event.enqueue"
                or out.get("id") != event.id
                or not isinstance(result, dict)
                or result.get("id") != event.id
                or result.get("digest") != event.digest
                or result.get("state") not in {"pending", "dead_letter", "acked"}
                or type(result.get("revision")) is not int
                or result["revision"] < 1
                or type(result.get("replayed")) is not bool
            ):
                out = _ipc_error(
                    "invalid_response", "agentd 未确认原事件入队", transport=self.transport, op="event.enqueue"
                )
        # Unknown transport outcome carries the exact original intent for a safe explicit retry.
        if out.get("ok") is not True:
            return {**out, "original_event": event.item(), "intended_project_id": intended_project_id}
        return out

    def event(
        self, name: str, *, intended_project_id: str, event_id: str, time: str, **data: Any
    ) -> dict[str, Any]:
        from .event_envelope import FrozenEvent

        return self.enqueue_event(
            FrozenEvent.create(name, data, event_id=event_id, time=time), intended_project_id=intended_project_id
        )

    def health(self) -> dict[str, Any]:
        return self.send("health")

    def task_done(
        self,
        task_id: str,
        *,
        expected_version: int,
        intended_project_id: str,
        event_id: str,
        time: str,
        notes="",
        confidence=0.0,
    ) -> dict[str, Any]:
        return self._task_status(
            task_id,
            "completed",
            expected_version,
            intended_project_id,
            event_id,
            time,
            notes=notes,
            confidence=confidence,
        )

    def task_fail(
        self, task_id: str, *, expected_version: int, intended_project_id: str, event_id: str, time: str, notes=""
    ) -> dict[str, Any]:
        return self._task_status(
            task_id, "blocked", expected_version, intended_project_id, event_id, time, notes=notes
        )

    def _task_status(self, task_id, status, expected_version, project, event_id, time, **metadata):
        from .event_envelope import FrozenEvent, integer

        integer(expected_version, "expected_version")
        event = FrozenEvent.create(
            "sop.task.status_changed",
            {"expected_version": expected_version, "status": status, **metadata},
            subject=task_id,
            event_id=event_id,
            time=time,
        )
        return self.enqueue_event(event, intended_project_id=project)

    def report_issue(
        self,
        title: str,
        *,
        expected_version: int,
        intended_project_id: str,
        event_id: str,
        time: str,
        severity="P2",
        description="",
        task_id="",
    ) -> dict[str, Any]:
        from .event_envelope import FrozenEvent, integer

        integer(expected_version, "expected_version")
        event = FrozenEvent.create(
            "sop.issue.opened",
            {
                "expected_version": expected_version,
                "title": title,
                "severity": severity,
                "description": description,
                "task_id": task_id,
            },
            event_id=event_id,
            time=time,
        )
        return self.enqueue_event(event, intended_project_id=intended_project_id)

    def sync_pull(self, modules: str = "") -> dict[str, Any]:
        data: dict[str, Any] = {}
        if modules:
            data["modules"] = modules
        return self.send("sync.pull", data=data)

    def sync_push(
        self,
        module: str,
        record: dict[str, Any],
        *,
        expected_version: int,
        intended_project_id: str,
        event_id: str,
        time: str,
        action="upsert",
    ) -> dict[str, Any]:
        from .event_envelope import FrozenEvent, integer

        integer(expected_version, "expected_version")
        event = FrozenEvent.create(
            "sop.sync.push",
            {"expected_version": expected_version, "module": module, "action": action, "record": record},
            event_id=event_id,
            time=time,
        )
        return self.enqueue_event(event, intended_project_id=intended_project_id)

    def outbox_stats(self):
        return self.send("outbox.stats")

    def outbox_list(self, *, state="all", limit=20, cursor=""):
        return self.send("outbox.list", data={"state": state, "limit": limit, "cursor": cursor})

    def outbox_inspect(self, event_id: str):
        return self.send("outbox.inspect", data={"id": event_id})

    def outbox_requeue(self, event_id: str, *, expected_revision: int, reason: str, idempotency_key: str):
        return self.send(
            "outbox.requeue",
            data={
                "id": event_id,
                "expected_revision": expected_revision,
                "reason": reason,
                "idempotency_key": idempotency_key,
            },
        )
