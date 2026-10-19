"""Task plan preview and confirmed scope use real SQL; only providers are replaced."""

import json

import pytest
from fastapi import HTTPException
from sop_manager.routers import llm_gateway
from sop_manager.routers.sql_models import Project, Requirement, Task, Tenant
from test_delivery_execution import bridge as delivery_bridge
from test_delivery_execution import finish, queue, sync
from test_delivery_workbench import command, requirement
from test_delivery_workbench import env as delivery_env

env = delivery_env
bridge = delivery_bridge


def preview(client, rid, **changes):
    body = {
        "requirement_id": rid,
        "expected_version": client.get("/api/v1/delivery/workspace").json()["version"],
        "idempotency_key": "plan-preview-first",
        "generator": "template",
        "mode": "fullstack",
        "max_items": 8,
        **changes,
    }
    return client.post("/api/v1/delivery/task-plan-preview", json=body)


def confirm(client, rid, result, items=None, **changes):
    return command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "requirement_revision": result["requirement_revision"],
            "requirement_basis": result["requirement_basis"],
            "preview_id": result["id"],
            "items": items or result["items"],
            **changes,
        },
        key="plan-confirm-first",
        version=result["version"],
    )


def test_template_preview_does_not_create_tasks_and_confirmation_uses_edits(env):
    client, sessions, _ = env
    rid = requirement(client)
    response = preview(client, rid)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["source"] == "template" and not result["model"]
    assert result["requirement_snapshot"]["acceptance_criteria"] == ["Find a requirement by title"]
    with sessions() as db:
        assert db.query(Task).count() == 0
    items = [
        {
            **result["items"][0],
            "title": "Edited before creation",
            "owner_id": "user:lead",
            "starts_on": "2026-10-16",
            "ends_on": "2026-10-17",
            "requirement_criteria_indices": [0],
        }
    ]
    saved = confirm(client, rid, result, items)
    assert saved.status_code == 200, saved.text
    tasks = saved.json()["tasks"]
    assert len(tasks) == 1 and tasks[0]["title"] == "Edited before creation"
    assert tasks[0]["planning"]["source"] == "template"
    assert tasks[0]["planning"]["preview_id"] == result["id"]
    assert tasks[0]["planning"]["starts_on"] == "2026-10-16"
    assert tasks[0]["planning"]["requirement_criteria_indices"] == [0]
    again = confirm(client, rid, result, items)
    assert again.status_code == 200 and again.json()["replayed"]
    with sessions() as db:
        assert db.query(Task).count() == 1


class StubProvider(llm_gateway.Provider):
    name = "plan-stub"

    def __init__(self, content=None, error=None, during=None):
        self.calls = []
        self.content = content or json.dumps(
            {"items": [{"key": "build", "title": "AI suggestion", "requirement_criteria_indices": [0]}]}
        )
        self.error = error
        self.during = during

    def chat(self, body):
        self.calls.append(body)
        if self.during:
            self.during()
        if self.error:
            raise self.error
        return llm_gateway.ChatOut(
            model="stub-model",
            provider=self.name,
            content=self.content,
            usage=llm_gateway.ChatUsage(
                prompt_tokens=12, completion_tokens=5, total_tokens=17, cost_usd=0.001
            ),
        )

    def models(self):
        return []

    def supports(self, model):
        return True


def provider(monkeypatch, stub):
    monkeypatch.setattr(llm_gateway, "_provider_chain", lambda model: [stub])
    monkeypatch.setattr(llm_gateway, "_enforce_llm_quota", lambda *args: None)
    # Keep usage writes isolated; the returned actual usage remains persisted with preview.
    monkeypatch.setattr(llm_gateway, "_audit_call", lambda *args: None)


def test_ai_preview_pins_model_usage_and_replay_never_calls_provider_twice(env, monkeypatch):
    client, _, _ = env
    rid = requirement(client)
    stub = StubProvider()
    provider(monkeypatch, stub)
    response = preview(client, rid, generator="ai")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["items"][0]["title"] == "AI suggestion"
    assert result["source"] == "ai" and result["model"] == "stub-model"
    assert result["usage"]["total_tokens"] == 17
    assert preview(client, rid, generator="ai").json() == result
    assert len(stub.calls) == 1 and stub.calls[0].task_type == "plan" and stub.calls[0].cache_ttl == 0
    assert preview(client, rid, generator="template").status_code == 409


