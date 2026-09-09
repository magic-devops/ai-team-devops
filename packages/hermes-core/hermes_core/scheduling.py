from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from .agents import Agents
from .execution import Execution
from .models import API_BASE, CoreError, Envelope, Node, Principal, RunAction, payload
from .schedule_triggers import (
    ScheduleTrigger,
    build_trigger_data,
    initial_due_cursor,
    next_due_after,
    parse_utc,
    preview_next_runs,
)
from .transactional import Store, digest, now
from .webhooks import GLOBAL_MAX_BODY_BYTES, verify_webhook

ACTIVE_RUN_STATUSES = frozenset({"planned", "queued", "running", "retrying", "interrupted"})
SCHEDULE_RESERVED_FIELDS = frozenset({
    "authority",
    "last_run_id",
    "last_triggered_at",
    "next_due_at",
    "workspace_root",
    "workspace_version",
    "agent_bindings",
})
MONITOR_PER_TICK_LIMIT = 20
LOGGER = logging.getLogger(__name__)


class ScheduleConfigure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    trigger: ScheduleTrigger
    nodes: list[Node] = Field(min_length=1, max_length=64)
    enabled: bool = True
    misfire_coalesce: bool = True
    idempotency_key: str = Field(min_length=1, max_length=160)
    expected_version: int | None = Field(default=None, ge=1)
    dry_run: bool = True

    @field_validator("title")
    @classmethod
    def non_blank_title(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("title must not be blank")
        return stripped

    @model_validator(mode="after")
    def valid_nodes(self):
        seen = set()
        for node in self.nodes:
            if node.id in seen:
                raise ValueError("Node IDs must be unique")
            seen.add(node.id)
            if node.kind == "command" and (not node.argv or any("\x00" in arg for arg in node.argv)):
                raise ValueError("Command nodes require a valid argument list")
            if node.kind == "approval" and (node.argv or getattr(node, "agent_id", "") or getattr(node, "prompt", "")):
                raise ValueError("Approval nodes cannot carry command or agent fields")
            if node.kind == "agent" and (not getattr(node, "agent_id", "") or not getattr(node, "prompt", "").strip() or node.argv):
                raise ValueError("Agent nodes require agent_id and prompt, without argv")
        return self


class Scheduler:
    def __init__(self, store: Store, execution: Execution):
        self.store = store
        self.execution = execution

    def preview(self, principal: Principal, workspace: str, body: ScheduleConfigure, *, runs: int = 5):
        workspace_row = self._workspace(principal, workspace)
        data = self._schedule_data(body, principal, workspace_row)
        with self.store.transaction() as conn:
            bindings = Agents(self.store).bindings(conn, principal, workspace, body.nodes)
            if bindings:
                data["agent_bindings"] = bindings
        return {
            "kind": "schedule_preview",
            "workspace": workspace,
            "data": data,
            "next_runs": preview_next_runs(data["trigger"], self._utcnow(), count=runs),
        }

    def configure(self, principal: Principal, workspace: str, schedule_id: str, body: ScheduleConfigure, trace: str):
        request = body.model_dump(mode="json")
        if body.dry_run:
            workspace_row = self._workspace(principal, workspace)
            data = self._schedule_data(body, principal, workspace_row)
            with self.store.transaction() as conn:
                bindings = Agents(self.store).bindings(conn, principal, workspace, body.nodes)
                if bindings:
                    data["agent_bindings"] = bindings
            return self._preview_schedule(principal, workspace, schedule_id, data, body.expected_version)
        with self.store.transaction() as conn:
            receipt_id, cached = self.store._receipt(conn, principal, workspace, f"schedule.configure:{schedule_id}", body.idempotency_key, request)
            if cached is not None:
                return cached
            current_workspace = self.store._get(conn, principal, "", "workspaces", workspace)
            if current_workspace["status"] != "active":
                raise CoreError("workspace_inactive", "Workspace is inactive", 409)
            data = self._schedule_data(body, principal, current_workspace)
            existing = self._maybe_get(conn, principal, workspace, "schedules", schedule_id)
            bindings = Agents(self.store).bindings(conn, principal, workspace, body.nodes)
            if bindings:
                data["agent_bindings"] = bindings
            if existing is None:
                if body.expected_version is not None:
                    raise CoreError("version_conflict", "New schedules do not have an expected_version yet", 409)
                try:
                    item = self._insert_entity(conn, principal, workspace, "schedules", schedule_id, "active" if data["enabled"] else "paused", data)
                except IntegrityError as exc:
                    raise CoreError("schedule_id_conflict", "Schedule id is already reserved; choose another id", 409) from exc
                action = "schedule.configured"
            else:
                if body.expected_version is None or existing["version"] != body.expected_version:
                    raise CoreError("version_conflict", "Schedule changed; reload before configuring", 409)
                item = self._update_entity(conn, principal, workspace, existing, {"status": "active" if data["enabled"] else "paused", "data": data})
                action = "schedule.reconfigured"
            self.store._record(conn, principal, workspace, item, action, trace, {"authority_actor": principal.actor})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=item, created_at=now()))
            return item

    def pause(self, principal: Principal, workspace: str, schedule_id: str, body: RunAction, trace: str):
        return self._set_enabled(principal, workspace, schedule_id, body, trace, enabled=False, operation="schedule.pause", status="paused")

    def resume(self, principal: Principal, workspace: str, schedule_id: str, body: RunAction, trace: str):
        return self._set_enabled(principal, workspace, schedule_id, body, trace, enabled=True, operation="schedule.resume", status="active")

    def trigger(self, principal: Principal, workspace: str, schedule_id: str, body: RunAction, trace: str):
        request = body.model_dump(mode="json")
        due_at = self._utcnow()
        if body.dry_run:
            schedule = self.store.get(principal, workspace, "schedules", schedule_id)
            self._assert_schedule_runnable(schedule)
            if schedule["version"] != body.expected_version:
                raise CoreError("version_conflict", "Schedule changed; reload before triggering", 409)
            return self._run_preview(schedule, due_at, "manual")
        with self.store.transaction() as conn:
            receipt_id, cached = self.store._receipt(conn, principal, workspace, f"schedule.trigger:{schedule_id}", body.idempotency_key, request)
            if cached is not None:
                return cached
            current = self.store._get(conn, principal, workspace, "schedules", schedule_id)
            if current["version"] != body.expected_version:
                raise CoreError("version_conflict", "Schedule changed; reload before triggering", 409)
            self._assert_schedule_runnable(current)
            if self._active_run(conn, principal, workspace, schedule_id):
                raise CoreError("schedule_overlap", "Schedule already has an active run", 409)
            run = self._create_run(conn, principal, workspace, current, due_at, "manual", trace)
            item = self._update_entity(conn, principal, workspace, current, {
                "data": {**current["data"], "last_run_id": run["id"], "last_triggered_at": due_at.isoformat()},
            })
            self.store._record(conn, principal, workspace, item, "schedule.triggered", trace, {"run_id": run["id"]})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=run, created_at=now()))
            return run

    def due(self, principal: Principal, workspace: str, *, limit: int = 20):
        created = []
        schedule_ids = self._schedule_ids(principal, workspace)
        for schedule_id in schedule_ids:
            if len(created) >= limit:
                break
            current_time = self._utcnow()
            with self.store.transaction() as conn:
                schedule = self.store._get(conn, principal, workspace, "schedules", schedule_id)
                data = schedule["data"]
                if schedule["status"] != "active" or not data.get("enabled"):
                    continue
                try:
                    self._assert_schedule_runnable(schedule, conn=conn)
                except CoreError as exc:
                    self._record_schedule_error(conn, principal, workspace, schedule, exc)
                    continue
                due_at = self._parse_dt(data.get("next_due_at"))
                if due_at is None or due_at > current_time:
                    continue
                next_due = next_due_after(data["trigger"], due_at, current_time, bool(data.get("misfire_coalesce", True)))
                if next_due is None:
                    continue
                if self._active_run(conn, principal, workspace, schedule["id"]):
                    item = self._update_entity(conn, principal, workspace, schedule, {"data": {**data, "next_due_at": next_due.isoformat()}})
                    self.store._record(conn, principal, workspace, item, "schedule.overlap_skipped", uuid.uuid4().hex, {"due_at": due_at.isoformat()})
                    continue
                due_trace = uuid.uuid4().hex
                run = self._create_run(conn, principal, workspace, schedule, due_at, "scheduled", due_trace)
                item = self._update_entity(conn, principal, workspace, schedule, {
                    "data": {**data, "next_due_at": next_due.isoformat(), "last_run_id": run["id"], "last_triggered_at": due_at.isoformat()},
                })
                self.store._record(conn, principal, workspace, item, "schedule.due", due_trace, {"run_id": run["id"], "due_at": due_at.isoformat()})
                created.append(run)
        return created

    def history(self, principal: Principal, workspace: str, schedule_id: str, *, limit: int = 100):
        self.store.get(principal, workspace, "schedules", schedule_id)
        with self.store.engine.connect() as conn:
            rows = conn.execute(select(self.store.entities).where(
                self.store._scope(self.store.entities, principal, workspace),
                self.store.entities.c.kind == "runs",
            ).order_by(self.store.entities.c.created_at.desc())).mappings()
            return [dict(row) for row in rows if row["data"].get("schedule", {}).get("id") == schedule_id][:limit]

    def recover_queued(self, principal: Principal, workspace: str, *, limit: int = 20):
        self.execution.recover(principal, workspace)
        rows = self._queued_scheduled_runs(principal, workspace, limit)
        for row in rows:
            self.execution.execute(principal, workspace, row["id"])
        return rows

    def scopes(self, *, limit: int = 1000):
        with self.store.engine.connect() as conn:
            rows = conn.execute(select(self.store.entities).where(
                self.store.entities.c.kind == "schedules",
                self.store.entities.c.status == "active",
            ).order_by(self.store.entities.c.tenant, self.store.entities.c.business, self.store.entities.c.workspace).limit(limit)).mappings()
            seen = set()
            scopes = []
            for row in rows:
                data = row["data"]
                if not data.get("enabled"):
                    continue
                key = (row["tenant"], row["business"], row["workspace"])
                if key in seen:
                    continue
                seen.add(key)
                authority = data.get("authority") or {}
                scopes.append((Principal(
                    actor=str(authority.get("actor") or "scheduler"),
                    tenant=row["tenant"],
                    business=row["business"],
                    permissions=frozenset({"read", "execute"}),
                    workspace_ids=frozenset({row["workspace"]}),
                ), row["workspace"]))
            return scopes

    def tick(self, scopes: list[tuple[Principal, str]] | None = None, *, limit: int = MONITOR_PER_TICK_LIMIT):
        created, recovered, errors = [], [], []
        active_scopes = scopes if scopes is not None else self.scopes()
        for principal, workspace in active_scopes:
            try:
                recovered.extend(self.recover_queued(principal, workspace, limit=limit))
                runs = self.due(principal, workspace, limit=limit)
                created.extend(runs)
                for run in runs:
                    self.execution.execute(principal, workspace, run["id"])
            except Exception as exc:
                LOGGER.exception("Hermes schedule tick failed for workspace %s", workspace)
                errors.append({"workspace": workspace, "actor": principal.actor, "error": str(exc)[:500]})
        return {"created": created, "recovered": recovered, "errors": errors}

    async def monitor(self, principal_factory: Callable[[], list[tuple[Principal, str]]] | None = None, *, interval_seconds: int = 5, limit: int = MONITOR_PER_TICK_LIMIT):
        while True:
            scopes = principal_factory() if principal_factory is not None else None
            await asyncio.to_thread(self.tick, scopes, limit=limit)
            await asyncio.sleep(interval_seconds)

    def _set_enabled(self, principal, workspace, schedule_id, body, trace, *, enabled: bool, operation: str, status: str):
        if body.dry_run:
            schedule = self.store.get(principal, workspace, "schedules", schedule_id)
            if schedule["version"] != body.expected_version:
                raise CoreError("version_conflict", "Schedule changed; reload before applying this action", 409)
            return schedule
        request = body.model_dump(mode="json")
        with self.store.transaction() as conn:
            receipt_id, cached = self.store._receipt(conn, principal, workspace, f"{operation}:{schedule_id}", body.idempotency_key, request)
            if cached is not None:
                return cached
            schedule = self.store._get(conn, principal, workspace, "schedules", schedule_id)
            if schedule["version"] != body.expected_version:
                raise CoreError("version_conflict", "Schedule changed; reload before applying this action", 409)
            data = {**schedule["data"], "enabled": enabled}
            if enabled:
                due = self._parse_dt(data.get("next_due_at")) or self._utcnow()
                if due < self._utcnow():
                    next_due = next_due_after(data["trigger"], due, self._utcnow(), True)
                    data["next_due_at"] = next_due.isoformat() if next_due else None
            item = self._update_entity(conn, principal, workspace, schedule, {"status": status, "data": data})
            self.store._record(conn, principal, workspace, item, operation, trace, {"enabled": enabled})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=item, created_at=now()))
            return item

    def _schedule_data(self, body: ScheduleConfigure, principal: Principal, workspace_row: dict):
        trigger_data = build_trigger_data(body.trigger)
        next_due = initial_due_cursor(trigger_data, self._utcnow())
        root = Path(workspace_row["data"]["root"]).expanduser().resolve()
        self.execution.validate_root(root)
        data = {
            "title": body.title.strip(),
            "trigger": trigger_data,
            "next_due_at": next_due.isoformat() if next_due else None,
            "nodes": [node.model_dump() for node in body.nodes],
            "enabled": body.enabled,
            "misfire_coalesce": body.misfire_coalesce,
            "workspace_root": str(root),
            "workspace_version": workspace_row["version"],
            "authority": {
                "actor": principal.actor,
                "tenant": principal.tenant,
                "business": principal.business,
                "authorized_at": self._utcnow().isoformat(),
                "permissions": sorted(principal.permissions),
            },
        }
        if trigger_data["type"] == "interval":
            data["interval_seconds"] = trigger_data["interval_seconds"]
            data["starts_at"] = trigger_data["starts_at"]
        elif trigger_data["type"] == "cron":
            data["cron_expression"] = trigger_data["cron_expression"]
            data["timezone"] = trigger_data["timezone"]
            if trigger_data.get("starts_at"):
                data["starts_at"] = trigger_data["starts_at"]
        return data

    def _workspace(self, principal: Principal, workspace: str):
        row = self.store.get(principal, "", "workspaces", workspace)
        if row["status"] != "active":
            raise CoreError("workspace_inactive", "Workspace is inactive", 409)
        return row

    def _assert_schedule_runnable(self, schedule: dict, conn=None):
        if schedule["status"] != "active" or not schedule["data"].get("enabled"):
            raise CoreError("schedule_paused", "Schedule is not enabled", 409)
        authority = schedule["data"].get("authority", {})
        principal = Principal(
            str(authority.get("actor") or schedule["tenant"]),
            tenant=schedule["tenant"],
            business=schedule["business"],
        )
        current = (
            self._workspace(principal, schedule["workspace"])
            if conn is None
            else self.store._get(conn, principal, "", "workspaces", schedule["workspace"])
        )
        if current["status"] != "active":
            raise CoreError("workspace_inactive", "Workspace is inactive", 409)
        if schedule["data"].get("workspace_version") != current["version"]:
            raise CoreError("workspace_changed", "Workspace configuration changed; reconfigure the schedule", 409)

    def _run_preview(self, schedule: dict, due_at: datetime, trigger: str):
        return {
            "id": self._run_id(schedule["id"], due_at, trigger),
            "kind": "runs",
            "workspace": schedule["workspace"],
            "version": 1,
            "status": "queued",
            "data": self._run_data(schedule, due_at, trigger),
        }

    def _create_run(self, conn, principal, workspace, schedule, due_at: datetime, trigger: str, trace: str):
        run = self._insert_entity(conn, principal, workspace, "runs", self._run_id(schedule["id"], due_at, trigger), "queued", self._run_data(schedule, due_at, trigger))
        self.store._record(conn, principal, workspace, run, "run.scheduled", trace, {
            "schedule_id": schedule["id"],
            "trigger": trigger,
            "due_at": due_at.isoformat(),
        })
        return run

    def _run_data(self, schedule: dict, due_at: datetime, trigger: str):
        data = schedule["data"]
        return {
            "title": f"{data['title']} @ {due_at.isoformat()}",
            "nodes": data["nodes"],
            "workspace_root": data["workspace_root"],
            "workspace_version": data["workspace_version"],
            "isolation": "workspace",
            "base_commit": "",
            "schedule": {
                "id": schedule["id"],
                "version": schedule["version"],
                "trigger": trigger,
                "trigger_config": data["trigger"],
                "due_at": due_at.isoformat(),
                "authority": data["authority"],
            },
            **({"agent_bindings": data["agent_bindings"]} if data.get("agent_bindings") else {}),
        }

    def _run_id(self, schedule_id: str, due_at: datetime, trigger: str):
        return digest(["schedule-run", schedule_id, due_at.isoformat(), trigger])[:32]

    def _active_run(self, conn, principal, workspace, schedule_id):
        rows = conn.execute(select(self.store.entities).where(
            self.store._scope(self.store.entities, principal, workspace),
            self.store.entities.c.kind == "runs",
            self.store.entities.c.status.in_(ACTIVE_RUN_STATUSES),
        )).mappings()
        return next((dict(row) for row in rows if row["data"].get("schedule", {}).get("id") == schedule_id), None)

    def _queued_scheduled_runs(self, principal, workspace, limit):
        with self.store.engine.connect() as conn:
            rows = conn.execute(select(self.store.entities).where(
                self.store._scope(self.store.entities, principal, workspace),
                self.store.entities.c.kind == "runs",
                self.store.entities.c.status == "queued",
            ).order_by(self.store.entities.c.created_at)).mappings()
            return [dict(row) for row in rows if row["data"].get("schedule")][:limit]

    def _schedule_ids(self, principal, workspace):
        with self.store.engine.connect() as conn:
            rows = conn.execute(select(self.store.entities.c.id).where(
                self.store._scope(self.store.entities, principal, workspace),
                self.store.entities.c.kind == "schedules",
            ).order_by(self.store.entities.c.id)).mappings()
            return [row["id"] for row in rows]

    def _schedules(self, conn, principal, workspace):
        query = select(self.store.entities).where(
            self.store._scope(self.store.entities, principal, workspace),
            self.store.entities.c.kind == "schedules",
        ).order_by(self.store.entities.c.id)
        if self.store.engine.dialect.name == "postgresql":
            query = query.with_for_update()
        rows = conn.execute(query).mappings()
        return [dict(row) for row in rows]

    def _record_schedule_error(self, conn, principal, workspace, schedule, exc: CoreError):
        self.store._record(conn, principal, workspace, schedule, "schedule.error", uuid.uuid4().hex, {
            "code": exc.code,
            "message": exc.message,
        })

    def webhook(self, schedule_id: str, headers: dict[str, str], raw_body: bytes, trace: str):
        due_at = self._utcnow()
        with self.store.transaction() as conn:
            schedule = self._get_schedule_by_id(conn, schedule_id)
            principal = self._principal_from_schedule(schedule)
            workspace = schedule["workspace"]
            trigger_data = schedule["data"]["trigger"]
            if trigger_data.get("type") != "webhook":
                raise CoreError("webhook_not_configured", "Schedule is not configured for webhook delivery", 409)
            delivery = verify_webhook(trigger_data, headers, raw_body, now_utc=due_at)
            # Retries may refresh the signed timestamp without changing the delivery.
            request = {"delivery_id": delivery["delivery_id"], "body_sha256": delivery["body_sha256"]}
            receipt_id, cached = self.store._receipt(conn, principal, workspace, f"schedule.webhook:{schedule_id}", delivery["delivery_id"], request)
            if cached is not None:
                return principal, workspace, cached, False
            self._assert_schedule_runnable(schedule, conn=conn)
            if self._active_run(conn, principal, workspace, schedule_id):
                raise CoreError("schedule_overlap", "Schedule already has an active run", 409)
            run = self._create_run(conn, principal, workspace, schedule, due_at, "webhook", trace)
            item = self._update_entity(conn, principal, workspace, schedule, {
                "data": {**schedule["data"], "last_run_id": run["id"], "last_triggered_at": due_at.isoformat()},
            })
            self.store._record(conn, principal, workspace, item, "schedule.webhook", trace, {"run_id": run["id"], **delivery})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=run, created_at=now()))
            return principal, workspace, run, True

    def webhook_test(self, principal: Principal, workspace: str, schedule_id: str, body: RunAction, trace: str):
        request = body.model_dump(mode="json")
        due_at = self._utcnow()
        if body.dry_run:
            schedule = self.store.get(principal, workspace, "schedules", schedule_id)
            self._assert_schedule_runnable(schedule)
            if (schedule["data"].get("trigger") or {}).get("type") != "webhook":
                raise CoreError("webhook_not_configured", "Schedule is not configured for webhook delivery", 409)
            if schedule["version"] != body.expected_version:
                raise CoreError("version_conflict", "Schedule changed; reload before testing webhook", 409)
            return self._run_preview(schedule, due_at, "webhook:test"), False
        with self.store.transaction() as conn:
            receipt_id, cached = self.store._receipt(conn, principal, workspace, f"schedule.webhook-test:{schedule_id}", body.idempotency_key, request)
            if cached is not None:
                return cached, False
            schedule = self.store._get(conn, principal, workspace, "schedules", schedule_id)
            if (schedule["data"].get("trigger") or {}).get("type") != "webhook":
                raise CoreError("webhook_not_configured", "Schedule is not configured for webhook delivery", 409)
            if schedule["version"] != body.expected_version:
                raise CoreError("version_conflict", "Schedule changed; reload before testing webhook", 409)
            self._assert_schedule_runnable(schedule, conn=conn)
            if self._active_run(conn, principal, workspace, schedule_id):
                raise CoreError("schedule_overlap", "Schedule already has an active run", 409)
            run = self._create_run(conn, principal, workspace, schedule, due_at, "webhook:test", trace)
            item = self._update_entity(conn, principal, workspace, schedule, {
                "data": {**schedule["data"], "last_run_id": run["id"], "last_triggered_at": due_at.isoformat()},
            })
            self.store._record(conn, principal, workspace, item, "schedule.webhook_test", trace, {"run_id": run["id"]})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=run, created_at=now()))
            return run, True

    def _get_schedule_by_id(self, conn, schedule_id: str):
        query = select(self.store.entities).where(
            self.store.entities.c.id == schedule_id,
            self.store.entities.c.kind == "schedules",
        )
        if self.store.engine.dialect.name == "postgresql":
            query = query.with_for_update()
        row = conn.execute(query).mappings().first()
        if row is None:
            raise CoreError("not_found", "Resource not found in this workspace", 404)
        return dict(row)

    @staticmethod
    def _principal_from_schedule(schedule: dict):
        authority = schedule["data"].get("authority") or {}
        return Principal(
            actor=str(authority.get("actor") or "scheduler"),
            tenant=schedule["tenant"],
            business=schedule["business"],
            permissions=frozenset({"read", "execute"}),
            workspace_ids=frozenset({schedule["workspace"]}),
        )

    def _maybe_get(self, conn, principal, workspace, kind, entity_id):
        try:
            return self.store._get(conn, principal, workspace, kind, entity_id)
        except CoreError as exc:
            if exc.status == 404:
                return None
            raise

    def _preview_schedule(self, principal, workspace, schedule_id, data, expected_version):
        existing = self._maybe_get_preview(principal, workspace, schedule_id)
        version = existing["version"] + 1 if existing else 1
        if existing and expected_version != existing["version"]:
            raise CoreError("version_conflict", "Schedule changed; reload before configuring", 409)
        return {"id": schedule_id, "kind": "schedules", "tenant": principal.tenant, "business": principal.business,
                "workspace": workspace, "version": version, "status": "active" if data["enabled"] else "paused",
                "data": data, "created_at": now(), "updated_at": now()}

    def _maybe_get_preview(self, principal, workspace, schedule_id):
        try:
            return self.store.get(principal, workspace, "schedules", schedule_id)
        except CoreError as exc:
            if exc.status == 404:
                return None
            raise

    def _insert_entity(self, conn, principal, workspace, kind, entity_id, status, data):
        item = {"id": entity_id, "kind": kind, "tenant": principal.tenant, "business": principal.business,
                "workspace": workspace, "version": 1, "status": status, "data": json.loads(json.dumps(data)),
                "created_at": now(), "updated_at": now()}
        conn.execute(insert(self.store.entities).values(**item))
        return item

    def _update_entity(self, conn, principal, workspace, item, changes):
        changed = {**item, **changes, "version": item["version"] + 1, "updated_at": now()}
        result = conn.execute(update(self.store.entities).where(
            self.store._scope(self.store.entities, principal, workspace),
            self.store.entities.c.id == item["id"],
            self.store.entities.c.version == item["version"],
        ).values(status=changed["status"], data=json.loads(json.dumps(changed["data"])), version=changed["version"], updated_at=changed["updated_at"]))
        if result.rowcount != 1:
            raise CoreError("version_conflict", "Concurrent modification", 409)
        return changed

    @staticmethod
    def _utcnow():
        return datetime.now(timezone.utc)

    @staticmethod
    def _parse_dt(value: Any):
        return parse_utc(value)

