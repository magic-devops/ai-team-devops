"""Actual JWT project middleware must not provision a project during reflection GET."""

import pytest
from sop_manager.routers import sql_models as m
from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
from sqlalchemy import event

from test_event_handoff import env  # noqa: F401
from test_reflection_intake import reflection_env  # noqa: F401


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/v1/reflections"), ("GET", "/api/v1/reflections/unknown"),
    ("GET", "/api/v1/reflections/inputs"), ("GET", "/api/v1/reflections/inputs/unknown"),
    ("GET", "/api/v1/system/pages/capabilities/me"), ("POST", "/api/v1/system/pages/capabilities/check"),
])
def test_real_jwt_reflection_get_with_missing_project_does_not_attempt_provision_or_write(reflection_env, monkeypatch, tmp_path, method, path):
    from sop_manager import project_provision
    from sop_manager.routers.auth_sql import _make_token
    from sop_manager.routers.project_scope_middleware import project_scope_middleware

    client, sessions, _, app = reflection_env
    if "/capabilities/" in path:
        from sop_manager.routers.system_pages import router
        app.include_router(router)
    app.dependency_overrides.pop(current_user_or_apikey)
    app.dependency_overrides.pop(current_user)
    app.middleware("http")(project_scope_middleware)
    monkeypatch.setattr(m, "SessionLocal", sessions)
    monkeypatch.setattr(project_provision, "ADMIN_MODE", "single")
    monkeypatch.setenv("ADMIN_MODE", "single")
    monkeypatch.setenv("TENANT_ID", "tenant")
    monkeypatch.setenv("PROJECT_PATH", str(tmp_path))
    provision_calls = []
    writes = []
    actual = project_provision.ensure_project

    def provision(*args, **kwargs):
        provision_calls.append(args[1])
        return actual(*args, **kwargs)

    def capture(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().lower().startswith(("insert", "update", "delete", "create", "alter")):
            writes.append(statement)

    monkeypatch.setattr(project_provision, "ensure_project", provision)
    engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", capture)
    try:
        token = _make_token("lead", "tenant", "tenant_admin")
        response = client.request(method, path, headers={"Authorization": "Bearer " + token, "X-Project-Id": "missing-reflection-project"},
                                  json={"capability": "ai.intelligence.reflections", "action": "read"} if method == "POST" else None)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 404, response.text
    assert provision_calls == [], "A GET invoked real project provisioning even if its transaction later rolled back"
    assert writes == [], "A rejected GET must not execute business SQL writes"
    with sessions() as db:
        assert db.get(m.Project, "missing-reflection-project") is None
