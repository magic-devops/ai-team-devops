"""Deployment integration preserves release evidence and canonical read boundaries."""

from copy import deepcopy
from types import SimpleNamespace

from fastapi import BackgroundTasks
from sop_manager.routers.delivery_contract import default_flow, stage_gates
from sop_manager.routers.delivery_release import quality
from sop_manager.routers.delivery_service import initial_state, materialize
from sop_manager.routers.project_lifecycle import preview as lifecycle_preview
from sop_manager.routers.project_lifecycle_contract import ProjectLifecyclePreviewInput
from sop_manager.routers.sql_models import DeliveryWorkspace, Project, User
from test_delivery_deployment_domain import (
    action as domain_action,
)
from test_delivery_deployment_domain import (
    create as domain_create,
)
from test_delivery_deployment_domain import (
    domain as deployment_domain,
)
from test_delivery_release import (
    create_candidate,
    import_ci,
)
from test_delivery_release import (
    scope as release_scope,
)
from test_delivery_release import (
    trusted as release_trusted,
)
from test_delivery_workbench import env as delivery_env

env = delivery_env
scope = release_scope
trusted = release_trusted
domain = deployment_domain


def test_normal_release_to_operations_keeps_the_signed_quality_scope(scope):
    sessions, data = scope
    with sessions() as db:
        project = db.get(Project, "project")
        before = quality(db, project, data, requirement_ids=["R-release"])
        assert before["eligible"]
        data["flows"]["R-release"]["stage"] = "operations"
        after = quality(db, project, data, requirement_ids=["R-release"])
    assert after["eligible"]
    assert after["scope_basis"] == before["scope_basis"]


def test_reopening_still_invalidates_the_accepted_quality_scope(scope):
    sessions, data = scope
    with sessions() as db:
        project = db.get(Project, "project")
        before = quality(db, project, data, requirement_ids=["R-release"])
        data["flows"]["R-release"]["stage"] = "intake"
        after = quality(db, project, data, requirement_ids=["R-release"])
    assert not after["eligible"]
    assert after["scope_basis"] != before["scope_basis"]


def test_deployment_catalogue_is_readable_without_provisioning_workspace(env):
    client, sessions, _ = env
    response = client.get("/api/v1/delivery/deployments")
    assert response.status_code == 200, response.text
    assert response.json()["project_id"] == "project"
    assert response.json()["environments"] == []
    assert response.json()["deployments"] == []
    with sessions() as db:
        assert db.query(DeliveryWorkspace).count() == 0


def test_release_gate_only_uses_the_server_verified_deployment_fact():
    requirement = {"id": "R-release"}
    flow = {**default_flow(), "stage": "release", "deployment_verified": True}
    unsigned = {item["id"]: item["ok"] for item in stage_gates(requirement, flow, [], [])}
    assert unsigned["deployment_verified"] is False
    verified = {
        item["id"]: item["ok"] for item in stage_gates(requirement, flow, [], [], deployment_verified=True)
    }
    assert verified["deployment_verified"] is True


def test_unknown_deployment_blocks_archive_and_has_an_exact_deployment_target(env):
    _, sessions, _ = env
    data = initial_state()
    data["deployments"] = [
        {
            "id": "deployment-unknown",
            "status": "unknown",
            "environment_id": "env-1",
            "candidate_id": "release-1",
            "operations": [],
        }
    ]
    with sessions() as db:
        result = lifecycle_preview(
            db,
            db.get(Project, "project"),
            db.get(User, "lead"),
            data,
            ProjectLifecyclePreviewInput(target_status="archived", reason="Close completed work"),
            version=0,
        )
    assert not result["allowed"]
    blocker = next(item for item in result["blockers"] if item["code"] == "project_deployment_unclosed")
    assert blocker["target"]["kind"] == "deployment"
    assert blocker["target"]["deployment_id"] == "deployment-unknown"


def test_deployed_requirements_need_both_current_approval_and_latest_physical_result(trusted):
    from sop_manager.routers.delivery_deployment_facts import current_deployed_requirement_ids
    from sop_manager.routers.delivery_release import apply_release, release_detail
    from sop_manager.routers.delivery_release_contract import ReleaseCandidateReview

    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        evidence, _ = import_ci(db, project, user, data, key)
        candidate_id = create_candidate(db, project, user, data, evidence)
        detail = release_detail(db, project, data, user, candidate_id, version=0)
        apply_release(
            db,
            project,
            user,
            data,
            "release.candidate.review",
            ReleaseCandidateReview(
                id=candidate_id,
                decision="approve",
                comment="Review signed release scope",
                review_basis=detail["candidate"]["review_basis"],
            ),
        )
        data["deployments"] = [
            {
                "id": "deployment-first",
                "candidate_id": candidate_id,
                "environment_id": "env-1",
                "status": "verified",
                "actual_traffic": 100,
                "physical_started": True,
                "snapshot": {"environment_generation": 1},
            }
        ]
        data["deployment_environments"] = [{"id": "env-1", "generation": 1, "active": True}]
        assert current_deployed_requirement_ids(db, project, data) == {"R-release"}
        snapshot = materialize(db, project, data, user)
        assert snapshot["summary"]["released"] == 1
        assert next(
            gate
            for gate in snapshot["requirements"][0]["flow"]["gates"]
            if gate["id"] == "deployment_verified"
        )["ok"]
        data["flows"]["R-release"]["stage"] = "operations"
        assert current_deployed_requirement_ids(db, project, data) == {"R-release"}
        data["deployments"].append(
            {
                "id": "deployment-next",
                "candidate_id": "release-new",
                "environment_id": "env-1",
                "status": "unknown",
                "actual_traffic": None,
                "physical_started": True,
            }
        )
        assert current_deployed_requirement_ids(db, project, data) == set()
        assert materialize(db, project, data, user)["summary"]["released"] == 0


