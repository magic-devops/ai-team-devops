"""Project resources use versioned delivery metadata and canonical SQL projects."""

from copy import deepcopy

import pytest
from sop_manager.routers.sql_models import (
    DeliveryEvent,
    DeliveryReceipt,
    DeliveryWorkspace,
    Project,
    ProjectMember,
    Tenant,
    User,
)
from test_delivery_workbench import command
from test_delivery_workbench import env as delivery_env

env = delivery_env


def resource(**changes):
    return {
        "kind": "repository",
        "title": "Product source",
        "url": "https://github.com/example/product?ref=main",
        "description": "Main repository",
        "ref": "main",
        **changes,
    }


def add_actor(sessions, actor_id, role, project_id="project"):
    unusable_hash = "not-a-login"
    with sessions() as db:
        db.add(
            User(
                id=actor_id,
                tenant_id="tenant",
                username=actor_id,
                password_hash=unusable_hash,
                role=role,
                status="active",
            )
        )
        db.flush()
        db.add(ProjectMember(project_id=project_id, user_id=actor_id, role=role))
        db.commit()


def test_project_partial_edits_update_canonical_rows_without_losing_metadata(env):
    client, sessions, _ = env
    first = command(
        client,
        "project.update",
        {
            "goal": "Deliver an accessible product",
            "owner_id": "user:lead",
            "starts_on": "2026-10-17",
            "ends_on": "2026-11-01",
        },
    )
    assert first.status_code == 200, first.text
    updated = command(client, "project.update", {"name": "New product", "description": "Overview"})
    assert updated.status_code == 200, updated.text
    project = updated.json()["project"]
    assert project["name"] == "New product" and project["description"] == "Overview"
    assert project["goal"] == "Deliver an accessible product"
    assert project["owner_id"] == "user:lead"
    assert project["starts_on"] == "2026-10-17" and project["ends_on"] == "2026-11-01"
    assert project["status"] == "active"
    goal = command(client, "project.update", {"goal": "Updated outcome"})
    assert goal.status_code == 200, goal.text
    assert goal.json()["project"]["owner_id"] == "user:lead"
    assert goal.json()["project"]["ends_on"] == "2026-11-01"
    clear = command(client, "project.update", {"description": "", "ends_on": None})
    assert clear.status_code == 200, clear.text
    assert clear.json()["project"]["description"] == ""
    assert clear.json()["project"]["ends_on"] is None
    with sessions() as db:
        assert db.query(Project).count() == 2
        assert db.get(Project, "project").name == "New product"
        assert db.get(Project, "project").description == ""
        assert db.get(Project, "other").name == "Other"
        metadata = db.get(DeliveryWorkspace, "project").data["project"]
        assert "name" not in metadata and "description" not in metadata
        event = db.query(DeliveryEvent).filter_by(action="project.update", version=2).one()
        assert event.data["before"]["name"] == "Product"
        assert event.data["before"]["goal"] == "Deliver an accessible product"


def test_project_partial_dates_validate_combined_stored_range_atomically(env):
    client, sessions, _ = env
    first = command(client, "project.update", {"starts_on": "2026-10-17", "ends_on": "2026-11-01"})
    assert first.status_code == 200
    bad = command(client, "project.update", {"name": "Must roll back", "ends_on": "2026-10-01"})
    assert bad.status_code == 422, bad.text
    state = client.get("/api/v1/delivery/workspace").json()
    assert state["version"] == 1 and state["project"]["ends_on"] == "2026-11-01"
    with sessions() as db:
        assert db.get(Project, "project").name == "Product"
        assert db.query(DeliveryEvent).count() == 1


@pytest.mark.parametrize(
    "payload", [{"name": ""}, {"name": None}, {"description": None}, {"name": "a" * 129}]
)
def test_invalid_canonical_project_fields_never_change_rows(env, payload):
    client, sessions, _ = env
    response = command(client, "project.update", payload)
    assert response.status_code == 422, response.text
    with sessions() as db:
        assert db.get(Project, "project").name == "Product"
        assert db.query(DeliveryEvent).count() == 0


