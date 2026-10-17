from sop_manager.routers.ops_center_core import (
    apply_self_heal_guarded_action,
    approve_self_heal_guarded_action,
    build_alert_slo_escalation,
    build_alert_strategy_canary_audit,
    build_ops_strategy_linkage,
    build_self_heal_guarded_actions,
    build_self_heal_tasks,
    compare_alert_strategy_variants,
    build_ops_rca_insight_tasks,
    build_ops_rca_insights,
    build_ops_rca_verification_plan,
    build_runbook_execution_evidence,
    diff_runbook_versions,
    evaluate_alert_noise,
    evaluate_self_heal,
    normalize_alerts_from_source,
    predict_alert_source_slo,
    recommend_alert_noise_strategy,
    rollback_self_heal_guarded_action,
    summarize_alert_sources,
    summarize_alert_noise_evaluations,
    summarize_alert_strategy_recommendations,
    summarize_runbook_execution_evidence,
    summarize_runbook_versions,
    summarize_ops_health,
    recommend_runbooks_for_candidate,
    verify_ops_rca_item,
    verify_self_heal_guarded_action,
)


def test_compare_alert_strategy_variants_selects_healthier_winner():
    alerts = [
        {"id": "critical-1", "status": "open", "severity": "critical", "title": "checkout down", "labels": {"service": "checkout", "alertname": "down"}},
        {"id": "medium-1", "status": "open", "severity": "medium", "title": "checkout latency", "labels": {"service": "checkout", "alertname": "latency"}},
        {"id": "medium-2", "status": "open", "severity": "medium", "title": "checkout latency", "labels": {"service": "checkout", "alertname": "latency"}},
        {"id": "low-1", "status": "open", "severity": "low", "title": "checkout debug", "labels": {"service": "checkout", "alertname": "debug"}},
    ]
    baseline = {"id": "baseline", "name": "baseline", "enabled": True, "group_by": ["service", "alertname"], "min_rca_severity": "medium", "suppress_severities": ["info"]}
    strict = {"id": "strict", "name": "strict", "enabled": True, "group_by": ["service", "alertname"], "min_rca_severity": "critical", "suppress_severities": ["info", "low", "medium"]}

    result = compare_alert_strategy_variants(alerts=alerts, policies=[baseline], silences=[], variants=[baseline, strict], now_iso="2026-05-24T00:00:00Z")

    assert result["ok"] is True
    assert result["summary"]["variants"] == 2
    assert result["items"][0]["id"] == "strict"
    assert result["items"][0]["winner"] is True
    assert result["items"][0]["actionable_incidents"] < result["baseline"]["summary"]["actionable_incidents"]
    assert result["agent_consumption"]["api"] == "/api/v1/ops-center/alert-noise/strategy-compare"


def test_predict_alert_source_slo_scores_cross_source_risk():
    result = predict_alert_source_slo(
        sources=[{"id": "prom-1", "name": "Prometheus", "enabled": True}],
        alerts=[
            {"id": "a1", "source_id": "prom-1", "source": "Prometheus", "status": "open", "severity": "critical", "title": "api down", "labels": {"service": "api"}},
            {"id": "a2", "source_id": "prom-1", "source": "Prometheus", "status": "open", "severity": "high", "title": "api errors", "labels": {"service": "api"}},
        ],
        runs=[{"source_id": "prom-1", "ok": False}],
        evaluations=[{"summary": {"noise_reduction_ratio": 0.25}}],
        window_hours=24,
        now_iso="2026-05-24T00:00:00Z",
    )

    assert result["ok"] is True
    assert result["summary"]["risk_targets"] == 1
    assert result["items"][0]["risk_level"] == "critical"
    assert result["items"][0]["predicted_slo_score"] < 75
    assert result["agent_consumption"]["api"] == "/api/v1/ops-center/alert-noise/slo-prediction"


def test_build_alert_slo_escalation_creates_task_plan_for_high_risk_prediction():
    prediction = {
        "items": [
            {
                "source_id": "prom-1",
                "source_name": "Prometheus",
                "service": "api",
                "risk_level": "critical",
                "predicted_slo_score": 42,
                "breach_probability": 0.76,
                "open_alerts": 4,
                "critical_alerts": 1,
                "high_alerts": 2,
                "recommendations": ["创建 RCA 并绑定 Runbook"],
            },
            {
                "source_id": "prom-2",
                "source_name": "Prometheus Staging",
                "service": "worker",
                "risk_level": "healthy",
                "predicted_slo_score": 96,
                "breach_probability": 0.04,
                "open_alerts": 0,
                "recommendations": [],
            },
        ]
    }

    result = build_alert_slo_escalation(
        prediction,
        policy={"min_risk_level": "high", "min_breach_probability": 0.35, "actions": ["create_task", "im_notify"]},
        dry_run=True,
        priority="P1",
        owner_id="",
        dev_tool="codex",
    )

    assert result["ok"] is True
    assert result["summary"]["candidates"] == 1
    assert result["summary"]["tasks_planned"] == 1
    assert result["tasks"][0]["source"] == "ops_center_alert_slo_escalation"
    assert result["tasks"][0]["priority"] == "P0"
    assert result["agent_consumption"]["api"] == "/api/v1/ops-center/alert-noise/slo-escalation/run"


def test_build_alert_strategy_canary_audit_blocks_when_slo_risk_is_critical():
    compare_run = {
        "summary": {"winner_id": "strict", "winner_name": "strict", "winner_score_delta": 8},
        "items": [
            {
                "id": "strict",
                "name": "strict",
                "winner": True,
                "policy": {"id": "strict", "name": "strict", "enabled": True},
                "health_score": 91,
                "score_delta": 8,
                "actionable_delta": -1,
                "noise_reduction_ratio": 0.45,
            }
        ],
    }
    result = build_alert_strategy_canary_audit(
        compare_runs=[compare_run],
        policies=[{"id": "strict", "name": "strict", "enabled": True}],
        evaluations=[{"summary": {"noise_reduction_ratio": 0.3}}],
        slo_predictions=[{"summary": {"risk_targets": 1, "critical_targets": 1, "breach_probability": 0.72}}],
        escalations=[],
        traffic_percent=10,
        now_iso="2026-05-24T00:00:00Z",
    )

    assert result["ok"] is True
    assert result["decision"] == "blocked"
    assert result["summary"]["recommended_percent"] == 0
    assert result["blocked_reasons"]
    assert result["agent_consumption"]["api"] == "/api/v1/ops-center/alert-noise/strategy-canary/audit"


