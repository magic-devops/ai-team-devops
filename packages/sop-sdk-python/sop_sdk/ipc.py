"""
@module: sop_sdk.ipc
@purpose: 与本地 sop-agentd 守护进程的 IPC（Unix socket / Windows named pipe 占位）
@stable: send() 协议帧格式稳定（NDJSON + v=1）
@ai_safe_edit: 新增 op 类型 → 不破坏旧客户端（agentd 端忽略未知）
"""
from __future__ import annotations

import json
import os
import socket
from pathlib import Path
from typing import Any


class AgentdIpcClient:
    """Hook / CLI → sop-agentd 的轻量同步客户端。

    协议：单 NDJSON 帧请求 → 单 NDJSON 帧响应（< 64 KB）。
    超时 1 秒，连接失败立即返回（fall through，由调用方决定降级）。
    """

    def __init__(self, socket_path: Path | str | None = None, timeout: float = 1.0) -> None:
        self.socket_path = Path(
            socket_path or os.getenv("SOP_AGENTD_SOCK", "")
            or Path(os.getenv("PROJECT_PATH", ".")).expanduser() / ".sop-runtime" / "agentd.sock"
        )
        self.timeout = timeout

    def available(self) -> bool:
        return self.socket_path.exists()

    def send(self, op: str, name: str = "", data: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = {"v": 1, "op": op, "name": name, "data": data or {}}
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(self.timeout)
            s.connect(str(self.socket_path))
            s.sendall((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
            buf = b""
            while not buf.endswith(b"\n") and len(buf) < 65536:
                chunk = s.recv(4096)
                if not chunk:
                    break
                buf += chunk
            s.close()
            if not buf.strip():
                return {"ok": False, "error": "empty response"}
            return json.loads(buf.decode("utf-8").strip())
        except (FileNotFoundError, ConnectionError, OSError) as e:
            return {"ok": False, "error": str(e)}

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
