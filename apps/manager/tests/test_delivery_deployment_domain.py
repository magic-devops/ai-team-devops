"""Real Manager SQL and Hermes receipts; worker outputs are authenticated test inputs."""

import importlib
import json
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from hermes_core.execution import Execution
from hermes_core.models import Principal
from hermes_core.transactional import Store
from sop_manager.routers.delivery_deployment_contract import (
    DeploymentAction,
    DeploymentCreate,
    DeploymentDetail,
    DeploymentEnvironmentSave,
    DeploymentIndex,
    DeploymentPreview,
    DeploymentPreviewInput,
    DeploymentSync,
)
from sop_manager.routers.delivery_release import apply_release, release_detail
from sop_manager.routers.delivery_release_contract import (
    ReleaseCandidateCreate,
    ReleaseCandidateReview,
    ReleaseCandidateRevoke,
)
from sop_manager.routers.sql_models import Issue, Project, User
from test_delivery_deployment import definition
from test_delivery_release import create_candidate, import_ci, scope, trusted  # noqa: F401
from test_delivery_workbench import env  # noqa: F401


@pytest.fixture
def domain(trusted, tmp_path):  # noqa: F811
    sessions, data, key = trusted
    module = importlib.import_module("sop_manager.routers.delivery_deployment")
    store = Store("sqlite:///" + str(tmp_path / "deployment-runtime.sqlite"))
    execution = Execution(store, tmp_path, agentd=sys.executable)
    execution.allowed_roots = (tmp_path.resolve(),)
    principal = Principal("lead", tenant="tenant", business="team")
    workspace = store.create(
        principal,
        "",
        "workspaces",
        {"name": "Release host", "root": str(tmp_path), "owner": "lead"},
        "workspace",
        "test",
    )
    with sessions() as db:
        user, project = db.get(User, "lead"), db.get(Project, "project")
        user.role = "super_admin"
        db.commit()
        ci, _ = import_ci(db, project, user, data, key)
        candidate = create_candidate(db, project, user, data, ci)
        view = release_detail(db, project, data, user, candidate, version=1)["candidate"]
        apply_release(
            db,
            project,
            user,
            data,
            "release.candidate.review",
            ReleaseCandidateReview(
                id=candidate,
                decision="approve",
                comment="Deploy trusted build",
                review_basis=view["review_basis"],
            ),
        )
        obj = SimpleNamespace(
            module=module,
            db=db,
            data=data,
            project=project,
            user=user,
            store=store,
            execution=execution,
            principal=principal,
            workspace=workspace,
            candidate=candidate,
        )
        obj.apply = lambda action, body: module.apply_deployment(
            db, project, user, data, action, body, store, execution
        )
        obj.preview = lambda body: module.deployment_preview(
            db, project, data, user, body, version=1, store=store, execution=execution
        )
        obj.index = lambda: module.deployment_index(
            db, project, data, user, version=1, store=store, execution=execution
        )
        obj.detail = lambda id: module.deployment_detail(
            db, project, data, user, id, version=1, store=store, execution=execution
        )["deployment"]
        obj.environment = obj.apply(
            "deployment.environment.save",
            DeploymentEnvironmentSave(**definition(workspace_id=workspace["id"])),
        )[0]
        yield obj
    store.engine.dispose()


def create(d):
    body = DeploymentPreviewInput(
        candidate_id=d.candidate, environment_id=d.environment, reason="Ship approved work"
    )
    preview = d.preview(body)
    assert preview["allowed"], preview["reasons"]
    return d.apply(
        "deployment.create", DeploymentCreate(**body.model_dump(), preview_basis=preview["preview_basis"])
    )[0]


def action(d, id, name):
    return d.apply(
        name, DeploymentAction(id=id, basis=d.detail(id)["basis"], comment="Explicit controlled action")
    )