def test_build_ops_strategy_linkage_creates_cross_module_plan():
    result = build_ops_strategy_linkage(
        canary_audits=[{
            "id": "audit-1",
            "decision": "blocked",
            "audit_status": "blocked",
            "summary": {"decision": "blocked", "readiness_score": 42},
            "blocked_reasons": ["critical SLO risk"],
        }],
        slo_escalations=[{
            "id": "esc-1",
            "summary": {"candidates": 1, "created": 0},
            "items": [{
                "id": "slo-1",
                "source_id": "prom",
                "source_name": "Prometheus",
                "service": "api",
                "risk_level": "critical",
                "breach_probability": 0.8,
            }],
        }],
        rca=[{"id": "rca-1", "status": "open"}],
        runbooks=[],
        self_heal=[],
        pipelines=[{"id": "pipe-1", "status": "failed"}],
        actions=["create_task", "im_notify"],
        max_items=6,
        priority="P1",
        owner_id="",
        dev_tool="codex",
        now_iso="2026-05-24T00:00:00Z",
    )

    assert result["ok"] is True
    assert result["summary"]["linkage_items"] >= 5
    assert result["summary"]["high_risk"] >= 3
    assert result["summary"]["tasks_planned"] == len(result["tasks"])
    assert result["tasks"][0]["source"] == "ops_center_strategy_linkage"
    assert "notify" in {route["module"] for route in result["strategy_packet"]["module_routes"]}
    assert result["agent_consumption"]["api"] == "/api/v1/ops-center/strategy-linkage/run"


def test_ops_center_alert_strategy_compare_and_slo_prediction_routes_persist(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-alert-ab",
        project_id="project-alert-ab",
        project_path=tmp_path,
        tenant_code="tenant-alert-ab",
        business_code="biz-alert-ab",
        project_code="project-alert-ab",
    )
    try:
        ops_center.create_alert_source(ops_center.AlertSourceCreate(
            name="Prometheus Prod",
            source_type="prometheus",
            labels={"environment": "production"},
            sample_payload={
                "alerts": [
                    {"labels": {"alertname": "ApiDown", "severity": "critical", "service": "api"}, "annotations": {"description": "api down"}, "status": {"state": "active"}},
                    {"labels": {"alertname": "ApiLatency", "severity": "medium", "service": "api"}, "annotations": {"description": "latency high"}, "status": {"state": "active"}},
                ]
            },
        ))
        ops_center.sync_alert_sources(ops_center.AlertSourceSyncIn(persist=True, limit=20))

        compared = ops_center.alert_strategy_compare(ops_center.AlertStrategyCompareIn(persist=True))
        predicted = ops_center.alert_slo_prediction(ops_center.AlertSloPredictIn(persist=True, window_hours=24))

        assert compared["persisted"] is True
        assert compared["summary"]["variants"] >= 1
        assert ops_center.list_alert_strategy_comparisons()["total"] == 1
        assert predicted["persisted"] is True
        assert predicted["summary"]["targets"] >= 1
        assert ops_center.list_alert_slo_predictions()["summary"]["latest_targets"] >= 1
        assert ops_center.summary()["summary"]["alert_slo_risk_targets"] >= 0
    finally:
        reset_request_scope(tokens)


def test_ops_center_alert_slo_escalation_policy_and_dry_run(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-alert-slo-escalation",
        project_id="project-alert-slo-escalation",
        project_path=tmp_path,
        tenant_code="tenant-alert-slo-escalation",
        business_code="biz-alert-slo-escalation",
        project_code="project-alert-slo-escalation",
    )
    try:
        ops_center.create_alert_source(ops_center.AlertSourceCreate(
            name="Prometheus Prod",
            source_type="prometheus",
            labels={"environment": "production"},
            sample_payload={
                "alerts": [
                    {"labels": {"alertname": "ApiDown", "severity": "critical", "service": "api"}, "annotations": {"description": "api down"}, "status": {"state": "active"}},
                ]
            },
        ))
        ops_center.sync_alert_sources(ops_center.AlertSourceSyncIn(persist=True, limit=20))
        saved = ops_center.update_alert_slo_escalation_policy(ops_center.AlertSloEscalationPolicyIn(
            min_risk_level="high",
            min_breach_probability=0.3,
            actions=["create_task", "im_notify"],
            max_targets=3,
        ))
        result = ops_center.run_alert_slo_escalation(ops_center.AlertSloEscalationRunIn(dry_run=True, priority="P1"))

        assert saved["item"]["min_breach_probability"] == 0.3
        assert result["dry_run"] is True
        assert result["summary"]["candidates"] >= 1
        assert result["summary"]["tasks_planned"] >= 1
        assert result["delivery_plan"]["target_count"] >= 0
        assert ops_center.list_alert_slo_escalation_runs()["total"] == 0
    finally:
        reset_request_scope(tokens)


def test_ops_center_alert_strategy_canary_audit_and_action(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-alert-canary",
        project_id="project-alert-canary",
        project_path=tmp_path,
        tenant_code="tenant-alert-canary",
        business_code="biz-alert-canary",
        project_code="project-alert-canary",
    )
    try:
        policy = ops_center.create_alert_noise_policy(ops_center.AlertNoisePolicyCreate(
            name="strict canary",
            min_rca_severity="critical",
            suppress_severities=["info", "low", "medium"],
        ))
        ops_center.create_alert_source(ops_center.AlertSourceCreate(
            name="Prometheus Prod",
            source_type="prometheus",
            labels={"environment": "production"},
            sample_payload={
                "alerts": [
                    {"labels": {"alertname": "ApiLatency", "severity": "medium", "service": "api"}, "annotations": {"description": "latency"}, "status": {"state": "active"}},
                    {"labels": {"alertname": "ApiDebug", "severity": "low", "service": "api"}, "annotations": {"description": "debug"}, "status": {"state": "active"}},
                ]
            },
        ))
        ops_center.sync_alert_sources(ops_center.AlertSourceSyncIn(persist=True, limit=20))

        audit = ops_center.alert_strategy_canary_audit(ops_center.AlertStrategyCanaryAuditIn(policy_id=policy["id"], persist=True))
        listed = ops_center.list_alert_strategy_canary_audits()
        action = ops_center.alert_strategy_canary_action(audit["id"], ops_center.AlertStrategyCanaryActionIn(action="archive", actor="SRE"))

        assert audit["persisted"] is True
        assert audit["summary"]["readiness_score"] >= 0
        assert listed["total"] == 1
        assert action["item"]["audit_status"] == "archived"
        assert ops_center.summary()["summary"]["alert_strategy_canary_audits"] == 1
    finally:
        reset_request_scope(tokens)