def test_ai_preview_normalizes_omitted_keys_for_independent_editing_and_confirmation(env, monkeypatch):
    from sop_manager.routers.sql_models import DeliveryPlanPreview

    client, sessions, _ = env
    rid = requirement(client)
    stub = StubProvider(content=json.dumps({"items": [{"title": "Build"}, {"title": "Verify"}]}))
    provider(monkeypatch, stub)
    response = preview(client, rid, generator="ai")
    assert response.status_code == 200, response.text
    result = response.json()
    assert [item["key"] for item in result["items"]] == ["item-1", "item-2"]
    with sessions() as db:
        stored = db.get(DeliveryPlanPreview, result["id"])
        assert [item["key"] for item in stored.data["result"]["items"]] == ["item-1", "item-2"]
    assert preview(client, rid, generator="ai").json() == result
    selected = [{**result["items"][1], "title": "Edited verify after removing build"}]
    saved = confirm(client, rid, result, selected)
    assert saved.status_code == 200, saved.text
    assert len(saved.json()["tasks"]) == 1
    assert saved.json()["tasks"][0]["planning"]["key"] == "item-2"


@pytest.mark.parametrize("failure", ["provider", "structure", "quota"])
def test_model_failures_are_recorded_and_same_key_does_not_retry_or_fallback(env, monkeypatch, failure):
    client, sessions, _ = env
    rid = requirement(client)
    stub = StubProvider(
        content="not JSON" if failure == "structure" else None,
        error=HTTPException(503, "provider offline") if failure == "provider" else None,
    )
    provider(monkeypatch, stub)
    if failure == "quota":

        def exhausted(*args):
            raise HTTPException(429, "quota exceeded")

        monkeypatch.setattr(llm_gateway, "_enforce_llm_quota", exhausted)
    failed = preview(client, rid, generator="ai")
    assert failed.status_code == (429 if failure == "quota" else 502), failed.text
    calls = len(stub.calls)
    replay = preview(client, rid, generator="ai")
    assert replay.status_code == failed.status_code and len(stub.calls) == calls
    with sessions() as db:
        from sop_manager.routers.sql_models import DeliveryPlanPreview

        row = db.query(DeliveryPlanPreview).one()
        assert row.status == "failed" and row.data["error"]
        assert db.query(Task).count() == 0


def test_requirement_change_during_ai_call_fails_and_does_not_hold_workspace_lock(env, monkeypatch):
    client, sessions, _ = env
    rid = requirement(client)

    def change():
        response = command(client, "requirement.update", {"id": rid, "description": "Changed during AI"})
        assert response.status_code == 200

    stub = StubProvider(during=change)
    provider(monkeypatch, stub)
    failed = preview(client, rid, generator="ai")
    assert failed.status_code == 409, failed.text
    assert preview(client, rid, generator="ai", expected_version=1).status_code == 409
    with sessions() as db:
        assert db.query(Task).count() == 0


def test_stale_or_forged_preview_cannot_create_tasks_even_with_fresh_project_version(env):
    client, sessions, _ = env
    rid = requirement(client)
    result = preview(client, rid).json()
    command(client, "requirement.update", {"id": rid, "acceptance_criteria": ["Different scope"]})
    state = client.get("/api/v1/delivery/workspace").json()
    assert confirm(client, rid, {**result, "version": state["version"]}).status_code == 409
    assert (
        command(
            client,
            "tasks.plan",
            {"requirement_id": rid, "preview_id": "forged-preview", "items": [{"title": "Forged"}]},
        ).status_code
        == 404
    )
    with sessions() as db:
        assert db.query(Task).count() == 0


@pytest.mark.parametrize(
    "items",
    [
        [{"key": "a", "title": "A", "depends_on": ["missing"]}],
        [{"key": "a", "title": "A", "depends_on": ["b"]}, {"key": "b", "title": "B", "depends_on": ["a"]}],
        [{"key": "a", "title": "A"}, {"key": "a", "title": "Duplicate"}],
        [{"title": "Wrong date", "starts_on": "2026-10-17", "ends_on": "2026-10-16"}],
        [{"title": "Wrong criterion", "requirement_criteria_indices": [1]}],
        [{"title": "Wrong member", "owner_id": "user:missing"}],
    ],
)
def test_invalid_selected_plan_is_rejected_atomically(env, items):
    client, sessions, _ = env
    rid = requirement(client)
    response = command(client, "tasks.plan", {"requirement_id": rid, "items": items})
    assert response.status_code == 422, response.text
    with sessions() as db:
        assert db.query(Task).count() == 0


