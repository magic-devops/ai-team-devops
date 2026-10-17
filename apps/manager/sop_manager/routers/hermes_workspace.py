from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends
from hermes_core.api import create_router, install_errors
from hermes_core.execution import Execution
from hermes_core.models import PERMISSIONS, Principal
from hermes_core.transactional import Store

from sop_manager.path_config import resolved_runtime_dir
from sop_manager.routers.auth_sql import current_user
from sop_manager.routers.sql_models import SessionLocal, User

CURRENT_USER_DEPENDENCY = Depends(current_user)


def runtime_identity(user, store):
    tenant = str(user.tenant_id)
    role = str(user.role)
    if role == "super_admin":
        return Principal(str(user.id), tenant=tenant, business="team")
    permissions = frozenset({"read"})
    if role in {"tenant_admin", "project_admin", "devops", "developer"}:
        permissions = PERMISSIONS - {"approve", "config", "execute"}
    if role in {"tenant_admin", "project_admin", "devops"}:
        permissions = permissions | {"approve", "config"}
    principal = Principal(str(user.id), tenant=tenant, business="team", permissions=permissions)
    workspaces = store.list(principal, "", "workspaces", limit=10000)
    allowed = frozenset(row["id"] for row in workspaces if row["data"].get("owner") == str(user.id)
                        or str(user.id) in row["data"].get("members", []))
    return Principal(str(user.id), tenant=tenant, business="team", permissions=permissions, workspace_ids=allowed)


def mount_hermes_workspace(app):
    data_dir = Path(os.getenv("HERMES_DATA_DIR", str(resolved_runtime_dir() / "hermes"))).expanduser()
    data_dir.mkdir(parents=True, exist_ok=True)
    store = Store(os.getenv("HERMES_DATABASE_URL", "sqlite:///" + str((data_dir / "workspace.sqlite").resolve())))
    execution = Execution(store, data_dir)
    execution.allowed_roots = tuple(Path(root).expanduser().resolve() for root in os.getenv("HERMES_EXECUTION_ROOTS", "").split(os.pathsep) if root.strip())
    execution.allow_commands = os.getenv("HERMES_ALLOW_MANAGER_EXECUTION") == "1"
    previous_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        from .delivery_sync import delivery_sync_lifespan

        async with previous_lifespan(application), execution.lifespan(application), delivery_sync_lifespan(application):
            yield

    app.router.lifespan_context = lifespan

    def identity(user: User = CURRENT_USER_DEPENDENCY):
        return runtime_identity(user, store)

    def workspace_actor_directory(principal: Principal, workspace: str) -> list[str]:
        row = store.get(principal, "", "workspaces", workspace)
        identities = {principal.actor, str(row["data"].get("owner", ""))}
        identities.update(str(member) for member in row["data"].get("members", []))
        identities.discard("")
        with SessionLocal() as session:
            users = session.query(User.id).filter(User.id.in_(identities), User.tenant_id == principal.tenant,
                                                 User.status == "active").all()
        return sorted({principal.actor, *(str(user.id) for user in users)})

    install_errors(app)
    app.include_router(create_router(store, execution, identity, actor_directory=workspace_actor_directory))
    app.state.hermes_store = store
    app.state.hermes_execution = execution
