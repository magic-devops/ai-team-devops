"""Late file mutations honor the actual project's archive lock, after request admission."""

import asyncio
from hashlib import sha256
from importlib import import_module
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from sop_manager import path_config
from sop_manager.routers import scope_guard, sql_models
from sop_manager.routers.sql_models import Project
from sqlalchemy import create_engine, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker
from test_delivery_workbench import env as delivery_env

env = delivery_env
MODULES = (
    "data_ingest",
    "data_quality",
    "metrics_service",
    "ops_center",
    "tag_service",
    "notify",
    "skills",
    "vibe",
    "workspace",
    "docker_env",
)


@pytest.fixture
def files(env, tmp_path, monkeypatch):
    _, sessions, _ = env
    root = tmp_path / "files"
    memory = root / "memory"
    project = root / "project"
    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    monkeypatch.setattr(path_config, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(path_config, "resolved_project_id", lambda: "project")
    monkeypatch.setattr(
        scope_guard,
        "current_scope",
        lambda: {
            "tenant_id": "tenant",
            "tenant_code": "team",
            "business_code": "business",
            "project_id": "project",
            "project_code": "project",
        },
    )
    modules = {name: import_module("sop_manager.routers." + name) for name in MODULES}
    for module in modules.values():
        if hasattr(module, "resolved_ai_memory_root"):
            monkeypatch.setattr(module, "resolved_ai_memory_root", lambda: memory)
        if hasattr(module, "resolved_project_path"):
            monkeypatch.setattr(module, "resolved_project_path", lambda: project)
    monkeypatch.setattr(modules["workspace"], "sop_dir", lambda: project / "ai-sop")
    return sessions, root, project, modules


def inventory(root):
    return {
        str(path.relative_to(root)): sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }


def operation(name, files):
    _, _, project, modules = files
    module_name, method = name.split(":")
    module = modules[module_name]
    if method == "update_state":
        state = project / "memory/current_state.json"
        state.parent.mkdir(parents=True, exist_ok=True)
        state.write_text('{"phase":"planned"}', encoding="utf-8")
        return lambda: module.update_state({"phase": "implementation"})
    return {
        "_save": lambda: module._save("fixtures", {"id": "fixture", "title": "Stored project item"}),
        "_save_notify": lambda: module._save({"channels": {}, "rules": []}),
        "_save_subscriptions": lambda: module._save_subscriptions([]),
        "_append_event": lambda: module._append_event({"text": "Recorded event"}),
        "_append_report_run": lambda: module._append_report_run({"text": "Recorded report"}),
        "create_skill": lambda: module.create_skill(
            module.SkillDef(skill_id="fixture", name="Project skill", description="Local skill")
        ),
        "_save_history": lambda: module._save_history([{"text": "A conversation"}]),
        "_save_sessions": lambda: module._save_sessions({"sessions": {}}),
        "upload_vibe": lambda: asyncio.run(
            module.upload_vibe(
                session="fixture", files=[UploadFile(BytesIO(b"attachment"), filename="fixture.txt")]
            )
        ),
        "update_spec": lambda: module.update_spec(
            path="fixture.md", body=module.SpecContentBody(content="Project specification")
        ),
        "_managed_manifest_save": lambda: module._managed_manifest_save({"stores": []}),
        "_compose_manifest_save": lambda: module._compose_manifest_save({"stores": []}),
        "_save_pins": lambda: module._save_pins({"runtime": {}, "tools": {}}),
        "_save_custom_catalog": lambda: module._save_custom_catalog([]),
        "_save_docker_custom_presets": lambda: module._save_docker_custom_presets([]),
        "append_exec_allowlist": lambda: module.append_exec_allowlist(
            module.ExecAllowlistAppendBody(binary="python")
        ),
    }[method]


@pytest.mark.parametrize(
    "name",
    [
        "data_ingest:_save",
        "data_quality:_save",
        "metrics_service:_save",
        "ops_center:_save",
        "tag_service:_save",
        "notify:_save_notify",
        "notify:_append_event",
        "notify:_save_subscriptions",
        "notify:_append_report_run",
        "skills:create_skill",
        "vibe:_save_history",
        "vibe:_save_sessions",
        "vibe:upload_vibe",
        "workspace:update_state",
        "workspace:update_spec",
        "docker_env:_managed_manifest_save",
        "docker_env:_compose_manifest_save",
        "docker_env:_save_pins",
        "docker_env:_save_custom_catalog",
        "docker_env:_save_docker_custom_presets",
        "docker_env:append_exec_allowlist",
    ],
)
def test_late_write_rechecks_archive_and_preserves_every_existing_file(files, name):
    sessions, root, _, _ = files
    write = operation(name, files)
    write()
    before = inventory(root)
    assert before
    # The request was admitted while active; an archive commits before its actual file mutation.
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(Project).where(Project.id == "project").values(status="archived"))
    with pytest.raises(HTTPException) as denied:
        write()
    assert denied.value.status_code == 409
    assert denied.value.detail["code"] == "project_archived"
    assert inventory(root) == before


