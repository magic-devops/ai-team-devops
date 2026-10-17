from contextlib import contextmanager

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import agent_runs, data_ingest, llm_gateway_v2
from sop_manager.routers.agent_runs import RunCreate, StatusUpdate
from sop_manager.routers.data_ingest import ConnectorCreate, JobCreate, JobStatusUpdate
from sop_manager.routers.events_ingest import CloudEvent, IngestIn, ingest
from sop_manager.routers.llm_gateway_v2 import UsageRecord


@contextmanager
def scoped_project(root, *, tenant="tenant-ob", business="biz-ob", project="project-ob"):
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


def test_trace_context_attaches_to_agent_llm_data_event_and_audit(monkeypatch, tmp_path):
    from sop_manager.routers import audit_chain
    from sop_manager.routers.system_ops import observability_trace_summary

    trace_id = "0123456789abcdef0123456789abcdef"
    correlation_id = "corr-observability-1"
    monkeypatch.setattr(audit_chain, "_CHAIN_DIR", tmp_path / ".sop-runtime" / "audit-chain")

    with scoped_project(tmp_path):
        with agent_runs.trace_context(trace_id=trace_id, correlation_id=correlation_id):
            run = agent_runs.create_run(RunCreate(agent_id="coder", task_id="TASK-OBS"))
            agent_runs.update_status(run["id"], StatusUpdate(status="failed", error_msg="llm timeout"))

        llm = llm_gateway_v2.record_usage(
            UsageRecord(
                model_id="gpt-5",
                prompt_tokens=1000,
                completion_tokens=500,
                cost_usd=0.42,
                latency_ms=7600,
                task_type="code",
                trace_id=trace_id,
                correlation_id=correlation_id,
                agent_run_id=run["id"],
                task_id="TASK-OBS",
            )
        )

        connector = data_ingest.create_connector(ConnectorCreate(name="ob-cdc", connector_type="oceanbase", database="hermes"))
        job = data_ingest.create_job(JobCreate(connector_id=connector["id"], name="cdc-orders", ingest_mode="cdc", source_table="orders"))
        with data_ingest.trace_context(trace_id=trace_id, correlation_id=correlation_id, agent_run_id=run["id"]):
            data_ingest.run_job(job["id"])
            data_ingest.update_job_status(job["id"], JobStatusUpdate(status="failed", error_msg="cursor lag", rows_ingested=0))

        ingest(
            IngestIn(
                events=[
                    CloudEvent(
                        id="evt-ob-1",
                        type="agent.run.failed",
                        subject=run["id"],
                        data={"trace_id": trace_id, "correlation_id": correlation_id, "agent_run_id": run["id"], "reason": "timeout"},
                    )
                ]
            )
        )
        audit_chain.append_audit(
            "agent_run.failed",
            resource_type="agent_run",
            resource_id=run["id"],
            details={"trace_id": trace_id, "correlation_id": correlation_id, "agent_run_id": run["id"]},
        )

        summary = observability_trace_summary(run_id=run["id"], trace_id="", limit=50)

    assert llm["trace_id"] == trace_id
    assert summary["ok"] is True
    assert summary["filters"]["run_id"] == run["id"]
    assert summary["summary"]["failed_runs"] == 1
    assert summary["summary"]["llm_calls"] == 1
    assert summary["summary"]["data_jobs"] == 1
    assert summary["summary"]["events"] == 1
    assert summary["summary"]["audit_entries"] == 1
    assert summary["trace"]["trace_id"] == trace_id
    node_types = {node["type"] for node in summary["root_cause_navigation"]}
    assert {"agent_run", "llm_call", "data_job", "event", "audit"} <= node_types
    assert summary["root_cause"]["risk_level"] == "high"
    assert "/api/v1/system/ops/observability/traces" == summary["agent_consumption"]["api"]


def test_system_pages_observability_page_contract_exposes_trace_navigation():
    from sop_manager.routers.system_pages import system_pages_readiness

    payload = system_pages_readiness(q="日志观测")
    settings = next(item for item in payload["items"] if item["id"] == "settingsObservability")
    assert settings["path"] == "#/settings/observability"

    apis = set(settings["implementation_contract"]["apis"])
    assert "/api/v1/system/ops/observability/traces" in apis
    assert "Trace 关联检索" in settings["capabilities"]
    assert "失败根因导航" in settings["capabilities"]
