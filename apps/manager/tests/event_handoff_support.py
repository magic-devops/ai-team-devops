"""Freeze an explicit original sync intent in tests using real SQL auth and scope."""

from uuid import uuid4

from fastapi import Request
from sop_manager.routers import sql_models as m
from sop_manager.routers import sync_api
from sqlalchemy import select


def direct_sync(db, project_id, *, module="tasks", action="upsert", record, key=None, **metadata):
    unusable_hash = "not-a-login"
    project = db.get(m.Project, project_id)
    user = (
        db.query(m.User)
        .filter(
            m.User.tenant_id == project.tenant_id,
            m.User.role.in_(["tenant_admin", "super_admin"]),
            m.User.status == "active",
        )
        .first()
    )
    if user is None:
        user = m.User(
            id="event-test-actor",
            tenant_id=project.tenant_id,
            username="Event test",
            password_hash=unusable_hash,
            role="tenant_admin",
            status="active",
        )
        db.add(user)
        db.commit()
    expected = (
        db.scalar(select(m.DeliveryWorkspace.version).where(m.DeliveryWorkspace.project_id == project_id))
        or 0
    )
    body = sync_api.SyncPushIn(
        module=module,
        action=action,
        record=record,
        expected_version=expected,
        idempotency_key=key or uuid4().hex,
        **metadata,
    )
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/sync/push",
            "headers": [(b"x-project-id", project_id.encode())],
        }
    )
    return sync_api.sync_push(body, request, user=user, db=db, project_id=project_id)