def test_ops_center_strategy_linkage_preview_and_persist(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-ops-linkage",
        project_id="project-ops-linkage",
        project_path=tmp_path,
        tenant_code="tenant-ops-linkage",
        business_code="biz-ops-linkage",
        project_code="project-ops-linkage",
    )
    try:
        from sop_manager.routers.sql_models import Business, Project, Tenant, get_session

        db = next(get_session())
        db.merge(Tenant(id="tenant-ops-linkage", name="Ops Linkage Tenant", slug="tenant-ops-linkage"))
        db.merge(Business(id="biz-ops-linkage", tenant_id="tenant-ops-linkage", name="Ops Linkage Biz"))
        db.merge(Project(
            id="project-ops-linkage",
            tenant_id="tenant-ops-linkage",
            business_id="biz-ops-linkage",
            name="Ops Linkage Project",
            project_path=str(tmp_path),
        ))
        db.commit()

        policy = ops_center.create_alert_noise_policy(ops_center.AlertNoisePolicyCreate(
            name="critical only",
            min_rca_severity="critical",
            suppress_severities=["info", "low", "medium"],
        ))
        ops_center.create_alert_source(ops_center.AlertSourceCreate(
            name="Prometheus Prod",
            source_type="prometheus",
            labels={"environment": "production"},
            sample_payload={
                "alerts": [
                    {"labels": {"alertname": "ApiDown", "severity": "critical", "service": "api"}, "annotations": {"description": "api down"}, "status": {"state": "active"}},
                    {"labels": {"alertname": "ApiError", "severity": "high", "service": "api"}, "annotations": {"description": "api errors"}, "status": {"state": "active"}},
                ]
            },
        ))
        ops_center.sync_alert_sources(ops_center.AlertSourceSyncIn(persist=True, limit=20))
        ops_center.alert_slo_prediction(ops_center.AlertSloPredictIn(persist=True, window_hours=24))
        ops_center.update_alert_slo_escalation_policy(ops_center.AlertSloEscalationPolicyIn(
            min_risk_level="high",
            min_breach_probability=0.25,
            actions=["create_task"],
            max_targets=3,
        ))
        ops_center.run_alert_slo_escalation(ops_center.AlertSloEscalationRunIn(
            dry_run=False,
            force=True,
            priority="P1",
        ))
        ops_center.alert_strategy_canary_audit(ops_center.AlertStrategyCanaryAuditIn(
            policy_id=policy["id"],
            persist=True,
            traffic_percent=10,
        ))

        preview = ops_center.run_ops_strategy_linkage(ops_center.OpsStrategyLinkageRunIn(
            dry_run=True,
            actions=["create_task", "im_notify"],
            max_items=5,
        ))
        applied = ops_center.run_ops_strategy_linkage(ops_center.OpsStrategyLinkageRunIn(
            dry_run=False,
            actions=["create_task"],
            max_items=5,
            owner_id="",
        ))
        from sop_manager.routers.tasks import list_tasks

        linked_tasks_before = list_tasks(source="ops_center_strategy_linkage")
        applied_again = ops_center.run_ops_strategy_linkage(ops_center.OpsStrategyLinkageRunIn(
            dry_run=False,
            actions=["create_task"],
            max_items=5,
            owner_id="",
        ))
        linked_tasks_after = list_tasks(source="ops_center_strategy_linkage")
        listed = ops_center.list_ops_strategy_linkage_runs()
        summary = ops_center.summary()["summary"]

        assert preview["persisted"] is False
        assert preview["summary"]["linkage_items"] >= 1
        assert preview["briefing"]["module"] == "ops-center"
        assert applied["persisted"] is True
        assert applied["run_id"]
        assert len(applied["created_tasks"]) == applied["summary"]["created"]
        assert applied_again["persisted"] is True
        assert applied_again["summary"]["created"] == 0
        assert applied_again["summary"]["skipped_existing"] == len(linked_tasks_before)
        assert len(linked_tasks_after) == len(linked_tasks_before)
        assert listed["total"] == 2
        assert listed["summary"]["latest_items"] == applied["summary"]["linkage_items"]
        assert summary["ops_strategy_linkage_runs"] == 2
        assert summary["ops_strategy_linkage_items"] == applied["summary"]["linkage_items"]

        tokens_two = set_request_scope(
            tenant_id="tenant-ops-linkage-two",
            project_id="project-ops-linkage-two",
            project_path=tmp_path,
            tenant_code="tenant-ops-linkage-two",
            business_code="biz-ops-linkage-two",
            project_code="project-ops-linkage-two",
        )
        try:
            db = next(get_session())
            db.merge(Tenant(id="tenant-ops-linkage-two", name="Ops Linkage Tenant Two", slug="tenant-ops-linkage-two"))
            db.merge(Business(id="biz-ops-linkage-two", tenant_id="tenant-ops-linkage-two", name="Ops Linkage Biz Two"))
            db.merge(Project(
                id="project-ops-linkage-two",
                tenant_id="tenant-ops-linkage-two",
                business_id="biz-ops-linkage-two",
                name="Ops Linkage Project Two",
                project_path=str(tmp_path),
            ))
            db.commit()

            cross_scope_applied = ops_center.run_ops_strategy_linkage(ops_center.OpsStrategyLinkageRunIn(
                dry_run=False,
                actions=["create_task"],
                max_items=5,
                owner_id="",
            ))
            assert cross_scope_applied["summary"]["created"] >= 1
            assert cross_scope_applied["summary"]["skipped_existing"] == 0
            assert len(list_tasks(source="ops_center_strategy_linkage")) == cross_scope_applied["summary"]["created"]
        finally:
            reset_request_scope(tokens_two)
    finally:
        reset_request_scope(tokens)


