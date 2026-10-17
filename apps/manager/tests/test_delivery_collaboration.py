"""Real SQL activity, observed definitions and explicit change-preview boundaries."""

from datetime import datetime

from sop_manager.routers.sql_models import DeliveryEvent, DeliveryWorkspace, Requirement, Task
from sqlalchemy import update
from test_delivery_deployment_domain import create as create_deployment
from test_delivery_deployment_domain import domain as domain  # noqa: F401
from test_delivery_execution import bridge as bridge  # noqa: F401
from test_delivery_execution import queue
from test_delivery_release import scope as scope  # noqa: F401
from test_delivery_release import trusted as trusted  # noqa: F401
from test_delivery_workbench import command, requirement
from test_delivery_workbench import env as env


def activity(client, **params):
    return client.get("/api/v1/delivery/activity", params=params)


def history(client, rid, **params):
    return client.get(f"/api/v1/delivery/requirements/{rid}/history", params=params)


def preview(client, rid, changes, basis=None):
    current = client.get("/api/v1/delivery/workspace").json()
    req = next(row for row in current["requirements"] if row["id"] == rid)
    return client.post(
        f"/api/v1/delivery/requirements/{rid}/change-preview",
        json={
            "requirement_basis": req["basis"] if basis is None else basis,
            "changes": changes,
        },
    )


def test_requirement_activity_filters_before_bounded_pagination(env):
    client, _, _ = env
    rid = requirement(client)
    for index in range(53):
        assert command(client, "project.update", {"goal": str(index)}).status_code == 200
    result = activity(client, scope="requirement", scope_id=rid)
    assert result.status_code == 200, result.text
    assert [row["action"] for row in result.json()["items"]] == ["requirement.create"]
    assert result.json()["items"][0]["requirement_ids"] == [rid]


def test_activity_fixed_upper_bound_and_cursor_scope_are_enforced(env):
    client, sessions, _ = env
    requirement(client)
    with sessions() as db:
        for index in range(205):
            db.add(
                DeliveryEvent(
                    id=f"old-{index:04}",
                    tenant_id="tenant",
                    project_id="project",
                    version=index + 100,
                    actor="old",
                    action="project.update",
                    data={
                        "input": {"password": "DO-NOT-EXPOSE"},
                        "result": {"command": "private"},
                    },
                )
            )
        db.get(DeliveryWorkspace, "project").version = 304
        db.commit()
    first = activity(client, limit=100)
    assert first.status_code == 200, first.text
    token = first.json()["next_cursor"]
    assert token
    assert command(client, "project.update", {"goal": "after first page"}).status_code == 200
    second = activity(client, cursor=token, limit=100)
    third = activity(client, cursor=second.json()["next_cursor"], limit=100)
    ids = [row["id"] for page in (first, second, third) for row in page.json()["items"]]
    assert len(ids) == len(set(ids)) == 206
    assert "DO-NOT-EXPOSE" not in first.text and "private" not in first.text
    assert all(row["association"] == "unknown" for row in first.json()["items"])
    bad = activity(client, scope="requirement", scope_id="different", cursor=token, limit=100)
    assert bad.status_code == 422
    assert activity(client, action="task.update", cursor=token, limit=100).status_code == 422


def test_activity_keeps_recorded_requirement_after_task_reparent_or_deletion(env):
    client, sessions, _ = env
    first = requirement(client)
    response = command(client, "requirement.create", {"title": "Other", "acceptance_criteria": ["B"]})
    second = next(row["id"] for row in response.json()["requirements"] if row["id"] != first)
    created = command(client, "task.create", {"requirement_id": first, "title": "Original task"})
    tid = created.json()["tasks"][0]["id"]
    assert command(client, "task.update", {"id": tid, "description": "Edited under first"}).status_code == 200
    before = activity(client, scope="requirement", scope_id=first).json()["items"]
    event = next(row for row in before if row["action"] == "task.update")
    with sessions() as db:
        db.get(Task, tid).req_id = second
        db.commit()
    assert event["id"] in [
        row["id"] for row in activity(client, scope="requirement", scope_id=first).json()["items"]
    ]
    assert event["id"] not in [
        row["id"] for row in activity(client, scope="requirement", scope_id=second).json()["items"]
    ]
    with sessions() as db:
        db.delete(db.get(Task, tid))
        db.commit()
    exact = client.get(f"/api/v1/delivery/activity/{event['id']}")
    assert exact.status_code == 200
    assert exact.json()["item"]["target"]["available"] is False
    assert exact.json()["item"]["target"]["reason"] == "target_missing"


