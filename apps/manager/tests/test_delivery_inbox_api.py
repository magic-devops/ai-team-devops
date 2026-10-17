"""The inbox uses the same authenticated project boundary and never writes on read."""

from sop_manager.routers.auth_sql import current_user
from sop_manager.routers.sql_models import DeliveryEvent, DeliveryReceipt, DeliveryWorkspace, Project, Tenant
from test_delivery_workbench import env as delivery_env

env = delivery_env


def test_inbox_is_a_pure_project_read_with_validated_scope(env):
    client, sessions, _ = env

    def counts():
        with sessions() as db:
            return tuple(db.query(model).count() for model in (DeliveryWorkspace, DeliveryEvent, DeliveryReceipt))

    before = counts()
    response = client.get("/api/v1/delivery/inbox")
    assert response.status_code == 200
    body = response.json()
    assert body["project_id"] == "project"
    assert body["scope"] == "mine"
    assert body["current_user_id"] == "lead"
    assert body["items"] == []
    assert client.get("/api/v1/delivery/inbox?scope=team").json()["scope"] == "team"
    assert client.get("/api/v1/delivery/inbox?scope=unknown").status_code == 422
    assert counts() == before


def test_inbox_requires_explicit_accessible_project_and_identity(env):
    client, sessions, actor = env
    assert client.get("/api/v1/delivery/inbox", headers={"X-Project-Id": ""}).status_code == 400
    actor["id"] = "reader"
    assert client.get("/api/v1/delivery/inbox", headers={"X-Project-Id": "other"}).status_code == 403
    with sessions() as db:
        db.add(Tenant(id="foreign-tenant", name="Foreign", slug="foreign"))
        db.flush()
        db.add(Project(id="foreign-project", tenant_id="foreign-tenant", name="Foreign"))
        db.commit()
    actor["id"] = "lead"
    assert client.get("/api/v1/delivery/inbox", headers={"X-Project-Id": "foreign-project"}).status_code == 403
    client.app.dependency_overrides.pop(current_user)
    assert client.get("/api/v1/delivery/inbox").status_code == 401


def test_read_only_member_sees_team_work_without_personal_approval(env):
    client, _, actor = env
    result = client.post("/api/v1/delivery/commands", json={
        "action": "requirement.create", "expected_version": 0,
        "idempotency_key": "inbox-api-requirement",
        "payload": {"title": "Ready for product review", "description": "Review scope", "acceptance_criteria": ["Scope is explicit"]},
    })
    assert result.status_code == 200
    actor["id"] = "reader"
    personal = client.get("/api/v1/delivery/inbox")
    assert personal.status_code == 200
    assert personal.json()["counts"]["approval"] == 0
    team = client.get("/api/v1/delivery/inbox?scope=team")
    assert team.status_code == 200
    assert team.json()["project_id"] == "project"