def test_rca_insight_create_rca_persists_candidate_with_runbook(monkeypatch, tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-ops",
        project_id="project-ops",
        project_path=tmp_path,
        tenant_code="tenant-ops",
        business_code="biz-ops",
        project_code="project-ops",
    )
    try:
        runbook = ops_center.create_runbook(ops_center.RunbookCreate(
            name="production rollback",
            tags=["rollback", "pipeline"],
            steps=["freeze traffic", "rollback", "verify"],
        ))
        ops_center._save("pipelines", {"id": "historic-pipeline", "name": "production deploy", "environment": "production", "status": "failed", "error_msg": "rollback required", "created_at": "2025-01-01T00:00:00Z"})

        analysis = ops_center.rca_insights(ops_center.RcaInsightIn(limit=10))
        candidate = next(item for item in analysis["candidates"] if item["kind"] == "pipeline_failure")
        created = ops_center.rca_insight_create_rca(ops_center.RcaInsightCreateRcaIn(
            candidate_id=candidate["id"],
            selected_runbook_ids=[runbook["id"]],
            owner="SRE",
            note="auto persisted from insight",
        ))

        assert created["ok"] is True
        assert created["item"]["source"] == "ops_center_rca_insight"
        assert created["item"]["source_candidate_id"] == candidate["id"]
        assert created["item"]["selected_runbook_ids"] == [runbook["id"]]
        assert ops_center.list_rca()["total"] == 1
    finally:
        reset_request_scope(tokens)


def test_runbook_version_governance_creates_diff_and_promotes(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-runbook-version",
        project_id="project-runbook-version",
        project_path=tmp_path,
        tenant_code="tenant-runbook-version",
        business_code="biz-runbook-version",
        project_code="project-runbook-version",
    )
    try:
        created = ops_center.create_runbook(ops_center.RunbookCreate(
            name="API rollback",
            tags=["api", "rollback"],
            steps=["freeze traffic", "rollback release", "verify metrics"],
            owner="SRE",
            change_note="initial",
        ))
        updated = ops_center.update_runbook(created["id"], ops_center.RunbookCreate(
            name="API rollback",
            tags=["api", "rollback", "production"],
            steps=["freeze traffic", "rollback release", "verify metrics", "notify IM"],
            owner="SRE",
            change_note="add notification",
        ))

        versions = ops_center.list_runbook_versions(created["id"])
        assert versions["summary"]["versions"] == 2
        assert versions["items"][0]["status"] == "active"
        assert versions["items"][0]["version_no"] == 2
        assert versions["items"][1]["status"] == "superseded"

        diff = ops_center.diff_runbook_version_route(
            created["id"],
            base_version_id=versions["items"][1]["id"],
            target_version_id=versions["items"][0]["id"],
        )
        assert diff["diff"]["summary"]["has_change"] is True
        assert diff["diff"]["added_tags"] == ["production"]
        assert diff["diff"]["changed_steps"][-1]["target"] == "notify IM"

        promoted = ops_center.runbook_version_action(
            created["id"],
            versions["items"][1]["id"],
            ops_center.RunbookVersionActionIn(action="promote", actor="SRE", note="rollback version"),
        )
        assert promoted["item"]["active_version_id"] == versions["items"][1]["id"]
        assert promoted["item"]["steps"] == ["freeze traffic", "rollback release", "verify metrics"]
        assert ops_center.list_runbook_versions(created["id"])["items"][1]["status"] == "active"
        assert updated["active_version"]["version_no"] == 2
    finally:
        reset_request_scope(tokens)


def test_runbook_version_helpers_summarize_and_diff():
    base = {
        "id": "v1",
        "snapshot": {"name": "rollback", "tags": ["api"], "steps": ["freeze", "rollback"]},
    }
    target = {
        "id": "v2",
        "snapshot": {"name": "rollback", "tags": ["api", "prod"], "steps": ["freeze", "rollback", "verify"]},
    }
    diff = diff_runbook_versions(base, target)
    summary = summarize_runbook_versions(
        [{"id": "rb-1", "active_version_id": "v2"}],
        [{**base, "runbook_id": "rb-1", "status": "superseded"}, {**target, "runbook_id": "rb-1", "status": "active"}],
    )
    assert diff["summary"]["changed_steps"] == 1
    assert diff["added_tags"] == ["prod"]
    assert summary["health_score"] == 100
    assert summary["versioned_runbooks"] == 1


def test_runbook_execution_evidence_helper_collects_rca_verification():
    payload = build_runbook_execution_evidence(
        runbooks=[{"id": "rb-1", "name": "API rollback", "active_version_id": "v1", "active_version_no": 1}],
        versions=[{"id": "v1", "runbook_id": "rb-1", "version_no": 1, "status": "active", "checksum": "abc"}],
        rca=[{
            "id": "rca-1",
            "incident_id": "INC-1",
            "root_cause": "api error rate high",
            "resolution": "rollback release",
            "status": "resolved",
            "selected_runbook_ids": ["rb-1"],
            "verification_status": "passed",
            "verification_score": 100,
            "verified_by": "SRE",
            "verification_history": [{
                "status": "passed",
                "score": 100,
                "verifier": "SRE",
                "checks": {"runbook_status": "passed", "evidence_url": "audit://inc-1", "resolution": "rollback release"},
            }],
        }],
        pipelines=[],
        self_heal_actions=[],
    )

    assert payload["summary"]["records"] == 1
    assert payload["items"][0]["status"] == "complete"
    assert payload["items"][0]["coverage_score"] == 100
    assert summarize_runbook_execution_evidence(payload["items"])["needs_backfill"] == 0


