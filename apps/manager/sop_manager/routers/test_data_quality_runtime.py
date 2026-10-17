from contextlib import contextmanager

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import data_quality
from sop_manager.routers import data_analytics, metrics_service, tag_service
from sop_manager.routers import notify


@contextmanager
def scoped_project(root, *, tenant="tenant-a", business="biz-a", project="project-a"):
    tokens = set_request_scope(
        tenant_id=tenant,
        project_id=project,
        project_path=root,
        tenant_code=tenant,
        business_code=business,
        project_code=project,
    )
    try:
        yield
    finally:
        reset_request_scope(tokens)


def test_data_quality_runtime_executes_rules_and_creates_explainable_alerts(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        owner_rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="owner must exist",
                domain="assets",
                rule_type="not_null",
                severity="high",
                config={"field": "owner"},
            )
        )
        score_rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="score in range",
                domain="assets",
                rule_type="range",
                severity="medium",
                config={"field": "score", "min": 0, "max": 100},
            )
        )
        regex_rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="email format",
                domain="assets",
                rule_type="regex",
                severity="low",
                config={"field": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"},
            )
        )
        unique_rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="asset id unique",
                domain="assets",
                rule_type="uniqueness",
                severity="high",
                config={"field": "id"},
            )
        )
        freshness_rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="fresh update",
                domain="assets",
                rule_type="freshness",
                severity="medium",
                config={"field": "updated_at", "max_age_hours": 24, "reference_time": "2026-05-21T12:00:00+00:00"},
            )
        )
        rows = [
            {"id": "asset-1", "owner": "DataOps", "score": 95, "email": "owner@example.com", "updated_at": "2026-05-21T06:00:00+00:00"},
            {"id": "asset-1", "owner": "", "score": 130, "email": "bad-email", "updated_at": "2026-05-19T06:00:00+00:00"},
        ]

        owner_run = data_quality.create_run(data_quality.RunCreate(rule_id=owner_rule["id"], dataset="asset_sample", sample_rows=rows))
        score_run = data_quality.create_run(data_quality.RunCreate(rule_id=score_rule["id"], dataset="asset_sample", sample_rows=rows))
        regex_run = data_quality.create_run(data_quality.RunCreate(rule_id=regex_rule["id"], dataset="asset_sample", sample_rows=rows))
        unique_run = data_quality.create_run(data_quality.RunCreate(rule_id=unique_rule["id"], dataset="asset_sample", sample_rows=rows))
        freshness_run = data_quality.create_run(data_quality.RunCreate(rule_id=freshness_rule["id"], dataset="asset_sample", sample_rows=rows))
        alerts = data_quality.list_alerts(status="open")
        summary = data_quality.summary()["summary"]

    assert owner_run["status"] == "failed"
    assert owner_run["score"] == 0.5
    assert owner_run["rows_checked"] == 2
    assert owner_run["rows_failed"] == 1
    assert owner_run["failed_samples"][0]["row_index"] == 1
    assert owner_run["alert_attribution"]["root_causes"] == ["owner_null_or_empty"]
    assert score_run["alert_attribution"]["root_causes"] == ["score_out_of_range"]
    assert regex_run["alert_attribution"]["root_causes"] == ["email_regex_mismatch"]
    assert unique_run["alert_attribution"]["root_causes"] == ["id_not_unique"]
    assert freshness_run["alert_attribution"]["root_causes"] == ["updated_at_stale"]
    assert alerts["total"] == 5
    assert alerts["items"][0]["alert_attribution"]["failed_rows"] == 1
    assert summary["alerts_open"] == 5
    assert summary["last_run_status"] in {"failed", "warning"}


def test_data_quality_alert_tasks_preview_uses_run_attribution(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="amount range",
                domain="billing",
                rule_type="range",
                severity="critical",
                config={"field": "amount", "min": 0, "max": 1000},
            )
        )
        data_quality.create_run(
            data_quality.RunCreate(
                rule_id=rule["id"],
                dataset="invoice_sample",
                sample_rows=[{"id": "inv-1", "amount": 2000}],
            )
        )

        tasks = data_quality.alert_tasks(
            data_quality.AlertTasksIn(dry_run=True, priority="P1", owner_id="", dev_tool="codex")
        )

    assert tasks["dry_run"] is True
    assert tasks["items"][0]["source"] == "data_quality_runtime_alert"
    assert tasks["items"][0]["priority"] == "P0"
    assert "amount_out_of_range" in tasks["items"][0]["description"]
    assert "invoice_sample" in tasks["items"][0]["description"]
    assert tasks["created"] == []