def test_plan_dependencies_resolve_ids_and_block_completion_until_predecessor_delivered(env):
    client, _, _ = env
    rid = requirement(client)
    saved = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {
                    "key": "build",
                    "title": "Build",
                    "owner_id": "user:lead",
                    "requirement_criteria_indices": [0],
                },
                {
                    "key": "verify",
                    "title": "Verify",
                    "owner_id": "user:lead",
                    "depends_on": ["build"],
                    "requirement_criteria_indices": [0],
                },
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    tasks = {t["title"]: t for t in saved.json()["tasks"]}
    first, second = tasks["Build"]["id"], tasks["Verify"]["id"]
    assert tasks["Verify"]["planning"]["depends_on"] == [first]
    assert tasks["Verify"]["dependency_blocked"] == [first]
    assert command(client, "task.update", {"id": second, "status": "completed"}).status_code == 409
    assert command(client, "task.update", {"id": first, "status": "completed"}).status_code == 200
    assert command(client, "task.update", {"id": second, "status": "completed"}).status_code == 409
    basis = client.get(f"/api/v1/delivery/tasks/{first}/review-current").json()["current"]["basis"]
    assert (
        command(
            client,
            "task.manual_review",
            {
                "task_id": first,
                "decision": "accept",
                "basis": basis,
                "comment": "Verified current delivery",
                "evidence_content": "Manually inspected build output",
            },
        ).status_code
        == 200
    )
    assert command(client, "task.update", {"id": second, "status": "completed"}).status_code == 200


def test_preview_and_external_dependencies_enforce_project_tenant_and_write_access(env):
    client, sessions, actor = env
    rid = requirement(client)
    actor["id"] = "reader"
    assert preview(client, rid).status_code == 403
    actor["id"] = "lead"
    with sessions() as db:
        db.add(Tenant(id="foreign", slug="foreign", name="Foreign"))
        db.flush()
        db.add(Project(id="foreign-project", tenant_id="foreign", name="Foreign"))
        db.add(Requirement(id="other-req", tenant_id="tenant", project_id="other", title="Private"))
        db.add(Task(id="other-task", tenant_id="tenant", project_id="other", title="Private"))
        db.commit()
    assert preview(client, "other-req").status_code == 404
    assert preview(client, rid, expected_version=0).status_code == 409
    assert preview(client, rid, max_items=0).status_code == 422
    assert (
        client.post(
            "/api/v1/delivery/task-plan-preview",
            headers={"X-Project-Id": "foreign-project"},
            json={"requirement_id": rid, "expected_version": 1, "idempotency_key": "foreign-preview"},
        ).status_code
        == 403
    )
    assert (
        command(
            client,
            "tasks.plan",
            {
                "requirement_id": rid,
                "items": [{"title": "Cannot depend outside project", "depends_on": ["other-task"]}],
            },
        ).status_code
        == 422
    )