def test_runbook_evidence_backfill_route_persists_records(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-runbook-evidence",
        project_id="project-runbook-evidence",
        project_path=tmp_path,
        tenant_code="tenant-runbook-evidence",
        business_code="biz-runbook-evidence",
        project_code="project-runbook-evidence",
    )
    try:
        runbook = ops_center.create_runbook(ops_center.RunbookCreate(
            name="API rollback",
            tags=["api", "rollback"],
            steps=["freeze traffic", "rollback release", "verify metrics"],
            owner="SRE",
            change_note="initial",
        ))
        rca = ops_center.create_rca(ops_center.RcaCreate(
            incident_id="INC-RB-EVIDENCE",
            root_cause="api error rate high",
            impact="api users",
            resolution="rollback release",
        ))
        rca["selected_runbook_ids"] = [runbook["id"]]
        ops_center._save("rca", rca)
        ops_center.verify_rca(rca["id"], ops_center.RcaVerifyIn(
            verifier="SRE",
            checks={
                "service_status": "healthy",
                "metrics_status": "healthy",
                "runbook_status": "passed",
                "evidence_url": "audit://inc-rb-evidence",
                "resolution": "rollback release",
            },
            close_on_pass=True,
            note="verified with runbook evidence",
        ))

        backfilled = ops_center.backfill_runbook_evidence(ops_center.RunbookEvidenceBackfillIn(
            runbook_ids=[runbook["id"]],
            persist=True,
            actor="SRE",
            note="test backfill",
        ))
        listed = ops_center.list_runbook_evidence(runbook_id=runbook["id"])

        assert backfilled["persisted"] == 1
        assert backfilled["summary"]["coverage_score"] == 100
        assert listed["total"] == 1
        assert listed["items"][0]["review_status"] == "open"
        acknowledged = ops_center.runbook_evidence_action(
            listed["items"][0]["id"],
            ops_center.RunbookEvidenceActionIn(action="acknowledge", actor="SRE", note="reviewed"),
        )
        assert acknowledged["item"]["review_status"] == "acknowledged"
    finally:
        reset_request_scope(tokens)


def test_rca_verify_route_persists_evidence_and_closes(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-verify",
        project_id="project-verify",
        project_path=tmp_path,
        tenant_code="tenant-verify",
        business_code="biz-verify",
        project_code="project-verify",
    )
    try:
        created = ops_center.create_rca(ops_center.RcaCreate(
            incident_id="INC-VERIFY",
            root_cause="latency spike",
            impact="api users",
            resolution="scaled out api service",
        ))
        plan = ops_center.rca_verification_plan(created["id"])
        assert plan["rca_id"] == created["id"]

        verified = ops_center.verify_rca(created["id"], ops_center.RcaVerifyIn(
            verifier="SRE",
            checks={"service_status": "healthy", "metrics_status": "healthy", "evidence_url": "audit://inc-verify"},
            close_on_pass=True,
            note="closed by verification",
        ))

        assert verified["ok"] is True
        assert verified["item"]["status"] == "resolved"
        assert verified["item"]["verification_status"] == "passed"
        assert verified["verification"]["note"] == "closed by verification"
    finally:
        reset_request_scope(tokens)


def test_alert_source_routes_collect_and_feed_rca_insights(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-alerts",
        project_id="project-alerts",
        project_path=tmp_path,
        tenant_code="tenant-alerts",
        business_code="biz-alerts",
        project_code="project-alerts",
    )
    try:
        source = ops_center.create_alert_source(ops_center.AlertSourceCreate(
            name="Prometheus production",
            source_type="prometheus",
            labels={"environment": "production"},
            sample_payload={
                "alerts": [
                    {
                        "fingerprint": "fp-1",
                        "labels": {"alertname": "ApiErrorRateHigh", "severity": "critical", "service": "api"},
                        "annotations": {"summary": "api error rate high", "description": "5xx above threshold"},
                        "status": {"state": "active"},
                    }
                ]
            },
        ))

        tested = ops_center.test_alert_source(source["id"], ops_center.AlertSourceTestIn())
        assert tested["ok"] is True
        assert tested["alerts"][0]["severity"] == "critical"

        synced = ops_center.sync_alert_sources(ops_center.AlertSourceSyncIn(persist=True))
        assert synced["summary"]["alerts"] == 1
        assert ops_center.list_external_alerts()["summary"]["high_alerts"] == 1

        analysis = ops_center.rca_insights(ops_center.RcaInsightIn(limit=20))
        candidate = next(item for item in analysis["candidates"] if item["kind"] == "multi_source_alerts")
        assert candidate["severity"] == "critical"
        assert any(ev["type"] == "Prometheus production" for ev in candidate["evidence"])
    finally:
        reset_request_scope(tokens)


def test_normalize_alerts_from_source_supports_prometheus_payload():
    alerts = normalize_alerts_from_source(
        {"id": "src-prom", "name": "Prometheus", "source_type": "prometheus", "labels": {"env": "prod"}},
        {
            "alerts": [
                {
                    "fingerprint": "abc",
                    "labels": {"alertname": "LatencyHigh", "severity": "warning", "trace_id": "trace-1"},
                    "annotations": {"description": "p95 latency high"},
                    "status": {"state": "active"},
                }
            ]
        },
    )

    assert alerts[0]["id"] == "abc"
    assert alerts[0]["source_id"] == "src-prom"
    assert alerts[0]["severity"] == "medium"
    assert alerts[0]["labels"]["env"] == "prod"
    assert alerts[0]["trace_id"] == "trace-1"


def test_summarize_alert_sources_scores_open_high_alerts():
    summary = summarize_alert_sources(
        sources=[{"enabled": True}, {"enabled": False}],
        alerts=[{"status": "active", "severity": "high", "source": "prom"}, {"status": "resolved", "severity": "low", "source": "grafana"}],
        runs=[{"ok": True}, {"ok": False}],
    )

    assert summary["sources"] == 2
    assert summary["enabled_sources"] == 1
    assert summary["open_alerts"] == 1
    assert summary["high_alerts"] == 1
    assert summary["health_score"] < 100


