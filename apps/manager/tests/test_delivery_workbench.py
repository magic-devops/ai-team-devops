"""Behaviour tests for the project delivery workflow, using a real isolated SQL database."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sop_manager.routers import delivery
from sop_manager.routers.auth_sql import current_user
from sop_manager.routers.sql_models import (
    Base,
    Issue,
    Project,
    ProjectMember,
    Requirement,
    Task,
    Tenant,
    User,
    get_session,
)
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions() as db:
        db.add(Tenant(id="tenant", name="Team", slug="team"))
        db.flush()
        unusable_hash = "not-a-login"
        db.add_all(
            [
                User(
                    id="lead",
                    tenant_id="tenant",
                    username="lead",
                    password_hash=unusable_hash,
                    role="tenant_admin",
                    status="active",
                ),
                User(
                    id="reader",
                    tenant_id="tenant",
                    username="reader",
                    password_hash=unusable_hash,
                    role="viewer",
                    status="active",
                ),
            ]
        )
        db.add_all(
            [
                Project(id="project", tenant_id="tenant", name="Product"),
                Project(id="other", tenant_id="tenant", name="Other"),
            ]
        )
        db.flush()
        db.add(ProjectMember(project_id="project", user_id="reader", role="viewer"))
        db.commit()
    actor = {"id": "lead"}

    def session():
        with sessions() as db:
            yield db

    def identity():
        with sessions() as db:
            return db.get(User, actor["id"])

    app = FastAPI()
    app.include_router(delivery.router)
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[current_user] = identity
    client = TestClient(app, headers={"X-Project-Id": "project"})
    yield client, sessions, actor
    engine.dispose()


def test_exact_receipt_recovery_precedes_a_tightened_payload_contract(env, monkeypatch):
    from pydantic import BaseModel
    from sop_manager.routers.delivery import PAYLOADS

    client, _, _ = env
    original = {"action": "task.create", "expected_version": 0, "idempotency_key": "fixed-old-contract",
        "payload": {"title": "Original task", "acceptance_criteria": ["Accepted condition"]}}
    first = client.post("/api/v1/delivery/commands", json=original)
    assert first.status_code == 200, first.text
    class TightenedContract(BaseModel):
        required_new_field: str
    monkeypatch.setitem(PAYLOADS, "task.create", TightenedContract)
    replay = client.post("/api/v1/delivery/commands", json=original)
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    assert replay.json()["resource"] == first.json()["resource"]
    changed = {**original, "idempotency_key": "new-request"}
    assert client.post("/api/v1/delivery/commands", json=changed).status_code == 422


def command(client, action, payload, key=None, version=None):
    state = client.get("/api/v1/delivery/workspace").json()
    if action == "requirement.update" and {"title", "description", "acceptance_criteria"} & payload.keys() and not {"requirement_basis", "change_preview_basis"} & payload.keys():
        requirement = next((row for row in state["requirements"] if row["id"] == payload.get("id")), None)
        if requirement:
            preview = client.post(f"/api/v1/delivery/requirements/{requirement['id']}/change-preview", json={
                "requirement_basis": requirement["basis"],
                "changes": {field: payload[field] for field in ("title", "description", "acceptance_criteria") if field in payload},
            })
            if preview.status_code == 200:
                payload = {**payload, "requirement_basis": preview.json()["requirement_basis"], "change_preview_basis": preview.json()["preview_basis"]}
    if (
        action == "task.update"
        and {"starts_on", "ends_on", "allocations"} & payload.keys()
        and "planning_basis" not in payload
    ):
        payload = {**payload, "planning_basis": state["planning_basis"]}
    response = client.post(
        "/api/v1/delivery/commands",
        json={
            "action": action,
            "payload": payload,
            "expected_version": state["version"] if version is None else version,
            "idempotency_key": key or f"test-{action}-{state['version']}",
        },
    )
    if response.status_code != 200:
        return response
    # Legacy domain tests explicitly inspect the export after a successful write.
    # Raw HTTP CommandAck contracts are tested without this inspection helper.
    exported = client.get("/api/v1/delivery/workspace")
    assert exported.status_code == 200, exported.text
    return response.__class__(response.status_code, json={**exported.json(), **response.json()},
                              headers=response.headers, request=response.request)


def requirement(client):
    response = command(
        client,
        "requirement.create",
        {
            "title": "Search",
            "description": "Search project work",
            "priority": "P1",
            "acceptance_criteria": ["Find a requirement by title"],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["requirements"][0]["id"]


def test_read_does_not_create_state_and_creation_is_real_business_data(env):
    client, sessions, _ = env
    assert client.get("/api/v1/delivery/workspace").json()["version"] == 0
    rid = requirement(client)
    with sessions() as db:
        row = db.get(Requirement, rid)
        assert row.title == "Search" and row.project_id == "project"
    snapshot = client.get("/api/v1/delivery/workspace").json()
    assert snapshot["requirements"][0]["flow"]["stage"] == "intake"
    assert snapshot["summary"]["accepted"] == 0
    with sessions() as db:
        from sop_manager.routers.sql_models import DeliveryProgressObservation

        observed = db.query(DeliveryProgressObservation).order_by(DeliveryProgressObservation.seq.desc()).first()
        assert len(observed.data["requirements"]) == 1


def test_receipt_replay_and_stale_edits_do_not_duplicate_or_overwrite(env):
    client, sessions, _ = env
    payload = {"title": "One", "acceptance_criteria": ["Works"]}
    first = command(client, "requirement.create", payload, "repeat-create", 0)
    replay = command(client, "requirement.create", payload, "repeat-create", 0)
    assert first.status_code == replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert (
        command(
            client, "requirement.create", {**payload, "title": "Different"}, "repeat-create", 0
        ).status_code
        == 409
    )
    assert command(client, "project.update", {"goal": "stale"}, "stale-update", 0).status_code == 409
    with sessions() as db:
        assert db.query(Requirement).count() == 1


def test_permissions_and_cross_project_references(env):
    client, sessions, actor = env
    rid = requirement(client)
    actor["id"] = "reader"
    assert client.get("/api/v1/delivery/workspace").status_code == 200
    assert command(client, "requirement.update", {"id": rid, "title": "No"}).status_code == 403
    assert client.get("/api/v1/delivery/workspace", headers={"X-Project-Id": "other"}).status_code == 403
    actor["id"] = "lead"
    with sessions() as db:
        db.add(Requirement(id="REQ-other", project_id="other", tenant_id="tenant", title="Private"))
        db.commit()
    assert command(client, "task.create", {"requirement_id": "REQ-other", "title": "No"}).status_code == 404


def test_stage_gates_require_evidence_and_do_not_skip_stages(env):
    client, _, _ = env
    rid = requirement(client)
    result = command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed criteria"})
    assert result.status_code == 200, result.text
    assert result.json()["requirements"][0]["flow"]["stage"] == "product"
    blocked = command(client, "stage.advance", {"requirement_id": rid, "comment": "No design"})
    assert blocked.status_code == 422
    assert client.get("/api/v1/delivery/workspace").json()["requirements"][0]["flow"]["stage"] == "product"
    assert (
        command(
            client,
            "artifact.add",
            {
                "requirement_id": rid,
                "kind": "prd",
                "title": "PRD",
                "content": "Users can search work by title.",
            },
        ).status_code
        == 200
    )
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "PRD approved"}).status_code
        == 200
    )


def test_breakdown_creates_assigned_tasks_and_rejects_bad_participant(env):
    client, sessions, _ = env
    rid = requirement(client)
    person = command(
        client, "member.save", {"name": "Builder", "kind": "agent", "role": "developer", "tool": "codex"}
    )
    assert person.status_code == 200
    member_id = next(x["id"] for x in person.json()["members"] if x["name"] == "Builder")
    result = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {"title": "Build search", "owner_id": member_id, "description": "Implement title search"},
                {"title": "Verify search", "owner_id": "user:lead", "description": "Verify acceptance"},
            ],
        },
    )
    assert result.status_code == 200, result.text
    with sessions() as db:
        tasks = db.query(Task).filter_by(req_id=rid).all()
        assert len(tasks) == 2 and all(t.owner_id for t in tasks)
    assert (
        command(
            client, "task.create", {"requirement_id": rid, "title": "Invalid", "owner_id": "missing"}
        ).status_code
        == 422
    )


def test_issue_to_requirement_is_linked_and_deduplicated(env):
    client, sessions, _ = env
    with sessions() as db:
        db.add(
            Issue(
                id="ISSUE-1",
                tenant_id="tenant",
                project_id="project",
                title="Search timeout",
                description="Large query fails",
                severity="P1",
            )
        )
        db.commit()
    response = command(
        client, "issue.promote", {"issue_id": "ISSUE-1", "acceptance_criteria": ["Query completes"]}
    )
    assert response.status_code == 200, response.text
    again = command(
        client, "issue.promote", {"issue_id": "ISSUE-1", "acceptance_criteria": ["Query completes"]}
    )
    assert again.status_code == 200
    with sessions() as db:
        assert db.query(Requirement).count() == 1
        assert db.get(Issue, "ISSUE-1").status == "open"
    assert response.json()["requirements"][0]["flow"]["source_issue_id"] == "ISSUE-1"


def test_design_revision_invalidates_downstream_approval(env):
    client, _, _ = env
    rid = requirement(client)
    command(client, "stage.advance", {"requirement_id": rid, "comment": "Accepted"})
    result = command(client, "requirement.update", {"id": rid, "acceptance_criteria": ["New criteria"]})
    assert result.status_code == 200
    flow = result.json()["requirements"][0]["flow"]
    assert flow["stage"] == "intake" and flow["revision"] == 2
    assert len(flow["reviews"]) == 1
    assert result.json()["summary"]["accepted"] == 0


def test_existing_requirement_editor_cannot_keep_stale_design_approval(env):
    client, sessions, _ = env
    rid = requirement(client)
    assert command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed"}).status_code == 200
    with sessions() as db:
        db.get(Requirement, rid).acceptance_criteria = ["Changed through existing requirement editor"]
        db.commit()
    snapshot = client.get("/api/v1/delivery/workspace").json()
    flow = snapshot["requirements"][0]["flow"]
    assert flow["stage"] == "intake" and flow["revision"] == 2
    result = command(client, "stage.advance", {"requirement_id": rid, "comment": "Review changed scope"})
    assert result.json()["requirements"][0]["flow"]["stage"] == "product"
    assert result.json()["requirements"][0]["flow"]["revision"] == 2


def test_roster_is_consistent_between_project_users(env):
    client, _, actor = env
    lead_roster = client.get("/api/v1/delivery/workspace").json()["members"]
    actor["id"] = "reader"
    assert client.get("/api/v1/delivery/workspace").json()["members"] == lead_roster


def test_task_scope_change_invalidates_passed_testing(env):
    from sop_manager.routers.sql_models import DeliveryWorkspace

    client, sessions, _ = env
    rid = requirement(client)
    task = command(
        client, "task.create", {"requirement_id": rid, "title": "Build", "owner_id": "user:lead"}
    ).json()["tasks"][0]
    command(client, "task.update", {"id": task["id"], "status": "completed"})
    with sessions() as db:
        workspace = db.get(DeliveryWorkspace, "project")
        from copy import deepcopy

        state = deepcopy(workspace.data)
        state["flows"][rid]["stage"] = "acceptance"
        state["flows"][rid]["artifacts"] = [{"id": "test", "kind": "test", "revision": 1, "result": "passed"}]
        workspace.data = state
        db.commit()
    result = command(
        client, "task.update", {"id": task["id"], "description": "New behaviour requiring validation"}
    )
    assert result.status_code == 200
    flow = result.json()["requirements"][0]["flow"]
    assert flow["stage"] == "intake" and flow["revision"] == 2


def test_invalid_dates_urls_empty_content_and_unknown_actions(env):
    client, _, _ = env
    rid = requirement(client)
    assert (
        command(client, "project.update", {"starts_on": "2026-12-02", "ends_on": "2026-01-01"}).status_code
        == 422
    )
    assert (
        command(
            client,
            "artifact.add",
            {"requirement_id": rid, "kind": "prd", "title": "Bad", "url": "javascript:alert(1)"},
        ).status_code
        == 422
    )
    assert (
        command(client, "artifact.add", {"requirement_id": rid, "kind": "prd", "title": "Empty"}).status_code
        == 422
    )
    assert command(client, "stage.advance", {"requirement_id": rid, "comment": " "}).status_code == 422
    assert command(client, "not-an-action", {}).status_code == 422


def test_full_delivery_keeps_test_acceptance_release_separate(env):
    client, sessions, _ = env
    rid = requirement(client)
    for stage, kind in [
        ("intake", None),
        ("product", "prd"),
        ("ux", "prototype"),
        ("architecture", "architecture"),
    ]:
        if kind:
            assert (
                command(
                    client,
                    "artifact.add",
                    {
                        "requirement_id": rid,
                        "kind": kind,
                        "title": kind,
                        "content": "Reviewed design evidence",
                    },
                ).status_code
                == 200
            )
        assert (
            command(
                client, "stage.advance", {"requirement_id": rid, "comment": f"Review {stage}"}
            ).status_code
            == 200
        )
    task_result = command(
        client,
        "task.create",
        {
            "requirement_id": rid,
            "title": "Build",
            "owner_id": "user:lead",
            "requirement_criteria_indices": [0],
        },
    )
    tid = task_result.json()["tasks"][0]["id"]
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Plan ready"}).status_code == 200
    )
    assert command(client, "stage.advance", {"requirement_id": rid, "comment": "Not done"}).status_code == 422
    assert command(client, "task.update", {"id": tid, "status": "completed"}).status_code == 200
    assert (
        command(
            client, "stage.advance", {"requirement_id": rid, "comment": "Implementation ready"}
        ).status_code
        == 200
    )
    assert (
        command(
            client,
            "artifact.add",
            {
                "requirement_id": rid,
                "kind": "test",
                "title": "Regression",
                "content": "Acceptance scenario passed",
                "result": "passed",
            },
        ).status_code
        == 200
    )
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Test verified"}).status_code
        == 200
    )
    snapshot = client.get("/api/v1/delivery/workspace").json()
    assert snapshot["summary"]["accepted"] == 0
    accepted = command(
        client, "stage.advance", {"requirement_id": rid, "comment": "Accepted against criteria"}
    )
    assert accepted.json()["summary"]["accepted"] == 1
    assert accepted.json()["summary"]["released"] == 0
    assert (
        command(
            client, "stage.advance", {"requirement_id": rid, "comment": "Release without evidence"}
        ).status_code
        == 422
    )
    assert (
        command(
            client,
            "release.save",
            {
                "requirement_id": rid,
                "version": "1.0.0",
                "environment": "staging",
                "rollback_plan": "Restore previous build",
                "artifact_url": "https://example.org/build/1",
                "verification": "Smoke passed",
            },
        ).status_code
        == 422
    )
    released = command(client, "stage.advance", {"requirement_id": rid, "comment": "Deployment verified"})
    assert released.status_code == 422
    assert "deployment_verified" in released.json()["detail"]["missing"]
    assert client.get("/api/v1/delivery/workspace").json()["summary"]["released"] == 0
    assert (
        command(
            client,
            "artifact.add",
            {
                "requirement_id": rid,
                "kind": "runbook",
                "title": "On-call handover",
                "content": "Monitor errors and restore the previous image if checks fail",
            },
        ).status_code
        == 200
    )
    # A runbook and a hand-written success description still cannot establish
    # deployment. Signed CI/candidate review is covered by the release suite.
    assert command(client, "stage.advance", {"requirement_id": rid, "comment": "Operations verified"}).status_code == 422
    with sessions() as db:
        db.get(Task, tid).description = "Changed through legacy task API"
        db.commit()
    snapshot = client.get("/api/v1/delivery/workspace").json()
    assert snapshot["summary"]["accepted"] == 0 and snapshot["summary"]["released"] == 0
    assert snapshot["requirements"][0]["flow"]["revision"] == 2


@pytest.mark.parametrize(
    "stage,kind",
    [("product", "prd"), ("ux", "prototype"), ("architecture", "architecture"), ("operations", "runbook")],
)
def test_failed_design_evidence_does_not_pass_a_stage(stage, kind):
    from sop_manager.routers.delivery_contract import default_flow, stage_gates

    flow = {
        **default_flow(),
        "stage": stage,
        "artifacts": [
            {"kind": kind, "revision": 1, "result": "passed"},
            {"kind": kind, "revision": 1, "result": "failed"},
        ],
    }
    assert not next(g["ok"] for g in stage_gates({"id": "req"}, flow, [], []) if g["id"] == kind)


def test_developer_cannot_approve_and_foreign_tenant_cannot_read(env):
    client, sessions, actor = env
    with sessions() as db:
        db.get(ProjectMember, ("project", "reader")).role = "developer"
        db.add(Tenant(id="foreign", slug="foreign", name="Foreign"))
        db.flush()
        db.add(Project(id="foreign-project", tenant_id="foreign", name="Foreign project"))
        db.commit()
    rid = requirement(client)
    actor["id"] = "reader"
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Cannot approve"}).status_code
        == 403
    )
    assert command(client, "member.save", {"kind": "agent", "name": "Cannot configure"}).status_code == 403
    actor["id"] = "lead"
    assert (
        client.get("/api/v1/delivery/workspace", headers={"X-Project-Id": "foreign-project"}).status_code
        == 403
    )