def test_data_quality_impact_links_metrics_tags_and_metadata_assets(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        governance = data_analytics._load_governance()
        governance["assets"] = [
            {
                "id": "asset-orders",
                "name": "订单事实表",
                "type": "table",
                "domain": "billing",
                "source": "orders",
                "owner": "",
                "status": "active",
                "quality_rules": [],
                "lineage_upstream": ["payment"],
                "lineage_downstream": ["metrics-service"],
                "fields": [{"name": "amount", "type": "decimal"}, {"name": "customer_id", "type": "string"}],
            }
        ]
        data_analytics._save_governance(governance)
        metric = metrics_service.create_metric(
            metrics_service.MetricCreate(
                name="Order Amount",
                domain="billing",
                formula="sum(amount)",
                source_assets=["orders"],
                owner="Metrics Agent",
            )
        )
        tag = tag_service.create_tag(
            tag_service.TagCreate(name="High Value Customer", category="customer", applies_to=["orders"], owner="TagOps")
        )
        tag_service.create_rule(
            tag_service.RuleCreate(
                tag_id=tag["id"],
                entity_type="orders",
                condition={"field": "amount", "operator": ">=", "value": 1000},
                output_value=True,
            )
        )
        rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="amount range",
                domain="billing",
                rule_type="range",
                severity="critical",
                config={"field": "amount", "min": 0, "max": 1000},
            )
        )
        data_quality.create_run(
            data_quality.RunCreate(
                rule_id=rule["id"],
                dataset="orders",
                sample_rows=[{"order_id": "o-1", "amount": 2000, "customer_id": "c-1"}],
            )
        )

        impact = data_quality.quality_impact()
        tasks = data_quality.quality_impact_tasks(data_quality.QualityImpactTasksIn(dry_run=True))

    assert impact["summary"]["alerts"] == 1
    assert impact["summary"]["impacted_metrics"] == 1
    assert impact["summary"]["impacted_tags"] == 1
    assert impact["summary"]["impacted_assets"] == 1
    assert impact["impacted_metrics"][0]["id"] == metric["id"]
    assert impact["impacted_metrics"][0]["matched_fields"] == ["amount"]
    assert impact["impacted_tags"][0]["id"] == tag["id"]
    assert impact["impacted_assets"][0]["id"] == "asset-orders"
    assert tasks["dry_run"] is True
    assert tasks["planned"] == 3
    assert {item["source"] for item in tasks["items"]} == {"data_quality_impact"}
    assert {"metric-impact", "tag-impact", "metadata-impact"} <= {label for item in tasks["items"] for label in item["labels"]}


def test_data_quality_subscription_runs_through_notify_channel(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        notify.add_channel(
            notify.Channel(
                type="webhook",
                name="quality-ops",
                webhook_url="http://127.0.0.1:9/disabled",
                enabled=False,
                events=["quality_alert_open", "quality_impact_high"],
            )
        )
        rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="amount range",
                domain="billing",
                rule_type="range",
                severity="critical",
                config={"field": "amount", "min": 0, "max": 1000},
            )
        )
        data_quality.create_run(
            data_quality.RunCreate(rule_id=rule["id"], dataset="orders", sample_rows=[{"order_id": "o-1", "amount": 2000}])
        )
        subscription = data_quality.upsert_quality_subscription(
            data_quality.QualitySubscriptionIn(
                name="质量运营群",
                channel="quality-ops",
                severity_min="medium",
                min_impact_score=0,
                owner="DataOps",
            )
        )["item"]
        preview = data_quality.run_quality_subscriptions(data_quality.QualitySubscriptionRunIn(dry_run=True, force=True))
        sent = data_quality.run_quality_subscriptions(data_quality.QualitySubscriptionRunIn(dry_run=False, force=True))
        runs = data_quality.quality_subscription_runs()
        messages = notify.messages(direction="outbound")
        summary = data_quality.summary()["summary"]

    assert subscription["channel"] == "quality-ops"
    assert preview["dry_run"] is True
    assert preview["delivery_plans"][0]["message"]["channel"] == "quality-ops"
    assert preview["delivery_plans"][0]["briefing"]["summary"]["alerts"] == 1
    assert sent["dry_run"] is False
    assert sent["sent"][0]["ok"] is False
    assert sent["sent"][0]["reason"] == "disabled"
    assert runs["items"][0]["messages_planned"] == 1
    assert messages["items"][0]["channel"] == "quality-ops"
    assert summary["subscriptions"] == 1
    assert summary["subscription_runs"] == 2