def test_alert_noise_policy_routes_group_suppress_and_feed_rca(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-alert-noise",
        project_id="project-alert-noise",
        project_path=tmp_path,
        tenant_code="tenant-alert-noise",
        business_code="biz-alert-noise",
        project_code="project-alert-noise",
    )
    try:
        source = ops_center.create_alert_source(ops_center.AlertSourceCreate(
            name="Prometheus Noise",
            source_type="prometheus",
            labels={"environment": "production"},
            sample_payload={
                "alerts": [
                    {"fingerprint": "critical-1", "labels": {"alertname": "ApiErrorRateHigh", "severity": "critical", "service": "api"}, "annotations": {"description": "5xx high"}, "status": {"state": "active"}},
                    {"fingerprint": "critical-2", "labels": {"alertname": "ApiErrorRateHigh", "severity": "critical", "service": "api"}, "annotations": {"description": "5xx high again"}, "status": {"state": "active"}},
                    {"fingerprint": "info-1", "labels": {"alertname": "CacheWarmup", "severity": "info", "service": "api"}, "annotations": {"description": "cache warmup"}, "status": {"state": "active"}},
                ],
            },
        ))
        assert source["sample_payload_status"] == "configured"
        ops_center.sync_alert_sources(ops_center.AlertSourceSyncIn(persist=True))
        policy = ops_center.create_alert_noise_policy(ops_center.AlertNoisePolicyCreate(
            name="prod noise policy",
            group_by=["service", "alertname"],
            min_rca_severity="high",
            suppress_severities=["info"],
        ))
        silence = ops_center.create_alert_silence(ops_center.AlertSilenceCreate(
            name="staging silence",
            matchers={"environment": "staging"},
            reason="staging maintenance",
        ))
        evaluated = ops_center.evaluate_alert_noise_route(ops_center.AlertNoiseEvaluateIn(policy_id=policy["id"], persist=True))
        assert silence["enabled"] is True
        assert evaluated["summary"]["open_alerts"] == 3
        assert evaluated["summary"]["groups"] == 2
        assert evaluated["summary"]["actionable_incidents"] == 1
        assert evaluated["summary"]["suppressed_alerts"] == 1
        assert evaluated["summary"]["deduped_alerts"] == 1
        assert ops_center.list_alert_noise_evaluations()["summary"]["latest_groups"] == 2
        analysis = ops_center.rca_insights(ops_center.RcaInsightIn(limit=10))
        candidate = next(item for item in analysis["candidates"] if item["kind"] == "multi_source_alerts")
        assert candidate["severity"] == "critical"
        assert "CacheWarmup" not in " ".join(str(item.get("label")) for item in candidate["evidence"])
    finally:
        reset_request_scope(tokens)


def test_evaluate_alert_noise_helpers_group_and_summarize():
    result = evaluate_alert_noise(
        [
            {"id": "a1", "title": "Latency", "severity": "high", "status": "active", "labels": {"service": "api", "alertname": "Latency"}},
            {"id": "a2", "title": "Latency", "severity": "high", "status": "active", "labels": {"service": "api", "alertname": "Latency"}},
            {"id": "a3", "title": "Info", "severity": "info", "status": "active", "labels": {"service": "api", "alertname": "Info"}},
        ],
        policies=[{"id": "p1", "name": "policy", "enabled": True, "group_by": ["service", "alertname"], "min_rca_severity": "high", "suppress_severities": ["info"]}],
        silences=[],
    )
    summary = summarize_alert_noise_evaluations([{"summary": result["summary"], "created_at": "2026-01-01T00:00:00+00:00"}])
    assert result["summary"]["groups"] == 2
    assert result["groups"][0]["deduped_count"] == 1
    assert summary["latest_actionable_incidents"] == 1
    assert summary["latest_noise_reduction_ratio"] > 0


def test_alert_strategy_recommendations_suggest_policy_and_silence():
    result = recommend_alert_noise_strategy(
        alerts=[
            {"id": "a1", "title": "CacheWarmup", "severity": "info", "status": "active", "labels": {"service": "api", "alertname": "CacheWarmup"}},
            {"id": "a2", "title": "CacheWarmup", "severity": "info", "status": "active", "labels": {"service": "api", "alertname": "CacheWarmup"}},
            {"id": "a3", "title": "CacheWarmup", "severity": "info", "status": "active", "labels": {"service": "api", "alertname": "CacheWarmup"}},
            {"id": "a4", "title": "ApiErrorRateHigh", "severity": "critical", "status": "active", "labels": {"service": "api", "alertname": "ApiErrorRateHigh"}},
        ],
        policies=[],
        silences=[],
        evaluations=[],
    )
    kinds = {item["kind"] for item in result["items"]}
    summary = summarize_alert_strategy_recommendations(result["items"])

    assert "create_baseline_policy" in kinds
    assert "create_silence_for_noisy_group" in kinds
    assert result["summary"]["applyable"] >= 2
    assert summary["recommendations"] == len(result["items"])


def test_alert_strategy_recommendation_routes_apply_policy(tmp_path):
    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers import ops_center

    tokens = set_request_scope(
        tenant_id="tenant-alert-strategy",
        project_id="project-alert-strategy",
        project_path=tmp_path,
        tenant_code="tenant-alert-strategy",
        business_code="biz-alert-strategy",
        project_code="project-alert-strategy",
    )
    try:
        source = ops_center.create_alert_source(ops_center.AlertSourceCreate(
            name="Prometheus Strategy",
            source_type="prometheus",
            labels={"environment": "production"},
            sample_payload={
                "alerts": [
                    {"fingerprint": "info-1", "labels": {"alertname": "CacheWarmup", "severity": "info", "service": "api"}, "annotations": {"description": "cache warmup"}, "status": {"state": "active"}},
                    {"fingerprint": "info-2", "labels": {"alertname": "CacheWarmup", "severity": "info", "service": "api"}, "annotations": {"description": "cache warmup"}, "status": {"state": "active"}},
                    {"fingerprint": "info-3", "labels": {"alertname": "CacheWarmup", "severity": "info", "service": "api"}, "annotations": {"description": "cache warmup"}, "status": {"state": "active"}},
                ],
            },
        ))
        assert source["source_type"] == "prometheus"
        ops_center.sync_alert_sources(ops_center.AlertSourceSyncIn(persist=True))
        generated = ops_center.generate_alert_strategy_recommendations(ops_center.AlertStrategyRecommendIn(persist=True))
        policy_recommendation = next(item for item in generated["items"] if item["operation"] == "upsert_policy")
        applied = ops_center.alert_strategy_recommendation_action(
            policy_recommendation["id"],
            ops_center.AlertStrategyRecommendationActionIn(action="apply", actor="SRE", note="apply baseline"),
        )
        listed = ops_center.list_alert_noise_policies()

        assert generated["persisted"] >= 1
        assert applied["item"]["review_status"] == "applied"
        assert listed["summary"]["enabled_policies"] == 1
        assert ops_center.list_alert_strategy_recommendations()["total"] >= 1
    finally:
        reset_request_scope(tokens)