def test_explicit_task_blocking_can_be_cleared_and_dates_are_validated_against_saved_plan(env):
    client, _, _ = env
    rid = requirement(client)
    created = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {
                    "title": "Blocked",
                    "blocked_reason": "Need access",
                    "starts_on": "2026-10-16",
                    "ends_on": "2026-10-18",
                }
            ],
        },
    )
    assert created.status_code == 200, created.text
    task = created.json()["tasks"][0]
    assert task["status"] == "blocked"
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 409
    assert command(client, "task.update", {"id": task["id"], "starts_on": "2026-10-19"}).status_code == 422
    saved = command(client, "task.update", {"id": task["id"], "blocked_reason": "", "status": "completed"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["tasks"][0]["planning"]["blocked_reason"] == ""


@pytest.mark.parametrize(
    "changed_task,dates", [("Second", {"starts_on": "2026-10-17"}), ("First", {"ends_on": "2026-10-19"})]
)
def test_task_date_edits_preserve_predecessor_and_successor_schedule(env, changed_task, dates):
    client, _, _ = env
    rid = requirement(client)
    created = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {"key": "first", "title": "First", "starts_on": "2026-10-16", "ends_on": "2026-10-18"},
                {
                    "key": "second",
                    "title": "Second",
                    "depends_on": ["first"],
                    "starts_on": "2026-10-18",
                    "ends_on": "2026-10-20",
                },
            ],
        },
    )
    assert created.status_code == 200, created.text
    original = created.json()
    task = next(task for task in original["tasks"] if task["title"] == changed_task)
    failed = command(client, "task.update", {"id": task["id"], **dates})
    assert failed.status_code == 422, failed.text
    assert failed.json()["detail"]["code"] == "plan_dependency_dates"
    current = client.get("/api/v1/delivery/workspace").json()
    assert current["version"] == original["version"]
    assert next(item["planning"] for item in current["tasks"] if item["id"] == task["id"]) == task["planning"]
    allowed = command(
        client,
        "task.update",
        {"id": task["id"], "starts_on": "2026-10-16" if changed_task == "First" else "2026-10-19"},
    )
    assert allowed.status_code == 200, allowed.text


def test_legacy_requirement_basis_pins_manual_plan_even_when_revision_is_unchanged(env):
    client, sessions, _ = env
    with sessions() as db:
        db.add(
            Requirement(
                id="legacy",
                tenant_id="tenant",
                project_id="project",
                title="Legacy",
                acceptance_criteria=["A", "B"],
            )
        )
        db.commit()
    initial = client.get("/api/v1/delivery/workspace").json()
    original = initial["requirements"][0]
    assert initial["version"] == 0 and original["flow"]["revision"] == 1
    assert len(original["basis"]) == 64
    with sessions() as db:
        db.get(Requirement, "legacy").acceptance_criteria = ["B", "A"]
        db.commit()
    latest = client.get("/api/v1/delivery/workspace").json()
    assert latest["version"] == 0 and latest["requirements"][0]["flow"]["revision"] == 1
    assert latest["requirements"][0]["basis"] != original["basis"]
    rejected = command(
        client,
        "tasks.plan",
        {
            "requirement_id": "legacy",
            "requirement_revision": 1,
            "requirement_basis": original["basis"],
            "items": [{"title": "Against original criterion A", "requirement_criteria_indices": [0]}],
        },
    )
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"]["code"] == "plan_basis_changed"
    with sessions() as db:
        assert db.query(Task).count() == 0
    compatible = command(
        client,
        "tasks.plan",
        {
            "requirement_id": "legacy",
            "items": [{"title": "Legacy caller without a basis", "requirement_criteria_indices": [0]}],
        },
    )
    assert compatible.status_code == 200, compatible.text


def test_provider_retry_while_generation_is_in_progress_has_no_extra_model_call(env, monkeypatch):
    client, _, _ = env
    rid = requirement(client)
    replies = []

    def retry():
        replies.append(preview(client, rid, generator="ai"))

    stub = StubProvider(during=retry)
    provider(monkeypatch, stub)
    generated = preview(client, rid, generator="ai")
    assert generated.status_code == 200, generated.text
    assert len(stub.calls) == 1 and replies[0].status_code == 409
    assert replies[0].json()["detail"]["code"] == "plan_generation_in_progress"


