"""Execute one artifact-pinned operation. An uncertain operation is never applied again."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import signal
import ssl
import stat
import subprocess
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import HTTPRedirectHandler, HTTPSHandler, build_opener

from .deployment_contract import (
    OperationPlan,
    OperationResult,
    ProbeReport,
    https_origin,
    strict_json,
    validate_argv,
)
from .transactional import digest

OUTPUT_LIMIT = 16384


def _now():
    return datetime.now(timezone.utc).isoformat()


def _safe(path: Path, *, directory=False):
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise ValueError("Deployment paths must not be links")
    info = path.lstat()
    if (directory and not stat.S_ISDIR(info.st_mode)) or (
        not directory and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1)
    ):
        raise ValueError("Deployment paths must be regular and unlinked")


def _directory(path: Path):
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    _safe(path, directory=True)


def _paths(root: Path, operation_id: str):
    root = root.expanduser().absolute()
    for path in [*reversed(root.parents), root]:
        _safe(path, directory=True)
    base = root / ".sop-deploy"
    _directory(base)
    folder = base / hashlib.sha256(operation_id.encode()).hexdigest()
    _directory(folder)
    return root, folder


def _write(path: Path, value: dict):
    if path.exists() or path.is_symlink():
        _safe(path)
    temporary = path.parent / ("." + uuid.uuid4().hex + ".tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def _lock(folder: Path):
    path = folder / "operation.lock"
    if path.exists() or path.is_symlink():
        _safe(path)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    locked = False
    try:
        _safe(path)
        if os.name == "nt":
            import msvcrt

            if os.fstat(fd).st_size == 0:
                os.write(fd, b"0")
            os.lseek(fd, 0, os.SEEK_SET)
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                locked = True
            except OSError:
                pass
        else:
            import fcntl

            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except BlockingIOError:
                pass
        yield locked
    finally:
        os.close(fd)


def _remaining(deadline):
    value = deadline - time.monotonic()
    if value <= 0:
        raise TimeoutError("Deployment total time budget expired")
    return value


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Artifact redirects are forbidden")


def _download(plan, folder, deadline):
    if https_origin(plan.artifact_url) not in [
        https_origin(item, origin_only=True) for item in plan.artifact_origins
    ]:
        raise ValueError("Artifact origin changed")
    destination = folder / "artifact.bin"
    if destination.exists() or destination.is_symlink():
        _safe(destination)
    temporary = folder / (uuid.uuid4().hex + ".artifact.tmp")
    opener = build_opener(_NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
    try:
        with opener.open(plan.artifact_url, timeout=_remaining(deadline)) as response:
            if response.status != 200:
                raise ValueError("Artifact response must be HTTP 200")
            checksum, size = hashlib.sha256(), 0
            fd = os.open(
                temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600
            )
            with os.fdopen(fd, "wb") as output:
                while True:
                    if response.fp is None:
                        break
                    # Reset the socket timeout for every read; a trickling response cannot extend the total budget.
                    response.fp.raw._sock.settimeout(_remaining(deadline))
                    chunk = response.read1(min(65536, plan.max_artifact_bytes + 1 - size))
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > plan.max_artifact_bytes:
                        raise ValueError("Artifact exceeds the configured byte limit")
                    checksum.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if checksum.hexdigest() != plan.artifact_sha256:
                raise ValueError("Artifact SHA-256 mismatch")
        os.replace(temporary, destination)
        return destination
    finally:
        temporary.unlink(missing_ok=True)


def _argv(values, plan, artifact):
    replacements = {
        "artifact_path": str(artifact),
        "artifact_sha256": plan.artifact_sha256,
        "commit_sha": plan.commit_sha,
        "operation_id": plan.operation_id,
        "traffic_percent": str(plan.traffic_percent),
    }
    result = list(values)
    for key, value in replacements.items():
        result = [arg.replace("{" + key + "}", value) for arg in result]
    return validate_argv(result, tokens=None)


def _terminate(proc):
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(  # noqa: S603 -- task-owned PID, no shell
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],  # noqa: S607
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW,
            check=False,
        )
    else:
        os.killpg(proc.pid, signal.SIGKILL)
    proc.wait(timeout=5)


def _command(argv, root, deadline):
    started = time.monotonic()
    buffers, lengths = {"stdout": bytearray(), "stderr": bytearray()}, {"stdout": 0, "stderr": 0}

    def drain(pipe, name):
        with pipe:
            while chunk := pipe.read(4096):
                lengths[name] += len(chunk)
                remaining = OUTPUT_LIMIT - len(buffers[name])
                if remaining > 0:
                    buffers[name].extend(chunk[:remaining])

    proc = subprocess.Popen(  # noqa: S603 -- configured argv, no shell
        argv,
        cwd=root,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=os.name != "nt",
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    threads = [
        threading.Thread(target=drain, args=(getattr(proc, name), name), daemon=True) for name in buffers
    ]
    for thread in threads:
        thread.start()
    error = ""
    try:
        proc.wait(timeout=_remaining(deadline))
    except (subprocess.TimeoutExpired, TimeoutError):
        error = "Deployment command exhausted the total time budget"
        _terminate(proc)
    except BaseException:
        _terminate(proc)
        raise
    for thread in threads:
        thread.join(timeout=1)
    return {
        "exit_code": proc.returncode,
        "duration_ms": round((time.monotonic() - started) * 1000),
        **{name: bytes(value).decode("utf-8", errors="replace") for name, value in buffers.items()},
        **{name + "_truncated": lengths[name] > OUTPUT_LIMIT for name in buffers},
        "error": error,
    }


class _ProbeFailure(ValueError):
    def __init__(self, message, probes, elapsed):
        super().__init__(message)
        self.probes, self.elapsed = probes, elapsed


def _observe(plan, root, artifact, deadline, *, apply):
    if apply.get("exit_code") not in (None, 0):
        raise ValueError("Recorded deployment apply failed; health observation cannot override it")
    started, wall_started = time.monotonic(), datetime.now(timezone.utc)
    probes = []
    target_samples = max(plan.min_samples, min(100, math.ceil(plan.observation_seconds / 10) + 1), 2)
    for index in range(target_samples):
        due = started + index * plan.observation_seconds / (target_samples - 1)
        while time.monotonic() < due:
            time.sleep(min(0.5, due - time.monotonic(), _remaining(deadline)))
        evidence = {
            "exit_code": None,
            "duration_ms": 0,
            "stdout": "",
            "stderr": "",
            "stdout_truncated": False,
            "stderr_truncated": False,
        }
        try:
            evidence = _command(_argv(plan.probe_argv, plan, artifact), root, deadline)
            if evidence["exit_code"] != 0 or evidence["error"] or evidence["stdout_truncated"]:
                raise ValueError("Independent health probe failed or returned incomplete output")
            probe = ProbeReport.model_validate(strict_json(evidence["stdout"]))
            timestamp = datetime.fromisoformat(probe.observed_at.replace("Z", "+00:00"))
            if (
                not probe.healthy
                or probe.operation_id != plan.operation_id
                or probe.artifact_sha256 != plan.artifact_sha256
                or probe.traffic_percent != plan.traffic_percent
                or timestamp.utcoffset() is None
                or timestamp.utcoffset().total_seconds() != 0
                or timestamp < wall_started
                or timestamp > datetime.now(timezone.utc)
            ):
                raise ValueError(
                    "Health evidence does not match this operation, artifact, traffic or observation window"
                )
        except Exception as exc:
            failure = {
                "exit_code": evidence["exit_code"],
                "duration_ms": evidence["duration_ms"],
                "observed_at": _now(),
                "error": str(exc)[:2000],
            }
            for name in ("stdout", "stderr"):
                raw = evidence[name].encode("utf-8")
                failure[name] = raw[:512].decode("utf-8", errors="ignore")
                failure[name + "_truncated"] = bool(evidence[name + "_truncated"] or len(raw) > 512)
            raise _ProbeFailure(str(exc), [*probes, failure], time.monotonic() - started) from exc
        probes.append(
            {**probe.model_dump(), "exit_code": evidence["exit_code"], "duration_ms": evidence["duration_ms"]}
        )
    return probes, time.monotonic() - started


def _result(
    plan, request_digest, *, status="unknown", started_at=None, apply=None, probes=None, elapsed=0, error=""
):
    apply = dict(
        apply
        or {
            "executed": False,
            "reused": False,
            "exit_code": None,
            "duration_ms": 0,
            "stdout": "",
            "stderr": "",
        }
    )
    for name in ("stdout", "stderr"):
        raw = apply.get(name, "").encode("utf-8")
        apply[name] = raw[:4096].decode("utf-8", errors="ignore")
        apply[name + "_truncated"] = bool(apply.get(name + "_truncated") or len(raw) > 4096)
    value = dict(
        protocol="sop.deployment.result.v1",
        operation_id=plan.operation_id,
        request_digest=request_digest,
        status=status,
        artifact_sha256=plan.artifact_sha256,
        traffic_percent=plan.traffic_percent,
        apply=apply,
        probes=probes or [],
        started_at=started_at or _now(),
        finished_at=_now(),
        observation_seconds=elapsed,
        error=str(error)[:2000],
    )
    while len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > 61440 and (
        apply["stdout"] or apply["stderr"]
    ):
        for name in ("stdout", "stderr"):
            apply[name] = apply[name][: len(apply[name]) // 2]
            apply[name + "_truncated"] = True
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > 61440:
        raise ValueError("Complete deployment evidence exceeds the result limit")
    return OperationResult.model_validate(value).model_dump(mode="json")


def execute_operation(plan: dict, root: Path, *, observe: bool = False) -> dict:
    plan = OperationPlan.model_validate(plan)
    if type(observe) is not bool:
        raise ValueError("observe must be boolean")
    request_digest = digest(plan.model_dump(mode="json"))
    root, folder = _paths(root, plan.operation_id)
    journal_path = folder / "journal.json"
    deadline = time.monotonic() + plan.timeout_seconds
    with _lock(folder) as locked:
        if not locked:
            return _result(
                plan, request_digest, error="Operation is already executing; query its original receipt"
            )
        journal = None
        if journal_path.exists() or journal_path.is_symlink():
            _safe(journal_path)
            with journal_path.open("r", encoding="utf-8") as source:
                journal = strict_json(source.read(131073), max_bytes=131072)
            if journal.get("request_digest") != request_digest:
                raise ValueError("Operation ID already belongs to a different immutable request")
            if journal.get("result"):
                return OperationResult.model_validate(journal["result"]).model_dump(mode="json")
        if observe and (not journal or journal.get("state") != "started"):
            return _result(
                plan, request_digest, error="No started operation journal exists; observe cannot apply"
            )
        if journal and journal.get("state") == "started" and not observe:
            return _result(
                plan,
                request_digest,
                started_at=journal["started_at"],
                apply=journal.get("apply"),
                error="Prior operation has uncertain side effects; use read-only observe",
            )
        journal = journal or {"request_digest": request_digest, "state": "prepared", "started_at": _now()}
        apply = journal.get("apply")
        started_at = journal["started_at"]
        try:
            if not observe:
                _write(journal_path, journal)
                artifact = _download(plan, folder, deadline)
                journal.update(
                    state="started",
                    started_at=_now(),
                    apply={
                        "executed": True,
                        "reused": False,
                        "exit_code": None,
                        "duration_ms": 0,
                        "stdout": "",
                        "stderr": "",
                    },
                )
                started_at = journal["started_at"]
                _write(journal_path, journal)
                apply = {
                    "executed": True,
                    "reused": False,
                    **_command(_argv(plan.apply_argv, plan, artifact), root, deadline),
                }
                journal["apply"] = apply
                _write(journal_path, journal)
                if apply["exit_code"] != 0 or apply["error"]:
                    raise ValueError("Deployment apply failed: " + apply["error"])
            else:
                artifact = folder / "artifact.bin"
                _safe(artifact)
                apply = {**(apply or {"executed": True, "exit_code": None}), "reused": True}
            probes, elapsed = _observe(plan, root, artifact, deadline, apply=apply)
            result = _result(
                plan,
                request_digest,
                status="verified",
                started_at=started_at,
                apply=apply,
                probes=probes,
                elapsed=elapsed,
            )
        except Exception as exc:
            uncertain = (
                journal.get("state") == "started"
                and (not apply or apply.get("exit_code") is None or apply.get("error"))
                and not (observe and apply and apply.get("exit_code") not in (None, 0))
            )
            result = _result(
                plan,
                request_digest,
                status="unknown" if uncertain else "failed",
                started_at=started_at,
                apply=apply,
                probes=exc.probes if isinstance(exc, _ProbeFailure) else None,
                elapsed=exc.elapsed if isinstance(exc, _ProbeFailure) else 0,
                error=f"{type(exc).__name__}: {exc}",
            )
            if uncertain:
                return result
        journal.update(state="completed", result=result)
        _write(journal_path, journal)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan-json", required=True)
    parser.add_argument("--observe", action="store_true")
    args = parser.parse_args(argv)
    try:
        plan = strict_json(args.plan_json)
        result = execute_operation(plan, Path.cwd(), observe=args.observe)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        return {"verified": 0, "failed": 1, "unknown": 2}[result["status"]]
    except (ValueError, OSError) as exc:
        print(json.dumps({"error": str(exc)[:2000]}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
