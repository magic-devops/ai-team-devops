from __future__ import annotations

import os
import shutil
import subprocess
import time
from collections.abc import Callable

from . import __version__
from .execution import Execution
from .transactional import Store


def _pipe_reader(descriptor: int) -> Callable[[int], bytes | None]:
    if os.name == "nt":
        import ctypes
        import msvcrt
        from ctypes import wintypes

        peek = ctypes.WinDLL("kernel32", use_last_error=True).PeekNamedPipe
        peek.argtypes = [
            wintypes.HANDLE,
            wintypes.LPVOID,
            wintypes.DWORD,
            wintypes.LPVOID,
            ctypes.POINTER(wintypes.DWORD),
            wintypes.LPVOID,
        ]
        peek.restype = wintypes.BOOL
        handle = msvcrt.get_osfhandle(descriptor)

        def read_windows(limit: int) -> bytes | None:
            available = wintypes.DWORD()
            if not peek(handle, None, 0, None, ctypes.byref(available), None):
                if ctypes.get_last_error() == 109:
                    return b""
                raise OSError("Cannot inspect executor output pipe")
            return os.read(descriptor, min(limit, available.value)) if available.value else None

        return read_windows
    os.set_blocking(descriptor, False)

    def read_posix(limit: int) -> bytes | None:
        try:
            return os.read(descriptor, limit)
        except BlockingIOError:
            return None

    return read_posix


def _version_matches(command: list[str], timeout: float = 3) -> bool:
    with subprocess.Popen(  # noqa: S603 - configured executor argv, no shell or request-supplied arguments
        command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0
    ) as process:
        assert process.stdout is not None
        output = bytearray()
        deadline = time.monotonic() + timeout
        try:
            read = _pipe_reader(process.stdout.fileno())
            while time.monotonic() < deadline:
                chunk = read(128 - len(output))
                if chunk == b"" or chunk is None and process.poll() is not None:
                    break
                if chunk:
                    output.extend(chunk)
                    if len(output) >= 128:
                        return False
                else:
                    time.sleep(0.01)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            return process.wait(timeout=remaining) == 0 and output.strip() == __version__.encode("ascii")
        except subprocess.TimeoutExpired:
            return False
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


def runtime_checks(store: Store, execution: Execution) -> list[dict[str, str]]:
    checks = []
    try:
        with store.engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1").scalar_one()
            mode = (
                connection.exec_driver_sql("PRAGMA journal_mode").scalar_one()
                if store.engine.dialect.name == "sqlite"
                else None
            )
        checks.append(
            {
                "id": "store",
                "status": "passed" if mode in {None, "wal", "memory"} else "failed",
                "detail": f"{store.engine.dialect.name}" + (f" / {mode}" if mode else ""),
            }
        )
    except Exception:
        checks.append(
            {"id": "store", "status": "failed", "detail": "Database probe failed; inspect local service logs"}
        )
    try:
        from langgraph.checkpoint.sqlite import SqliteSaver

        with SqliteSaver.from_conn_string(":memory:") as saver:
            saver.setup()
        checks.append(
            {"id": "checkpoints", "status": "passed", "detail": "LangGraph SQLite checkpointer available"}
        )
    except Exception:
        checks.append(
            {"id": "checkpoints", "status": "failed", "detail": "LangGraph checkpoint initialization failed"}
        )
    executor = {
        "id": "executor",
        "status": "failed",
        "detail": "Install a complete runtime with an executable agentd",
    }
    if execution.available():
        try:
            if _version_matches([execution.agentd, "version"]):
                executor.update(status="passed", detail=f"agentd {__version__}")
            else:
                executor["detail"] = "agentd version does not match Core; reinstall the matching runtime"
        except (OSError, subprocess.TimeoutExpired, UnicodeError):
            executor["detail"] = "agentd version probe failed; verify runtime installation"
    checks.append(executor)
    try:
        enough = shutil.disk_usage(execution.data_dir).free >= 64 * 1024 * 1024
        checks.append(
            {
                "id": "storage",
                "status": "passed" if enough else "failed",
                "detail": "At least 64 MiB free"
                if enough
                else "Less than 64 MiB free; free disk space before execution",
            }
        )
    except OSError:
        checks.append({"id": "storage", "status": "failed", "detail": "Data-directory disk probe failed"})
    return checks
