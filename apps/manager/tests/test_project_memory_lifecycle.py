"""Project memory uses the same actual archive lock and business write permission."""

from hashlib import sha256

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sop_manager import memory_store, path_config
from sop_manager.routers import auth_sql, memory_api, sql_models
from sop_manager.routers.project_scope_middleware import project_scope_middleware
from sqlalchemy import update


def inventory(root):
    return {path.relative_to(root).as_posix(): sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*") if path.is_file()}


@pytest.fixture
def memory_scope(isolated_project_sql, tmp_path):
    root = tmp_path / "memory-project"
    tokens = path_config.set_request_scope("memory-tenant", "memory-project", root)
    isolated_project_sql["ensure_scope"]()
    try:
        yield isolated_project_sql["sessions"], root, memory_store.FileJsonlMemoryStore()
    finally:
        path_config.reset_request_scope(tokens)


def archive(sessions):
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(sql_models.Project).where(sql_models.Project.id == "memory-project")
                           .values(status="archived"))


@pytest.mark.parametrize("operation", ["append", "forget", "attach", "lifecycle", "summarize", "write_all", "trim"])
def test_late_memory_mutation_rechecks_archive_and_preserves_files(memory_scope, monkeypatch, operation):
    sessions, root, store = memory_scope
    first = store.append("First project memory", "long", {})
    store.append("Second project memory", "long", {})
    before = inventory(root)
    assert before
    monkeypatch.setattr(store, "_max_lines", 1)
    writes = {
        "append": lambda: store.append("Rejected memory", "long", {}),
        "forget": lambda: store.forget(ids=[first.id]),
        "attach": lambda: store.attach_run(first.id, "run-fixed"),
        "lifecycle": lambda: store.update_lifecycle(first.id, "pinned", "Reviewed"),
        "summarize": lambda: store.summarize(),
        "write_all": lambda: store._write_all([]),
        "trim": lambda: store._trim_unlocked(memory_store._scope_file()),
    }
    archive(sessions)
    with pytest.raises(HTTPException) as denied:
        writes[operation]()
    assert denied.value.status_code == 409
    assert denied.value.detail["code"] == "project_archived"
    assert inventory(root) == before
    assert len(store.recent(limit=10)) == 2


def test_empty_memory_reads_do_not_create_scope_directories(memory_scope):
    _, root, store = memory_scope
    assert store.search("Nothing", limit=10) == []
    assert store.recent(limit=10) == []
    assert not root.exists()


def test_append_trim_reenters_project_scope_without_reacquiring_thread_lock(memory_scope, monkeypatch):
    _, _, store = memory_scope
    monkeypatch.setattr(store, "_max_lines", 1)
    store.append("First", "long", {})
    second = store.append("Second", "long", {})
    assert [row["id"] for row in store.recent(limit=10)] == [second.id]


@pytest.fixture
def api(isolated_project_sql, tmp_path, monkeypatch):
    sessions = isolated_project_sql["sessions"]
    root = tmp_path / "memory-project"
    with sessions() as db:
        db.add(sql_models.Tenant(id="memory-tenant", name="Memory", slug="memory"))
        db.flush()
        unusable_hash = "not-a-login"
        for uid, role in (("memory-writer", "developer"), ("memory-reader", "viewer")):
            db.add(sql_models.User(id=uid, tenant_id="memory-tenant", username=uid,
                                   password_hash=unusable_hash, role=role, status="active"))
        db.add(sql_models.Project(id="memory-project", tenant_id="memory-tenant", name="Memory",
                                 project_path=str(root), status="active"))
        db.flush()
        for uid, role in (("memory-writer", "developer"), ("memory-reader", "viewer")):
            db.add(sql_models.ProjectMember(project_id="memory-project", user_id=uid, role=role))
        db.commit()

    def session():
        with sessions() as db:
            yield db

    store = memory_store.FileJsonlMemoryStore()
    monkeypatch.setattr(memory_api, "get_memory_store", lambda: store)
    monkeypatch.setenv("ADMIN_MODE", "saas")
    app = FastAPI()
    app.include_router(memory_api.router)
    app.middleware("http")(project_scope_middleware)
    app.dependency_overrides[sql_models.get_session] = session
    with TestClient(app) as client:
        yield client, sessions, root


def headers(uid="memory-writer"):
    return {"Authorization": "Bearer " + auth_sql._make_token(uid, "memory-tenant", "developer"),
            "X-Project-Id": "memory-project"}


def mutations(memory_id):
    return [
        ("", {"content": "New memory"}),
        ("/forget", {"ids": [memory_id]}),
        (f"/{memory_id}/attach-run", {"run_id": "run-fixed"}),
        (f"/{memory_id}/lifecycle", {"state": "pinned"}),
        ("/summarize", {}),
    ]


def test_memory_api_reader_can_read_but_cannot_mutate(api):
    client, _, root = api
    created = client.post("/api/v1/memory", headers=headers(), json={"content": "Project evidence"})
    assert created.status_code == 200, created.text
    before = inventory(root)
    memory_id = created.json()["item"]["id"]
    for suffix, body in mutations(memory_id):
        denied = client.post("/api/v1/memory" + suffix, headers=headers("memory-reader"), json=body)
        assert denied.status_code == 403, denied.text
    assert inventory(root) == before
    recent = client.get("/api/v1/memory/recent", headers=headers("memory-reader"))
    search = client.get("/api/v1/memory/search?q=evidence", headers=headers("memory-reader"))
    assert recent.status_code == search.status_code == 200
    assert recent.json()["items"][0]["id"] == search.json()["items"][0]["id"] == memory_id


def test_memory_api_archive_rejects_every_mutation_but_keeps_reads_and_public_health(api):
    client, sessions, root = api
    created = client.post("/api/v1/memory", headers=headers(), json={"content": "Original evidence"})
    assert created.status_code == 200, created.text
    memory_id = created.json()["item"]["id"]
    before = inventory(root)
    archive(sessions)
    for suffix, body in mutations(memory_id):
        denied = client.post("/api/v1/memory" + suffix, headers=headers(), json=body)
        assert denied.status_code == 409, denied.text
        assert denied.json()["detail"]["code"] == "project_archived"
    assert inventory(root) == before
    assert client.get("/api/v1/memory/recent", headers=headers()).status_code == 200
    assert client.get("/api/v1/memory/health").status_code == 200
    assert client.get("/api/v1/memory/recent").status_code == 401


def test_empty_memory_http_gets_do_not_create_project_directory(api):
    client, _, root = api
    assert client.get("/api/v1/memory/recent", headers=headers("memory-reader")).json()["items"] == []
    assert client.get("/api/v1/memory/search?q=empty", headers=headers("memory-reader")).json()["items"] == []
    assert not root.exists()
