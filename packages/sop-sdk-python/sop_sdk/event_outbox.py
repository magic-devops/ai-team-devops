"""Single project SQLite event repository, shared with agentd. Acknowledged rows stay retained."""

from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
import struct
import time
from contextlib import contextmanager
from importlib.resources import files
from pathlib import Path
from typing import Any

from .event_envelope import (
    DurableReceipt,
    EventIdentity,
    EventProtocolError,
    FrozenEvent,
    integer,
    matching_receipts,
    strict_json,
    text_field,
)

_SCHEMA = files("sop_sdk").joinpath("event_outbox_v1.sql").read_text(encoding="utf-8")
_SCOPE = ("expected_tenant_id", "expected_project_id", "expected_producer_id", "manager_origin")
_PAYLOAD = {"event_json", "remote_receipt_json"}
_LEGACY_COLUMNS = {"id", "type", "subject", "payload", "retries", "next_at", "created_at"}


class QueueError(ValueError):
    def __init__(self, code: str, message: str = ""):
        self.code = code
        super().__init__(f"{code}: {message}")


def _now():
    return time.time_ns() // 1_000_000


def _result(row, replayed=False):
    return {key: row[key] for key in ("id", "digest", "state", "revision")} | {"replayed": replayed}


def _dict(row):
    value = dict(row)
    if value.get("last_error_retryable") is not None:
        value["last_error_retryable"] = bool(value["last_error_retryable"])
    return value


def _initialize(db):
    # executescript would implicitly commit; individual complete statements preserve atomic creation/migration.
    statement = ""
    for line in _SCHEMA.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            db.execute(statement)
            statement = ""
    db.execute("PRAGMA user_version=1")


def _legacy_empty(db):
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if tables - {"events"}:
        raise QueueError("migration_required", "unknown legacy tables")
    if "events" in tables:
        if {row[1] for row in db.execute("PRAGMA table_info(events)")} != _LEGACY_COLUMNS:
            raise QueueError("migration_required", "unknown legacy schema")
        if db.execute("SELECT 1 FROM events LIMIT 1").fetchone():
            raise QueueError("migration_required", "nonempty legacy queue needs an explicitly chosen project")
    return "events" in tables


def _schema_snapshot(db):
    db.execute("BEGIN")
    try:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1):
            raise QueueError("migration_required", "unknown schema version")
        if version == 0:
            _legacy_empty(db)
        return version
    finally:
        db.execute("ROLLBACK")


def _enable_wal(db):
    # SQLite can reject a competing journal-mode change without invoking its busy handler.
    deadline = time.monotonic() + 5
    while True:
        try:
            mode = db.execute("PRAGMA journal_mode=WAL").fetchone()[0]
            if mode.lower() != "wal":
                raise QueueError("storage_unavailable", "durable file WAL is required")
            return
        except sqlite3.OperationalError as exc:
            code = getattr(exc, "sqlite_errorcode", 0) & 255
            if code not in {sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED} or time.monotonic() >= deadline:
                raise
            time.sleep(0.01)


