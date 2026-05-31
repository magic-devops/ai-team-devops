from __future__ import annotations

from pathlib import Path

from sop_manager.routers import system_ops


def test_deployment_package_versions_manifest_and_masked_preview(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    profile = "prod-oceanbase"
    system_ops.upsert_profile(
        profile,
        system_ops.EnvProfileIn(
            name=profile,
            mode="private",
            database="oceanbase",
            manager_url="https://manager.internal",
            public_url="https://manager.example.com",
            features={"worker": True, "temporal": True, "sso": True},
            env={"DB_TYPE": "oceanbase", "SECRET_TOKEN": "plain-secret"},
            notes="production rollout",
        ),
        _=object(),
    )

    created = system_ops.create_deployment_package(
        profile,
        system_ops.DeploymentPackageIn(version="2026.05.24-rc1", channel="staging", release_notes="first governed rollout"),
        _=object(),
    )
    listed = system_ops.list_deployment_packages(profile, _=object())
    detail = system_ops.get_deployment_package(created["item"]["id"], _=object())
    compose = system_ops.download_deployment_package_compose(created["item"]["id"], _=object())

    assert created["item"]["version"] == "2026.05.24-rc1"
    assert created["manifest"]["checksum"]
    assert len(created["manifest"]["files"]) == 4
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == created["item"]["id"]
    assert "plain-secret" not in detail["preview"]["shell"]
    assert "SECRET_TOKEN" in detail["preview"]["shell"]
    assert "docker-compose.override.yml" in {item["name"] for item in detail["manifest"]["files"]}
    assert compose.media_type == "text/yaml; charset=utf-8"
    assert "manager:" in compose.body.decode("utf-8")


def test_deployment_package_approval_publish_links_release_and_pipeline(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    profile = "prod-oceanbase"
    system_ops.upsert_profile(
        profile,
        system_ops.EnvProfileIn(
            name=profile,
            mode="private",
            database="oceanbase",
            manager_url="https://manager.internal",
            public_url="https://manager.example.com",
            features={"worker": True, "temporal": True, "sso": True},
            env={"DB_TYPE": "oceanbase", "SECRET_TOKEN": "plain-secret"},
            notes="production rollout",
        ),
        _=object(),
    )
    package = system_ops.create_deployment_package(
        profile,
        system_ops.DeploymentPackageIn(version="2026.05.24-release", channel="production", release_notes="approval publish"),
        _=object(),
    )

    requested = system_ops.create_deployment_package_approval(
        system_ops.DeploymentPackageApprovalIn(
            package_id=package["item"]["id"],
            environment="production",
            requested_by="release-manager",
            reviewers=["ops-lead"],
            policy="single",
            notes="release window approved by CAB",
        ),
        _=object(),
    )
    approved = system_ops.deployment_package_approval_action(
        requested["item"]["id"],
        system_ops.DeploymentPackageApprovalActionIn(action="approve", actor="ops-lead", note="checks are green"),
        _=object(),
    )
    published = system_ops.deployment_package_approval_action(
        requested["item"]["id"],
        system_ops.DeploymentPackageApprovalActionIn(action="publish", actor="release-manager", note="publish to production"),
        _=object(),
    )
    approvals = system_ops.list_deployment_package_approvals(profile=profile, _=object())
    detail = system_ops.get_deployment_package(package["item"]["id"], _=object())
    pipelines = system_ops.list_deployment_pipelines(package_id=package["item"]["id"], _=object())

    assert requested["item"]["status"] == "pending"
    assert approved["item"]["status"] == "approved"
    assert published["item"]["status"] == "published"
    assert published["item"]["pipeline_run_id"]
    assert approvals["total"] == 1
    assert detail["item"]["release_status"] == "published"
    assert detail["item"]["published_approval_id"] == requested["item"]["id"]
    assert pipelines["total"] == 1
    assert pipelines["items"][0]["status"] == "ready"
