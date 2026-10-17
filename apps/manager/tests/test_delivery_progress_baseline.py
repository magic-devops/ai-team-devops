"""Immutable plan baselines reject stale scope and preserve deleted task facts."""

from copy import deepcopy

from sop_manager.routers.sql_models import DeliveryReceipt, DeliveryWorkspace, ProjectMember, Task, User
from test_delivery_workbench import command, requirement
from test_delivery_workbench import env as delivery_env

env = delivery_env


def _prepare(client):
    rid = requirement(client)
    response = command(
        client, "task.create", {"requirement_id": rid, "title": "Build search", "owner_id": "user:lead"}
    )
    assert response.status_code == 200, response.text
    return rid, response.json()["tasks"][0]["id"]


def _payload(client, **changes):
    progress = client.get("/api/v1/delivery/progress").json()
    return {
        "title": "Reviewed delivery plan",
        "scope": "project",
        "scope_id": "",
        "task_ids": progress["current"]["task_ids"],
        "basis": progress["current"]["basis"],
        "starts_on": "2026-01-01",
        "ends_on": "2026-01-03",
        "note": "Tasks, not hours",
        **changes,
    }


def test_freeze_creates_immutable_plan_exact_replay_and_fixed_reference_line(env):
    client, sessions, _ = env
    _, task_id = _prepare(client)
    payload = _payload(client)
    version = client.get("/api/v1/delivery/workspace").json()["version"]
    frozen = command(client, "baseline.create", payload, key="freeze-reviewed-plan", version=version)
    assert frozen.status_code == 200, frozen.text
    replay = command(client, "baseline.create", payload, key="freeze-reviewed-plan", version=version)
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    from sop_manager.routers.sql_models import DeliveryProgressBaseline

    with sessions() as db:
        row = db.query(DeliveryProgressBaseline).one()
        baseline_id, original = row.id, deepcopy(row.data)
        assert row.created_by == "lead" and row.source_version == version + 1
    progress = client.get(
        "/api/v1/delivery/progress",
        params={"starts_on": "2026-01-01", "ends_on": "2026-01-04", "baseline_id": baseline_id},
    ).json()
    assert progress["baseline"]["task_ids"] == [task_id]
    assert progress["ideal"] == [
        {"date": "2026-01-01", "remaining": 1.0},
        {"date": "2026-01-02", "remaining": 0.5},
        {"date": "2026-01-03", "remaining": 0.0},
    ]
    assert progress["comparison"]["unchanged_count"] == 1
    assert (
        command(
            client,
            "baseline.create",
            {**payload, "title": "Changed"},
            key="freeze-reviewed-plan",
            version=version,
        ).status_code
        == 409
    )
    with sessions() as db:
        assert db.query(DeliveryProgressBaseline).one().data == original


def test_baseline_basis_rejects_legacy_edit_without_workspace_version_change(env):
    client, sessions, _ = env
    _, task_id = _prepare(client)
    payload = _payload(client)
    version = client.get("/api/v1/delivery/workspace").json()["version"]
    with sessions() as db:
        db.get(Task, task_id).estimate = "XL"
        db.commit()
    rejected = command(client, "baseline.create", payload, key="stale-legacy-estimate", version=version)
    assert rejected.status_code == 409, rejected.text
    from sop_manager.routers.sql_models import DeliveryProgressBaseline

    with sessions() as db:
        assert db.query(DeliveryProgressBaseline).count() == 0
        assert db.get(DeliveryWorkspace, "project").version == version
        assert not db.query(DeliveryReceipt).filter_by(version=version + 1).first()


def test_baseline_requires_explicit_complete_task_set_and_matching_project(env):
    client, sessions, _ = env
    _prepare(client)
    with sessions() as db:
        db.add(Task(id="TASK-other-project", project_id="other", tenant_id="tenant", title="Private"))
        db.commit()
    for changes, expected in [
        ({"task_ids": []}, 409),
        ({"task_ids": ["TASK-other-project"]}, 409),
        ({"scope": "milestone", "scope_id": "missing"}, 404),
        ({"scope": "project", "scope_id": "other"}, 422),
        ({"task_ids": None}, 422),
        ({"starts_on": "2026-01-04"}, 422),
        ({"basis": "a" * 64}, 409),
    ]:
        response = command(client, "baseline.create", _payload(client, **changes))
        assert response.status_code == expected, (changes, response.text)


