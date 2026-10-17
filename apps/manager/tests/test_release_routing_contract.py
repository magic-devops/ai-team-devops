"""Canonical release HTTP boundaries, independently of producer/domain tests."""

from sop_manager.routers.delivery_contract import default_flow, stage_gates
from sop_manager.routers.delivery_service import materialize
from sop_manager.routers.sql_models import Project
from test_delivery_workbench import command, requirement
from test_delivery_workbench import env as delivery_env

env = delivery_env


def test_old_manual_release_command_is_retired(env):
    client, _, _ = env
    rid = requirement(client)
    result = command(client, "release.save", {
        "requirement_id": rid, "version": "1.0.0", "environment": "production",
        "artifact_url": "https://example.org/build", "rollback_plan": "Restore previous build",
        "verification": "Manual notes are not deployment evidence",
    })
    assert result.status_code == 422


def test_manual_release_record_does_not_satisfy_deployment_gate():
    flow = {**default_flow(), "stage": "release", "releases": [{"revision": 1}]}
    gates = {gate["id"]: gate["ok"] for gate in stage_gates({"id": "req"}, flow, [], [])}
    assert "release_record" not in gates
    assert gates["deployment_verified"] is False


def test_old_operations_stage_is_a_record_not_verified_deployment(env):
    client, sessions, _ = env
    rid = requirement(client)
    with sessions() as db:
        data = {"project": {}, "members": [], "milestones": [], "resources": [],
                "task_details": {}, "flows": {rid: {**default_flow(), "stage": "operations"}}}
        snapshot = materialize(db, db.get(Project, "project"), data, None)
    assert snapshot["summary"]["released"] == 0
    assert snapshot["summary"]["recorded_released"] == 1


def test_quality_and_release_reads_do_not_provision_workspace(env):
    client, sessions, _ = env
    from sop_manager.routers.sql_models import DeliveryWorkspace

    for path in ["/api/v1/delivery/quality", "/api/v1/delivery/releases"]:
        response = client.get(path)
        assert response.status_code == 200, response.text
        assert response.json()["project_id"] == "project"
    with sessions() as db:
        assert db.query(DeliveryWorkspace).count() == 0


def test_policy_configuration_requires_configuration_permission(env):
    client, _, actor = env
    actor["id"] = "reader"
    result = command(client, "release.policy.save", {
        "repository": "https://github.com/example/repo", "workflow": "ci/release",
        "public_keys": ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
    })
    assert result.status_code == 403, result.text


def test_identity_capture_can_only_invalidate_candidate_not_change_its_content():
    from copy import deepcopy

    from sop_manager.project_write_guard import _workspace_invalidation

    original = {"flows": {}, "release_candidates": [{
        "id": "release-1", "snapshot": {"version": "1"}, "reviews": [], "decision": "approved",
        "invalidated": False, "invalidated_at": None, "invalidated_reasons": [],
    }]}
    changed = deepcopy(original)
    candidate = changed["release_candidates"][0]
    candidate.update(invalidated=True, invalidated_at="2026-10-17T12:00:00Z",
                     invalidated_reasons=[{"code": "release_approver_unavailable", "message": "Approval no longer valid", "target": None}])
    assert _workspace_invalidation(original, changed)
    candidate["snapshot"]["version"] = "forged"
    assert not _workspace_invalidation(original, changed)
    assert not _workspace_invalidation(changed, original)