def test_resource_create_edit_archive_restore_preserves_audit_and_project_rows(env):
    client, sessions, _ = env
    created = command(client, "resource.save", resource())
    assert created.status_code == 200, created.text
    entry = created.json()["resources"][0]
    rid = entry["id"]
    assert entry["archived"] is False
    assert entry["created_by"] == entry["updated_by"] == "lead"
    assert entry["created_at"].endswith("Z") and entry["updated_at"].endswith("Z")
    edited = command(client, "resource.save", resource(id=rid, title="Source and delivery"))
    assert edited.status_code == 200, edited.text
    changed = edited.json()["resources"][0]
    assert changed["title"] == "Source and delivery"
    assert changed["created_at"] == entry["created_at"]
    archived = command(client, "resource.archive", {"id": rid, "comment": "Superseded repository"})
    assert archived.status_code == 200, archived.text
    inactive = archived.json()["resources"][0]
    assert inactive["archived"] is True and inactive["created_at"] == entry["created_at"]
    restored = command(client, "resource.save", resource(id=rid, title="Restored source", archived=False))
    assert restored.status_code == 200, restored.text
    active = restored.json()["resources"][0]
    assert active["id"] == rid and active["archived"] is False
    assert active["created_at"] == entry["created_at"] and active["created_by"] == "lead"
    with sessions() as db:
        state = db.get(DeliveryWorkspace, "project")
        assert len(state.data["resources"]) == 1 and state.version == 4
        events = db.query(DeliveryEvent).order_by(DeliveryEvent.version).all()
        assert [e.action for e in events] == [
            "resource.save",
            "resource.save",
            "resource.archive",
            "resource.save",
        ]
        assert events[0].data["before"] is None
        assert events[1].data["before"] == entry
        assert events[2].data["before"] == changed
        assert events[2].data["input"]["comment"] == "Superseded repository"
        assert events[3].data["before"] == inactive
        assert all(e.resource_id == rid for e in events)
        assert db.query(Project).count() == 2 and db.get(Project, "project").name == "Product"


def test_resources_are_project_scoped_and_unknown_ids_cannot_be_copied_or_archived(env):
    client, sessions, _ = env
    created = command(client, "resource.save", resource())
    assert created.status_code == 200, created.text
    rid = created.json()["resources"][0]["id"]
    client.headers["X-Project-Id"] = "other"
    assert client.get("/api/v1/delivery/workspace").json()["resources"] == []
    assert command(client, "resource.save", resource(id=rid)).status_code == 404
    assert command(client, "resource.archive", {"id": rid}).status_code == 404
    saved_other = command(client, "resource.save", resource(title="Other project docs", kind="document"))
    assert saved_other.status_code == 200, saved_other.text
    assert saved_other.json()["resources"][0]["id"] != rid
    client.headers["X-Project-Id"] = "project"
    assert client.get("/api/v1/delivery/workspace").json()["resources"][0]["id"] == rid
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").version == 1
        assert db.get(DeliveryWorkspace, "other").version == 1
        assert db.query(DeliveryEvent).count() == 2


def test_resource_replay_returns_current_state_and_conflict_does_not_duplicate(env):
    client, sessions, _ = env
    payload = resource()
    first = command(client, "resource.save", payload, "stable-resource-create", 0)
    assert first.status_code == 200, first.text
    rid = first.json()["resources"][0]["id"]
    assert command(client, "resource.save", resource(id=rid, title="Later edit")).status_code == 200
    replay = command(client, "resource.save", payload, "stable-resource-create", 0)
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True and replay.json()["applied_version"] == 1
    assert replay.json()["version"] == 2 and replay.json()["resources"][0]["title"] == "Later edit"
    assert (
        command(client, "resource.save", resource(title="Changed"), "stable-resource-create", 0).status_code
        == 409
    )
    assert (
        command(
            client, "resource.save", resource(id=rid, title="Stale"), "stale-resource-edit", 1
        ).status_code
        == 409
    )
    archived = command(client, "resource.archive", {"id": rid}, "stable-resource-archive", 2)
    assert archived.status_code == 200
    assert command(client, "resource.archive", {"id": rid}, "stable-resource-archive", 2).json()["replayed"]
    with sessions() as db:
        assert len(db.get(DeliveryWorkspace, "project").data["resources"]) == 1
        assert db.query(DeliveryEvent).count() == db.query(DeliveryReceipt).count() == 3


def test_legacy_workspace_has_empty_resources_and_canonical_project_wins_without_read_writes(env):
    client, sessions, _ = env
    fresh = client.get("/api/v1/delivery/workspace").json()
    assert fresh["resources"] == [] and fresh["project"]["status"] == "active"
    with sessions() as db:
        assert db.query(DeliveryWorkspace).count() == 0
    assert command(client, "project.update", {"goal": "Legacy goal"}).status_code == 200
    with sessions() as db:
        row = db.get(DeliveryWorkspace, "project")
        original = deepcopy(row.data)
        original.pop("resources", None)
        original["project"].update(name="Stale duplicate", description="Stale metadata", status="archived")
        row.data = original
        db.commit()
    old = client.get("/api/v1/delivery/workspace").json()
    assert old["resources"] == [] and old["project"]["name"] == "Product"
    assert old["project"]["description"] == "" and old["project"]["status"] == "active"
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").data == original
        assert db.get(DeliveryWorkspace, "project").version == 1