def test_baseline_requires_approve_while_manual_record_allows_developer(env):
    client, sessions, actor = env
    _prepare(client)
    payload = _payload(client)
    unusable_hash = "not-a-login"
    with sessions() as db:
        db.add(
            User(
                id="developer",
                tenant_id="tenant",
                username="developer",
                role="developer",
                status="active",
                password_hash=unusable_hash,
            )
        )
        db.flush()
        db.add(ProjectMember(project_id="project", user_id="developer", role="developer"))
        db.commit()
    actor["id"] = "developer"
    assert command(client, "baseline.create", payload).status_code == 403
    assert command(client, "progress.record", {}).status_code == 200
    actor["id"] = "reader"
    assert client.get("/api/v1/delivery/progress").status_code == 200
    assert command(client, "baseline.create", payload).status_code == 403


def test_comparison_reports_added_removed_and_changed_without_rewriting_plan(env):
    client, sessions, _ = env
    rid, task_id = _prepare(client)
    second = command(
        client, "task.create", {"requirement_id": rid, "title": "Test search", "owner_id": "user:lead"}
    )
    second_id = next(task["id"] for task in second.json()["tasks"] if task["id"] != task_id)
    assert command(client, "baseline.create", _payload(client)).status_code == 200
    from sop_manager.routers.sql_models import DeliveryProgressBaseline

    with sessions() as db:
        baseline_id = db.query(DeliveryProgressBaseline).one().id
        before = deepcopy(db.query(DeliveryProgressBaseline).one().data)
        db.get(Task, task_id).estimate = "XL"
        db.delete(db.get(Task, second_id))
        db.commit()
    third = command(
        client, "task.create", {"requirement_id": rid, "title": "New scope", "owner_id": "user:lead"}
    )
    third_id = next(task["id"] for task in third.json()["tasks"] if task["id"] != task_id)
    result = client.get(f"/api/v1/delivery/progress/baselines/{baseline_id}")
    assert result.status_code == 200, result.text
    body = result.json()
    assert [task["id"] for task in body["comparison"]["added"]] == [third_id]
    assert [task["id"] for task in body["comparison"]["removed"]] == [second_id]
    changed = body["comparison"]["changed"][0]
    assert changed["id"] == task_id and "estimate" in changed["fields"]
    assert changed["before"]["estimate"] == "M" and changed["after"]["estimate"] == "XL"
    assert (
        next(task for task in body["baseline"]["tasks"] if task["id"] == second_id)["title"] == "Test search"
    )
    with sessions() as db:
        assert db.query(DeliveryProgressBaseline).one().data == before


def test_no_dates_means_no_ideal_and_each_replan_is_a_new_baseline(env):
    client, sessions, _ = env
    _prepare(client)
    assert (
        command(client, "baseline.create", _payload(client, starts_on=None, ends_on=None)).status_code == 200
    )
    assert (
        command(
            client, "baseline.create", _payload(client, title="Replanned scope", starts_on=None, ends_on=None)
        ).status_code
        == 200
    )
    from sop_manager.routers.sql_models import DeliveryProgressBaseline

    with sessions() as db:
        assert db.query(DeliveryProgressBaseline).count() == 2
        baseline_id = db.query(DeliveryProgressBaseline).first().id
    body = client.get("/api/v1/delivery/progress", params={"baseline_id": baseline_id}).json()
    assert body["ideal"] == []
    assert len(body["baselines"]) == 2
    assert (
        client.get(
            "/api/v1/delivery/progress",
            headers={"X-Project-Id": "other"},
            params={"baseline_id": baseline_id},
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/delivery/progress/baselines/{baseline_id}", headers={"X-Project-Id": "other"}
        ).status_code
        == 404
    )
    assert client.get("/api/v1/delivery/progress/baselines/missing").status_code == 404


