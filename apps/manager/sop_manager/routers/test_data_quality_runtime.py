from contextlib import contextmanager

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import data_quality


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
            data_quality.AlertTasksIn(dry_run=True, priority="P1", assigned_to="Data Governance Agent", dev_tool="codex")
        )

    assert tasks["dry_run"] is True
    assert tasks["items"][0]["source"] == "data_quality_runtime_alert"
    assert tasks["items"][0]["priority"] == "P0"
    assert "amount_out_of_range" in tasks["items"][0]["description"]
    assert "invoice_sample" in tasks["items"][0]["description"]
    assert tasks["created"] == []


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
