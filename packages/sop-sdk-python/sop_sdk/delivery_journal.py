"""Durable immutable originals and verified receipts, with atomic CAS and OS locks.

This is a local command journal, not a credential store or an automatic runner.
Keep its directory private to the current OS user; hashes detect damage, not a
malicious writer who already controls that user's files.
"""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import re
import stat
import uuid

from .delivery_ack import canonical, command_original, digest, strict_json, validate_ack, validate_binding

MAX_RECORD_BYTES = 512 * 1024
MAX_RECORDS = 1000
SCOPE_KEYS = {"endpoint", "actor_id", "tenant_id", "project_id", "tenant_code", "business_code", "project_code"}


class DeliveryJournalError(ValueError):
    """Journal unavailable, damaged, concurrently held or changed since review."""


def _safe_stat(value, *, directory=False):
    if (stat.S_ISLNK(value.st_mode) or getattr(value, "st_file_attributes", 0) & 0x400
            or not (stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode))
            or not directory and value.st_nlink != 1):
        raise DeliveryJournalError("Journal paths must be real private directories and single-link regular files")


def _identity(value):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{32}", value) is None:
        raise DeliveryJournalError("Use the exact saved operation identity")
    return value


def _scope(value):
    if (not isinstance(value, dict) or set(value) != SCOPE_KEYS
            or any(not isinstance(v, str) or not v or len(v) > 2048 or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in v) for v in value.values())):
        raise DeliveryJournalError("Retain the complete server and authenticated actor scope")


def _source(record):
    return {key: record[key] for key in ("scope", "original", "binding")}


def _seal(record):
    record = {k: v for k, v in record.items() if k != "record_digest"}
    return {**record, "record_digest": digest(record)}


def _validate(record):
    try:
        required = {"schema", "id", "revision", "state", "active", "scope", "original", "binding", "original_digest", "ack", "error", "record_digest"}
        if not isinstance(record, dict) or set(record) != required or record["schema"] != 1:
            raise ValueError("Invalid journal record")
        _identity(record["id"]); _scope(record["scope"])
        if type(record["schema"]) is not int or type(record["revision"]) is not int or record["revision"] < 1 or type(record["active"]) is not bool:
            raise ValueError("Invalid journal revision")
        if record["state"] not in {"prepared", "unknown", "confirmed", "refused", "cancelled"}: raise ValueError("Invalid journal phase")
        body = command_original(record["original"]); validate_binding(body, record["binding"])
        if record["original_digest"] != digest(_source(record)) or record["record_digest"] != digest({k: v for k, v in record.items() if k != "record_digest"}):
            raise ValueError("Journal source digest changed")
        if record["state"] == "confirmed":
            validate_ack(body, record["ack"], project_id=record["scope"]["project_id"], binding=record["binding"])
        elif record["ack"] is not None: raise ValueError("Unconfirmed operation contains a receipt")
        if record["state"] in {"prepared", "unknown"} and not record["active"]: raise ValueError("Unresolved originals must remain active")
        if record["state"] in {"refused", "cancelled"} and record["active"]: raise ValueError("Closed local operations must not occupy an active slot")
        if record["error"] is not None:
            error = record["error"]
            if (not isinstance(error, dict) or set(error) != {"code", "status"} or error["code"] not in {"unconfirmed", "refused"}
                    or error["status"] is not None and (type(error["status"]) is not int or not 100 <= error["status"] <= 599)):
                raise ValueError("Journal diagnostics must not contain raw server details")
        canonical(record, MAX_RECORD_BYTES)
        return record
    except (ValueError, KeyError, TypeError, RecursionError) as exc:
        raise DeliveryJournalError("Saved operation failed its complete original/receipt integrity check") from exc


