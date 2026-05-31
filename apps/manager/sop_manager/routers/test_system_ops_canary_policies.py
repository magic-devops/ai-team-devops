from __future__ import annotations

from pathlib import Path

from sop_manager.routers import notify, system_ops


def _seed_package(tmp_path: Path, monkeypatch) -> dict:
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
    return system_ops.create_deployment_package(
        profile,
        system_ops.DeploymentPackageIn(version="2026.05.24-canary", channel="production", release_notes="canary rollout package"),
        _=object(),
    )


def test_canary_policy_advances_and_completes_with_pipeline(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_canary_policy(
        system_ops.DeploymentCanaryPolicyIn(
            package_id=package["item"]["id"],
            name="production progressive rollout",
            environment="production",
            traffic_steps=[5, 25, 50, 100],
            max_error_rate=0.02,
            latency_p95_ms=800,
            created_by="release-manager",
        ),
        _=object(),
    )

    started = system_ops.deployment_canary_policy_action(
        created["item"]["id"],
        system_ops.DeploymentCanaryActionIn(action="start", actor="release-manager", metrics={"error_rate": 0.005, "latency_p95_ms": 320}),
        _=object(),
    )
    advanced = system_ops.deployment_canary_policy_action(
        created["item"]["id"],
        system_ops.DeploymentCanaryActionIn(action="advance", actor="release-manager", metrics={"error_rate": 0.004, "latency_p95_ms": 350}),
        _=object(),
    )
    for _ in range(2):
        advanced = system_ops.deployment_canary_policy_action(
            created["item"]["id"],
            system_ops.DeploymentCanaryActionIn(action="advance", actor="release-manager", metrics={"error_rate": 0.003, "latency_p95_ms": 340}),
            _=object(),
        )
    completed = system_ops.deployment_canary_policy_action(
        created["item"]["id"],
        system_ops.DeploymentCanaryActionIn(action="complete", actor="release-manager", note="all canary gates green"),
        _=object(),
    )
    policies = system_ops.list_deployment_canary_policies(profile="prod-oceanbase", _=object())
    package_detail = system_ops.get_deployment_package(package["item"]["id"], _=object())
    pipelines = system_ops.list_deployment_pipelines(package_id=package["item"]["id"], _=object())

    assert created["item"]["status"] == "draft"
    assert started["item"]["status"] == "running"
    assert started["item"]["current_traffic"] == 5
    assert advanced["item"]["current_traffic"] == 100
    assert completed["item"]["status"] == "completed"
    assert completed["item"]["pipeline_run_id"]
    assert policies["total"] == 1
    assert package_detail["item"]["release_status"] == "canary_completed"
    assert package_detail["item"]["canary_policy_id"] == created["item"]["id"]
    assert pipelines["total"] == 1
    assert pipelines["items"][0]["status"] == "ready"


def test_canary_policy_blocks_bad_metrics_and_rolls_back(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_canary_policy(
        system_ops.DeploymentCanaryPolicyIn(
            package_id=package["item"]["id"],
            name="high risk rollout",
            environment="production",
            traffic_steps=[10, 50, 100],
            max_error_rate=0.01,
            latency_p95_ms=500,
        ),
        _=object(),
    )

    try:
        system_ops.deployment_canary_policy_action(
            created["item"]["id"],
            system_ops.DeploymentCanaryActionIn(action="start", actor="release-manager", metrics={"error_rate": 0.03, "latency_p95_ms": 350}),
            _=object(),
        )
        raise AssertionError("expected canary gate failure")
    except Exception as exc:
        assert "canary gate failed" in str(exc)

    rolled_back = system_ops.deployment_canary_policy_action(
        created["item"]["id"],
        system_ops.DeploymentCanaryActionIn(action="rollback", actor="release-manager", note="error budget exceeded"),
        _=object(),
    )

    assert rolled_back["item"]["status"] == "rolled_back"
    assert rolled_back["item"]["current_traffic"] == 0
    assert any(event["kind"] == "rollback" for event in rolled_back["policy"]["events"])


def test_canary_policy_im_briefing_previews_and_sends_via_notify(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("AI_MEMORY_ROOT", str(tmp_path / "ai-memory"))
    package = _seed_package(tmp_path, monkeypatch)
    notify.add_channel(
        notify.Channel(
            type="webhook",
            name="release-im",
            webhook_url="http://127.0.0.1:9/canary",
            enabled=True,
            events=["canary_risk"],
        )
    )
    created = system_ops.create_deployment_canary_policy(
        system_ops.DeploymentCanaryPolicyIn(
            package_id=package["item"]["id"],
            name="risk rollout",
            environment="production",
            traffic_steps=[10, 50, 100],
            max_error_rate=0.01,
            latency_p95_ms=500,
        ),
        _=object(),
    )
    try:
        system_ops.deployment_canary_policy_action(
            created["item"]["id"],
            system_ops.DeploymentCanaryActionIn(action="start", actor="release-manager", metrics={"error_rate": 0.03, "latency_p95_ms": 350}),
            _=object(),
        )
    except Exception:
        pass

    preview = system_ops.deployment_canary_policy_im_briefing(
        created["item"]["id"],
        system_ops.DeploymentCanaryImBriefingIn(dry_run=True, limit=3),
        _=object(),
    )
    sent = system_ops.deployment_canary_policy_im_briefing(
        created["item"]["id"],
        system_ops.DeploymentCanaryImBriefingIn(dry_run=False, channels=["release-im"], title="Canary risk"),
        _=object(),
    )
    detail = system_ops.get_deployment_canary_policy(created["item"]["id"], _=object())

    assert preview["delivery_plan"]["ready"] is True
    assert preview["delivery_plan"]["selection_mode"] == "event"
    assert preview["briefing"]["risk_level"] in {"high", "medium"}
    assert sent["dry_run"] is False
    assert sent["delivery_plan"]["selection_mode"] == "requested"
    assert len(sent["sent"]) == 1
    assert any(event["kind"] == "im_briefing" for event in detail["policy"]["events"])


def test_canary_metric_source_previews_and_auto_advances_policy(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_canary_policy(
        system_ops.DeploymentCanaryPolicyIn(
            package_id=package["item"]["id"],
            name="metric driven rollout",
            environment="production",
            traffic_steps=[5, 25],
            max_error_rate=0.02,
            latency_p95_ms=800,
        ),
        _=object(),
    )
    source = system_ops.create_deployment_canary_metric_source(
        system_ops.DeploymentCanaryMetricSourceIn(
            policy_id=created["item"]["id"],
            name="prometheus fallback",
            source_type="manual",
            sample_error_rate=0.004,
            sample_latency_p95_ms=310,
        ),
        _=object(),
    )

    preview = system_ops.deployment_canary_metric_collection(
        created["item"]["id"],
        system_ops.DeploymentCanaryMetricCollectIn(dry_run=True, source_id=source["item"]["id"]),
        _=object(),
    )
    advanced = system_ops.deployment_canary_metric_collection(
        created["item"]["id"],
        system_ops.DeploymentCanaryMetricCollectIn(
            dry_run=False,
            source_id=source["item"]["id"],
            apply_to_gate=True,
            advance_on_pass=True,
            actor="release-manager",
        ),
        _=object(),
    )
    source_detail = system_ops.get_deployment_canary_metric_source(source["item"]["id"], _=object())
    policies = system_ops.list_deployment_canary_policies(profile="prod-oceanbase", _=object())

    assert preview["gate"]["status"] == "passed"
    assert preview["applied"] is False
    assert advanced["advanced"] is True
    assert advanced["item"]["status"] == "running"
    assert advanced["item"]["current_traffic"] == 5
    assert source_detail["item"]["sample_count"] == 1
    assert source_detail["item"]["last_status"] == "passed"
    assert policies["total"] == 1


def test_canary_metric_source_blocks_failed_gate(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_canary_policy(
        system_ops.DeploymentCanaryPolicyIn(
            package_id=package["item"]["id"],
            name="metric blocked rollout",
            environment="production",
            max_error_rate=0.01,
            latency_p95_ms=500,
        ),
        _=object(),
    )
    source = system_ops.create_deployment_canary_metric_source(
        system_ops.DeploymentCanaryMetricSourceIn(
            policy_id=created["item"]["id"],
            name="bad metric source",
            source_type="synthetic",
            sample_error_rate=0.03,
            sample_latency_p95_ms=900,
        ),
        _=object(),
    )

    collected = system_ops.deployment_canary_metric_collection(
        created["item"]["id"],
        system_ops.DeploymentCanaryMetricCollectIn(dry_run=False, source_id=source["item"]["id"], apply_to_gate=True),
        _=object(),
    )

    assert collected["gate"]["status"] == "failed"
    assert collected["item"]["status"] == "blocked"
    assert collected["applied"] is True
    assert any(event["kind"] == "metric_collected" for event in collected["policy"]["events"])