def create_scheduling_router(store: Store, execution: Execution, identity: Callable):  # noqa: C901
    router = APIRouter(prefix=API_BASE, tags=["Hermes Scheduling"])
    scheduler = Scheduler(store, execution)
    identity_dependency = Depends(identity)

    def require(principal: Principal, action: str):
        if action not in principal.permissions:
            raise CoreError("forbidden", f"Missing {action} permission", 403)

    def workspace_id(request: Request, principal: Principal):
        workspace = request.headers.get("X-Workspace-Id", "")
        if not workspace:
            raise CoreError("workspace_required", "Select a workspace first", 400)
        if principal.workspace_ids is not None and workspace not in principal.workspace_ids:
            raise CoreError("forbidden", "Workspace access denied", 403)
        row = store.get(principal, "", "workspaces", workspace)
        if row["status"] != "active":
            raise CoreError("workspace_inactive", "Workspace is inactive", 409)
        return workspace

    def response(principal, workspace, items, *, trace: str, **extra):
        return payload(principal, workspace, items, trace=trace, **extra)

    async def read_webhook_body(request: Request):
        declared = request.headers.get("content-length", "")
        if declared:
            try:
                if int(declared) > GLOBAL_MAX_BODY_BYTES:
                    raise CoreError("webhook_body_too_large", "Webhook body exceeds the global limit", 413)
            except ValueError as exc:
                raise CoreError("webhook_content_length_invalid", "Webhook Content-Length must be numeric", 400) from exc
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > GLOBAL_MAX_BODY_BYTES:
                raise CoreError("webhook_body_too_large", "Webhook body exceeds the global limit", 413)
        return bytes(body)

    def schedule_cli(schedule_id: str, workspace: str):
        return {"command": f"sop schedule get {schedule_id} --json", "workspace_id": workspace}

    @router.post("/schedules/preview", response_model=Envelope)
    def preview(body: ScheduleConfigure, request: Request, runs: int = Query(5, ge=0, le=20), principal: Principal = identity_dependency):
        require(principal, "config")
        require(principal, "execute")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = scheduler.preview(principal, workspace, body, runs=runs)
        return response(principal, workspace, [item], summary={"dry_run": True, "preview": True, "next_runs": item["next_runs"]},
                        trace=trace, cli={"command": "sop schedule preview --json", "workspace_id": workspace})

    @router.post("/schedules/{schedule_id}/configure", response_model=Envelope)
    def configure(schedule_id: str, body: ScheduleConfigure, request: Request, principal: Principal = identity_dependency):
        require(principal, "config")
        require(principal, "execute")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = scheduler.configure(principal, workspace, schedule_id, body, trace)
        return response(principal, workspace, [item], summary={"dry_run": body.dry_run, "configured": not body.dry_run},
                        trace=trace, cli=schedule_cli(schedule_id, workspace))

    @router.post("/schedules/{schedule_id}/trigger", response_model=Envelope)
    def trigger(schedule_id: str, body: RunAction, request: Request, background: BackgroundTasks, principal: Principal = identity_dependency):
        require(principal, "execute")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = scheduler.trigger(principal, workspace, schedule_id, body, trace)
        if not body.dry_run:
            background.add_task(execution.execute, principal, workspace, item["id"])
        return response(principal, workspace, [item], summary={"dry_run": body.dry_run, "queued": not body.dry_run},
                        trace=trace, cli=schedule_cli(schedule_id, workspace))

    @router.post("/schedules/{schedule_id}/webhook", response_model=Envelope)
    async def webhook(schedule_id: str, request: Request, background: BackgroundTasks):
        trace = uuid.uuid4().hex
        principal, workspace, item, created = scheduler.webhook(schedule_id, dict(request.headers), await read_webhook_body(request), trace)
        if created:
            background.add_task(execution.execute, principal, workspace, item["id"])
        return response(principal, workspace, [item], summary={"queued": created, "duplicate": not created},
                        trace=trace, cli=schedule_cli(schedule_id, workspace))

    @router.post("/schedules/{schedule_id}/webhook-test", response_model=Envelope)
    def webhook_test(schedule_id: str, body: RunAction, request: Request, background: BackgroundTasks, principal: Principal = identity_dependency):
        require(principal, "execute")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item, created = scheduler.webhook_test(principal, workspace, schedule_id, body, trace)
        if created:
            background.add_task(execution.execute, principal, workspace, item["id"])
        return response(principal, workspace, [item], summary={"dry_run": body.dry_run, "queued": created},
                        trace=trace, cli=schedule_cli(schedule_id, workspace))

    @router.post("/schedules/{schedule_id}/pause", response_model=Envelope)
    def pause(schedule_id: str, body: RunAction, request: Request, principal: Principal = identity_dependency):
        require(principal, "config")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = scheduler.pause(principal, workspace, schedule_id, body, trace)
        return response(principal, workspace, [item], summary={"dry_run": body.dry_run, "enabled": item["data"].get("enabled")},
                        trace=trace, cli=schedule_cli(schedule_id, workspace))

    @router.post("/schedules/{schedule_id}/resume", response_model=Envelope)
    def resume(schedule_id: str, body: RunAction, request: Request, principal: Principal = identity_dependency):
        require(principal, "config")
        require(principal, "execute")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = scheduler.resume(principal, workspace, schedule_id, body, trace)
        return response(principal, workspace, [item], summary={"dry_run": body.dry_run, "enabled": item["data"].get("enabled")},
                        trace=trace, cli=schedule_cli(schedule_id, workspace))

    @router.get("/schedules/{schedule_id}/history", response_model=Envelope)
    def history(schedule_id: str, request: Request, limit: int = Query(100, ge=1, le=500), principal: Principal = identity_dependency):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        rows = scheduler.history(principal, workspace, schedule_id, limit=limit)
        return response(principal, workspace, rows, summary={"total": len(rows), "schedule_id": schedule_id},
                        trace=trace, cli={"command": f"sop schedule history {schedule_id} --json", "workspace_id": workspace})

    return router