def completed(d, id, *, status="verified", change=None):
    item = d.detail(id)
    op = item["operations"][-1]
    plan = op["plan"]
    finished = datetime.now(timezone.utc)
    started = finished - timedelta(seconds=2)
    now = finished.isoformat()
    result = {
        "protocol": "sop.deployment.result.v1",
        "operation_id": plan["operation_id"],
        "request_digest": op["plan_digest"],
        "status": status,
        "artifact_sha256": plan["artifact_sha256"],
        "traffic_percent": plan["traffic_percent"],
        "apply": {
            "executed": True,
            "reused": op["observe"],
            "exit_code": 0,
            "duration_ms": 10,
            "stdout": "applied",
            "stderr": "",
        },
        "probes": [
            {
                "healthy": True,
                "artifact_sha256": plan["artifact_sha256"],
                "traffic_percent": plan["traffic_percent"],
                "operation_id": plan["operation_id"],
                "sample_count": 1,
                "observed_at": (started + timedelta(seconds=index)).isoformat(),
                "exit_code": 0,
                "duration_ms": 5,
            }
            for index in (0, 1)
        ],
        "started_at": started.isoformat(),
        "finished_at": now,
        "observation_seconds": 1.1,
        "error": "" if status == "verified" else "Health failed",
        **(change or {}),
    }
    run = d.store.get(d.principal, d.workspace["id"], "runs", op["run_id"])
    node = run["data"]["nodes"][0]["id"]
    d.store.mutate(
        d.principal,
        d.workspace["id"],
        "runs",
        run["id"],
        operation="test.worker.result",
        key="result-" + str(run["version"]),
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda value: {
            "status": "completed",
            "data": {
                **value["data"],
                "node_results": {
                    node: {"succeeded": True, "exit_code": 0, "stdout": json.dumps(result), "stderr": ""}
                },
            },
        },
    )
    d.apply("deployment.sync", DeploymentSync(id=id))
    return d.detail(id)


def test_preview_and_reads_are_pure_and_create_stays_in_manager(domain):
    d = domain
    before = deepcopy(d.data)
    body = DeploymentPreviewInput(
        candidate_id=d.candidate, environment_id=d.environment, reason="Ship approved work"
    )
    DeploymentPreview.model_validate(d.preview(body))
    DeploymentIndex.model_validate(d.index())
    assert d.data == before
    id = create(d)
    assert d.detail(id)["status"] == "pending_dispatch"
    assert not d.store.list(d.principal, d.workspace["id"], "runs")
    DeploymentDetail.model_validate(
        d.module.deployment_detail(
            d.db, d.project, d.data, d.user, id, version=1, store=d.store, execution=d.execution
        )
    )
    proposal = d.preview(body)
    assert not proposal["allowed"]
    with pytest.raises(HTTPException) as denied:
        d.apply(
            "deployment.create",
            DeploymentCreate(**body.model_dump(), preview_basis=proposal["preview_basis"]),
        )
    assert denied.value.status_code == 409
    assert d.module.active_deployment_ids(d.data) == [id]


def test_real_result_each_step_and_final_current_are_separate(domain):
    d = domain
    id = create(d)
    action(d, id, "deployment.dispatch")
    assert d.detail(id)["status"] == "planned"
    result = action(d, id, "deployment.start")[2]
    assert result["start_run"]["run_id"] == d.detail(id)["operations"][-1]["run_id"]
    assert d.detail(id)["status"] == "queued"
    partial = completed(d, id)
    assert partial["status"] == "awaiting_promotion" and partial["actual_traffic"] == 25
    assert not d.module.deployment_verified_for_release(d.data, d.candidate)
    action(d, id, "deployment.advance")
    assert len(d.detail(id)["operations"]) == 2
    assert d.detail(id)["status"] == "pending_dispatch"
    action(d, id, "deployment.dispatch")
    action(d, id, "deployment.start")
    assert d.detail(id)["actual_traffic"] is None
    final = completed(d, id)
    assert final["status"] == "verified" and final["current"] and final["actual_traffic"] == 100
    assert d.module.deployment_verified_for_release(d.data, d.candidate)
    assert d.module.active_deployment_ids(d.data) == []
    frozen = deepcopy(final["snapshot"])
    d.data["release_candidates"][0]["invalidated"] = True
    after = d.detail(id)
    assert after["status"] == "verified" and not after["business_valid"]
    assert after["snapshot"] == frozen