def test_manual_record_and_old_operations_never_supply_deployment_facts(scope):
    from sop_manager.routers.delivery_deployment_facts import current_deployed_requirement_ids

    sessions, data = scope
    data["flows"]["R-release"].update(stage="operations", deployment_verified=True)
    with sessions() as db:
        assert current_deployed_requirement_ids(db, db.get(Project, "project"), data) == set()


def test_replaying_committed_start_recovers_lost_background_scheduling(env, domain, monkeypatch):
    client, _, _ = env
    deployment_id = domain_create(domain)
    domain_action(domain, deployment_id, "deployment.dispatch")
    domain.db.add(
        DeliveryWorkspace(
            project_id="project",
            tenant_id="tenant",
            version=1,
            data=deepcopy(domain.data),
        )
    )
    domain.db.commit()
    client.app.state.hermes_store = domain.store
    client.app.state.hermes_execution = domain.execution
    scheduled = []
    monkeypatch.setattr(
        domain.execution,
        "execute",
        lambda principal, workspace, run_id: scheduled.append((principal.actor, workspace, run_id)),
    )
    shown = client.get(f"/api/v1/delivery/deployments/{deployment_id}")
    assert shown.status_code == 200, shown.text
    shown = shown.json()
    body = {
        "action": "deployment.start",
        "expected_version": shown["version"],
        "idempotency_key": "lost-scheduling-original-key",
        "payload": {
            "id": deployment_id,
            "basis": shown["deployment"]["basis"],
            "comment": "Start reviewed operation",
        },
    }
    with monkeypatch.context() as suppressed:
        suppressed.setattr(BackgroundTasks, "add_task", lambda *args, **kwargs: None)
        first = client.post("/api/v1/delivery/commands", json=body)
    assert first.status_code == 200, first.text
    assert scheduled == []
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"]
    runs = domain.store.list(domain.principal, domain.workspace["id"], "runs")
    assert len(runs) == 1
    assert runs[0]["status"] == "queued"
    assert scheduled == [("lead", domain.workspace["id"], runs[0]["id"])]

    from sop_manager.project_write_guard import lifecycle_scope

    with lifecycle_scope(domain.db, domain.project.tenant_id, domain.project.id):
        domain.project.status = "paused"
        domain.db.commit()
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert scheduled == [("lead", domain.workspace["id"], runs[0]["id"])]
    with lifecycle_scope(domain.db, domain.project.tenant_id, domain.project.id):
        domain.project.status = "active"
        domain.db.commit()

    # A delayed replay of this start cannot schedule a later canary operation.
    from hermes_core.deployments import ManagedDeployments
    from hermes_core.transactional import digest

    latest = client.get(f"/api/v1/delivery/deployments/{deployment_id}").json()["deployment"]
    previous = latest["operations"][-1]
    plan = {**previous["plan"], "operation_id": "later-reviewed-canary", "traffic_percent": 100}
    managed = ManagedDeployments(domain.store, domain.execution)
    later = managed.dispatch(
        domain.principal,
        domain.workspace["id"],
        plan=plan,
        runner_argv=latest["snapshot"]["definition"]["runner_argv"],
        target_snapshot=latest["snapshot"]["target_snapshot"],
        key=plan["operation_id"],
    )
    managed.start(domain.principal, domain.workspace["id"], later["id"], key=plan["operation_id"])
    domain.db.expire_all()
    saved = domain.db.get(DeliveryWorkspace, "project")
    changed = deepcopy(saved.data)
    entry = next(item for item in changed["deployments"] if item["id"] == deployment_id)
    entry["operations"].append(
        {
            **previous,
            "id": plan["operation_id"],
            "plan": plan,
            "plan_digest": digest(plan),
            "run_id": later["id"],
        }
    )
    saved.data = changed
    domain.db.commit()
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200, replay.text
    assert scheduled == [("lead", domain.workspace["id"], runs[0]["id"])]


def test_background_deployment_sync_only_observes_changed_runtime_evidence(env, domain):
    from sop_manager.routers.delivery_sync import sync_once

    _, sessions, _ = env
    deployment_id = domain_create(domain)
    domain_action(domain, deployment_id, "deployment.dispatch")
    run = domain.store.list(domain.principal, domain.workspace["id"], "runs")[0]
    domain.db.add(
        DeliveryWorkspace(project_id="project", tenant_id="tenant", version=1, data=deepcopy(domain.data))
    )
    domain.db.commit()
    domain.store.mutate(
        domain.principal,
        domain.workspace["id"],
        "runs",
        run["id"],
        operation="test.lease_expired",
        key="lease-expired",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda item: {
            "status": "failed",
            "data": {
                **item["data"],
                "recovery_requires_review": True,
                "error": "Review unknown side effects",
            },
        },
    )
    app = SimpleNamespace(state=SimpleNamespace(hermes_store=domain.store, hermes_execution=domain.execution))
    assert sync_once(app, sessions=sessions) == 1
    with sessions() as db:
        workspace = db.get(DeliveryWorkspace, "project")
        assert workspace.data["deployments"][0]["status"] == "unknown"
        assert workspace.data["deployments"][0]["issue_id"]
        version = workspace.version
    assert sync_once(app, sessions=sessions) == 0
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").version == version
    assert len(domain.store.list(domain.principal, domain.workspace["id"], "runs")) == 1
