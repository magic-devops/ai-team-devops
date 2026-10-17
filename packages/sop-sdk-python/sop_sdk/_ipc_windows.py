"""Windows-only primitives, using the CPython >=3.10 stdlib _winapi contract."""

import _winapi
import hashlib
import math
import os
import time


def pipe_name(socket_path: str) -> str:
    canonical = os.path.abspath(socket_path)
    # Match the daemon on this host; Python lower() has different Unicode rules.
    mapped = _winapi.LCMapStringEx("", 0x100, canonical)
    return "\\\\.\\pipe\\sop-agentd-" + hashlib.sha1(mapped.encode("utf-8"), usedforsecurity=False).hexdigest()[:16]


def available(endpoint: str) -> bool:
    # WaitNamedPipe checks an instance without opening/consuming a connection.
    try:
        _winapi.WaitNamedPipe(endpoint, 1)
        return True
    except OSError as exc:
        if exc.winerror in (_winapi.ERROR_SEM_TIMEOUT, _winapi.ERROR_PIPE_BUSY):
            return True
        if exc.winerror in (2, 3):
            return False
        raise


def _remaining_ms(deadline: float) -> int:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("agentd named pipe request deadline expired")
    return min(0xFFFFFFFE, math.ceil(remaining * 1000))


def _complete(operation, deadline: float) -> tuple[int, int]:
    complete = False
    try:
        result = _winapi.WaitForSingleObject(operation.event, _remaining_ms(deadline))
        if result == _winapi.WAIT_TIMEOUT:
            raise TimeoutError("agentd named pipe request deadline expired")
        if result != _winapi.WAIT_OBJECT_0:
            raise OSError("agentd named pipe event wait failed")
        transferred, error = operation.GetOverlappedResult(True)
        complete = True
        return transferred, error
    finally:
        if not complete:
            # The stdlib keeps the buffer alive until cancellation has completed.
            operation.cancel()
            operation.GetOverlappedResult(True)


def _connect(endpoint: str, deadline: float) -> int:
    while True:
        _remaining_ms(deadline)
        try:
            handle = _winapi.CreateFile(
                endpoint,
                _winapi.GENERIC_READ | _winapi.GENERIC_WRITE,
                0,
                0,
                _winapi.OPEN_EXISTING,
                _winapi.FILE_FLAG_OVERLAPPED,
                0,
            )
            return handle
        except OSError as exc:
            if exc.winerror != _winapi.ERROR_PIPE_BUSY:
                raise
            try:
                _winapi.WaitNamedPipe(endpoint, _remaining_ms(deadline))
            except OSError as wait_error:
                if wait_error.winerror == _winapi.ERROR_SEM_TIMEOUT:
                    raise TimeoutError("agentd named pipe connection deadline expired") from wait_error
                raise


def request(endpoint: str, frame: bytes, timeout: float, max_bytes: int) -> bytes:
    if isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("IPC timeout must be finite and positive")
    deadline = time.monotonic() + timeout
    handle = _connect(endpoint, deadline)
    try:
        sent = 0
        while sent < len(frame):
            _remaining_ms(deadline)
            operation, _ = _winapi.WriteFile(handle, frame[sent:], overlapped=True)
            written, error = _complete(operation, deadline)
            if error or not written:
                raise OSError(error, "agentd named pipe write failed")
            sent += written
        response = bytearray()
        while not response.endswith(b"\n") and len(response) < max_bytes:
            _remaining_ms(deadline)
            try:
                operation, _ = _winapi.ReadFile(handle, min(4096, max_bytes - len(response)), overlapped=True)
                count, error = _complete(operation, deadline)
            except BrokenPipeError:
                break
            if error == _winapi.ERROR_BROKEN_PIPE:
                break
            if error not in (0, _winapi.ERROR_MORE_DATA):
                raise OSError(error, "agentd named pipe read failed")
            if not count:
                break
            response.extend(operation.getbuffer())
        return bytes(response)
    finally:
        _winapi.CloseHandle(handle)