def test_wrong_result_is_unknown_with_one_issue_and_observe_is_read_only(domain):
    d = domain
    id = create(d)
    action(d, id, "deployment.dispatch")
    action(d, id, "deployment.start")
    unknown = completed(d, id, change={"request_digest": "0" * 64})
    assert unknown["status"] == "unknown" and unknown["actual_traffic"] is None
    assert unknown["issue_id"]
    d.apply("deployment.sync", DeploymentSync(id=id))
    assert d.db.query(Issue).count() == 1
    assert not unknown["actions"]["can_advance"]
    action(d, id, "deployment.observe")
    observe = d.detail(id)["operations"][-1]
    assert (
        observe["observe"]
        and observe["plan"]["operation_id"] == unknown["operations"][0]["plan"]["operation_id"]
    )
    action(d, id, "deployment.dispatch")
    run = d.store.get(d.principal, d.workspace["id"], "runs", d.detail(id)["operations"][-1]["run_id"])
    assert "--observe" in run["data"]["nodes"][0]["argv"]


def test_stale_preview_and_environment_mutation_cannot_change_existing_intent(domain):
    d = domain
    body = DeploymentPreviewInput(candidate_id=d.candidate, environment_id=d.environment, reason="Ship")
    proposal = d.preview(body)
    d.apply(
        "deployment.environment.save",
        DeploymentEnvironmentSave(
            **definition(id=d.environment, workspace_id=d.workspace["id"], min_samples=3)
        ),
    )
    with pytest.raises(HTTPException) as denied:
        d.apply(
            "deployment.create",
            DeploymentCreate(**body.model_dump(), preview_basis=proposal["preview_basis"]),
        )
    assert denied.value.status_code == 409
    id = create(d)
    with pytest.raises(HTTPException) as locked:
        d.apply(
            "deployment.environment.save",
            DeploymentEnvironmentSave(**definition(id=d.environment, workspace_id=d.workspace["id"])),
        )
    assert locked.value.status_code == 409
    old = d.detail(id)["basis"]
    action(d, id, "deployment.dispatch")
    with pytest.raises(HTTPException) as stale:
        d.apply("deployment.start", DeploymentAction(id=id, basis=old, comment="Outdated detail"))
    assert stale.value.status_code == 409


def test_project_approval_does_not_grant_runtime_execute(domain):
    d = domain
    d.user.role = "tenant_admin"
    preview = d.preview(
        DeploymentPreviewInput(candidate_id=d.candidate, environment_id=d.environment, reason="Ship")
    )
    assert not preview["allowed"]
    assert not preview["permissions"]["can_operate"]
    assert not d.data.get("deployments")


def verify_all(d, id):
    while True:
        action(d, id, "deployment.dispatch")
        action(d, id, "deployment.start")
        item = completed(d, id)
        if item["status"] != "awaiting_promotion":
            return item
        action(d, id, "deployment.advance")