def test_history_records_only_actual_definitions_and_reads_are_pure(env):
    client, sessions, _ = env
    rid = requirement(client)
    initial = history(client, rid)
    assert initial.status_code == 200, initial.text
    assert initial.json()["items"][0]["definition"]["title"] == "Search"
    assert initial.json()["items"][0]["number"] == 1
    with sessions() as db:
        before = {
            table.name: db.connection().execute(table.select()).all()
            for table in Requirement.metadata.sorted_tables
        }
    selected = initial.json()["items"][0]
    assert client.get(f"/api/v1/delivery/requirements/{rid}/history/{selected['id']}").status_code == 200
    assert activity(client).status_code == 200
    assert preview(client, rid, {"description": "Future"}).status_code == 200
    with sessions() as db:
        after = {
            table.name: db.connection().execute(table.select()).all()
            for table in Requirement.metadata.sorted_tables
        }
    assert after == before
    assert command(client, "requirement.update", {"id": rid, "priority": "P0"}).status_code == 200
    assert len(history(client, rid).json()["items"]) == 1


def test_change_requires_current_definition_and_exact_preview(env):
    client, _, _ = env
    rid = requirement(client)
    generated = preview(client, rid, {"description": "Reviewed change"})
    assert generated.status_code == 200, generated.text
    view = generated.json()
    assert view["changes"] == [
        {"field": "description", "before": "Search project work", "after": "Reviewed change"}
    ]
    state = client.get("/api/v1/delivery/workspace").json()
    body = {
        "action": "requirement.update",
        "expected_version": state["version"],
        "idempotency_key": "exact-change-request",
        "payload": {
            "id": rid,
            "description": "Unreviewed change",
            "requirement_basis": view["requirement_basis"],
            "change_preview_basis": view["preview_basis"],
        },
    }
    wrong = client.post("/api/v1/delivery/commands", json=body)
    assert wrong.status_code == 409
    assert wrong.json()["detail"]["code"] == "requirement_change_preview_changed"
    body["payload"]["description"] = "Reviewed change"
    saved = client.post("/api/v1/delivery/commands", json=body)
    assert saved.status_code == 200, saved.text
    again = client.post("/api/v1/delivery/commands", json=body)
    assert again.status_code == 200 and again.json()["replayed"] is True
    versions = history(client, rid).json()["items"]
    assert len(versions) == 2 and versions[0]["number"] == 2
    assert versions[0]["definition"]["description"] == "Reviewed change"
    body["expected_version"] = saved.json()["version"]
    body["idempotency_key"] = "old-definition-request"
    stale = client.post("/api/v1/delivery/commands", json=body)
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "requirement_basis_changed"


def test_missing_preview_is_rejected_but_metadata_edit_is_allowed(env):
    client, _, _ = env
    rid = requirement(client)
    current = client.get("/api/v1/delivery/workspace").json()
    body = {
        "action": "requirement.update",
        "expected_version": current["version"],
        "idempotency_key": "missing-preview",
        "payload": {"id": rid, "title": "Unpreviewed"},
    }
    result = client.post("/api/v1/delivery/commands", json=body)
    assert result.status_code == 409
    assert result.json()["detail"]["code"] == "requirement_change_preview_required"
    assert command(client, "requirement.update", {"id": rid, "due_on": "2026-12-20"}).status_code == 200


def test_generic_orm_and_core_changes_capture_once_without_fabricating_old_content(env):
    client, sessions, _ = env
    with sessions() as db:
        db.add(Requirement(id="prior", tenant_id="tenant", project_id="project", title="First observed"))
        db.commit()
    assert history(client, "prior").status_code == 200
    with sessions() as db:
        row = db.get(Requirement, "prior")
        row.description = "ORM change"
        db.commit()
    with sessions() as db:
        db.execute(update(Requirement).where(Requirement.id == "prior").values(title="Core change"))
        db.commit()
    result = history(client, "prior").json()
    assert [row["definition"]["title"] for row in result["items"]] == [
        "Core change",
        "First observed",
        "First observed",
    ]
    assert [row["number"] for row in result["items"]] == [3, 2, 1]
    assert all(row["source"] == "sql_observed" for row in result["items"])
    with sessions() as db:
        db.get(Requirement, "prior").description = "rolled back"
        db.flush()
        db.rollback()
    assert history(client, "prior").json() == result


