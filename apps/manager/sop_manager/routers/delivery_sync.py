"""Recoverable runtime-to-business synchronization; no execution is started here."""

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from types import SimpleNamespace

from fastapi import HTTPException
from hermes_core.models import CoreError

from .delivery import execute
from .delivery_contract import Command
from .delivery_execution import CLOSED, context
from .sql_models import DeliveryWorkspace, Project, SessionLocal, User

logger = logging.getLogger(__name__)


def sync_once(app, sessions=SessionLocal):
    """Persist only changed runtime versions. A failed CAS retries next scan."""
    store = getattr(app.state, "hermes_store", None)
    if store is None:
        return 0
    from .delivery_execution_handoff import handoff_once
    from .delivery_execution_control_operation_service import control_once

    # Accepted originals must get their bounded scan even if an unrelated legacy
    # observation/deployment later fails in this shared lifecycle iteration.
    applied = control_once(app, sessions) + handoff_once(app, sessions)
    with sessions() as db:
        rows = db.query(DeliveryWorkspace.project_id).all()
    for (project_id,) in rows:
        with sessions() as db:
            project = db.get(Project, project_id)
            if not project or project.status == "archived":
                continue
            row = db.get(DeliveryWorkspace, project_id)
            ids = [
                e["id"]
                for e in row.data.get("executions", [])
                if e.get("run_id") and e["status"] not in CLOSED
            ]
        for execution_id in ids:
            with sessions() as db:
                row = db.get(DeliveryWorkspace, project_id)
                entry = next((e for e in row.data.get("executions", []) if e["id"] == execution_id), None)
                if not entry or entry["status"] in CLOSED:
                    continue
                user = db.get(User, entry["requested_by"])
                if not user or user.status != "active":
                    continue
                try:
                    principal, _ = context(store, user, entry["workspace_id"])
                    run = store.get(principal, entry["workspace_id"], "runs", entry["run_id"])
                    if run["version"] == entry["run_version"]:
                        continue
                    execute(
                        Command(
                            action="execution.sync",
                            payload={"id": execution_id},
                            expected_version=row.version,
                            idempotency_key=f"sync-{execution_id}-{run['version']}",
                        ),
                        user=user,
                        db=db,
                        project_id=project_id,
                        request=SimpleNamespace(app=app),
                    )
                    applied += 1
                except (HTTPException, CoreError):
                    db.rollback()
                    # Revoked permissions and CAS races must not mutate or stop other projects.
                    logger.debug("Delivery sync deferred for %s", execution_id)
    return applied + _sync_deployments(app, sessions, store, [project_id for (project_id,) in rows])


def _sync_deployments(app, sessions, store, project_ids):
    from .delivery_deployment import _context, active_deployment_ids

    applied = 0
    for project_id in project_ids:
        with sessions() as db:
            project = db.get(Project, project_id)
            row = db.get(DeliveryWorkspace, project_id)
            if project is None or project.status == "archived" or row is None:
                continue
            ids = active_deployment_ids(row.data)
        for deployment_id in ids:
            with sessions() as db:
                project = db.get(Project, project_id)
                row = db.get(DeliveryWorkspace, project_id)
                if project is None or project.status == "archived" or row is None:
                    continue
                entry = next((item for item in row.data.get("deployments", []) if item["id"] == deployment_id), None)
                if entry is None or deployment_id not in active_deployment_ids(row.data) or not entry["operations"]:
                    continue
                operation = entry["operations"][-1]
                if not operation.get("run_id"):
                    continue
                user = db.get(User, operation["requested_by"]["id"])
                if user is None or user.status != "active":
                    continue
                try:
                    workspace_id = entry["snapshot"]["definition"]["workspace_id"]
                    principal, _ = _context(store, user, project, workspace_id, "read")
                    run = store.get(principal, workspace_id, "runs", operation["run_id"])
                    if run["version"] == operation.get("run_version"):
                        continue
                    execute(
                        Command(
                            action="deployment.sync", payload={"id": deployment_id},
                            expected_version=row.version,
                            idempotency_key=f"deployment-sync-{operation['id']}-{run['version']}",
                        ),
                        user=user, db=db, project_id=project_id, request=SimpleNamespace(app=app),
                    )
                    applied += 1
                except (HTTPException, CoreError):
                    db.rollback()
                    logger.debug("Deployment observation deferred for %s", deployment_id)
    return applied


@asynccontextmanager
async def delivery_sync_lifespan(app):
    async def loop():
        while True:
            try:
                await asyncio.to_thread(sync_once, app)
            except Exception:
                logger.exception("Delivery sync scan failed; will retry")
            await asyncio.sleep(5)

    task = asyncio.create_task(loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