def test_milestone_baseline_cannot_be_selected_in_different_scope(env):
    client, _, _ = env
    rid, _ = _prepare(client)
    milestone = command(
        client, "milestone.save", {"title": "Launch", "starts_on": "2026-01-01", "ends_on": "2026-01-31"}
    )
    milestone_id = milestone.json()["milestones"][0]["id"]
    assert command(client, "requirement.update", {"id": rid, "milestone_id": milestone_id}).status_code == 200
    current = client.get(
        "/api/v1/delivery/progress", params={"scope": "milestone", "scope_id": milestone_id}
    ).json()["current"]
    payload = _payload(
        client, scope="milestone", scope_id=milestone_id, task_ids=current["task_ids"], basis=current["basis"]
    )
    saved = command(client, "baseline.create", payload)
    assert saved.status_code == 200, saved.text
    detail = client.get(
        "/api/v1/delivery/progress", params={"scope": "milestone", "scope_id": milestone_id}
    ).json()
    baseline_id = detail["baselines"][0]["id"]
    assert client.get("/api/v1/delivery/progress", params={"baseline_id": baseline_id}).status_code == 422


def test_normal_status_change_advances_progress_without_scope_change(env):
    client, sessions, _ = env
    _, task_id = _prepare(client)
    assert command(client, "baseline.create", _payload(client)).status_code == 200
    from sop_manager.routers.sql_models import DeliveryProgressBaseline

    with sessions() as db:
        baseline_id = db.query(DeliveryProgressBaseline).one().id
        db.get(Task, task_id).status = "in_progress"
        db.commit()
    result = client.get(f"/api/v1/delivery/progress/baselines/{baseline_id}")
    assert result.status_code == 200, result.text
    assert result.json()["comparison"] == {"added": [], "removed": [], "changed": [], "unchanged_count": 1}
    assert result.json()["current"]["tasks"][0]["status"] == "in_progress"


def test_deleted_scope_keeps_baseline_and_historical_progress_readable(env):
    client, sessions, _ = env
    rid, task_id = _prepare(client)
    milestone = command(client, "milestone.save", {"title": "Retired launch"}).json()["milestones"][0]["id"]
    assert command(client, "requirement.update", {"id": rid, "milestone_id": milestone}).status_code == 200
    current = client.get(
        "/api/v1/delivery/progress", params={"scope": "milestone", "scope_id": milestone}
    ).json()["current"]
    assert (
        command(
            client,
            "baseline.create",
            _payload(
                client,
                scope="milestone",
                scope_id=milestone,
                task_ids=current["task_ids"],
                basis=current["basis"],
            ),
        ).status_code
        == 200
    )
    from sop_manager.routers.sql_models import DeliveryProgressBaseline

    with sessions() as db:
        baseline_id = db.query(DeliveryProgressBaseline).one().id
        row = db.get(DeliveryWorkspace, "project")
        state = deepcopy(row.data)
        state["milestones"] = []
        row.data = state
        db.commit()
    detail = client.get(f"/api/v1/delivery/progress/baselines/{baseline_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["baseline"]["tasks"][0]["id"] == task_id
    assert detail.json()["current"]["tasks"] == []
    progress = client.get(
        "/api/v1/delivery/progress",
        params={"scope": "milestone", "scope_id": milestone, "baseline_id": baseline_id},
    )
    assert progress.status_code == 200, progress.text
    assert progress.json()["scope"]["label"] == "Retired launch"
    assert progress.json()["baseline"]["tasks"][0]["id"] == task_id


def test_freezing_rejects_cross_project_task_associations(env):
    client, sessions, _ = env
    _, task_id = _prepare(client)
    from sop_manager.routers.sql_models import Requirement, Sprint

    with sessions() as db:
        db.add(
            Requirement(
                id="REQ-cross-project", project_id="other", tenant_id="tenant", title="Private requirement"
            )
        )
        db.add(
            Sprint(id="SPRINT-cross-project", project_id="other", tenant_id="tenant", goal="Private sprint")
        )
        db.commit()
    for field, value in (("req_id", "REQ-cross-project"), ("sprint_id", "SPRINT-cross-project")):
        with sessions() as db:
            task = db.get(Task, task_id)
            previous = getattr(task, field)
            setattr(task, field, value)
            db.commit()
        response = command(client, "baseline.create", _payload(client))
        assert response.status_code == 422, (field, response.text)
        with sessions() as db:
            setattr(db.get(Task, task_id), field, previous)
            db.commit()
