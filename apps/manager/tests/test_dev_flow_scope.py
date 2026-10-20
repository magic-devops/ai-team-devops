"""Development flow reads require an authenticated, explicit, existing project."""

import pytest
from sop_manager.routers import dev_flow
from sop_manager.routers import sql_models as m
from sqlalchemy import event
from test_business_access import env as business_env
from test_business_access import headers

env = business_env


@pytest.fixture
def flow_env(env, monkeypatch, tmp_path):
    client, sessions = env
    client.app.include_router(dev_flow.router)
    # Match a configured local project even for requests that omit credentials;
    # the endpoint must authorize rather than expose this environment fallback.
    monkeypatch.setenv("TENANT_ID", "team")
    monkeypatch.setenv("PROJECT_ID", "selected")
    with sessions() as db:
        db.add(m.Project(id="empty", tenant_id="team", name="Empty project", project_path=str(tmp_path / "empty")))
        db.flush()
        db.add(m.ProjectMember(project_id="empty", user_id="reader", role="viewer"))
        db.commit()
    return client, sessions


@pytest.mark.parametrize("project,expected", [("stale-project", 404), (None, 400)])
def test_single_mode_missing_or_stale_project_is_rejected_without_provision(flow_env, monkeypatch, project, expected):
    from sop_manager import project_provision

    client, sessions = flow_env
    monkeypatch.setenv("ADMIN_MODE", "single")
    monkeypatch.setenv("PROJECT_ID", "missing-environment-project")
    monkeypatch.setattr(project_provision, "ADMIN_MODE", "single")
    calls = []
    original = project_provision.ensure_project

    def track(db, project_id, **kwargs):
        calls.append(project_id)
        return original(db, project_id, **kwargs)

    monkeypatch.setattr(project_provision, "ensure_project", track)
    auth = headers(project=project or "selected")
    if project is None:
        auth.pop("X-Project-Id")
    response = client.get("/api/v1/dev-flow/summary", headers=auth)
    assert (response.status_code, calls) == (expected, []), response.text
    assert "Task project scope does not exist" not in response.text
    with sessions() as db:
        assert db.get(m.Project, "stale-project") is None
        assert db.get(m.Project, "missing-environment-project") is None


def test_dev_flow_summary_requires_identity_before_environment_scope_read(flow_env):
    client, _ = flow_env
    response = client.get("/api/v1/dev-flow/summary", headers={"X-Project-Id": "selected"})
    assert response.status_code == 401, response.text
    assert "T-selected" not in response.text


def test_explicit_empty_project_summary_is_read_only_and_truthfully_empty(flow_env):
    client, sessions = flow_env
    engine = sessions.kw["bind"]
    writes = []

    def watch(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().lower().startswith(("insert", "update", "delete", "create", "alter", "drop", "replace")):
            writes.append(statement)

    event.listen(engine, "before_cursor_execute", watch)
    try:
        response = client.get("/api/v1/dev-flow/summary", headers=headers("reader", "empty"))
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["requirements"]["total"] == 0
    assert data["tasks"]["total_all"] == 0 and data["tasks"]["sprint_scope"] == 0
    assert data["issues"]["total"] == 0 and data["sprint"] is None
    assert writes == []


@pytest.mark.parametrize("path", ["summary", "charts", "hub", "ops-plan", "lifecycle", "burndown", "templates"])
def test_every_dev_flow_read_denies_foreign_project(flow_env, path):
    client, _ = flow_env
    response = client.get(f"/api/v1/dev-flow/{path}", headers=headers(project="private"))
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("dry_run", [True, False])
def test_dev_flow_task_dispatch_requires_current_project_write_permission(flow_env, dry_run):
    client, sessions = flow_env
    with sessions() as db:
        before = db.query(m.Task).count()
    response = client.post("/api/v1/dev-flow/ops-tasks", headers=headers("reader"), json={"dry_run": dry_run})
    assert response.status_code == 403, response.text
    with sessions() as db:
        assert db.query(m.Task).count() == before
