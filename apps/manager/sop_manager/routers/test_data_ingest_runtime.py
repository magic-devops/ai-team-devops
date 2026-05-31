from contextlib import contextmanager

import pytest
from fastapi import HTTPException

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import data_ingest


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


def test_connector_dry_run_discovers_and_registers_schema(tmp_path):
    with scoped_project(tmp_path):
        connector = data_ingest.create_connector(
            data_ingest.ConnectorCreate(
                name="Billing OceanBase",
                connector_type="oceanbase",
                database="billing",
                extra={
                    "schemas": {
                        "orders": [
                            {"name": "id", "type": "string", "primary_key": True},
                            {"name": "updated_at", "type": "datetime"},
                            {"name": "amount", "type": "decimal"},
                        ]
                    },
                    "sample_rows": [{"id": "o-1", "amount": 99}],
                    "supports_cdc": True,
                },
            )
        )

        dry_run = data_ingest.connector_dry_run(connector["id"], data_ingest.ConnectorDryRunIn(sample_limit=2))
        schema = data_ingest.get_schema(connector["id"])
        registry = data_ingest.schema_registry(connector_id=connector["id"])

    assert dry_run["status"] == "passed"
    assert dry_run["connector_id"] == connector["id"]
    assert dry_run["sample_count"] == 1
    assert dry_run["schema_summary"]["tables"] == 1
    assert schema["tables"][0]["name"] == "orders"
    assert registry["total"] == 1
    assert registry["items"][0]["table_name"] == "orders"
    assert registry["items"][0]["columns"][2]["name"] == "amount"


def test_cdc_job_run_history_and_cursor_lifecycle(tmp_path):
    with scoped_project(tmp_path):
        connector = data_ingest.create_connector(
            data_ingest.ConnectorCreate(name="Orders CDC", connector_type="mysql", database="billing", extra={"supports_cdc": True})
        )
        job = data_ingest.create_job(
            data_ingest.JobCreate(
                connector_id=connector["id"],
                name="orders cdc",
                ingest_mode="cdc",
                source_table="orders",
                target_table="ods_orders",
                cursor_field="updated_at",
            )
        )

        started = data_ingest.run_job(job["id"])
        finished = data_ingest.update_job_status(
            job["id"],
            data_ingest.JobStatusUpdate(status="success", rows_ingested=88, cdc_cursor="binlog.000002:120"),
        )
        runs = data_ingest.list_runs(job_id=job["id"])
        cursors = data_ingest.cdc_cursors(job_id=job["id"])

    assert started["status"] == "running"
    assert started["active_run_id"]
    assert finished["status"] == "success"
    assert finished["cdc_cursor"] == "binlog.000002:120"
    assert runs["total"] == 1
    assert runs["items"][0]["run_id"] == started["active_run_id"]
    assert runs["items"][0]["rows_ingested"] == 88
    assert cursors["items"][0]["cursor"] == "binlog.000002:120"
    assert cursors["items"][0]["source_table"] == "orders"


def test_data_ingest_runtime_is_scoped_by_project(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        connector = data_ingest.create_connector(data_ingest.ConnectorCreate(name="Project A DB", database="project_a"))
        job = data_ingest.create_job(data_ingest.JobCreate(connector_id=connector["id"], name="project a job"))
        data_ingest.run_job(job["id"])

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        assert data_ingest.list_connectors()["items"] == []
        assert data_ingest.list_jobs()["items"] == []
        assert data_ingest.list_runs()["items"] == []
        assert data_ingest.schema_registry()["items"] == []
        with pytest.raises(HTTPException) as exc:
            data_ingest.get_schema(connector["id"])

    assert exc.value.status_code == 404