def test_failed_new_release_rollback_restores_frozen_physical_baseline_not_approval(domain, trusted):  # noqa: F811
    d = domain
    first = create(d)
    assert verify_all(d, first)["status"] == "verified"
    stable_snapshot = deepcopy(d.detail(first)["snapshot"]["candidate_snapshot"])
    from sop_manager.routers.delivery_release import preview
    from test_delivery_release import candidate_input

    ci, _ = import_ci(d.db, d.project, d.user, d.data, trusted[2], run=2, artifact="c" * 64, commit="d" * 40)
    body = candidate_input(ci).model_copy(update={"version": "2.0.0"})
    proposal = preview(d.db, d.project, d.data, d.user, body, version=2)
    id = apply_release(
        d.db,
        d.project,
        d.user,
        d.data,
        "release.candidate.create",
        ReleaseCandidateCreate(**body.model_dump(), preview_basis=proposal["preview_basis"]),
    )[0]
    view = release_detail(d.db, d.project, d.data, d.user, id, version=2)["candidate"]
    apply_release(
        d.db,
        d.project,
        d.user,
        d.data,
        "release.candidate.review",
        ReleaseCandidateReview(
            id=id, decision="approve", comment="New release", review_basis=view["review_basis"]
        ),
    )
    d.candidate = id
    failed = create(d)
    assert d.detail(failed)["snapshot"]["baseline"]["deployment_id"] == first
    action(d, failed, "deployment.dispatch")
    action(d, failed, "deployment.start")
    assert completed(d, failed, status="failed")["status"] == "failed"
    assert not d.module.deployment_verified_for_release(d.data, d.detail(first)["candidate_id"])
    original_candidate = d.detail(first)["candidate_id"]
    review = release_detail(d.db, d.project, d.data, d.user, original_candidate, version=3)["candidate"]
    apply_release(
        d.db,
        d.project,
        d.user,
        d.data,
        "release.candidate.revoke",
        ReleaseCandidateRevoke(
            id=original_candidate,
            comment="Retain physical baseline but revoke business approval",
            review_basis=review["review_basis"],
        ),
    )
    body = DeploymentPreviewInput(rollback_of=failed, reason="Restore the verified stable artifact")
    proposal = d.preview(body)
    assert proposal["allowed"], proposal["reasons"]
    rollback = d.apply(
        "deployment.create", DeploymentCreate(**body.model_dump(), preview_basis=proposal["preview_basis"])
    )[0]
    restored = verify_all(d, rollback)
    assert restored["status"] == "rolled_back" and restored["current"]
    assert restored["snapshot"]["candidate_snapshot"] == stable_snapshot
    assert restored["candidate_id"] != failed and not restored["business_valid"]
    assert d.detail(failed)["status"] == "failed"
    assert d.db.query(Issue).count() == 1 and d.db.query(Issue).one().status == "open"


def test_original_receipt_recovers_across_actor_permission_and_target_changes(domain):
    d = domain
    id = create(d)
    original = deepcopy(d.data["deployments"][-1])
    action(d, id, "deployment.dispatch")
    run_id = d.detail(id)["operations"][0]["run_id"]
    # Simulate the Manager transaction failing after the independent Core receipt committed.
    d.data["deployments"][-1] = original
    d.user.status = "inactive"
    unusable_hash = "not-a-login"
    other = User(
        id="other-operator",
        tenant_id="tenant",
        username="other-operator",
        password_hash=unusable_hash,
        role="super_admin",
        status="active",
    )
    d.db.add(other)
    d.db.flush()
    d.store.mutate(
        d.principal,
        "",
        "workspaces",
        d.workspace["id"],
        operation="test.workspace",
        key="edit",
        request={},
        trace="test",
        expected=d.workspace["version"],
        transform=lambda row: {"data": {**row["data"], "name": "Changed host"}},
    )
    view = d.module.deployment_detail(
        d.db, d.project, d.data, other, id, version=2, store=d.store, execution=d.execution
    )["deployment"]
    d.module.apply_deployment(
        d.db,
        d.project,
        other,
        d.data,
        "deployment.dispatch",
        DeploymentAction(id=id, basis=view["basis"], comment="Recover the original handoff"),
        d.store,
        d.execution,
    )
    assert d.data["deployments"][-1]["operations"][0]["run_id"] == run_id
    assert len(d.store.list(d.principal, d.workspace["id"], "runs")) == 1
    with pytest.raises(HTTPException) as denied:
        view = d.module.deployment_detail(
            d.db, d.project, d.data, other, id, version=2, store=d.store, execution=d.execution
        )["deployment"]
        d.module.apply_deployment(
            d.db,
            d.project,
            other,
            d.data,
            "deployment.start",
            DeploymentAction(id=id, basis=view["basis"], comment="Start must revalidate"),
            d.store,
            d.execution,
        )
    assert denied.value.status_code in {403, 409}