def test_activity_and_history_scope_access_is_rechecked(env):
    client, _, actor = env
    rid = requirement(client)
    selected = activity(client).json()["items"][0]["id"]
    version = history(client, rid).json()["items"][0]["id"]
    actor["id"] = "reader"
    assert activity(client).status_code == 200
    assert (
        client.get(f"/api/v1/delivery/activity/{selected}", headers={"X-Project-Id": "other"}).status_code
        == 403
    )
    assert (
        client.get(
            f"/api/v1/delivery/requirements/{rid}/history/{version}", headers={"X-Project-Id": "other"}
        ).status_code
        == 403
    )
    assert preview(client, rid, {"title": "Denied"}).status_code == 403


def test_empty_change_preview_lists_actual_direct_and_transitive_dependencies(env):
    client, sessions, _ = env
    rid = requirement(client)
    first = command(client, "task.create", {"requirement_id": rid, "title": "Direct"}).json()["tasks"][0]
    independent = command(client, "task.create", {"title": "Dependent", "depends_on": [first["id"]]}).json()
    dependent = next(row for row in independent["tasks"] if row["id"] != first["id"])
    read = preview(client, rid, {})
    assert read.status_code == 200, read.text
    assert read.json()["impact"]["task_ids"] == [first["id"]]
    assert read.json()["impact"]["dependent_task_ids"] == [dependent["id"]]
    assert read.json()["impact"]["invalidates_current_acceptance"] is False
    fixed = preview(client, rid, {"description": "Reviewed"}).json()
    with sessions() as db:
        db.get(Task, dependent["id"]).description = "Changed downstream scope"
        db.commit()
    state = client.get("/api/v1/delivery/workspace").json()
    result = client.post(
        "/api/v1/delivery/commands",
        json={
            "action": "requirement.update",
            "expected_version": state["version"],
            "idempotency_key": "downstream-changed",
            "payload": {
                "id": rid,
                "description": "Reviewed",
                "requirement_basis": fixed["requirement_basis"],
                "change_preview_basis": fixed["preview_basis"],
            },
        },
    )
    assert result.status_code == 409
    assert result.json()["detail"]["code"] == "requirement_change_preview_changed"


def test_recorded_execution_target_rechecks_runtime_workspace_access(bridge):
    client, _, _, _, _, rid, _ = bridge
    entry = queue(bridge)
    items = activity(client, scope="requirement", scope_id=rid).json()["items"]
    event = next(row for row in items if row["action"] == "execution.queue")
    assert event["target"]["kind"] == "execution" and event["target"]["id"] == entry["id"]
    assert event["target"]["available"] is True
    client.app.state.hermes_store = None
    denied = client.get(f"/api/v1/delivery/activity/{event['id']}").json()["item"]
    assert denied["target"] == {
        "kind": "execution",
        "id": None,
        "label": None,
        "available": False,
        "reason": "target_restricted",
    }


def test_real_deployment_candidate_snapshot_links_and_permissions(domain):
    from sop_manager.routers.delivery_activity import event_view, record_activity

    deployment_id = create_deployment(domain)
    event = DeliveryEvent(
        id="deployment-event",
        tenant_id=domain.project.tenant_id,
        project_id=domain.project.id,
        version=1,
        actor=domain.user.username,
        action="deployment.create",
        resource_id=deployment_id,
        data={"input": {}},
        created_at=datetime(2026, 10, 17),
    )
    record_activity(domain.db, domain.project, domain.user, domain.data, event)
    domain.db.add(event)
    domain.db.flush()
    view = event_view(domain.db, domain.project, domain.data, domain.user, event, domain.store)
    assert view["requirement_ids"] == ["R-release"]
    assert view["target"]["id"] == deployment_id and view["target"]["available"]
    release = next(row for row in view["related_targets"] if row["kind"] == "release_candidate")
    assert release["id"] == domain.candidate and release["available"]
    restricted = event_view(domain.db, domain.project, domain.data, domain.user, event, None)
    assert restricted["target"]["id"] is None and restricted["target"]["reason"] == "target_restricted"