class DeliveryJournal:
    """A directory of retained JSON receipts; no operation overwrites an original."""

    def __init__(self, directory):
        raw = Path(os.path.abspath(os.fspath(directory)))
        # Do not resolve symlinks: resolving would erase the evidence of a link.
        for part in [*reversed(raw.parents), raw]:
            if not part.exists() and not part.is_symlink():
                try: part.mkdir(mode=0o700)
                except FileExistsError: pass
            _safe_stat(part.lstat(), directory=True)
        self.directory = raw
        info = raw.lstat()
        self._root_identity = (info.st_dev, info.st_ino)

    @contextmanager
    def transaction(self):
        """Hold a short journal transaction for slot admission and atomic CAS."""
        with _Root(self) as root, _file_lock(root, ".operations.lock"):
            yield _Transaction(root)

    @contextmanager
    def operation_lock(self, operation_id):
        """Only this original is held during HTTP; other tasks remain independent."""
        with _Root(self) as root, _file_lock(root, ".operation-" + _identity(operation_id) + ".lock"):
            yield

    def inspect(self, operation_id):
        with self.transaction() as tx: return tx.inspect(operation_id)

    def list(self, *, include_closed=False, limit=20, after=""):
        """Bounded local summaries only; retained payloads are reviewed by inspect."""
        if type(include_closed) is not bool or type(limit) is not int or not 1 <= limit <= 100 or not isinstance(after, str):
            raise DeliveryJournalError("Choose a local summary page size between 1 and 100")
        if after: _identity(after)
        with self.transaction() as tx:
            items = []
            for name in sorted(tx.root.names()):
                if name[:-5] <= after: continue
                record = tx.inspect(name[:-5])
                if not include_closed and not record["active"]: continue
                items.append({"id": record["id"], "action": record["original"]["action"], "task_id": record["binding"]["task_id"],
                    "state": record["state"], "active": record["active"]})
                if len(items) > limit: break
            return {"items": items[:limit], "next_cursor": items[limit - 1]["id"] if len(items) > limit else None}

    def update(self, operation_id, revision, **changes):
        with self.transaction() as tx: return tx.update(operation_id, revision, **changes)

    def finish(self, operation_id):
        with self.transaction() as tx:
            record = tx.inspect(operation_id)
            if record["state"] != "confirmed": raise DeliveryJournalError("Only a verified confirmed receipt can close the local active operation")
            if not record["active"]: return record
            return tx.update(operation_id, record["revision"], active=False)

    def discard(self, operation_id):
        """Cancel only a never-sent prepared draft, retaining its complete source."""
        with self.transaction() as tx:
            record = tx.inspect(operation_id)
            if record["state"] != "prepared": raise DeliveryJournalError("Only a never-sent prepared original can be discarded; unknown operations must resume")
            return tx.update(operation_id, record["revision"], state="cancelled", active=False)


@contextmanager
def _file_lock(root, name):
    lock = root.open(name, os.O_RDWR | os.O_CREAT)
    held = False
    try:
        if os.fstat(lock).st_size == 0:
            os.write(lock, b"0"); os.fsync(lock)
        os.lseek(lock, 0, os.SEEK_SET)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            held = True
        except OSError as exc:
            raise DeliveryJournalError("Another process is using this journal operation; retain the original and retry later") from exc
        root.check()
        yield
    finally:
        if held:
            if os.name == "nt":
                import msvcrt
                os.lseek(lock, 0, os.SEEK_SET); msvcrt.locking(lock, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_UN)
        os.close(lock)


