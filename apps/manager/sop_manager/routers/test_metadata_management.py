from contextlib import contextmanager

import pytest

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import data_ingest, metadata_management
from sop_manager.routers.data_analytics import _load_governance, _save_governance


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


def seed_schema_registry() -> str:
    connector = data_ingest.create_connector(
        data_ingest.ConnectorCreate(
            name="billing lake",
            connector_type="oceanbase",
            database="billing",
            extra={
                "schemas": {
                    "dwd_orders": [
                        {"name": "order_id", "type": "string"},
                        {"name": "customer_name", "type": "string"},
                        {"name": "paid_amount", "type": "decimal"},
                    ]
                }
            },
        )
    )
    data_ingest.connector_dry_run(connector["id"], data_ingest.ConnectorDryRunIn(sample_limit=5))
    return connector["id"]


def test_metadata_summary_assets_fields_and_classification(tmp_path):
    with scoped_project(tmp_path):
        seed_schema_registry()

        summary = metadata_management.metadata_summary()
        assets = metadata_management.metadata_assets(domain="", status="", q="任务")
        fields = metadata_management.metadata_fields(asset_id="", q="customer", sensitive=True)
        classified = metadata_management.metadata_classify_asset(
            "asset-tasks",
            metadata_management.MetadataAssetClassifyIn(
                owner="DataOps",
                security_level="confidential",
                tags=["任务", "调度"],
                quality_rules=["required_owner", "pii_redaction", "lineage_declared"],
                note="补齐元数据责任人与分类",
            ),
        )

    assert summary["summary"]["assets"] >= 4
    assert summary["summary"]["schema_tables"] == 1
    assert summary["summary"]["fields"] >= 3
    assert summary["summary"]["sensitive_fields"] >= 1
    assert assets["total"] >= 1
    assert any(item["id"] == "asset-tasks" for item in assets["items"])
    assert fields["total"] == 1
    assert fields["items"][0]["name"] == "customer_name"
    assert classified["item"]["owner"] == "DataOps"
    assert classified["item"]["security_level"] == "confidential"
    assert "pii_redaction" in classified["item"]["quality_rules"]


def test_metadata_scope_isolated(tmp_path):
    with scoped_project(tmp_path / "a", tenant="tenant-a", business="biz-a", project="project-a"):
        seed_schema_registry()
        a_summary = metadata_management.metadata_summary()

    with scoped_project(tmp_path / "b", tenant="tenant-b", business="biz-b", project="project-b"):
        b_summary = metadata_management.metadata_summary()
        b_fields = metadata_management.metadata_fields(asset_id="", q="customer", sensitive=None)

    assert a_summary["summary"]["schema_tables"] == 1
    assert b_summary["summary"]["schema_tables"] == 0
    assert b_fields["total"] == 0


def test_metadata_lineage_impact_uses_asset_source(tmp_path):
    with scoped_project(tmp_path):
        data = _load_governance()
        for asset in data["assets"]:
            if asset["id"] == "asset-requirements":
                asset["lineage_downstream"] = ["tasks"]
        _save_governance(data)

        impact = metadata_management.metadata_lineage_impact(asset_id="asset-requirements")

    assert impact["asset"]["id"] == "asset-requirements"
    assert impact["node_id"] == "requirements"
    assert impact["downstream_count"] >= 1


def test_metadata_lineage_impact_requires_known_asset(tmp_path):
    with scoped_project(tmp_path):
        with pytest.raises(Exception):
            metadata_management.metadata_lineage_impact(asset_id="missing")
