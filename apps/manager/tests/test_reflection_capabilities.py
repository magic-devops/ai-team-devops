"""The real navigation grant follows this module's project authorization."""

import pytest
from sop_manager.routers import sql_models as m

from test_event_handoff import env  # noqa: F401
from test_reflection_intake import reflection_env  # noqa: F401


@pytest.fixture
def capability_env(reflection_env):
    from sop_manager.routers.system_pages import router

    client, sessions, actor, app = reflection_env
    app.include_router(router)
    with sessions() as db:
        db.get(m.User, "lead").role = "viewer"
        db.add(m.ProjectMember(project_id="project", user_id="lead", role="viewer"))
        db.commit()
    return client, sessions, actor


def grants(client, project="project"):
    response = client.get("/api/v1/system/pages/capabilities/me", headers={"X-Project-Id": project})
    assert response.status_code == 200, response.text
    return {row["id"]: row for row in response.json()["items"]}


def test_project_viewer_can_reach_reflection_recovery_and_original_only_not_all_ai(capability_env):
    client, _, _ = capability_env
    current = grants(client)
    for key in ("reflectionIntake", "eventStream"):
        assert current[key]["visible"] is True
        assert current[key]["allowed"]["read"] is True
        assert current[key]["allowed"]["write"] is False
    assert current["ruleCenter"]["visible"] is False
    assert current["ragSearch"]["visible"] is False


def test_scoped_capability_uses_actual_project_writer_role_and_archive_state(capability_env):
    from sqlalchemy import update

    client, sessions, _ = capability_env
    with sessions() as db:
        db.get(m.ProjectMember, ("project", "lead")).role = "developer"
        db.commit()
    current = grants(client)
    assert current["reflectionIntake"]["allowed"]["write"] is True
    with sessions() as db:
        db.connection().execute(update(m.Project).where(m.Project.id == "project").values(status="archived"))
        db.commit()
    current = grants(client)
    assert current["reflectionIntake"]["allowed"]["read"] is True
    assert current["reflectionIntake"]["allowed"]["write"] is False


def test_scoped_capability_never_provisions_missing_or_unjoined_projects(capability_env):
    client, sessions, _ = capability_env
    for project in ("missing", "other", ""):
        current = grants(client, project)
        assert not current["reflectionIntake"]["visible"]
        assert not current["eventStream"]["allowed"]["read"]
    with sessions() as db:
        assert db.get(m.Project, "missing") is None


def test_actual_capability_check_uses_the_same_project_grant(capability_env):
    client, sessions, _ = capability_env
    body = {"capability": "ai.intelligence.reflections", "action": "write"}
    denied = client.post("/api/v1/system/pages/capabilities/check", json=body)
    assert denied.status_code == 200 and denied.json()["allowed"] is False
    with sessions() as db:
        db.get(m.ProjectMember, ("project", "lead")).role = "developer"
        db.commit()
    allowed = client.post("/api/v1/system/pages/capabilities/check", json=body)
    assert allowed.status_code == 200 and allowed.json()["allowed"] is True
    assert allowed.json()["project_id"] == "project"
    missing = client.post("/api/v1/system/pages/capabilities/check", headers={"X-Project-Id": "missing"}, json=body)
    assert missing.status_code == 200 and missing.json()["allowed"] is False
