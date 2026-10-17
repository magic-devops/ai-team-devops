"""Deployment preview binds authority, not volatile presence observation times."""

import pytest
from fastapi import HTTPException
from hermes_core import execution_targets
from sop_manager.routers.delivery_deployment_contract import DeploymentCreate, DeploymentPreviewInput
from test_delivery_deployment_domain import action, completed, create, domain  # noqa: F401
from test_delivery_release import scope, trusted  # noqa: F401
from test_delivery_workbench import env  # noqa: F401


def test_presence_heartbeat_keeps_preview_but_changed_target_basis_does_not(domain, monkeypatch):  # noqa: F811
    original = execution_targets.select_execution_target
    observation = {"seen": "2026-10-17T00:00:00+00:00", "changed": False}

    def target(*args, **kwargs):
        result = original(*args, **kwargs)
        result.update(last_seen_at=observation["seen"], expires_at=observation["seen"])
        if observation["changed"]:
            result["basis"] = "b" * 64
        return result

    monkeypatch.setattr(execution_targets, "select_execution_target", target)
    body = DeploymentPreviewInput(
        candidate_id=domain.candidate, environment_id=domain.environment, reason="Review fixed authority"
    )
    first = domain.preview(body)
    assert first["allowed"]
    observation["seen"] = "2026-10-17T00:00:01+00:00"
    heartbeat = domain.preview(body)
    assert heartbeat["preview_basis"] == first["preview_basis"]
    observation["changed"] = True
    changed = domain.preview(body)
    assert changed["preview_basis"] != first["preview_basis"]
    with pytest.raises(HTTPException) as denied:
        domain.apply(
            "deployment.create", DeploymentCreate(**body.model_dump(), preview_basis=first["preview_basis"])
        )
    assert denied.value.status_code == 409


@pytest.mark.parametrize("state", ["paused", "planning"])
def test_nonactive_project_cannot_prepare_new_deployment(domain, state):  # noqa: F811
    from sop_manager.project_write_guard import lifecycle_scope

    with lifecycle_scope(domain.db, domain.project.tenant_id, domain.project.id):
        domain.project.status = state
        domain.db.flush()
    body = DeploymentPreviewInput(
        candidate_id=domain.candidate, environment_id=domain.environment, reason="Review project state"
    )
    assert not domain.preview(body)["allowed"]


@pytest.mark.parametrize("stage", ["dispatch", "start", "advance"])
def test_pause_after_intent_blocks_new_runtime_operation(domain, stage):  # noqa: F811
    from sop_manager.project_write_guard import lifecycle_scope

    identifier = create(domain)
    if stage in {"start", "advance"}:
        action(domain, identifier, "deployment.dispatch")
    if stage == "advance":
        action(domain, identifier, "deployment.start")
        completed(domain, identifier)
    with lifecycle_scope(domain.db, domain.project.tenant_id, domain.project.id):
        domain.project.status = "paused"
        domain.db.flush()
    with pytest.raises(HTTPException) as denied:
        action(domain, identifier, "deployment." + stage)
    assert denied.value.status_code == 409