def test_sync_observes_only_and_remains_available_without_runtime_execute(domain):
    d = domain
    id = create(d)
    d.apply("deployment.sync", DeploymentSync(id=id))
    assert not d.store.list(d.principal, d.workspace["id"], "runs")
    action(d, id, "deployment.dispatch")
    action(d, id, "deployment.start")
    d.user.role = "tenant_admin"
    assert completed(d, id)["status"] == "awaiting_promotion"
    assert not d.detail(id)["actions"]["can_advance"]


@pytest.mark.parametrize(
    "change",
    [{"traffic_percent": 100}, {"artifact_sha256": "0" * 64}, {"probes": []}, {"observation_seconds": 0.5}],
)
def test_incomplete_or_wrong_physical_evidence_cannot_verify_or_unlock(domain, change):
    d = domain
    id = create(d)
    action(d, id, "deployment.dispatch")
    action(d, id, "deployment.start")
    unknown = completed(d, id, change=change)
    assert unknown["status"] == "unknown" and unknown["actual_traffic"] is None
    assert id in d.module.active_deployment_ids(d.data)


def test_artifact_outside_environment_allowlist_is_blocked_in_preview(domain):
    d = domain
    d.apply(
        "deployment.environment.save",
        DeploymentEnvironmentSave(
            **definition(
                id=d.environment, workspace_id=d.workspace["id"], artifact_origins=["https://other.test"]
            )
        ),
    )
    preview = d.preview(
        DeploymentPreviewInput(
            candidate_id=d.candidate, environment_id=d.environment, reason="Check source authority"
        )
    )
    assert not preview["allowed"]
    assert any(reason["code"] == "deployment_artifact_origin" for reason in preview["reasons"])
    assert not d.module.deployment_verified_for_release(d.data, d.candidate)


def test_observe_resolves_unknown_without_reapplying_and_terminal_sync_is_immutable(domain):
    d = domain
    id = create(d)
    action(d, id, "deployment.dispatch")
    action(d, id, "deployment.start")
    assert completed(d, id, status="unknown")["status"] == "unknown"
    action(d, id, "deployment.observe")
    action(d, id, "deployment.dispatch")
    action(d, id, "deployment.start")
    observed = completed(d, id)
    assert observed["status"] == "awaiting_promotion"
    assert observed["operations"][0]["status"] == "unknown"
    assert observed["operations"][-1]["result"]["apply"]["reused"]
    before = deepcopy(d.data)
    d.apply("deployment.sync", DeploymentSync(id=id))
    assert d.data == before


def test_queued_cancellation_preserves_environment_lock_until_actual_observation(domain):
    d = domain
    id = create(d)
    action(d, id, "deployment.dispatch")
    action(d, id, "deployment.start")
    action(d, id, "deployment.cancel")
    cancelled = d.detail(id)
    assert cancelled["status"] == "unknown"
    assert id in d.module.active_deployment_ids(d.data)


def test_environment_generation_reconfiguration_preserves_history_but_invalidates_current_gate(domain):
    d = domain
    id = create(d)
    assert verify_all(d, id)["status"] == "verified"
    assert d.module.deployment_verified_for_release(d.data, d.candidate)
    frozen = deepcopy(d.detail(id)["snapshot"])
    d.apply(
        "deployment.environment.save",
        DeploymentEnvironmentSave(
            **definition(id=d.environment, workspace_id=d.workspace["id"], min_samples=4)
        ),
    )
    assert not d.module.deployment_verified_for_release(d.data, d.candidate)
    after = d.detail(id)
    assert after["status"] == "verified" and after["snapshot"] == frozen
    assert not after["current"] and not after["business_valid"]