def test_build_ops_rca_verification_plan_requires_recovery_evidence():
    plan = build_ops_rca_verification_plan(
        rca_item={
            "id": "rca-1",
            "incident_id": "INC-1",
            "root_cause": "production rollback required",
            "resolution": "rollback done",
            "severity": "high",
            "selected_runbook_ids": ["rb-rollback"],
            "linked": {"pipelines": ["pipe-1"]},
            "evidence": [{"type": "pipeline", "label": "deploy prod"}],
        },
        pipelines=[{"id": "pipe-1", "name": "deploy prod", "status": "failed", "error_msg": "apply failed"}],
        runbooks=[{"id": "rb-rollback", "name": "production rollback", "steps": ["rollback", "verify"]}],
    )

    assert plan["status"] == "failed"
    assert plan["summary"]["required_failed"] == 1
    assert any(item["id"] == "linked_pipelines_recovered" and item["status"] == "failed" for item in plan["checks"])

    passed = build_ops_rca_verification_plan(
        rca_item={
            "id": "rca-1",
            "incident_id": "INC-1",
            "root_cause": "production rollback required",
            "resolution": "rollback done",
            "severity": "high",
            "selected_runbook_ids": ["rb-rollback"],
            "linked": {"pipelines": ["pipe-1"]},
            "evidence": [{"type": "pipeline", "label": "deploy prod"}],
        },
        pipelines=[{"id": "pipe-1", "name": "deploy prod", "status": "success"}],
        runbooks=[{"id": "rb-rollback", "name": "production rollback", "steps": ["rollback", "verify"]}],
        manual_checks={"service_status": "healthy", "runbook_status": "passed", "pipeline_status": "healthy", "evidence_url": "trace://1"},
    )

    assert passed["status"] == "passed"
    assert passed["score"] >= 90


def test_verify_ops_rca_item_closes_when_plan_passes():
    rca = {"id": "rca-1", "incident_id": "INC-1", "root_cause": "latency spike", "resolution": "scaled out", "status": "open"}
    plan = build_ops_rca_verification_plan(
        rca_item=rca,
        pipelines=[],
        runbooks=[],
        manual_checks={"service_status": "healthy", "metrics_status": "healthy", "evidence_url": "audit://evidence"},
    )

    updated = verify_ops_rca_item(
        rca,
        verifier="sre",
        checks={"service_status": "healthy", "metrics_status": "healthy", "evidence_url": "audit://evidence"},
        plan=plan,
        close_on_pass=True,
        note="post incident verification",
    )

    assert updated["status"] == "resolved"
    assert updated["verification_status"] == "passed"
    assert updated["verification_history"][0]["verifier"] == "sre"


def test_evaluate_self_heal_matches_enabled_threshold_policy():
    result = evaluate_self_heal(
        policies=[
            {
                "id": "policy-cpu",
                "trigger_condition": "cpu > 90",
                "action": "restart_service api",
                "enabled": True,
            },
            {
                "id": "policy-disabled",
                "trigger_condition": "error_rate > 5",
                "action": "rollback deployment",
                "enabled": False,
            },
        ],
        signals={"cpu": 96, "error_rate": 9, "service": "api"},
        rca=[],
        pipelines=[],
        runbooks=[],
    )

    assert result["summary"]["matched"] == 1
    assert result["decisions"][0]["policy_id"] == "policy-cpu"
    assert result["decisions"][0]["decision"] == "ready"
    assert result["decisions"][0]["risk_level"] == "high"
    assert result["decisions"][0]["action"] == "restart_service api"


def test_evaluate_self_heal_blocks_destructive_production_action_without_runbook():
    result = evaluate_self_heal(
        policies=[
            {
                "id": "policy-prod-rollback",
                "trigger_condition": "error_rate >= 5",
                "action": "rollback production",
                "enabled": True,
            }
        ],
        signals={"error_rate": 12, "environment": "production"},
        rca=[{"id": "rca-1", "status": "open", "incident_id": "INC-1", "root_cause": "release regression"}],
        pipelines=[],
        runbooks=[],
    )

    decision = result["decisions"][0]
    assert decision["decision"] == "needs_approval"
    assert decision["risk_level"] == "critical"
    assert any("Runbook" in step["title"] for step in decision["steps"])
    assert result["summary"]["needs_approval"] == 1


def test_build_self_heal_tasks_creates_actionable_task_drafts():
    evaluation = evaluate_self_heal(
        policies=[
            {"id": "policy-latency", "trigger_condition": "latency_ms > 1000", "action": "scale_out api", "enabled": True}
        ],
        signals={"latency_ms": 1880, "service": "api"},
        rca=[],
        pipelines=[],
        runbooks=[{"id": "rb-scale", "name": "服务扩容", "tags": ["scale"], "steps": ["确认容量", "扩容实例"]}],
    )

    tasks = build_self_heal_tasks(evaluation, dry_run=True, priority="P1", owner_id="", dev_tool="codex")

    assert tasks["dry_run"] is True
    assert tasks["tasks"][0]["source"] == "ops_center_self_heal"
    assert tasks["tasks"][0]["priority"] == "P1"
    assert "policy-latency" in tasks["tasks"][0]["debug_notes"]


def test_summarize_ops_health_counts_open_risk_and_recommendations():
    summary = summarize_ops_health(
        pipelines=[{"status": "failed"}, {"status": "running"}],
        rca=[{"status": "open"}, {"status": "resolved"}],
        runbooks=[],
        self_heal=[{"enabled": True}, {"enabled": False}],
        evaluations=[{"summary": {"matched": 2, "needs_approval": 1}}],
    )

    assert summary["health_score"] < 90
    assert summary["pipelines_failed"] == 1
    assert summary["rca_open"] == 1
    assert summary["self_heal_active"] == 1
    assert summary["recommendations"]


