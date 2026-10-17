"""Deployment policy, immutable intent and runtime evidence boundaries."""

import importlib

import pytest
from pydantic import ValidationError


def contract():
    return importlib.import_module("sop_manager.routers.delivery_deployment_contract")


def definition(**changes):
    return {
        "name": "staging",
        "workspace_id": "workspace",
        "runner_argv": ["python", "-m", "hermes_core.deployment_runner"],
        "apply_argv": ["deploy-tool", "{artifact_path}", "{traffic_percent}"],
        "probe_argv": ["probe-tool", "{operation_id}"],
        "artifact_origins": ["https://example.test"],
        "max_artifact_bytes": 1048576,
        "timeout_seconds": 30,
        "observation_seconds": 1,
        "min_samples": 2,
        "traffic_steps": [25, 100],
        **changes,
    }


@pytest.mark.parametrize(
    "change",
    [
        {"traffic_steps": [25, 25, 100]},
        {"traffic_steps": [25]},
        {"traffic_steps": [True, 100]},
        {"artifact_origins": ["http://example.test"]},
        {"artifact_origins": ["https://example.test/path"]},
        {"artifact_origins": ["https://user:secret@example.test"]},
        {"apply_argv": ["tool", "{surprise}"]},
        {"probe_argv": ["tool\x00"]},
        {"timeout_seconds": 3, "observation_seconds": 2},
        {"active": "true"},
        {"secret": "no-inline-credentials"},
    ],
)
def test_environment_rejects_unsafe_or_ambiguous_policy(change):
    with pytest.raises(ValidationError):
        contract().DeploymentEnvironmentSave(**definition(**change))


def test_preview_requires_one_explicit_source_and_roundtrips_policy():
    c = contract()
    for fields in (
        {},
        {"candidate_id": "release"},
        {"candidate_id": "release", "environment_id": "env", "rollback_of": "old"},
    ):
        with pytest.raises(ValidationError):
            c.DeploymentPreviewInput(reason="Approved change", **fields)
    assert c.DeploymentEnvironmentSave(**definition()).model_dump()["traffic_steps"] == [25, 100]
    assert c.DeploymentPreviewInput(rollback_of="old", reason="Restore stable version").rollback_of == "old"


def test_empty_initial_catalogue_is_pure_and_unconfigured():
    module = importlib.import_module("sop_manager.routers.delivery_deployment")
    data = {}
    assert module.active_deployment_ids(data) == []
    assert not module.deployment_verified_for_release(data, "release")
    assert data == {}


def test_human_explanations_accept_multiline_without_weakening_identity_or_commands():
    c = contract()
    body = c.DeploymentPreviewInput(
        candidate_id="release", environment_id="env", reason="First observation\nSecond observation\tcontext"
    )
    assert "\n" in body.reason
    assert c.DeploymentAction(id="deployment", basis="a" * 64, comment="Approved\nObserve traffic").comment
    with pytest.raises(ValidationError):
        c.DeploymentPreviewInput(candidate_id="release\nother", environment_id="env", reason="No")
    with pytest.raises(ValidationError):
        c.DeploymentEnvironmentSave(**definition(apply_argv=["unsafe\ncommand"]))