def test_data_quality_rca_generates_hypotheses_history_and_tasks(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="amount range",
                domain="billing",
                rule_type="range",
                severity="critical",
                config={"field": "amount", "min": 0, "max": 1000},
            )
        )
        data_quality.create_run(
            data_quality.RunCreate(
                rule_id=rule["id"],
                dataset="orders",
                sample_rows=[{"order_id": "o-1", "amount": 2000}, {"order_id": "o-2", "amount": 1200}],
            )
        )

        rca = data_quality.create_quality_rca(data_quality.QualityRcaIn(persist=True))
        tasks = data_quality.quality_rca_tasks(data_quality.QualityRcaTasksIn(rca_id=rca["id"], dry_run=True))
        history = data_quality.quality_rca_history()
        summary = data_quality.summary()["summary"]

    assert rca["status"] == "ready"
    assert rca["summary"]["alerts"] == 1
    assert rca["summary"]["failed_rows"] == 2
    assert rca["summary"]["risk_score"] > 0
    assert rca["hypotheses"][0]["category"] == "validity"
    assert rca["hypotheses"][0]["root_cause"] == "amount_out_of_range"
    assert rca["recommendations"]["containment_actions"]
    assert tasks["dry_run"] is True
    assert tasks["planned"] == 1
    assert tasks["items"][0]["source"] == "data_quality_rca"
    assert "rca" in tasks["items"][0]["labels"]
    assert history["items"][0]["id"] == rca["id"]
    assert summary["rca_reports"] == 1
    assert summary["last_rca_risk_score"] == rca["summary"]["risk_score"]


def test_data_quality_forecast_generates_risk_signals_history_and_tasks(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        rule = data_quality.create_rule(
            data_quality.RuleCreate(
                name="owner must exist",
                domain="assets",
                rule_type="not_null",
                severity="high",
                config={"field": "owner"},
            )
        )
        data_quality.create_run(data_quality.RunCreate(rule_id=rule["id"], dataset="assets", sample_rows=[{"id": "a-1", "owner": "DataOps"}]))
        data_quality.create_run(data_quality.RunCreate(rule_id=rule["id"], dataset="assets", sample_rows=[{"id": "a-2", "owner": ""}]))

        forecast = data_quality.create_quality_forecast(data_quality.QualityForecastIn(window_days=7, horizon_days=3, persist=True))
        tasks = data_quality.quality_forecast_tasks(data_quality.QualityForecastTasksIn(forecast_id=forecast["id"], dry_run=True))
        history = data_quality.quality_forecast_history()
        summary = data_quality.summary()["summary"]

    assert forecast["status"] == "ready"
    assert forecast["summary"]["runs"] == 2
    assert forecast["summary"]["open_alerts"] == 1
    assert forecast["summary"]["risk_score"] > 0
    assert forecast["series"]
    assert {signal["id"] for signal in forecast["risk_signals"]} & {"failed-row-pressure", "open-alert-backlog", "quality-score-decline"}
    assert tasks["dry_run"] is True
    assert tasks["planned"] == len(forecast["risk_signals"])
    assert tasks["items"][0]["source"] == "data_quality_forecast"
    assert "forecast" in tasks["items"][0]["labels"]
    assert history["items"][0]["id"] == forecast["id"]
    assert summary["forecast_reports"] == 1
    assert summary["last_forecast_risk_score"] == forecast["summary"]["risk_score"]


def test_data_quality_runtime_is_scoped_by_project(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        rule = data_quality.create_rule(
            data_quality.RuleCreate(name="project a owner", rule_type="not_null", config={"field": "owner"})
        )
        data_quality.create_run(data_quality.RunCreate(rule_id=rule["id"], sample_rows=[{"owner": ""}]))

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        rules = data_quality.list_rules()
        runs = data_quality.list_runs()
        alerts = data_quality.list_alerts()

    assert rules["items"] == []
    assert runs["items"] == []
    assert alerts["items"] == []
