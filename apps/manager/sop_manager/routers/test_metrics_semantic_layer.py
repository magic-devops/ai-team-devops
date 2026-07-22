from contextlib import contextmanager

import pytest
from fastapi import HTTPException

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import metrics_service
from sop_manager.routers.sql_models import Business, Project, SessionLocal, Tenant


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


def ensure_sql_scope(tenant="tenant-a", business="biz-a", project="project-a"):
    db = SessionLocal()
    try:
        if not db.get(Tenant, tenant):
            db.add(Tenant(id=tenant, name=tenant, slug=tenant, plan="free", status="active"))
        if not db.get(Business, business):
            db.add(Business(id=business, tenant_id=tenant, name=business, description="test business"))
        if not db.get(Project, project):
            db.add(Project(id=project, tenant_id=tenant, business_id=business, name=project, project_path="", status="active"))
        db.commit()
    finally:
        db.close()


def test_metric_semantic_layer_validates_formula_and_blocks_unsafe_expression(tmp_path):
    with scoped_project(tmp_path):
        metric = metrics_service.create_metric(
            metrics_service.MetricCreate(
                name="GMV",
                domain="billing",
                metric_type="atomic",
                formula="sum(order_amount)",
                dimensions=["day", "region"],
                source_assets=["orders"],
                owner="Metrics Agent",
            )
        )

    assert metric["formula_validation"]["valid"] is True
    assert metric["formula_validation"]["functions"] == ["sum"]
    assert metric["formula_validation"]["fields"] == ["order_amount"]
    assert metric["semantic_version"] == "v0"

    with scoped_project(tmp_path):
        with pytest.raises(HTTPException) as exc:
            metrics_service.create_metric(
                metrics_service.MetricCreate(
                    name="Unsafe metric",
                    formula="sum(order_amount); drop table users",
                    owner="Metrics Agent",
                )
            )

    assert exc.value.status_code == 400
    assert "formula" in str(exc.value.detail).lower()


def test_metric_publish_creates_versioned_query_contract_and_query_result(tmp_path):
    with scoped_project(tmp_path):
        metric = metrics_service.create_metric(
            metrics_service.MetricCreate(
                name="Paid Orders",
                domain="billing",
                metric_type="atomic",
                formula="count(order_id)",
                dimensions=["day", "channel"],
                source_assets=["orders"],
                owner="Metrics Agent",
            )
        )

        published = metrics_service.publish_metric_version(
            metric["id"],
            metrics_service.MetricPublishIn(version_note="initial public contract", sla="99.9%"),
        )
        queried = metrics_service.query_metric(metric["id"], grain="day", dimensions="channel=web")
        versions = metrics_service.metric_versions(metric["id"])

    assert published["metric_id"] == metric["id"]
    assert published["semantic_version"] == "v1"
    assert published["query_contract"]["endpoint"] == f"/api/v1/metrics-service/query/{metric['id']}"
    assert {"start", "end", "grain", "dimensions"} <= set(published["query_contract"]["parameters"])
    assert versions["total"] == 1
    assert versions["items"][0]["version_note"] == "initial public contract"
    assert queried["semantic_version"] == "v1"
    assert queried["query"]["dimensions"] == {"channel": "web"}
    assert queried["contract"]["sla"] == "99.9%"
    assert len(queried["values"]) == 7