class _Root:
    def __init__(self, journal):
        self.journal, self.fd, self.handles = journal, None, []

    def check(self):
        for part in [*reversed(self.journal.directory.parents), self.journal.directory]:
            _safe_stat(part.lstat(), directory=True)
        info = self.journal.directory.lstat()
        if (info.st_dev, info.st_ino) != self.journal._root_identity:
            raise DeliveryJournalError("Journal directory changed; do not follow its replacement")

    def __enter__(self):
        self.check()
        try:
            if os.name == "nt":
                # Deny rename/delete on each ancestor while using absolute paths.
                # OPEN_REPARSE_POINT + lstat rejects junctions and directory links.
                import ctypes
                from ctypes import wintypes
                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                self._close = kernel.CloseHandle
                self._close.argtypes = [wintypes.HANDLE]; self._close.restype = wintypes.BOOL
                create = kernel.CreateFileW
                create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
                create.restype = wintypes.HANDLE
                for part in [*reversed(self.journal.directory.parents), self.journal.directory]:
                    handle = create(str(part), 0, 3, None, 3, 0x02200000, None)
                    if handle == ctypes.c_void_p(-1).value: raise DeliveryJournalError("Cannot pin the private journal directory")
                    self.handles.append(handle)
                    _safe_stat(part.lstat(), directory=True)
            else:
                self.fd = os.open(self.journal.directory, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
                info = os.fstat(self.fd)
                if (info.st_dev, info.st_ino) != self.journal._root_identity: raise DeliveryJournalError("Journal directory changed")
            self.check()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_args):
        if self.fd is not None: os.close(self.fd)
        for handle in reversed(self.handles): self._close(handle)

    def _args(self, name):
        return ((name,), {"dir_fd": self.fd}) if self.fd is not None else ((self.journal.directory / name,), {})

    def open(self, name, flags):
        self.check()
        args, kwargs = self._args(name)
        # On Windows open the reparse point itself before CRT conversion. This
        # also denies deletion/replacement while a record or lock handle is open.
        if os.name == "nt":
            import ctypes
            import msvcrt
            from ctypes import wintypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            create = kernel.CreateFileW
            create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
            create.restype = wintypes.HANDLE
            disposition = 1 if flags & os.O_EXCL else 4 if flags & os.O_CREAT else 3
            access = 0x80000000 | (0x40000000 if flags & (os.O_RDWR | os.O_WRONLY) else 0)
            handle = create(str(args[0]), access, 3, None, disposition, 0x00200000, None)
            if handle == ctypes.c_void_p(-1).value: raise DeliveryJournalError("Cannot safely open the private journal file")
            try: fd = msvcrt.open_osfhandle(handle, flags & (os.O_RDWR | os.O_WRONLY) | os.O_BINARY)
            except BaseException:
                self._close(handle); raise
        else:
            fd = os.open(*args, flags | getattr(os, "O_NOFOLLOW", 0), 0o600, **kwargs)
        try:
            opened = os.fstat(fd)
            _safe_stat(opened)
            # fstat alone on Windows can obscure a reparse point's path type.
            # Validate the path itself and its identity against the held handle.
            info = os.stat(*args, follow_symlinks=False, **kwargs)
            _safe_stat(info)
            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                raise DeliveryJournalError("Journal file changed while it was opened")
            self.check()
            return fd
        except BaseException:
            os.close(fd); raise

    def read(self, name):
        fd = self.open(name, os.O_RDONLY)
        try:
            info = os.fstat(fd)
            if info.st_size > MAX_RECORD_BYTES: raise DeliveryJournalError("Journal record exceeds its full source budget")
            chunks, remaining = [], MAX_RECORD_BYTES + 1
            while remaining:
                block = os.read(fd, min(65536, remaining))
                if not block: break
                chunks.append(block); remaining -= len(block)
            return strict_json(b"".join(chunks), MAX_RECORD_BYTES)
        finally: os.close(fd)

    def names(self):
        records = []
        with os.scandir(self.fd if self.fd is not None else self.journal.directory) as entries:
            for count, entry in enumerate(entries, 1):
                if count > MAX_RECORDS * 2 + 100: raise DeliveryJournalError("Private journal directory exceeds its bounded entry budget")
                if entry.name.endswith(".json"): records.append(entry.name)
                if len(records) > MAX_RECORDS: raise DeliveryJournalError("Journal retention budget reached; choose a separate private journal")
        if any(re.fullmatch(r"[0-9a-f]{32}\.json", name) is None for name in records):
            raise DeliveryJournalError("Unexpected record file in the private journal")
        return records

    def write(self, record, *, existing):
        name = record["id"] + ".json"
        temporary = ".pending-" + uuid.uuid4().hex
        try:
            fd = self.open(temporary, os.O_RDWR | os.O_CREAT | os.O_EXCL)
            try:
                raw = canonical(record, MAX_RECORD_BYTES)
                view = memoryview(raw)
                while view:
                    size = os.write(fd, view)
                    if not size: raise DeliveryJournalError("Cannot persist the complete original")
                    view = view[size:]
                os.fsync(fd)
            finally: os.close(fd)
            self.check()
            if existing:
                # Re-read immediately before replace to enforce source + revision CAS.
                current = _validate(self.read(name))
                if current["revision"] != record["revision"] - 1 or current["original_digest"] != record["original_digest"]:
                    raise DeliveryJournalError("Journal changed since this operation was reviewed")
                if self.fd is None: self._move_windows(temporary, name, replace=True)
                else: os.replace(temporary, name, src_dir_fd=self.fd, dst_dir_fd=self.fd)
            else:
                # Windows MOVEFILE_WRITE_THROUGH without REPLACE_EXISTING and
                # POSIX link are atomic no-overwrite admission of a new original.
                if self.fd is None: self._move_windows(temporary, name, replace=False)
                else: os.link(temporary, name, src_dir_fd=self.fd, dst_dir_fd=self.fd, follow_symlinks=False)
            if self.fd is not None: os.fsync(self.fd)
        finally:
            args, kwargs = self._args(temporary)
            try: os.unlink(*args, **kwargs)
            except FileNotFoundError: pass  # The atomic move already consumed it.
            if self.fd is not None: os.fsync(self.fd)

    def _move_windows(self, temporary, name, *, replace):
        import ctypes
        from ctypes import wintypes
        move = ctypes.WinDLL("kernel32", use_last_error=True).MoveFileExW
        move.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
        move.restype = wintypes.BOOL
        if not move(str(self.journal.directory / temporary), str(self.journal.directory / name), 8 | (1 if replace else 0)):
            raise DeliveryJournalError("Cannot atomically persist the complete journal original/receipt")


