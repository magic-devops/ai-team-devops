"""Aggregate business reads use actual identity/project scope, without fallback writes."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sop_manager.routers import sql_models as m
from sqlalchemy import event
from sqlalchemy.exc import OperationalError

from test_business_access import env as business_env
from test_business_access import headers

env = business_env

SELECTED_SECRET = "scope-selected-confidential-91d7"
OTHER_SECRET = "scope-other-confidential-6af2"


@pytest.fixture
def aggregate_env(env, monkeypatch, tmp_path):
    """Real JWT/HMAC/scope middleware and real SQL; optional stores remain absent."""
    from sop_manager.routers import data_exchange, db, knowledge_graph, pages_productization, system_pages, workspace

    client, sessions = env
    for module in (workspace, data_exchange, knowledge_graph, pages_productization, system_pages):
        client.app.include_router(module.router)
    monkeypatch.setenv("TENANT_ID", "team")
    monkeypatch.setenv("PROJECT_ID", "selected")
    # The regressions target SQL-backed business aggregates, without requiring
    # optional vector/model/file integrations or calling an external service.
    monkeypatch.setattr(db, "rows", lambda *args, **kwargs: [])
    monkeypatch.setattr(workspace, "semantic_search_status", lambda: {"available": False, "tables": []})
    monkeypatch.setattr(workspace, "_design_doc_search_hits", lambda query: [])
    monkeypatch.setattr(workspace, "list_specs", lambda: [])
    for name in ("_load_lance_knowledge", "_load_file_documents", "_load_runtime_documents"):
        monkeypatch.setattr(knowledge_graph, name, lambda: [])
    with sessions() as db_session:
        for project, secret in (("selected", SELECTED_SECRET), ("other", OTHER_SECRET)):
            project_path = Path(db_session.get(m.Project, project).project_path)
            project_path.mkdir(parents=True, exist_ok=True)
            db_session.add(m.Task(id=f"T-aggregate-{project}", tenant_id="team", project_id=project,
                                 title=secret, description=f"Confidential project material {secret}",
                                 status="blocked", acceptance_criteria=[secret]))
            # Task source is real per-project UI metadata, not a SQL Task column.
            ui_path = project_path / ".sop-runtime" / "ai-memory" / "tasks_plan_ui_state.json"
            ui_path.parent.mkdir(parents=True, exist_ok=True)
            ui_path.write_text(json.dumps({"version": 1, "columns": {priority: [] for priority in ("P0", "P1", "P2", "P3")},
                                           "fields": {f"T-aggregate-{project}": {"source": "system_page_readiness"}}}),
                               encoding="utf-8")
        db_session.add(m.Task(id="T-aggregate-extra-other", tenant_id="team", project_id="other",
                             title=OTHER_SECRET + "-extra", acceptance_criteria=[OTHER_SECRET]))
        db_session.commit()
    return client, sessions, tmp_path


def observe(sessions):
    statements = []
    engine = sessions.kw["bind"]

    def capture(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    return engine, capture, statements


def writes(statements):
    return [sql for sql in statements if sql.lstrip().lower().startswith(
        ("insert", "update", "delete", "create", "alter", "drop", "replace"))]


def task_reads(statements):
    return [sql for sql in statements if "from tasks" in sql.lower()]


FIRST_WAVE_READS = [
    "/api/v1/dashboard",
    "/api/v1/analytics",
    "/api/v1/search?q=scope-",
    "/api/v1/search/hub",
    "/api/v1/data-exchange/summary",
    "/api/v1/data-exchange/export?modules=tasks",
    "/api/v1/knowledge-graph/summary",
    "/api/v1/pages/interaction-ops?status=all",
    "/api/v1/system/pages/governance-tasks?status=all",
]


@pytest.mark.parametrize("path", FIRST_WAVE_READS)
def test_first_wave_aggregate_rejects_anonymous_before_reading_project_business_data(aggregate_env, path):
    client, sessions, _ = aggregate_env
    engine, capture, statements = observe(sessions)
    try:
        response = client.get(path, headers={"X-Project-Id": "selected"})
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 401, response.text
    assert SELECTED_SECRET not in response.text and OTHER_SECRET not in response.text
    assert task_reads(statements) == [] and writes(statements) == []


def test_first_wave_missing_dashboard_project_never_provisions_even_if_rolled_back(aggregate_env, monkeypatch):
    from sop_manager import project_provision

    client, sessions, _ = aggregate_env
    monkeypatch.setenv("ADMIN_MODE", "single")
    monkeypatch.setattr(project_provision, "ADMIN_MODE", "single")
    provision_calls = []
    actual = project_provision.ensure_project

    def track(*args, **kwargs):
        provision_calls.append(args[1])
        return actual(*args, **kwargs)

    monkeypatch.setattr(project_provision, "ensure_project", track)
    engine, capture, statements = observe(sessions)
    try:
        response = client.get("/api/v1/dashboard", headers=headers(project="stale-aggregate-project"))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 404, response.text
    assert provision_calls == [] and writes(statements) == [], "Rollback does not make provisioning a read"
    with sessions() as db_session:
        assert db_session.get(m.Project, "stale-aggregate-project") is None


def test_first_wave_export_job_is_bound_to_header_project_not_environment_project(aggregate_env):
    client, sessions, _ = aggregate_env
    with sessions() as db_session:
        db_session.get(m.ProjectMember, ("other", "writer")).role = "developer"
        db_session.commit()
    response = client.post("/api/v1/data-exchange/export-job", headers=headers(project="other"), json={"modules": ["tasks"]})
    assert response.status_code == 200, response.text
    assert response.json()["job"]["project_id"] == "other"
    assert response.json()["job"]["tenant_id"] == "team"
    assert response.json()["job"]["counts"]["tasks"] == 3


def test_first_wave_graph_build_requires_real_project_write_permission(aggregate_env):
    client, _, root = aggregate_env
    before = sorted(str(path.relative_to(root)) for path in root.rglob("*") if path.is_file())
    response = client.post("/api/v1/knowledge-graph/build", headers=headers("reader"), json={"documents": []})
    assert response.status_code == 403, response.text
    after = sorted(str(path.relative_to(root)) for path in root.rglob("*") if path.is_file())
    assert after == before


@pytest.mark.parametrize("path", ["/api/v1/search?q=scope-", "/api/v1/data-exchange/export?modules=tasks"])
def test_real_authorized_aggregate_reads_only_selected_project_and_executes_no_sql_writes(aggregate_env, path):
    client, sessions, _ = aggregate_env
    engine, capture, statements = observe(sessions)
    try:
        response = client.get(path, headers=headers("reader"))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200, response.text
    assert SELECTED_SECRET in response.text and OTHER_SECRET not in response.text
    assert writes(statements) == []
    denied = client.get(path, headers=headers("reader", "other"))
    assert denied.status_code == 403, denied.text
    assert OTHER_SECRET not in denied.text and SELECTED_SECRET not in denied.text


@pytest.mark.parametrize("path", ["/api/v1/dashboard", "/api/v1/data-exchange/export?modules=tasks", "/api/v1/knowledge-graph/summary"])
def test_aggregate_requires_explicit_project_instead_of_first_membership_fallback(aggregate_env, path):
    client, _, _ = aggregate_env
    response = client.get(path, headers={"Authorization": headers("reader")["Authorization"]})
    assert response.status_code == 400, response.text


def test_calculation_preview_and_graph_lineage_allow_reader_but_recorded_export_job_does_not(aggregate_env):
    client, sessions, root = aggregate_env
    before = sorted(str(path.relative_to(root)) for path in root.rglob("*") if path.is_file())
    engine, capture, statements = observe(sessions)
    try:
        preview = client.post("/api/v1/data-exchange/preview", headers=headers("reader"), json={"mode": "merge", "tasks": []})
        lineage = client.post("/api/v1/knowledge-graph/lineage", headers=headers("reader"), json={"entity_id": "not-present"})
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert preview.status_code == 200, preview.text
    assert lineage.status_code == 200, lineage.text
    assert writes(statements) == []
    assert sorted(str(path.relative_to(root)) for path in root.rglob("*") if path.is_file()) == before
    denied = client.post("/api/v1/data-exchange/export-job", headers=headers("reader"), json={"modules": ["tasks"]})
    assert denied.status_code == 403, denied.text


@pytest.mark.parametrize("path", ["/api/v1/pages/interaction-ops?status=all", "/api/v1/system/pages/governance-tasks?status=all"])
def test_sql_source_failure_is_not_reported_as_successful_empty_or_degraded_business_data(aggregate_env, path):
    client, sessions, _ = aggregate_env
    engine = sessions.kw["bind"]

    def unavailable(connection, cursor, statement, parameters, context, executemany):
        if "from tasks" in statement.lower():
            raise OperationalError(statement, parameters, OSError("Controlled SQL source outage"))

    event.listen(engine, "before_cursor_execute", unavailable)
    try:
        # Match a real HTTP server: application exceptions produce a failure
        # response rather than becoming a TestClient harness error.
        with TestClient(client.app, raise_server_exceptions=False) as failing_client:
            response = failing_client.get(path, headers=headers("reader"))
    finally:
        event.remove(engine, "before_cursor_execute", unavailable)
    assert response.status_code in {500, 503}, response.text
    assert SELECTED_SECRET not in response.text and OTHER_SECRET not in response.text