def test_metric_impact_analysis_traces_upstream_and_downstream_dependencies(tmp_path):
    with scoped_project(tmp_path):
        base = metrics_service.create_metric(
            metrics_service.MetricCreate(
                name="Paid Orders",
                domain="billing",
                metric_type="atomic",
                formula="count(order_id)",
                source_assets=["orders"],
                owner="Metrics Agent",
            )
        )
        derived = metrics_service.create_metric(
            metrics_service.MetricCreate(
                name="Order Conversion",
                domain="growth",
                metric_type="derived",
                formula="ratio(paid_orders, visits)",
                dimensions=["day"],
                source_assets=["orders", "traffic"],
                depends_on=[base["id"], "visits"],
                owner="Metrics Agent",
            )
        )
        metrics_service.publish_metric_version(
            derived["id"],
            metrics_service.MetricPublishIn(version_note="growth dashboard contract"),
        )

        impact = metrics_service.metric_impact(base["id"])

    assert impact["metric_id"] == base["id"]
    assert "orders" in impact["upstream_assets"]
    assert derived["id"] in {item["id"] for item in impact["downstream_metrics"]}
    assert any(service["type"] == "metric_api" for service in impact["affected_services"])
    assert impact["risk_level"] in {"medium", "high"}


def test_metrics_semantic_layer_is_scoped_by_project(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        metric = metrics_service.create_metric(
            metrics_service.MetricCreate(name="Project A Metric", formula="count(task_id)", source_assets=["tasks"])
        )
        metrics_service.publish_metric_version(metric["id"], metrics_service.MetricPublishIn())

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        assert metrics_service.list_catalog()["items"] == []
        assert metrics_service.list_published()["items"] == []
        with pytest.raises(HTTPException) as exc:
            metrics_service.query_metric(metric["id"])

    assert exc.value.status_code == 404


def test_metrics_governance_tasks_preview_and_create(tmp_path):
    with scoped_project(tmp_path):
        ensure_sql_scope()
        metric = metrics_service.create_metric(
            metrics_service.MetricCreate(
                name="Unowned Draft Metric",
                domain="growth",
                metric_type="derived",
                formula="",
                source_assets=["traffic"],
                depends_on=["missing_metric"],
            )
        )

        preview = metrics_service.metrics_governance_tasks(
            metrics_service.MetricsGovernanceTasksIn(ids=[metric["id"]], dry_run=True, assigned_to="MetricsOps")
        )
        created = metrics_service.metrics_governance_tasks(
            metrics_service.MetricsGovernanceTasksIn(ids=[metric["id"]], dry_run=False, assigned_to="MetricsOps")
        )

    assert preview["dry_run"] is True
    assert preview["planned"] >= 4
    assert preview["created"] == []
    assert {item["source"] for item in preview["items"]} == {"metrics_governance"}
    labels = {label for item in preview["items"] for label in item.get("labels", [])}
    assert {"missing-owner", "missing-formula", "unpublished-api", "missing-version", "broken-dependency"} & labels
    assert created["dry_run"] is False
    assert created["created_count"] == created["planned"]
    assert created["created_count"] >= 4
    assert all(item.get("source") == "metrics_governance" for item in created["items"])


def test_metric_approval_review_can_publish_metric_contract(tmp_path):
    with scoped_project(tmp_path):
        metric = metrics_service.create_metric(
            metrics_service.MetricCreate(
                name="Approved Revenue",
                domain="billing",
                metric_type="atomic",
                formula="sum(revenue)",
                dimensions=["day"],
                source_assets=["orders"],
                owner="Metrics Agent",
            )
        )

        approval = metrics_service.create_metric_approval(
            metrics_service.MetricApprovalCreateIn(
                metric_id=metric["id"],
                reason="publish reviewed contract",
                payload={"version_note": "approved revenue v1", "sla": "99.95%"},
            )
        )
        pending = metrics_service.list_metric_approvals(status="pending")
        reviewed = metrics_service.review_metric_approval(
            approval["id"],
            metrics_service.MetricApprovalReviewIn(status="approved", reviewer="Data Steward", note="ok"),
        )
        published = metrics_service.list_published()

    assert approval["status"] == "pending"
    assert approval["risk"]["risk_level"] in {"low", "medium", "high"}
    assert pending["total"] == 1
    assert reviewed["status"] == "approved"
    assert reviewed["applied_result"]["semantic_version"] == "v1"
    assert reviewed["applied_result"]["query_contract"]["sla"] == "99.95%"
    assert any(item["metric_id"] == metric["id"] for item in published["items"])