class _Transaction:
    def __init__(self, root): self.root = root

    def inspect(self, operation_id):
        operation_id = _identity(operation_id)
        try:
            value = _validate(self.root.read(operation_id + ".json"))
            if value["id"] != operation_id: raise DeliveryJournalError("Journal filename does not identify this original")
            return value
        except (OSError, ValueError) as exc:
            if isinstance(exc, DeliveryJournalError): raise
            raise DeliveryJournalError("The exact saved operation is unavailable or damaged") from exc

    def create(self, scope, original, binding):
        _scope(scope); original = command_original(original); validate_binding(original, binding)
        source = strict_json(canonical({"scope": scope, "original": original, "binding": binding}))
        names = self.root.names()
        if len(names) >= MAX_RECORDS: raise DeliveryJournalError("Journal retention budget reached")
        for name in names:
            prior = self.inspect(name[:-5])
            same_owner = all(prior["scope"][field] == scope[field] for field in ("endpoint", "actor_id", "project_id"))
            if prior["active"] and same_owner and prior["binding"]["task_id"] == binding["task_id"]:
                raise DeliveryJournalError("This task already has an active saved original; inspect and finish it before preparing another")
        record = _seal({"schema": 1, "id": uuid.uuid4().hex, "revision": 1, "state": "prepared", "active": True,
            **source, "original_digest": digest(source), "ack": None, "error": None})
        _validate(record)
        self.root.write(record, existing=False)
        return record

    def update(self, operation_id, revision, **changes):
        record = self.inspect(operation_id)
        if type(revision) is not int or record["revision"] != revision: raise DeliveryJournalError("Journal revision changed; inspect the retained original")
        if set(changes) - {"state", "ack", "error", "active"}: raise DeliveryJournalError("A saved original and scope are immutable")
        target = changes.get("state", record["state"])
        allowed = {"prepared": {"prepared", "unknown", "cancelled"}, "unknown": {"unknown", "confirmed", "refused"}, "confirmed": {"confirmed"}, "refused": {"refused"}, "cancelled": {"cancelled"}}
        if target not in allowed[record["state"]]: raise DeliveryJournalError("Invalid saved operation transition")
        next_record = _seal({**record, **changes, "revision": revision + 1})
        _validate(next_record)
        self.root.write(next_record, existing=True)
        return next_record