def test_viewer_reads_current_links_without_a_write_preview(bridge):
    client, _, _, _, _, rid, task = bridge
    entry = queue(bridge)
    from sop_manager.routers.auth_sql import current_user
    from sop_manager.routers.sql_models import User

    client.app.dependency_overrides[current_user] = lambda: User(
        id="reader", tenant_id="tenant", username="reader", role="viewer", status="active"
    )
    response = history(client, rid)
    assert response.status_code == 200, response.text
    links = response.json()["current_links"]
    assert links["requirement_basis"] == response.json()["current_basis"]
    assert links["task_ids"] == [task["id"]]
    assert links["execution_ids"] == [] and links["restricted_execution_count"] == 1
    assert entry["id"] not in str(links)


def test_history_cursor_fixed_upper_exact_scope_and_invalid_body(env):
    client, _, _ = env
    rid = requirement(client)
    assert command(client, "requirement.update", {"id": rid, "title": "Second"}).status_code == 200
    first = history(client, rid, limit=1).json()
    assert command(client, "requirement.update", {"id": rid, "title": "Third"}).status_code == 200
    second = history(client, rid, limit=1, cursor=first["next_cursor"]).json()
    assert [row["number"] for page in (first, second) for row in page["items"]] == [2, 1]
    assert history(client, "other", cursor=first["next_cursor"]).status_code in {404, 422}
    for changes in (
        {"title": None},
        {"acceptance_criteria": [""]},
        {"description": "x", "password": "private"},
    ):
        result = preview(client, rid, changes)
        assert result.status_code == 422, result.text


def test_command_event_is_persisted_before_its_links_with_foreign_keys_enabled(env):
    client, sessions, _ = env
    with sessions() as db:
        db.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
        db.commit()
    created = command(client, "requirement.create", {"title": "Actual foreign key ordering"})
    assert created.status_code == 200, created.text
    rid = created.json()["requirements"][0]["id"]
    events = activity(client, scope="requirement", scope_id=rid)
    assert events.status_code == 200 and len(events.json()["items"]) == 1


def test_description_only_change_keeps_lists_and_exact_event_readable(env):
    client, sessions, _ = env
    rid = requirement(client)
    saved = command(
        client, "requirement.update", {"id": rid, "description": "Only this definition field changed"}
    )
    assert saved.status_code == 200, saved.text
    with sessions() as db:
        selected = db.query(DeliveryEvent).filter_by(action="requirement.update").one().id
    for url, params in (
        ("/api/v1/delivery/activity", {}),
        ("/api/v1/delivery/activity", {"scope": "requirement", "scope_id": rid}),
        (f"/api/v1/delivery/activity/{selected}", {}),
    ):
        response = client.get(url, params=params)
        assert response.status_code == 200, response.text
        item = response.json().get("item") or next(
            row for row in response.json()["items"] if row["id"] == selected
        )
        assert item["changes"] == [
            {
                "field": "description",
                "before": "Search project work",
                "after": "Only this definition field changed",
            }
        ]


def test_null_omissions_and_nullable_prior_definition_do_not_fabricate_changes(env):
    client, sessions, _ = env
    rid = requirement(client)
    with sessions() as db:
        db.get(Requirement, rid).description = None
        db.commit()
    fixed = preview(client, rid, {"description": "New text"}).json()
    saved = command(
        client,
        "requirement.update",
        {
            "id": rid,
            "description": "New text",
            "title": None,
            "acceptance_criteria": None,
            "requirement_basis": fixed["requirement_basis"],
            "change_preview_basis": fixed["preview_basis"],
        },
    )
    # Explicit null fields are ignored by the canonical edit, not recorded as changes.
    assert saved.status_code == 200, saved.text
    response = activity(client)
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["changes"] == [
        {"field": "description", "before": "", "after": "New text"}
    ]


def test_invalid_recorded_field_change_does_not_block_an_activity_page(env):
    client, sessions, _ = env
    rid = requirement(client)
    selected = activity(client).json()["items"][0]["id"]
    with sessions() as db:
        event = db.get(DeliveryEvent, selected)
        event.data = {
            **event.data,
            "activity": {
                **event.data["activity"],
                "changes": [
                    {"field": "title", "before": "Search", "after": None},
                    {"field": "description", "before": "Original", "after": "Actual valid recorded change"},
                ],
            },
        }
        db.commit()
    for url, params in (
        ("/api/v1/delivery/activity", {"scope": "requirement", "scope_id": rid}),
        (f"/api/v1/delivery/activity/{selected}", {}),
    ):
        response = client.get(url, params=params)
        assert response.status_code == 200, response.text
        item = response.json().get("item") or response.json()["items"][0]
        assert item["changes"] == [
            {"field": "description", "before": "Original", "after": "Actual valid recorded change"}
        ]
