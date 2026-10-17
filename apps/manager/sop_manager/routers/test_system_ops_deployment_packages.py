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
        system_ops.DeploymentPackageIn(
            version="2026.05.24-rc1", channel="staging", release_notes="first governed rollout"
        ),
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
    for payload in (
        created["item"],
        created["manifest"],
        detail["item"],
        detail["manifest"],
        listed["items"][0],
    ):
        assert payload["configuration_only"] is True
        assert payload["deployment_evidence"] is False


def test_historical_package_release_claims_are_removed_from_response_without_rewriting_history(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    package = {
        "id": "legacy",
        "profile": "local-dev",
        "version": "v1",
        "files": [],
        "release_status": "published",
        "published_at": "2025-01-01T00:00:00Z",
        "published_by": "operator",
        "published_approval_id": "approval",
        "canary_policy_id": "canary",
        "canary_completed_at": "2025-01-01T00:00:00Z",
        "deployment_evidence": True,
        "configuration_only": False,
    }
    system_ops._save_deployment_packages({"items": [package]})
    index = system_ops._deployment_packages_path()
    original = index.read_bytes()
    detail = system_ops.get_deployment_package("legacy", _=object())
    listed = system_ops.list_deployment_packages("local-dev", _=object())
    for payload in (detail["item"], detail["manifest"], listed["items"][0]):
        assert payload["configuration_only"] is True
        assert payload["deployment_evidence"] is False
        assert not any(
            key == "release_status" or key.startswith(("published_", "canary_")) for key in payload
        )
    assert index.read_bytes() == original