def test_resource_and_canonical_edit_require_configure_while_goal_remains_write(env):
    client, sessions, actor = env
    add_actor(sessions, "developer", "developer")
    add_actor(sessions, "manager", "project_admin")
    actor["id"] = "developer"
    assert command(client, "project.update", {"goal": "Developer can clarify goal"}).status_code == 200
    assert command(client, "project.update", {"name": "Forbidden"}).status_code == 403
    assert command(client, "project.update", {"description": "Forbidden"}).status_code == 403
    assert (
        command(client, "project.update", {"name": "Forbidden", "goal": "Must roll back"}).status_code == 403
    )
    assert command(client, "resource.save", resource()).status_code == 403
    actor["id"] = "manager"
    saved = command(client, "resource.save", resource())
    assert saved.status_code == 200, saved.text
    rid = saved.json()["resources"][0]["id"]
    assert saved.json()["resources"][0]["created_by"] == "manager"
    assert command(client, "project.update", {"name": "Configured product"}).status_code == 200
    actor["id"] = "developer"
    assert command(client, "resource.archive", {"id": rid}).status_code == 403
    actor["id"] = "reader"
    read = client.get("/api/v1/delivery/workspace")
    assert read.status_code == 200 and read.json()["resources"][0]["id"] == rid
    assert command(client, "resource.save", resource(id=rid)).status_code == 403
    with sessions() as db:
        assert db.get(Project, "project").name == "Configured product"
        assert db.get(DeliveryWorkspace, "project").data["project"]["goal"] == "Developer can clarify goal"


def test_cross_tenant_resources_and_project_fields_are_not_readable_or_writable(env):
    client, sessions, _ = env
    with sessions() as db:
        db.add(Tenant(id="private-tenant", name="Private", slug="private"))
        db.flush()
        db.add(Project(id="private-project", tenant_id="private-tenant", name="Private product"))
        db.commit()
    client.headers["X-Project-Id"] = "private-project"
    assert client.get("/api/v1/delivery/workspace").status_code == 403
    for action, payload in [
        ("resource.save", resource()),
        ("resource.archive", {"id": "resource-private"}),
        ("project.update", {"name": "Cross tenant"}),
    ]:
        response = client.post(
            "/api/v1/delivery/commands",
            json={
                "action": action,
                "expected_version": 0,
                "idempotency_key": "cross-tenant-denied",
                "payload": payload,
            },
        )
        assert response.status_code == 403, response.text
    with sessions() as db:
        assert db.get(Project, "private-project").name == "Private product"
        assert db.query(DeliveryWorkspace).count() == db.query(DeliveryEvent).count() == 0


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "file:///C:/private",
        "https://user:password@example.org/repo",
        "https://user@example.org/repo",
        "https:///missing-host",
        "https://example.org:bad/repo",
        "https://example.org/\nrepo",
        "\thttps://example.org/repo",
        "https://example.org/%0Drepo",
        "https://example.org/repo?token=credential",
        "https://example.org/repo?access_token=credential",
        "https://example.org/repo?password=credential",
        "https://example.org/repo?api-key=credential",
        "https://example.org/repo?secret=credential",
        "https://example.org/repo?%74oken=credential",
        "https://example.org/repo?X-Amz-Credential=credential",
        "https://example.org/repo?X-Amz-Signature=credential",
        "https://exa mple.org/repo",
        "https://example.org/repo?private_token=credential",
        "https://example.org/repo?securityToken=credential",
        "https://example.org/repo?secret_key=credential",
    ],
)
def test_resource_rejects_unsafe_or_credential_urls_without_writing(env, url):
    client, sessions, _ = env
    response = command(client, "resource.save", resource(url=url))
    assert response.status_code == 422, response.text
    with sessions() as db:
        assert db.query(DeliveryEvent).count() == db.query(DeliveryWorkspace).count() == 0


@pytest.mark.parametrize("kind", ["repository", "document", "design", "other"])
def test_resource_accepts_normal_http_links_and_domain_kinds_without_fetching(env, kind):
    client, _, _ = env
    response = command(
        client,
        "resource.save",
        resource(
            kind=kind,
            url="http://localhost:3000/docs?ref=feature%2Fsearch&branch=main&keynote=design#section",
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["resources"][0]["kind"] == kind


@pytest.mark.parametrize(
    "changes",
    [
        {"title": ""},
        {"title": "a" * 201},
        {"kind": "executable"},
        {"description": "a" * 4001},
        {"ref": "a" * 201},
        {"url": "https://example.org/" + "a" * 2000},
    ],
)
def test_resource_input_bounds_are_enforced(env, changes):
    client, _, _ = env
    response = command(client, "resource.save", resource(**changes))
    assert response.status_code == 422, response.text