@pytest.mark.parametrize("dispatch_observer", [False, True])
def test_cancelling_unstarted_observer_cannot_erase_prior_unknown_side_effects(domain, dispatch_observer):
    d = domain
    id = create(d)
    action(d, id, "deployment.dispatch")
    action(d, id, "deployment.start")
    assert completed(d, id, status="unknown")["status"] == "unknown"
    action(d, id, "deployment.observe")
    if dispatch_observer:
        action(d, id, "deployment.dispatch")
    action(d, id, "deployment.cancel")
    assert d.detail(id)["status"] == "unknown"
    assert id in d.module.active_deployment_ids(d.data)


def test_oversized_fixed_runner_plan_is_rejected_by_pure_preview(domain):
    d = domain
    d.apply(
        "deployment.environment.save",
        DeploymentEnvironmentSave(
            **definition(
                id=d.environment,
                workspace_id=d.workspace["id"],
                apply_argv=["apply", "x" * 11000],
                probe_argv=["probe", "y" * 11000],
            )
        ),
    )
    before = deepcopy(d.data)
    proposal = d.preview(
        DeploymentPreviewInput(
            candidate_id=d.candidate, environment_id=d.environment, reason="Check bounded execution"
        )
    )
    assert not proposal["allowed"]
    assert d.data == before
    assert not d.store.list(d.principal, d.workspace["id"], "runs")


def test_project_read_does_not_expose_environment_or_run_without_workspace_read(domain):
    d = domain
    id = create(d)
    reader = d.db.get(User, "reader")
    index = d.module.deployment_index(
        d.db, d.project, d.data, reader, version=1, store=d.store, execution=d.execution
    )
    assert index["environments"] == [] and index["deployments"] == []
    with pytest.raises(HTTPException) as denied:
        d.module.deployment_detail(
            d.db, d.project, d.data, reader, id, version=1, store=d.store, execution=d.execution
        )
    assert denied.value.status_code == 403


def test_promotion_rechecks_frozen_target_before_creating_any_new_operation(domain):
    d = domain
    id = create(d)
    action(d, id, "deployment.dispatch")
    action(d, id, "deployment.start")
    assert completed(d, id)["status"] == "awaiting_promotion"
    d.store.mutate(
        d.principal,
        "",
        "workspaces",
        d.workspace["id"],
        operation="test.target",
        key="new-target",
        request={},
        trace="test",
        expected=d.workspace["version"],
        transform=lambda row: {"data": {**row["data"], "name": "A different runtime definition"}},
    )
    before = deepcopy(d.data)
    with pytest.raises(HTTPException) as denied:
        action(d, id, "deployment.advance")
    assert denied.value.status_code == 409
    assert d.data == before


def test_rollback_action_is_unavailable_after_environment_generation_changes(domain):
    d = domain
    stable = create(d)
    assert verify_all(d, stable)["status"] == "verified"
    failed = create(d)
    action(d, failed, "deployment.dispatch")
    action(d, failed, "deployment.start")
    assert completed(d, failed, status="failed")["actions"]["can_rollback"]
    d.apply(
        "deployment.environment.save",
        DeploymentEnvironmentSave(
            **definition(id=d.environment, workspace_id=d.workspace["id"], min_samples=4)
        ),
    )
    assert not d.detail(failed)["actions"]["can_rollback"]


@pytest.mark.parametrize("restore_before", ["dispatch", "start"])
def test_recovered_terminal_receipt_applies_observation_before_recording_run_version(domain, restore_before):
    d = domain
    id = create(d)
    pending = deepcopy(d.data["deployments"][-1])
    action(d, id, "deployment.dispatch")
    planned = deepcopy(d.data["deployments"][-1])
    action(d, id, "deployment.start")
    assert completed(d, id)["status"] == "awaiting_promotion"
    d.data["deployments"][-1] = pending if restore_before == "dispatch" else planned
    action(d, id, "deployment." + restore_before)
    recovered = d.detail(id)
    assert recovered["status"] == "awaiting_promotion"
    assert recovered["actual_traffic"] == 25
    assert len(d.store.list(d.principal, d.workspace["id"], "runs")) == 1