def test_build_ops_rca_insights_correlates_trace_alerts_and_pipeline_failures():
    analysis = build_ops_rca_insights(
        trace_summary={
            "ok": True,
            "trace": {"trace_id": "trace-1", "correlation_id": "corr-1"},
            "summary": {"failed_runs": 1, "slow_llm_calls": 1, "failed_data_jobs": 1, "nodes": 3},
            "root_cause": {"risk_level": "high", "likely_causes": ["LLM latency exceeded 5000ms"], "recommended_next": ["检查模型 fallback"]},
            "root_cause_navigation": [{"type": "llm_call", "title": "LLM gpt-5", "detail": "latency=7600ms", "status": "slow"}],
        },
        alerts=[
            {"source": "data_quality", "id": "dq-1", "severity": "high", "status": "open", "title": "orders freshness failed", "detail": "lag"},
            {"source": "billing", "id": "bill-1", "severity": "medium", "status": "open", "message": "quota warning"},
        ],
        pipelines=[{"id": "pipe-1", "name": "deploy prod", "status": "failed", "error_msg": "apply failed"}],
        rca=[{"id": "rca-1", "status": "open", "root_cause": "previous incident"}],
        runbooks=[{"id": "rb-llm", "name": "LLM fallback runbook", "tags": ["llm", "fallback"], "steps": ["check provider", "switch fallback"]}],
    )

    kinds = {item["kind"] for item in analysis["candidates"]}
    assert {"trace_correlation", "multi_source_alerts", "pipeline_failure", "open_rca_debt"} <= kinds
    assert analysis["summary"]["high"] >= 2
    assert analysis["summary"]["open_alerts"] == 2
    assert analysis["agent_consumption"]["api"] == "/api/v1/ops-center/rca/insights"
    trace = next(item for item in analysis["candidates"] if item["kind"] == "trace_correlation")
    assert trace["id"].startswith("rca-insight-trace_correlation-")
    assert trace["recommended_runbooks"][0]["id"] == "rb-llm"


def test_recommend_runbooks_for_candidate_scores_matching_terms():
    candidate = {
        "kind": "pipeline_failure",
        "title": "部署流水线失败",
        "root_cause": "rollback production apply failed",
        "evidence": [{"type": "pipeline", "label": "production deploy"}],
        "recommendations": ["绑定 rollback Runbook"],
    }
    recommended = recommend_runbooks_for_candidate(candidate, [
        {"id": "rb-rollback", "name": "production rollback", "tags": ["rollback"], "steps": ["rollback", "verify"]},
        {"id": "rb-cache", "name": "cache cleanup", "tags": ["cache"], "steps": ["flush"]},
    ])

    assert recommended[0]["id"] == "rb-rollback"
    assert recommended[0]["match_score"] > 40


def test_build_ops_rca_insight_tasks_turns_candidates_into_actionable_tasks():
    analysis = build_ops_rca_insights(
        trace_summary={"summary": {}, "root_cause": {}, "root_cause_navigation": []},
        alerts=[{"source": "data_quality", "id": "dq-1", "severity": "critical", "status": "open", "title": "critical data drift"}],
        pipelines=[],
        rca=[],
    )

    tasks = build_ops_rca_insight_tasks(analysis, dry_run=True, priority="P2", owner_id="", dev_tool="codex")

    assert tasks["dry_run"] is True
    assert tasks["summary"]["planned"] == 1
    assert tasks["tasks"][0]["source"] == "ops_center_rca_insight"
    assert tasks["tasks"][0]["priority"] == "P0"
    assert "critical data drift" in tasks["tasks"][0]["description"]


def test_build_self_heal_guarded_actions_requires_approval_for_critical_rollback():
    evaluation = evaluate_self_heal(
        policies=[
            {"id": "policy-prod", "trigger_condition": "error_rate >= 5", "action": "rollback production", "enabled": True}
        ],
        signals={"error_rate": 9, "environment": "production", "service": "api"},
        rca=[{"id": "rca-1", "status": "open"}],
        pipelines=[{"id": "pipe-1", "status": "failed"}],
        runbooks=[{"id": "rb-rollback", "name": "production rollback", "tags": ["rollback"], "steps": ["freeze traffic", "rollback", "verify"]}],
    )

    actions = build_self_heal_guarded_actions(evaluation, created_by="ops-bot")

    assert len(actions) == 1
    action = actions[0]
    assert action["policy_id"] == "policy-prod"
    assert action["state"] == "approval_required"
    assert action["requires_approval"] is True
    assert action["rollback_required"] is True
    assert action["rollback_command"]
    assert action["audit_payload"]["risk_level"] == "critical"
    assert action["audit_payload"]["state"] == "approval_required"


def test_self_heal_guarded_action_lifecycle_approval_apply_verify_rollback():
    action = build_self_heal_guarded_actions(
        {
            "signals": {"error_rate": 9, "environment": "production"},
            "decisions": [
                {
                    "policy_id": "policy-prod",
                    "trigger_condition": "error_rate >= 5",
                    "action": "rollback production",
                    "decision": "needs_approval",
                    "risk_level": "critical",
                    "evidence": {"actual": 9, "expected": "5", "environment": "production"},
                    "steps": [{"id": "verify", "title": "执行后验证", "type": "verify"}],
                }
            ],
        },
        created_by="ops-bot",
    )[0]

    approved = approve_self_heal_guarded_action(action, approver="ops-lead", note="变更窗口已确认")
    assert approved["state"] == "approved"
    assert approved["approved_by"] == "ops-lead"

    applied = apply_self_heal_guarded_action(approved, operator="ops-bot", result={"command_exit_code": 0})
    assert applied["state"] == "applied"
    assert applied["applied_by"] == "ops-bot"
    assert applied["audit_payload"]["state"] == "applied"

    verified = verify_self_heal_guarded_action(applied, verifier="sre", verification={"error_rate": 0.4, "status": "healthy"})
    assert verified["state"] == "verified"
    assert verified["verification_result"]["status"] == "healthy"

    rolled_back = rollback_self_heal_guarded_action(verified, operator="ops-lead", evidence={"reason": "post-check regression", "command_exit_code": 0})
    assert rolled_back["state"] == "rolled_back"
    assert rolled_back["rollback_evidence"]["reason"] == "post-check regression"
    assert rolled_back["audit_payload"]["state"] == "rolled_back"