@pytest.mark.parametrize(
    "module_name",
    [
        "data_ingest",
        "data_quality",
        "metrics_service",
        "ops_center",
        "tag_service",
        "skills",
    ],
)
def test_empty_project_catalog_reads_do_not_create_directories(files, module_name):
    _, root, _, modules = files
    module = modules[module_name]
    if module_name == "skills":
        module.list_skills()
    else:
        assert module._load_all("fixtures") == []
    assert not (root / "memory").exists()


@pytest.mark.parametrize("kind", ["dockerfile", "compose"])
def test_managed_file_versions_and_delete_keep_one_project_scope_and_block_archived_changes(files, kind):
    sessions, root, _, modules = files
    module = modules["docker_env"]
    if kind == "dockerfile":
        created = module.managed_dockerfiles_create(
            module.ManagedDockerfileCreate(name="fixture", content="FROM scratch")
        )
        update_method = module.managed_dockerfiles_update
        update_body = module.ManagedDockerfileUpdate(content="FROM busybox", bump_version=True)
        delete_method = module.managed_dockerfiles_delete
    else:
        created = module.managed_compose_create(
            module.ManagedComposeCreate(name="fixture", content="services: {}")
        )
        update_method = module.managed_compose_update
        update_body = module.ManagedComposeUpdate(
            content="services: {app: {image: busybox}}", bump_version=True
        )
        delete_method = module.managed_compose_delete

    def update_file():
        return update_method(created["id"], update_body)

    def delete_file():
        return delete_method(created["id"])

    assert update_file()["latest"] == 2
    before = inventory(root)
    assert any("v2" in path for path in before)
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(Project).where(Project.id == "project").values(status="archived"))
    for change in (update_file, delete_file):
        with pytest.raises(HTTPException) as denied:
            change()
        assert denied.value.status_code == 409
        assert inventory(root) == before
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(Project).where(Project.id == "project").values(status="active"))
    assert delete_file()["ok"]
    assert not any(created["id"] in path for path in inventory(root))


def test_file_sqlite_scope_serializes_archive_and_reentrant_save_uses_the_existing_lock(
    files, tmp_path, monkeypatch
):
    from sop_manager.project_write_guard import ManagerSession, project_file_write_scope

    _, root, _, modules = files
    engine = create_engine(
        "sqlite:///" + str(tmp_path / "project-lock.sqlite"), connect_args={"timeout": 0.01}
    )
    sql_models.Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, class_=ManagerSession)
    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    with sessions() as db:
        db.add(sql_models.Tenant(id="tenant", name="Actual tenant", slug="actual"))
        db.flush()
        db.add(Project(id="project", tenant_id="tenant", name="Actual project"))
        db.commit()
    try:
        with project_file_write_scope():
            # A separate archiver cannot commit while the short file-write scope owns Project.
            with pytest.raises(OperationalError, match="locked"):
                with engine.begin() as connection:
                    connection.execute(
                        update(Project).where(Project.id == "project").values(status="archived")
                    )
            modules["data_quality"]._save("fixtures", {"id": "locked", "status": "running"})
        before = inventory(root)
        with engine.begin() as connection:
            connection.execute(update(Project).where(Project.id == "project").values(status="archived"))
        with pytest.raises(HTTPException) as denied:
            modules["data_quality"]._save("fixtures", {"id": "locked", "status": "failed"})
        assert denied.value.status_code == 409
        assert inventory(root) == before
    finally:
        engine.dispose()
