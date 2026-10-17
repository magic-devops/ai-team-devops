"""Atomic progress capture across Manager writers and bounded daily checkpoints."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from .delivery_progress_facts import capture_facts, fact_basis
from .sql_models import (
    DeliveryProgressCheckpoint,
    DeliveryProgressObservation,
    DeliveryWorkspace,
    Project,
    SessionLocal,
    Tenant,
)

logger = logging.getLogger(__name__)
_RECORDED = "delivery_progress_recorded"
_RESERVED = "delivery_reserved_workspace_versions"


def reserve_workspace_version(db, project, version):
    transaction = db.get_nested_transaction() or db.get_transaction()
    scope = (project.tenant_id, project.id)
    db.info.setdefault(_RESERVED, {}).setdefault(transaction, {})[scope] = version
    return transaction, scope, version


def release_workspace_version(db, token):
    transaction, scope, version = token
    group = db.info.get(_RESERVED, {}).get(transaction, {})
    if group.get(scope) == version:
        group.pop(scope, None)


def _utc(now=None):
    value = now or datetime.now(timezone.utc)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def record_observation(
    db, project, source="transaction", actor="", source_version=None, force=False, now=None
):
    """Append facts in the caller's transaction; never commit, edit a task or backfill a day."""
    db.flush()
    # SQL Core CAS intentionally avoids identity-map synchronization. Read its final
    # database state, after flushing all pending ORM edits, not a cached workspace.
    db.expire_all()
    from .delivery_manual_review import invalidate_reviews
    from .delivery_service import reconcile

    workspace = db.scalar(
        select(DeliveryWorkspace)
        .where(DeliveryWorkspace.project_id == project.id, DeliveryWorkspace.tenant_id == project.tenant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if workspace:
        effective = reconcile(db, project, workspace.data)
        changed = effective["flows"] != workspace.data["flows"]
        for entry in effective.get("executions", []):
            if entry.get("stale") and not entry.get("planning_invalidated"):
                entry["planning_invalidated"] = True
                changed = True
        if changed:
            value = {
                **workspace.data,
                "flows": effective["flows"],
                "executions": effective.get("executions", []),
            }
            transaction = db.get_nested_transaction() or db.get_transaction()
            reserved = db.info.get(_RESERVED, {}).get(transaction, {}).get((project.tenant_id, project.id))
            version = workspace.version if reserved == workspace.version else workspace.version + 1
            applied = db.execute(
                update(DeliveryWorkspace)
                .where(
                    DeliveryWorkspace.project_id == project.id,
                    DeliveryWorkspace.tenant_id == project.tenant_id,
                    DeliveryWorkspace.version == workspace.version,
                )
                .values(data=value, version=version),
                execution_options={"synchronize_session": False},
            )
            if applied.rowcount != 1:
                raise HTTPException(409, "Concurrent delivery definition change; reload and retry")
            db.expire(workspace)
    invalidate_reviews(db, project)
    facts = capture_facts(db, project)
    fingerprint = fact_basis(facts)
    instant = _utc(now)
    day = instant.date().isoformat()
    previous = (
        db.query(DeliveryProgressObservation)
        .filter_by(tenant_id=project.tenant_id, project_id=project.id)
        .order_by(DeliveryProgressObservation.seq.desc())
        .first()
    )
    transaction = db.get_nested_transaction() or db.get_transaction()
    recorded = db.info.setdefault(_RECORDED, {}).setdefault(transaction, {})
    key = (project.tenant_id, project.id)
    if recorded.get(key) == fingerprint or (
        not force and previous and previous.fingerprint == fingerprint and previous.observed_day == day
    ):
        return None
    if source_version is None:
        workspace = db.get(DeliveryWorkspace, project.id)
        source_version = workspace.version if workspace else 0
    row = DeliveryProgressObservation(
        id="observation-" + uuid4().hex[:20],
        tenant_id=project.tenant_id,
        project_id=project.id,
        observed_day=day,
        observed_at=instant.replace(tzinfo=None),
        source=source,
        actor=actor,
        source_version=source_version,
        fingerprint=fingerprint,
        data=facts,
    )
    db.add(row)
    db.flush()
    recorded[key] = fingerprint
    return row


def daily_once(sessions=SessionLocal, now=None, page_size=100):
    """Page actual active projects; downtime remains a gap, multiple workers share one checkpoint."""
    instant = _utc(now)
    day = instant.date().isoformat()
    applied, cursor = 0, ""
    while True:
        with sessions() as db:
            ids = (
                db.query(Project.id)
                .join(Tenant, Tenant.id == Project.tenant_id)
                .filter(Project.id > cursor, Project.status == "active", Tenant.status == "active")
                .order_by(Project.id)
                .limit(page_size)
                .all()
            )
        if not ids:
            break
        for (project_id,) in ids:
            cursor = project_id
            with sessions() as db:
                project = db.get(Project, project_id)
                tenant = db.get(Tenant, project.tenant_id) if project else None
                if not project or project.status != "active" or not tenant or tenant.status != "active":
                    continue
                key = (project.tenant_id, project.id, day)
                if db.get(DeliveryProgressCheckpoint, key):
                    continue
                try:
                    db.add(DeliveryProgressCheckpoint(tenant_id=key[0], project_id=key[1], observed_day=day))
                    db.flush()
                    existing = (
                        db.query(DeliveryProgressObservation.seq)
                        .filter_by(tenant_id=key[0], project_id=key[1], observed_day=day)
                        .first()
                    )
                    recorded = not existing
                    if recorded:
                        record_observation(db, project, source="daily", force=True, now=instant)
                    db.commit()
                    applied += int(recorded)
                except IntegrityError:
                    db.rollback()
                    # Another worker won this exact daily checkpoint. No phantom facts survive.
                except Exception:
                    db.rollback()
                    logger.exception("Progress checkpoint failed for project %s; will retry", project_id)
        if len(ids) < page_size:
            break
    return applied


@asynccontextmanager
async def progress_lifespan(app):
    async def loop():
        while True:
            try:
                await asyncio.to_thread(daily_once)
            except Exception:
                logger.exception("Daily delivery progress scan failed; will retry")
            await asyncio.sleep(60)

    task = asyncio.create_task(loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def mount_progress_observer(app):
    previous = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        async with previous(application), progress_lifespan(application):
            yield

    app.router.lifespan_context = lifespan