class EventOutbox:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        try:
            version = _schema_snapshot(self.db)
            _enable_wal(self.db)
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.execute("PRAGMA foreign_keys=ON")
            self.db.execute("PRAGMA busy_timeout=5000")
            if version == 0:
                with self._write():
                    # A second Go/Python opener may have initialized while this process waited.
                    current = self.db.execute("PRAGMA user_version").fetchone()[0]
                    if current == 0:
                        if _legacy_empty(self.db):
                            self.db.execute("DROP TABLE events")
                        _initialize(self.db)
                    elif current != 1:
                        raise QueueError("migration_required", "schema changed during open")
        except BaseException:
            self.db.close()
            raise

    def close(self):
        self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    @contextmanager
    def _write(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def _bump(self):
        self._update("UPDATE queue_meta SET generation=generation+1 WHERE singleton=1", ())

    def _update(self, sql, values):
        if self.db.execute(sql, values).rowcount != 1:
            raise QueueError("revision_conflict", "event update was not applied")

    def inspect(self, event_id: str) -> dict[str, Any]:
        text_field(event_id, "id")
        row = self.db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if row is None:
            raise QueueError("event_not_found")
        return _dict(row)

    def _pending(self, event_id, revision):
        integer(revision, "expected_revision", 1)
        row = self.inspect(event_id)
        if row["revision"] != revision:
            raise QueueError("revision_conflict")
        if row["state"] != "pending":
            raise QueueError("invalid_state")
        return row

    def enqueue(self, event: FrozenEvent, intended_project_id: str) -> dict[str, Any]:
        if not isinstance(event, FrozenEvent):
            raise EventProtocolError("frozen event required")
        text_field(intended_project_id, "intended_project_id", maximum=64)
        parsed = FrozenEvent._parse(event.event_json)
        with self._write():
            original = self.db.execute("SELECT * FROM events WHERE id=?", (event.id,)).fetchone()
            if original is not None:
                if (
                    original["event_json"] != event.event_json
                    or original["digest"] != event.digest
                    or original["intended_project_id"] != intended_project_id
                ):
                    raise QueueError("event_id_conflict")
                return _result(original, True)
            now = _now()
            self._update(
                """INSERT INTO events(id,type,subject,event_json,digest,intended_project_id,
                binding_state,state,revision,attempts,next_at_ms,created_at_ms,updated_at_ms)
                VALUES(?,?,?,?,?,?,'unbound','pending',1,0,?,?,?)""",
                (
                    event.id,
                    parsed["type"],
                    parsed["subject"],
                    event.event_json,
                    event.digest,
                    intended_project_id,
                    now,
                    now,
                    now,
                ),
            )
            self._bump()
            return _result(self.inspect(event.id))

    def bind(self, event_id: str, revision: int, identity: EventIdentity) -> dict[str, Any]:
        with self._write():
            row = self.inspect(event_id)
            if row["intended_project_id"] != identity.project_id:
                raise QueueError("scope_mismatch")
            values = (identity.tenant_id, identity.project_id, identity.producer_id, identity.manager_origin)
            if row["binding_state"] == "bound":
                if tuple(row[key] for key in _SCOPE) != values:
                    raise QueueError("scope_mismatch")
                return _result(row, True)
            self._pending(event_id, revision)
            self._update(
                """UPDATE events SET binding_state='bound',expected_tenant_id=?,expected_project_id=?,
                expected_producer_id=?,manager_origin=?,revision=revision+1,updated_at_ms=? WHERE id=? AND revision=?""",
                (*values, _now(), event_id, revision),
            )
            self._bump()
            return _result(self.inspect(event_id))

    def pending_batch(self, limit=20):
        integer(limit, "limit", 1, 50)
        return [
            _dict(row)
            for row in self.db.execute(
                "SELECT * FROM events WHERE state='pending' AND next_at_ms<=? ORDER BY next_at_ms,created_at_ms,id LIMIT ?",
                (_now(), limit),
            )
        ]

    def fail(self, event_id, revision, code, message, *, retryable=True, max_attempts=4):
        integer(max_attempts, "max_attempts", 1, 1000)
        if type(retryable) is not bool:
            raise EventProtocolError("retryable must be boolean")
        with self._write():
            row = self._pending(event_id, revision)
            now = _now()
            attempts = row["attempts"] + 1
            state = "dead_letter" if not retryable or attempts >= max_attempts else "pending"
            self._update(
                """UPDATE events SET state=?,revision=revision+1,attempts=?,next_at_ms=?,updated_at_ms=?,
                last_attempt_at_ms=?,last_error_code=?,last_error_message=?,last_error_retryable=?,dead_at_ms=?
                WHERE id=? AND revision=? AND state='pending'""",
                (
                    state,
                    attempts,
                    now + min(300_000, (2 ** min(attempts, 9)) * 1000),
                    now,
                    now,
                    str(code)[:128],
                    str(message)[:1000],
                    int(retryable),
                    now if state == "dead_letter" else None,
                    event_id,
                    revision,
                ),
            )
            self._bump()
            return _result(self.inspect(event_id))

    def ack(self, event_id: str, revision: int, receipt: DurableReceipt):
        if not isinstance(receipt, DurableReceipt):
            raise EventProtocolError("verified receipt required")
        with self._write():
            row = self._pending(event_id, revision)
            actual = (
                receipt.identity.tenant_id,
                receipt.identity.project_id,
                receipt.identity.producer_id,
                receipt.identity.manager_origin,
            )
            if row["binding_state"] != "bound" or tuple(row[key] for key in _SCOPE) != actual:
                raise QueueError("scope_mismatch")
            if receipt.id != row["id"] or receipt.digest != row["digest"]:
                raise EventProtocolError("receipt identity/digest mismatch")
            text_field(receipt.result_json, "receipt proof", 2, 65536)
            proof = matching_receipts(
                [FrozenEvent(row["id"], row["event_json"], row["digest"])],
                {
                    "tenant_id": receipt.identity.tenant_id,
                    "project_id": receipt.identity.project_id,
                    "producer": {"kind": "user", "id": receipt.identity.producer_id},
                    "as_of": receipt.stored_at,
                    "results": [strict_json(receipt.result_json)],
                },
                receipt.identity,
            ).get(event_id)
            if proof is None or any(
                getattr(proof, key) != getattr(receipt, key)
                for key in ("id", "digest", "receipt_id", "outcome", "stored_at", "processing_state")
            ):
                raise EventProtocolError("receipt metadata does not match its durable proof")
            now = _now()
            self._update(
                """UPDATE events SET state='acked',revision=revision+1,updated_at_ms=?,receipt_id=?,receipt_outcome=?,
                remote_stored_at=?,processing_state=?,remote_receipt_json=?,acked_at_ms=? WHERE id=? AND revision=? AND state='pending'""",
                (
                    now,
                    receipt.receipt_id,
                    receipt.outcome,
                    receipt.stored_at,
                    receipt.processing_state,
                    receipt.result_json,
                    now,
                    event_id,
                    revision,
                ),
            )
            self._bump()
            return _result(self.inspect(event_id))

    def requeue(self, event_id: str, expected_revision: int, reason: str, idempotency_key: str):
        text_field(event_id, "id")
        integer(expected_revision, "expected_revision", 1)
        text_field(reason, "reason", 1, 2000)
        text_field(idempotency_key, "idempotency_key")
        if not reason.strip():
            raise EventProtocolError("reason must not be blank")

        def frame(value):
            raw = value.encode("utf-8")
            return struct.pack(">I", len(raw)) + raw

        fingerprint = hashlib.sha256(
            b"sop-outbox-requeue-v1\0"
            + frame(event_id)
            + struct.pack(">q", expected_revision)
            + frame(reason)
        ).hexdigest()
        request = {"id": event_id, "expected_revision": expected_revision, "reason": reason}
        with self._write():
            old = self.db.execute(
                "SELECT request_digest,result_json FROM queue_receipts WHERE operation='requeue' AND idempotency_key=?",
                (idempotency_key,),
            ).fetchone()
            if old:
                if old["request_digest"] != fingerprint:
                    raise QueueError("idempotency_conflict")
                return strict_json(old["result_json"]) | {"replayed": True}
            row = self.inspect(event_id)
            if row["revision"] != expected_revision:
                raise QueueError("revision_conflict")
            if row["state"] != "dead_letter" or row["last_error_retryable"] is not True:
                raise QueueError("invalid_state")
            self._update(
                """UPDATE events SET state='pending',revision=revision+1,attempts=0,next_at_ms=?,updated_at_ms=?,
                last_attempt_at_ms=NULL,last_error_code=NULL,last_error_message=NULL,last_error_retryable=NULL,dead_at_ms=NULL
                WHERE id=? AND revision=? AND state='dead_letter'""",
                (_now(), _now(), event_id, expected_revision),
            )
            result = _result(self.inspect(event_id))
            self._update(
                """INSERT INTO queue_receipts(operation,idempotency_key,event_id,request_json,request_digest,result_json,created_at_ms)
                VALUES('requeue',?,?,?,?,?,?)""",
                (
                    idempotency_key,
                    event_id,
                    json.dumps(request, ensure_ascii=False),
                    fingerprint,
                    json.dumps(result),
                    _now(),
                ),
            )
            self._bump()
            return result

    def stats(self):
        self.db.execute("BEGIN")
        try:
            meta = dict(
                self.db.execute("SELECT queue_id,generation FROM queue_meta WHERE singleton=1").fetchone()
            )
            counts = dict(self.db.execute("SELECT state,count(*) FROM events GROUP BY state"))
            meta.update({key: counts.get(key, 0) for key in ("pending", "dead_letter", "acked")})
            meta["due"] = self.db.execute(
                "SELECT count(*) FROM events WHERE state='pending' AND next_at_ms<=?", (_now(),)
            ).fetchone()[0]
            meta["oldest_pending_at_ms"] = self.db.execute(
                "SELECT min(created_at_ms) FROM events WHERE state='pending'"
            ).fetchone()[0]
            meta["last_ack_at_ms"] = self.db.execute("SELECT max(acked_at_ms) FROM events").fetchone()[0]
            last = self.db.execute(
                "SELECT id,last_error_code,last_error_message,last_error_retryable,last_attempt_at_ms FROM events WHERE last_error_code IS NOT NULL ORDER BY last_attempt_at_ms DESC,id DESC LIMIT 1"
            ).fetchone()
            meta["last_error"] = (
                None
                if last is None
                else {
                    "id": last[0],
                    "code": last[1],
                    "message": last[2],
                    "retryable": bool(last[3]),
                    "at_ms": last[4],
                }
            )
            return meta
        finally:
            self.db.execute("ROLLBACK")

    def list(self, *, state="all", limit=20, cursor=""):
        integer(limit, "limit", 1, 50)
        if state not in {"all", "pending", "dead_letter", "acked"}:
            raise QueueError("payload_invalid", "invalid state")
        self.db.execute("BEGIN")
        try:
            meta = dict(
                self.db.execute("SELECT queue_id,generation FROM queue_meta WHERE singleton=1").fetchone()
            )
            where, values = ("1=1", []) if state == "all" else ("state=?", [state])
            total = self.db.execute(f"SELECT count(*) FROM events WHERE {where}", values).fetchone()[0]  # noqa: S608 -- where uses only fixed SQL fragments; values are parameters.
            if cursor:
                try:
                    if not isinstance(cursor, str) or len(cursor) > 4096:
                        raise ValueError()
                    raw = base64.b64decode(
                        cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True
                    ).decode("utf-8")
                    page = strict_json(raw)
                    if set(page) != {"v", "queue_id", "generation", "state", "limit", "created_at_ms", "id"}:
                        raise ValueError()
                    integer(page["v"], "v", 1, 1)
                    integer(page["generation"], "generation")
                    integer(page["limit"], "limit", 1, 50)
                    integer(page["created_at_ms"], "created_at_ms", -(2**63))
                    text_field(page["id"], "id")
                    if (
                        page["queue_id"] != meta["queue_id"]
                        or page["state"] != state
                        or page["limit"] != limit
                    ):
                        raise ValueError()
                except (ValueError, TypeError, KeyError, UnicodeError) as exc:
                    raise QueueError("cursor_invalid") from exc
                if page["generation"] != meta["generation"]:
                    raise QueueError("cursor_stale")
                where += " AND (created_at_ms>? OR (created_at_ms=? AND id>?))"
                values += [page["created_at_ms"], page["created_at_ms"], page["id"]]
            columns = [
                row[1] for row in self.db.execute("PRAGMA table_info(events)") if row[1] not in _PAYLOAD
            ]
            rows = [
                _dict(row)
                for row in self.db.execute(
                    f"SELECT {','.join(columns)} FROM events WHERE {where} ORDER BY created_at_ms,id LIMIT ?",  # noqa: S608 -- columns come from the fixed schema; cursor values are parameters.
                    (*values, limit + 1),
                )
            ]
            more, items = len(rows) > limit, rows[:limit]
            next_cursor = None
            if more:
                page = {
                    "v": 1,
                    **meta,
                    "state": state,
                    "limit": limit,
                    "created_at_ms": items[-1]["created_at_ms"],
                    "id": items[-1]["id"],
                }
                next_cursor = (
                    base64.urlsafe_b64encode(json.dumps(page, separators=(",", ":")).encode())
                    .decode()
                    .rstrip("=")
                )
            return {
                **meta,
                "items": items,
                "total": total,
                "limit": limit,
                "has_more": more,
                "next_cursor": next_cursor,
            }
        finally:
            self.db.execute("ROLLBACK")

    @classmethod
    def migrate_legacy(cls, path: Path | str, intended_project_id: str):
        text_field(intended_project_id, "intended_project_id", maximum=64)
        if not Path(path).is_file():
            raise QueueError("migration_required", "legacy database does not exist")
        db = sqlite3.connect(path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("PRAGMA user_version").fetchone()[0] != 0:
                raise QueueError("migration_required", "not a v0 queue")
            columns = {row[1] for row in db.execute("PRAGMA table_info(events)")}
            if columns != {"id", "type", "subject", "payload", "retries", "next_at", "created_at"}:
                raise QueueError("migration_required", "unknown v0 schema")
            db.execute("ALTER TABLE events RENAME TO legacy_events")
            _initialize(db)
            last, count, dead_count = None, 0, 0
            while True:
                rows = (
                    db.execute("SELECT rowid,* FROM legacy_events ORDER BY rowid LIMIT 256").fetchall()
                    if last is None
                    else db.execute(
                        "SELECT rowid,* FROM legacy_events WHERE rowid>? ORDER BY rowid LIMIT 256", (last,)
                    ).fetchall()
                )
                if not rows:
                    break
                for row in rows:
                    last = row["rowid"]
                    raw = row["payload"]
                    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
                    valid = True
                    try:
                        event = FrozenEvent.from_json(raw)
                        parsed = FrozenEvent._parse(raw)
                        valid = (
                            event.id == row["id"]
                            and parsed["type"] == row["type"]
                            and parsed["subject"] == row["subject"]
                        )
                    except EventProtocolError:
                        valid = False
                    next_at = integer(row["next_at"] * 1000, "legacy next_at", -(2**63))
                    created_at = integer(row["created_at"] * 1000, "legacy created_at", -(2**63))
                    db.execute(
                        """INSERT INTO events(id,type,subject,event_json,digest,intended_project_id,binding_state,state,revision,
                        attempts,next_at_ms,created_at_ms,updated_at_ms,last_error_code,last_error_message,last_error_retryable,dead_at_ms)
                        VALUES(?,?,?,?,?,?,'unbound',?,1,?,?,?,?,?,?,?,?)""",
                        (
                            row["id"],
                            row["type"],
                            row["subject"],
                            raw,
                            digest,
                            intended_project_id,
                            "pending" if valid else "dead_letter",
                            row["retries"],
                            next_at,
                            created_at,
                            _now(),
                            None if valid else "legacy_event_invalid",
                            None if valid else "Invalid original legacy envelope; inspect original bytes",
                            None if valid else 0,
                            None if valid else _now(),
                        ),
                    )
                    count += 1
                    dead_count += int(not valid)
            db.execute("DROP TABLE legacy_events")
            db.execute("UPDATE queue_meta SET generation=1 WHERE singleton=1")
            db.execute("COMMIT")
            return {"migrated": count, "dead_letter": dead_count}
        except BaseException:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise
        finally:
            db.close()
