"""UNRUN: real HTTP/SQL definitions for atomic project creation and recovery."""
import pytest
from sqlalchemy import event

from sop_manager.routers import tenants
from sop_manager.routers.sql_models import DeliveryReceipt, Project, ProjectMember, Tenant, User
from test_delivery_workbench import env as delivery_env

env = delivery_env


def prepare(client, monkeypatch):
    client.app.include_router(tenants.proj_router)
    sent = []
    monkeypatch.setattr(tenants, "notify_webhook", lambda *args, **kwargs: sent.append(args))
    return sent


def test_creation_receipt_survives_lost_response_and_later_project_edits(env, monkeypatch):
    client, sessions, _ = env
    sent = prepare(client, monkeypatch)
    body = {"name": "  New project  ", "idempotency_key": "fixed-creation-01"}
    first = client.post("/api/v1/projects", json=body)
    assert first.status_code == 200, first.text
    ack = first.json()
    assert ack["action"] == "project.create" and ack["replayed"] is False
    assert ack["creator_id"] == "lead" and ack["tenant_id"] == "tenant"
    with sessions() as db:
        project = db.get(Project, ack["id"])
        assert project.status == "planning" and project.name == "New project"
        assert db.get(ProjectMember, (project.id, "lead")).role == "project_admin"
        project.name = "Later edit"
        db.commit()
    replay = client.post("/api/v1/projects", json=body)
    assert replay.status_code == 200, replay.text
    assert replay.json() == {**ack, "replayed": True}
    assert len(sent) == 1
    with sessions() as db:
        assert db.get(Project, ack["id"]).name == "Later edit"
        assert db.query(DeliveryReceipt).filter_by(project_id=ack["id"]).count() == 1


def test_creation_key_cannot_replace_input_and_does_not_implicitly_deduplicate_names(env, monkeypatch):
    client, sessions, _ = env
    prepare(client, monkeypatch)
    body = {"name": "A", "idempotency_key": "fixed-creation-02"}
    first = client.post("/api/v1/projects", json=body)
    assert first.status_code == 200
    for patch in [{"name": "B"}, {"status": "active"}, {"description": "Changed"}]:
        assert client.post("/api/v1/projects", json={**body, **patch}).status_code == 409
    second = client.post("/api/v1/projects", json={**body, "idempotency_key": "different-original"})
    assert second.status_code == 200 and second.json()["id"] != first.json()["id"]


def test_creation_revalidates_active_role_and_tenant_business_before_writing(env, monkeypatch):
    client, sessions, actor = env
    prepare(client, monkeypatch)
    body = {"name": "New", "idempotency_key": "fixed-creation-03"}
    assert client.post("/api/v1/projects", json={**body, "business_id": "foreign-business"}).status_code == 404
    actor["id"] = "reader"
    assert client.post("/api/v1/projects", json=body).status_code == 403
    actor["id"] = "lead"
    with sessions() as db:
        db.get(User, "lead").status = "disabled"
        db.commit()
    assert client.post("/api/v1/projects", json=body).status_code == 403
    with sessions() as db:
        assert db.query(Project).count() == 2


@pytest.mark.parametrize("patch", [{"idempotency_key": "short"}, {"idempotency_key": "bad key 000"}, {"status": "archived"}, {"name": " "}])
def test_creation_rejects_invalid_originals(env, monkeypatch, patch):
    client, _, _ = env
    prepare(client, monkeypatch)
    response = client.post("/api/v1/projects", json={"name": "New", "idempotency_key": "valid-original", **patch})
    assert response.status_code == 422, response.text


def test_creation_notification_failure_does_not_mask_committed_result(env, monkeypatch):
    client, sessions, _ = env
    prepare(client, monkeypatch)
    def fail(*_args, **_kwargs):
        raise RuntimeError("notification unavailable")
    monkeypatch.setattr(tenants, "notify_webhook", fail)
    body = {"name": "New", "idempotency_key": "fixed-creation-04"}
    response = client.post("/api/v1/projects", json=body)
    assert response.status_code == 200
    assert client.post("/api/v1/projects", json=body).json()["replayed"] is True


def test_receipt_failure_rolls_back_project_and_creator_membership(env, monkeypatch):
    client, sessions, _ = env
    sent = prepare(client, monkeypatch)
    session_type = sessions.class_
    def fail(db, *_args):
        if any(isinstance(row, DeliveryReceipt) for row in db.new):
            raise RuntimeError("receipt storage unavailable")
    event.listen(session_type, "before_flush", fail)
    try:
        with pytest.raises(RuntimeError, match="receipt storage unavailable"):
            client.post("/api/v1/projects", json={"name": "New", "idempotency_key": "fixed-creation-05"})
    finally:
        event.remove(session_type, "before_flush", fail)
    with sessions() as db:
        assert db.query(Project).count() == 2
        assert db.query(ProjectMember).filter_by(user_id="lead").count() == 0
        assert db.query(DeliveryReceipt).count() == 0
    assert not sent


def test_creation_and_delivery_command_receipts_have_disjoint_domains(env, monkeypatch):
    client, sessions, actor = env
    prepare(client, monkeypatch)
    with sessions() as db:
        db.add(Tenant(id="project.create", name="Namespace tenant", slug="namespace"))
        db.flush()
        db.add(Project(id="project.create", tenant_id="project.create", name="Existing"))
        db.add(User(id="namespace-admin", tenant_id="project.create", username="namespace-admin", password_hash="not-a-login", role="tenant_admin", status="active"))
        db.commit()
    actor["id"] = "namespace-admin"
    original = {"action": "task.create", "payload": {"title": "Task", "acceptance_criteria": ["Works"]},
                "expected_version": 0, "idempotency_key": "namespace-original"}
    first = client.post("/api/v1/delivery/commands", headers={"X-Project-Id": "project.create"}, json=original)
    assert first.status_code == 200, first.text
    creation = client.post("/api/v1/projects", json={"name": "New", "idempotency_key": "namespace-original"})
    assert creation.status_code == 200, creation.text
    replay = client.post("/api/v1/delivery/commands", headers={"X-Project-Id": "project.create"}, json=original)
    assert replay.status_code == 200 and replay.json()["replayed"] is True
