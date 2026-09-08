from __future__ import annotations

import hashlib
import json
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import JSON, Column, Integer, MetaData, String, Table, Text, and_, create_engine, event, insert, select, update

from .models import CoreError, Principal


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


class Store:
    def __init__(self, url: str):
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30} if url.startswith("sqlite") else {})
        self.lock = threading.RLock()
        if url.startswith("sqlite"):
            @event.listens_for(self.engine, "connect")
            def configure(dbapi, _record):
                dbapi.execute("PRAGMA journal_mode=WAL")
                dbapi.execute("PRAGMA foreign_keys=ON")
        meta = MetaData()
        self.entities = Table("hermes_entities", meta,
            Column("id", String(64), primary_key=True), Column("kind", String(32), nullable=False, index=True),
            Column("tenant", String(128), nullable=False, index=True), Column("business", String(128), nullable=False),
            Column("workspace", String(64), nullable=False, index=True), Column("version", Integer, nullable=False),
            Column("status", String(40), nullable=False), Column("data", JSON, nullable=False),
            Column("created_at", String(40), nullable=False), Column("updated_at", String(40), nullable=False))
        self.events = Table("hermes_events", meta,
            Column("seq", Integer, primary_key=True, autoincrement=True), Column("entity_id", String(64), nullable=False, index=True),
            Column("tenant", String(128), nullable=False), Column("business", String(128), nullable=False),
            Column("workspace", String(64), nullable=False), Column("action", String(100), nullable=False),
            Column("actor", String(128), nullable=False), Column("trace_id", String(64), nullable=False),
            Column("version", Integer, nullable=False), Column("data", JSON, nullable=False), Column("created_at", String(40), nullable=False))
        self.receipts = Table("hermes_receipts", meta, Column("id", String(64), primary_key=True),
            Column("request_hash", String(64), nullable=False), Column("result", JSON, nullable=False), Column("created_at", String(40), nullable=False))
        meta.create_all(self.engine)

    @contextmanager
    def transaction(self):
        with self.lock, self.engine.connect() as conn:
            if self.engine.dialect.name == "sqlite":
                conn.exec_driver_sql("BEGIN IMMEDIATE")
            else:
                conn.begin()
            try:
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise

    def _scope(self, table, principal: Principal, workspace: str):
        return and_(table.c.tenant == principal.tenant, table.c.business == principal.business, table.c.workspace == workspace)

    def _get(self, conn, principal: Principal, workspace: str, kind: str, entity_id: str):
        row = conn.execute(select(self.entities).where(self._scope(self.entities, principal, workspace), self.entities.c.kind == kind, self.entities.c.id == entity_id).with_for_update()).mappings().first()
        if row is None:
            raise CoreError("not_found", "Resource not found in this workspace", 404)
        return dict(row)

    def get(self, principal: Principal, workspace: str, kind: str, entity_id: str):
        with self.engine.connect() as conn:
            return self._get(conn, principal, workspace, kind, entity_id)

    def list(self, principal: Principal, workspace: str, kind: str, *, status: str = "", q: str = "", kind_filter: str = "", limit: int = 100, cursor: str = ""):
        query = select(self.entities).where(self._scope(self.entities, principal, workspace), self.entities.c.kind == kind)
        if status:
            query = query.where(self.entities.c.status == status)
        if kind_filter:
            query = query.where(self.entities.c.data["kind"].as_string() == kind_filter)
        if cursor:
            query = query.where(self.entities.c.id > cursor)
        if q:
            query = query.where(self.entities.c.data.cast(Text).icontains(q, autoescape=True))
        with self.engine.connect() as conn:
            return [dict(row) for row in conn.execute(query.order_by(self.entities.c.id).limit(limit)).mappings()]

    def _receipt(self, conn, principal, workspace, operation, key, request):
        receipt_id = digest([principal.tenant, principal.business, workspace, principal.actor, operation, key])
        if self.engine.dialect.name == "postgresql":
            lock_id = int.from_bytes(bytes.fromhex(receipt_id[:16]), "big", signed=True)
            conn.exec_driver_sql("SELECT pg_advisory_xact_lock(%s)", (lock_id,))
        row = conn.execute(select(self.receipts).where(self.receipts.c.id == receipt_id)).mappings().first()
        if row:
            if row["request_hash"] != digest(request):
                raise CoreError("idempotency_conflict", "This key was already used for a different request", 409)
            return receipt_id, row["result"]
        return receipt_id, None

    def _record(self, conn, principal, workspace, item, action, trace, data):
        conn.execute(insert(self.events).values(entity_id=item["id"], tenant=principal.tenant, business=principal.business,
            workspace=workspace, action=action, actor=principal.actor, trace_id=trace,
            version=item["version"], data=data, created_at=now()))

    def receipt(self, principal, workspace, operation, key, request):
        with self.transaction() as conn:
            return self._receipt(conn, principal, workspace, operation, key, request)[1]

    def create(self, principal: Principal, workspace: str, kind: str, data: dict, key: str, trace: str, *, status="active", entity_id: str | None = None, operation: str = "", request: dict | None = None):
        receipt_request = data if request is None else request
        with self.transaction() as conn:
            receipt_id, cached = self._receipt(conn, principal, workspace, operation or "create:" + kind, key, receipt_request)
            if cached is not None:
                return cached
            item = dict(id=entity_id or uuid.uuid4().hex, kind=kind, tenant=principal.tenant, business=principal.business,
                workspace=workspace, version=1, status=status, data=data, created_at=now(), updated_at=now())
            conn.execute(insert(self.entities).values(**item))
            self._record(conn, principal, workspace, item, kind + ".created", trace, {"status": status})
            conn.execute(insert(self.receipts).values(id=receipt_id, request_hash=digest(receipt_request), result=item, created_at=now()))
            return item

    def mutate(self, principal: Principal, workspace: str, kind: str, entity_id: str, *, operation: str, key: str,
               request: dict, trace: str, expected: int | None, transform: Callable[[dict], dict]):
        with self.transaction() as conn:
            receipt_id, cached = self._receipt(conn, principal, workspace, operation + ":" + entity_id, key, request)
            if cached is not None:
                return cached
            item = self._get(conn, principal, workspace, kind, entity_id)
            if expected is not None and item["version"] != expected:
                raise CoreError("version_conflict", "Resource changed; reload before applying this action", 409)
            changes = transform(json.loads(json.dumps(item)))
            changes = {name: value for name, value in changes.items() if name in {"data", "status"}}
            changed = {**item, **changes, "version": item["version"] + 1, "updated_at": now()}
            result = conn.execute(update(self.entities).where(self.entities.c.id == entity_id, self.entities.c.version == item["version"]).values(**changes, version=changed["version"], updated_at=changed["updated_at"]))
            if result.rowcount != 1:
                raise CoreError("version_conflict", "Concurrent modification", 409)
            self._record(conn, principal, workspace, changed, operation, trace, {"status": changed["status"]})
            conn.execute(insert(self.receipts).values(id=receipt_id, request_hash=digest(request), result=changed, created_at=now()))
            return changed

    def stream(self, principal: Principal, workspace: str, *, after=0, entity_id="", limit=200):
        query = select(self.events).where(self._scope(self.events, principal, workspace), self.events.c.seq > after)
        if entity_id:
            query = query.where(self.events.c.entity_id == entity_id)
        with self.engine.connect() as conn:
            return [dict(row) for row in conn.execute(query.order_by(self.events.c.seq).limit(limit)).mappings()]

    def running_scopes(self):
        with self.engine.connect() as conn:
            query = select(self.entities.c.tenant, self.entities.c.business, self.entities.c.workspace).where(
                self.entities.c.kind == "runs", self.entities.c.status == "running").distinct()
            return [tuple(row) for row in conn.execute(query)]