def test_generic_task_status_write_cannot_bypass_dependencies(env, monkeypatch):
    from sop_manager.routers import db_sql_compat

    client, sessions, _ = env
    rid = requirement(client)
    state = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {"key": "build", "title": "Build"},
                {"key": "verify", "title": "Verify", "depends_on": ["build"]},
            ],
        },
    ).json()
    tid = next(task["id"] for task in state["tasks"] if task["title"] == "Verify")
    monkeypatch.setattr(db_sql_compat, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(db_sql_compat, "resolved_project_id", lambda: "project")
    with sessions() as db:
        table = db_sql_compat._SqlTable(Task, db)
        with pytest.raises(HTTPException) as error:
            table.update(f"id = '{tid}'", {"status": "completed"})
        assert error.value.status_code == 409
        assert db.get(Task, tid).status == "pending"


def edit_links(client, task_id, **changes):
    state = client.get("/api/v1/delivery/workspace").json()
    task = next(item for item in state["tasks"] if item["id"] == task_id)
    return command(
        client,
        "task.update",
        {
            "id": task_id,
            "task_basis": task["basis"],
            **changes,
        },
    )


def test_removed_predecessor_can_be_explicitly_unlinked_and_mapping_rebased(env):
    client, sessions, _ = env
    rid = requirement(client)
    saved = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {"key": "a", "title": "First"},
                {"key": "b", "title": "Second", "depends_on": ["a"]},
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    tasks = {task["title"]: task for task in saved.json()["tasks"]}
    with sessions() as db:
        db.delete(db.get(Task, tasks["First"]["id"]))
        db.commit()
    tid = tasks["Second"]["id"]
    assert command(client, "task.update", {"id": tid, "status": "in_progress"}).status_code == 409
    repaired = edit_links(client, tid, depends_on=[], requirement_criteria_indices=[0], status="in_progress")
    assert repaired.status_code == 200, repaired.text
    task = repaired.json()["tasks"][0]
    assert task["status"] == "in_progress" and not task["dependency_blocked"]
    assert task["planning"]["depends_on"] == [] and task["planning"]["requirement_criteria_indices"] == [0]
    assert task["planning"]["requirement_snapshot"]["acceptance_criteria"] == ["Find a requirement by title"]
    assert task["planning"]["requirement_revision"] == 1
    assert task["planning"]["requirement_basis"] == repaired.json()["requirements"][0]["basis"]


@pytest.mark.parametrize("invalid", ["cycle", "self", "missing", "foreign", "criterion", "date"])
def test_task_link_edits_validate_graph_criteria_scope_and_schedule_atomically(env, invalid):
    client, sessions, _ = env
    rid = requirement(client)
    saved = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {"key": "a", "title": "First", "starts_on": "2026-10-16", "ends_on": "2026-10-18"},
                {
                    "key": "b",
                    "title": "Second",
                    "depends_on": ["a"],
                    "starts_on": "2026-10-18",
                    "ends_on": "2026-10-20",
                },
            ],
        },
    ).json()
    tasks = {task["title"]: task for task in saved["tasks"]}
    first, second = tasks["First"]["id"], tasks["Second"]["id"]
    with sessions() as db:
        db.add(Task(id="private", tenant_id="tenant", project_id="other", title="Private"))
        db.commit()
    changes = {
        "cycle": {"depends_on": [second]},
        "self": {"depends_on": [first]},
        "missing": {"depends_on": ["missing"]},
        "foreign": {"depends_on": ["private"]},
        "criterion": {"requirement_criteria_indices": [1]},
        "date": {"depends_on": [second]},
    }[invalid]
    if invalid == "date":
        command(client, "task.update", {"id": second, "starts_on": None, "ends_on": None})
        unlinked = edit_links(client, second, depends_on=[])
        assert unlinked.status_code == 200, unlinked.text
        assert command(client, "task.update", {"id": second, "ends_on": "2026-10-19"}).status_code == 200
    before = client.get("/api/v1/delivery/workspace").json()
    response = edit_links(client, first, **changes)
    assert response.status_code == 422, response.text
    assert (
        response.json()["detail"]["code"]
        == {
            "cycle": "plan_dependency_cycle",
            "self": "plan_dependency_cycle",
            "missing": "plan_dependency_missing",
            "foreign": "plan_dependency_missing",
            "criterion": "plan_criteria_invalid",
            "date": "plan_dependency_dates",
        }[invalid]
    )
    after = client.get("/api/v1/delivery/workspace").json()
    assert after["version"] == before["version"]
    assert after["tasks"] == before["tasks"]


@pytest.mark.parametrize(
    "invalid", ["no_basis", "invalid_basis", "stale", "null_dependencies", "null_criteria"]
)
def test_task_link_edits_require_explicit_current_task_basis(env, invalid):
    client, sessions, _ = env
    rid = requirement(client)
    saved = command(client, "task.create", {"requirement_id": rid, "title": "Original"}).json()
    payload = {
        "id": saved["tasks"][0]["id"],
        "requirement_criteria_indices": [0],
        "task_basis": saved["tasks"][0]["basis"],
    }
    if invalid == "no_basis":
        payload.pop("task_basis")
    elif invalid == "invalid_basis":
        payload["task_basis"] = "invalid"
    elif invalid == "null_dependencies":
        payload["depends_on"] = None
    elif invalid == "null_criteria":
        payload["requirement_criteria_indices"] = None
    else:
        with sessions() as db:
            db.get(Requirement, rid).acceptance_criteria = ["New meaning at same index"]
            db.commit()
    failed = command(client, "task.update", payload)
    assert failed.status_code == (409 if invalid == "stale" else 422), failed.text
    assert (
        client.get("/api/v1/delivery/workspace").json()["tasks"][0]["planning"][
            "requirement_criteria_indices"
        ]
        == []
    )


