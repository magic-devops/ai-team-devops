"""Opt-in real SQL scope support for tests that previously stored only files.

The fixture does not bypass production lifecycle checks. Tests explicitly opt in;
the legacy router directory provides its own local autouse wrapper.
"""

import sys

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool


def _restore_imported_aliases(factory, engine, previous_factory, previous_engine):
    for module_name, module in list(sys.modules.items()):
        if module is None or not module_name.startswith("sop_manager"):
            continue
        if getattr(module, "SessionLocal", None) is factory:
            module.SessionLocal = previous_factory
        if getattr(module, "engine", None) is engine:
            module.engine = previous_engine


@pytest.fixture
def isolated_project_sql(tmp_path, monkeypatch):
    from sop_manager import path_config
    from sop_manager.project_write_guard import ManagerSession
    from sop_manager.routers import sql_models as models

    monkeypatch.setenv("PROJECT_PATH", str(tmp_path / "project"))
    monkeypatch.setenv("AI_MEMORY_ROOT", str(tmp_path / "memory"))
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path / "runtime"))
    monkeypatch.setenv("TENANT_ID", "router-test-tenant")
    monkeypatch.setenv("PROJECT_ID", "router-test-project")
    engine = create_engine(
        "sqlite:///" + str(tmp_path / "manager.sqlite"),
        connect_args={"check_same_thread": False, "timeout": 0.2},
        poolclass=NullPool,
    )
    event.listen(engine, "connect", models._configure_sqlite)
    models.Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, class_=ManagerSession, autoflush=False)
    seeded = set()

    def ensure_selected_scope():
        tenant_id, project_id = path_config.resolved_tenant_id(), path_config.resolved_project_id()
        scope = (tenant_id, project_id)
        if scope in seeded:
            return
        business_id = path_config.resolved_business_code() or None
        with sessions() as db:
            tenant = db.get(models.Tenant, tenant_id)
            if tenant is None:
                db.add(models.Tenant(id=tenant_id, name=tenant_id, slug=tenant_id, status="active"))
                db.flush()
            if business_id and db.get(models.Business, business_id) is None:
                db.add(models.Business(id=business_id, tenant_id=tenant_id, name=business_id))
                db.flush()
            project = db.get(models.Project, project_id)
            if project is None:
                db.add(
                    models.Project(
                        id=project_id,
                        tenant_id=tenant_id,
                        business_id=business_id,
                        name=project_id,
                        project_path=str(path_config.resolved_project_path()),
                        status="active",
                    )
                )
            elif project.tenant_id != tenant_id:
                raise AssertionError("Test scopes must use globally unique canonical Project IDs")
            db.commit()
        seeded.add(scope)

    def selected_session(*args, **kwargs):
        ensure_selected_scope()
        return sessions(*args, **kwargs)

    previous_factory, previous_engine = models.SessionLocal, models.engine
    for module_name, module in list(sys.modules.items()):
        if module is None or not module_name.startswith("sop_manager"):
            continue
        if getattr(module, "SessionLocal", None) is previous_factory:
            monkeypatch.setattr(module, "SessionLocal", selected_session)
        if getattr(module, "engine", None) is previous_engine:
            monkeypatch.setattr(module, "engine", engine)
    try:
        yield {"sessions": sessions, "ensure_scope": ensure_selected_scope, "engine": engine}
    finally:
        # Imports during a test may copy a patched factory into a new module.
        # Restore those aliases too, so later tests cannot retain this closed DB.
        _restore_imported_aliases(selected_session, engine, previous_factory, previous_engine)
        engine.dispose()
