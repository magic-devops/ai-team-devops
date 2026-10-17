from __future__ import annotations

import errno
import hashlib
import json
import os
import stat
import time
import uuid
from pathlib import Path
from typing import Any

OUTBOX_VERSION = 1
RECORD_LIMIT_BYTES = 8 * 1024 * 1024
VALID_STATES = {"executing", "pending", "acknowledged", "quarantined"}


class OutboxError(Exception):
    pass


class OutboxLocked(OutboxError):
    pass


def credential_binding(credential: dict[str, Any]) -> str:
    raw = json.dumps({
        "server": str(credential.get("server", "")),
        "device_id": str(credential.get("device_id", "")),
        "workspace_id": str(credential.get("workspace_id", "")),
        "credential": str(credential.get("credential", "")),
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def default_outbox_dir(credential_file: Path) -> Path:
    return Path(str(credential_file) + ".outbox")


class OutboxLock:
    def __init__(self, outbox_dir: Path):
        self.path = outbox_dir / "worker.lock"
        self.fd: int | None = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(
            self.path,
            os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0),
            0o600,
        )
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or self.path.is_symlink():
                raise OSError("Outbox lock must be a regular file with no additional links")
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                os.fchmod(fd, 0o600)
        except OSError as exc:
            os.close(fd)
            if exc.errno in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                raise OutboxLocked("Remote worker outbox is already locked") from exc
            raise
        self.fd = fd
        return self

    def __exit__(self, *_exc):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


class RemoteOutbox:
    def __init__(self, path: Path, credential: dict[str, Any]):
        self.path = path.expanduser().absolute()
        self.credential = credential
        self.binding = credential_binding(credential)
        self._ensure_dir()

    def _ensure_dir(self) -> None:
        if self.path.exists() and self.path.is_symlink():
            raise OutboxError(f"Outbox directory must not be a symbolic link: {self.path}")
        self.path.mkdir(parents=True, exist_ok=True, mode=0o700)
        info = self.path.stat()
        if not stat.S_ISDIR(info.st_mode):
            raise OutboxError(f"Outbox path must be a directory: {self.path}")
        if os.name != "nt":
            if info.st_uid != os.getuid():
                raise OutboxError(f"Outbox directory owner is not the current user: {self.path}")
            if stat.S_IMODE(info.st_mode) & 0o077:
                os.chmod(self.path, 0o700)

    def _record_path(self, record_id: str) -> Path:
        if "/" in record_id or "\\" in record_id or not record_id.endswith(".json"):
            raise OutboxError("Invalid outbox record id")
        return self.path / record_id

    def _safe_error(self, message: str) -> str:
        safe = str(message)
        credential = str(self.credential.get("credential", ""))
        if credential:
            safe = safe.replace(credential, "[REDACTED_SECRET]")
        return safe[:500]

    def _validate_record(self, record: dict[str, Any], name: str) -> dict[str, Any]:
        if not isinstance(record, dict) or record.get("schema_version") != OUTBOX_VERSION:
            raise OutboxError(f"Outbox record schema is unsupported: {name}")
        required_strings = (
            "record_id", "state", "server", "device_id", "workspace_id", "credential_generation_hash",
            "claim_idempotency_key", "run_id", "owner", "node_id", "result_idempotency_key",
        )
        for key in required_strings:
            if not isinstance(record.get(key), str) or not record[key]:
                raise OutboxError(f"Outbox record missing required string field {key}: {name}")
        if record["state"] not in VALID_STATES:
            raise OutboxError(f"Outbox record state is unsupported: {name}")
        if record["record_id"] != name:
            raise OutboxError(f"Outbox record id does not match filename: {name}")
        if not isinstance(record.get("created_at"), int | float) or not isinstance(record.get("updated_at"), int | float):
            raise OutboxError(f"Outbox record timestamps are invalid: {name}")
        if not isinstance(record.get("attempts", 0), int) or record.get("attempts", 0) < 0:
            raise OutboxError(f"Outbox record attempts are invalid: {name}")
        if record["state"] == "executing":
            if not isinstance(record.get("task"), dict):
                raise OutboxError(f"Outbox executing record missing task: {name}")
        else:
            if not isinstance(record.get("result"), dict):
                raise OutboxError(f"Outbox result record missing result body: {name}")
        return record

    def _load_path(self, path: Path) -> dict[str, Any]:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        try:
            fd = os.open(path, flags)
        except OSError as exc:
            raise OutboxError(f"Outbox record must be a regular non-symlink file: {path.name}") from exc
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise OutboxError(f"Outbox record must be a regular file: {path.name}")
            if os.name != "nt":
                if info.st_uid != os.getuid():
                    raise OutboxError(f"Outbox record owner is not the current user: {path.name}")
                if stat.S_IMODE(info.st_mode) & 0o077:
                    raise OutboxError(f"Outbox record must be 0600 or stricter: {path.name}")
            if info.st_size > RECORD_LIMIT_BYTES:
                raise OutboxError(f"Outbox record exceeds {RECORD_LIMIT_BYTES} bytes: {path.name}")
            with os.fdopen(fd, "r", encoding="utf-8") as handle:
                fd = -1
                record = json.loads(handle.read(RECORD_LIMIT_BYTES + 1))
        except ValueError as exc:
            raise OutboxError(f"Outbox record is not valid JSON: {path.name}") from exc
        finally:
            if fd >= 0:
                os.close(fd)
        return self._validate_record(record, path.name)

    def load_records(self) -> list[dict[str, Any]]:
        self._ensure_dir()
        records: list[dict[str, Any]] = []
        for path in sorted(self.path.iterdir()):
            if path.name == "worker.lock":
                continue
            if path.is_symlink() or path.suffix != ".json":
                raise OutboxError(f"Unexpected outbox entry: {path.name}")
            records.append(self._load_path(path))
        return records

    def status(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        safe_records: list[dict[str, Any]] = []
        for record in self.load_records():
            state = str(record.get("state", "unknown"))
            counts[state] = counts.get(state, 0) + 1
            safe_records.append({
                "record_id": record.get("record_id"),
                "state": state,
                "server": record.get("server"),
                "device_id": record.get("device_id"),
                "workspace_id": record.get("workspace_id"),
                "run_id": record.get("run_id"),
                "node_id": record.get("node_id"),
                "attempts": int(record.get("attempts", 0) or 0),
                "last_status": record.get("last_status"),
                "last_error": record.get("last_error"),
                "updated_at": record.get("updated_at"),
            })
        return {"ok": True, "outbox_dir": str(self.path), "counts": counts, "records": safe_records}

    def pending_records(self) -> list[dict[str, Any]]:
        pending = [record for record in self.load_records() if record.get("state") == "pending"]
        return sorted(pending, key=lambda record: (
            0 if record.get("kind") == "output" else 1 if record.get("kind") == "stop" else 2,
            record.get("result", {}).get("events", [{}])[0].get("source_seq", 0), record["created_at"]))

    def executing_records(self) -> list[dict[str, Any]]:
        return [record for record in self.load_records() if record.get("state") == "executing"]

    def has_quarantined(self) -> bool:
        return any(record.get("state") == "quarantined" for record in self.load_records())

    def validate_record_binding(self, record: dict[str, Any]) -> bool:
        return (
            record.get("server") == self.credential.get("server")
            and record.get("device_id") == self.credential.get("device_id")
            and record.get("workspace_id") == self.credential.get("workspace_id")
            and record.get("credential_generation_hash") == self.binding
        )

    def journal_claim(self, task: dict[str, Any], *, claim_idempotency_key: str) -> dict[str, Any]:
        record = {
            "schema_version": OUTBOX_VERSION,
            "record_id": uuid.uuid4().hex + ".json",
            "state": "executing",
            "server": self.credential["server"],
            "device_id": self.credential["device_id"],
            "workspace_id": task["workspace_id"],
            "credential_generation_hash": self.binding,
            "claim_idempotency_key": claim_idempotency_key,
            "run_id": task["run_id"],
            "owner": task["owner"],
            "node_id": task["node"]["id"],
            "result_idempotency_key": f"result:{task['owner']}:{task['node']['id']}",
            "task": task,
            "created_at": time.time(),
            "updated_at": time.time(),
            "attempts": 0,
        }
        self.save(record)
        return record

    def save_result(self, record: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
        updated = {**record, "state": "pending", "result": result, "updated_at": time.time(),
                   "terminal_source_seq": self.last_source_seq(record)}
        self.save(updated)
        return updated

    def assignment_output_records(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        attempt = record.get("task", {}).get("attempt", record.get("attempt", 1))
        return [entry for entry in self.load_records() if entry.get("kind") == "output"
                and all(entry.get(key) == record.get(key) for key in ("run_id", "owner", "node_id", "credential_generation_hash"))
                and entry.get("attempt", 1) == attempt]

    def last_source_seq(self, record: dict[str, Any]) -> int:
        return max((event["source_seq"] for entry in self.assignment_output_records(record)
                    for event in entry["result"]["events"]), default=0)

    def save_events(self, record: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
        from .run_output import sanitize_text
        safe = [{**event, "text": sanitize_text(event.get("text", ""), known_secrets=(self.credential.get("credential"),))} for event in events]
        key = f"events:{record['owner']}:{events[0]['source_seq']}"
        result = self._technical_record(record, "output", {"events": safe}, key)
        self.save(result)
        return result

    def save_stop(self, record: dict[str, Any], request_id: str, result: dict[str, Any]) -> dict[str, Any]:
        evidence = {key: result[key] for key in ("process_tree_stopped", "wait_completed", "output_eof", "exit_code", "backend") if key in result}
        receipt = self._technical_record(record, "stop", {"request_id": request_id, "evidence": evidence,
            "final_source_seq": result.get("_last_source_seq", record.get("terminal_source_seq", self.last_source_seq(record)))}, "stop:" + request_id)
        path = self._record_path(receipt["record_id"])
        if path.exists():
            existing = self._load_path(path)
            if any(existing.get(key) != receipt.get(key) for key in ("run_id", "owner", "node_id", "attempt", "result", "credential_generation_hash")):
                raise OutboxError("Stop receipt conflicts with the original durable assignment evidence")
            return existing
        self.save(receipt)
        return receipt

    def _technical_record(self, record, kind, result, key):
        keep = ("schema_version", "server", "device_id", "workspace_id", "credential_generation_hash", "claim_idempotency_key",
                "run_id", "owner", "node_id")
        body = {name: record[name] for name in keep}
        body.update(record_id=hashlib.sha256(key.encode()).hexdigest() + ".json", kind=kind, state="pending", result=result,
                    attempt=record.get("task", {}).get("attempt", 1), result_idempotency_key=key,
                    created_at=time.time(), updated_at=time.time(), attempts=0)
        return body

    def acknowledge(self, record: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
        updated = dict(record)
        updated.update({
            "state": "acknowledged",
            "acknowledged_at": time.time(),
            "updated_at": time.time(),
            "last_status": 200,
            "ack": {
                "run_id": (response.get("items") or [{}])[0].get("id") if isinstance(response, dict) else None,
                "summary": response.get("summary", {}) if isinstance(response, dict) else {},
            },
        })
        self.save(updated)
        return updated

    def mark_retryable(self, record: dict[str, Any], message: str, status_code: int | None = None) -> dict[str, Any]:
        updated = {
            **record,
            "state": "pending",
            "attempts": int(record.get("attempts", 0) or 0) + 1,
            "last_error": self._safe_error(message),
            "last_status": status_code,
            "updated_at": time.time(),
        }
        self.save(updated)
        return updated

    def quarantine(self, record: dict[str, Any], message: str, status_code: int | None = None) -> dict[str, Any]:
        updated = {**record, "state": "quarantined", "last_error": self._safe_error(message),
                   "last_status": status_code, "updated_at": time.time()}
        self.save(updated)
        return updated

    def save(self, record: dict[str, Any]) -> None:
        self._ensure_dir()
        path = self._record_path(str(record["record_id"]))
        tmp = self.path / (path.name + f".{os.getpid()}.tmp")
        serialized = json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n"
        if len(serialized.encode("utf-8")) > RECORD_LIMIT_BYTES:
            raise OutboxError(f"Outbox record exceeds {RECORD_LIMIT_BYTES} bytes: {path.name}")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(tmp, flags, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                fd = -1
                handle.write(serialized)
                handle.flush()
                os.fsync(handle.fileno())
            if os.name != "nt":
                os.chmod(tmp, 0o600)
            os.replace(tmp, path)
            if os.name != "nt":
                dir_fd = os.open(self.path, os.O_RDONLY)
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
        finally:
            if fd >= 0:
                os.close(fd)
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
