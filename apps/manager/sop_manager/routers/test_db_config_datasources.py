from contextlib import contextmanager

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import db_config
from sop_manager.routers.sql_models import User


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


def admin_user() -> User:
    return User(id="u-test", tenant_id="tenant-a", username="admin", password_hash="x", role="tenant_admin", status="active")


def test_datasource_summary_metadata_preview_and_sync_to_schema_registry(tmp_path):
    user = admin_user()
    with scoped_project(tmp_path):
        saved = db_config.upsert_db_connection(
            "billing-ob",
            db_config.RemoteDbConfig(
                name="billing-ob",
                type="oceanbase",
                role="analytics",
                capabilities=["sql", "analytics"],
                host="ob.example.internal",
                port=2881,
                database="billing",
                schema_name="dwd",
                readonly=True,
                secret_ref="env://BILLING_OB_URL",
                options={
                    "schemas": {
                        "dwd_orders": [
                            {"name": "order_id", "type": "string", "primary_key": True},
                            {"name": "customer_name", "type": "string"},
                            {"name": "paid_amount", "type": "decimal"},
                        ]
                    }
                },
            ),
            user=user,
        )

        summary = db_config.db_connections_summary(user=user)
        preview = db_config.preview_connection_metadata("billing-ob", db_config.MetadataPreviewIn(sample_limit=10), user=user)
        security = db_config.scan_connection_security("billing-ob", db_config.MetadataPreviewIn(sample_limit=10), user=user)
        synced = db_config.sync_connection_metadata("billing-ob", db_config.MetadataSyncIn(owner="DataOps"), user=user)

    assert saved["config"]["name"] == "billing-ob"
    assert "password" not in saved["config"]
    assert summary["summary"]["total"] == 1
    assert summary["summary"]["ready"] == 1
    assert summary["summary"]["by_role"]["analytics"] == 1
    assert preview["metadata"]["tables"] == 1
    assert preview["metadata"]["pii_candidates"] == 1
    assert preview["tables"][0]["name"] == "dwd_orders"
    assert security["score"] < 100
    assert security["controls"]["secret_ref_required"] is True
    assert any(item["id"] == "sensitive_fields_detected" for item in security["findings"])
    assert any(str(item["id"]).startswith("data-source-security-billing-ob-") for item in security["candidate_tasks"])
    assert synced["ingest_connector"]["extra"]["source_connection_name"] == "billing-ob"
    assert synced["schema_registry"]["total"] == 1
    assert synced["schema_registry"]["items"][0]["table_name"] == "dwd_orders"