@pytest.mark.parametrize("accepted", [False, True])
def test_changed_task_mapping_permanently_invalidates_previous_execution(bridge, accepted):
    client, _, _, _, _, _, task = bridge
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution)
    execution = sync(bridge, intent)
    review = {
        "id": intent["id"],
        "decision": "accept",
        "comment": "Verified original mapping",
        "run_version": execution["run_version"],
    }
    if accepted:
        assert command(client, "execution.review", review).status_code == 200
    edited = edit_links(client, task["id"], requirement_criteria_indices=[0])
    assert edited.status_code == 200, edited.text
    entry = edited.json()["executions"][0]
    assert entry["stale"] is True and entry["planning_invalidated"] is True
    assert edited.json()["summary"]["tasks_done"] == 0
    if accepted:
        assert edited.json()["requirements"][0]["flow"]["artifacts"][0]["stale"] is True
    restored = edit_links(client, task["id"], requirement_criteria_indices=[])
    assert restored.status_code == 200, restored.text
    observed = sync(bridge, intent)
    assert observed["stale"] is True
    assert command(client, "execution.review", review).status_code == 409
    if accepted:
        fresh = queue(bridge)
        assert fresh["id"] != intent["id"] and not fresh["stale"]


def test_resaving_unchanged_task_links_preserves_verified_execution(bridge):
    client, _, _, _, _, _, task = bridge
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution)
    execution = sync(bridge, intent)
    accepted = command(
        client,
        "execution.review",
        {
            "id": intent["id"],
            "decision": "accept",
            "comment": "Verified unchanged links",
            "run_version": execution["run_version"],
        },
    )
    assert accepted.status_code == 200, accepted.text
    saved = edit_links(
        client, task["id"], requirement_criteria_indices=[], depends_on=[], starts_on="2026-10-16"
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["summary"]["tasks_done"] == 1
    assert saved.json()["executions"][0]["stale"] is False
    assert saved.json()["requirements"][0]["flow"]["artifacts"][0]["stale"] is False


def test_mapping_edit_reopening_testing_stores_the_new_revision_basis(env):
    from sop_manager.routers.sql_models import DeliveryWorkspace

    client, sessions, _ = env
    rid = requirement(client)
    created = command(
        client, "tasks.plan", {"requirement_id": rid, "items": [{"title": "Implementation"}]}
    ).json()
    task_id = created["tasks"][0]["id"]
    with sessions() as db:
        workspace = db.get(DeliveryWorkspace, "project")
        state = json.loads(json.dumps(workspace.data))
        state["flows"][rid]["stage"] = "testing"
        workspace.data = state
        db.commit()
    updated = edit_links(client, task_id, requirement_criteria_indices=[0])
    assert updated.status_code == 200, updated.text
    assert updated.json()["requirements"][0]["flow"]["revision"] == 2
    assert updated.json()["tasks"][0]["planning"]["requirement_revision"] == 2


def test_unlinking_predecessor_and_rescheduling_is_validated_as_one_change(env):
    client, _, _ = env
    rid = requirement(client)
    saved = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {"key": "a", "title": "First", "ends_on": "2026-10-18"},
                {"key": "b", "title": "Second", "depends_on": ["a"], "starts_on": "2026-10-18"},
            ],
        },
    ).json()
    task_id = next(task["id"] for task in saved["tasks"] if task["title"] == "Second")
    updated = edit_links(client, task_id, depends_on=[], starts_on="2026-10-17")
    assert updated.status_code == 200, updated.text
    task = next(task for task in updated.json()["tasks"] if task["id"] == task_id)
    assert task["planning"]["starts_on"] == "2026-10-17" and task["planning"]["depends_on"] == []
