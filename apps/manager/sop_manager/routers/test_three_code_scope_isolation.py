from contextlib import contextmanager

import pytest
from fastapi import HTTPException

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers.auth_sql import User
from sop_manager.routers.data_analytics import (
    DataAssetPatchIn,
    DataDevTemplateIn,
    ReportIn,
    ReportMetaIn,
    analytics_asset_patch,
    analytics_assets,
    analytics_dev_template_upsert,
    analytics_dev_templates,
    analytics_reports,
    create_analytics_report,
    update_analytics_report_meta,
)
from sop_manager.routers.agents import agent_runs
from sop_manager.routers.billing import PaymentIn, list_invoices, record_payment, snapshot_invoice
from sop_manager.routers.notify import InboundAction, InboundMsg, inbound, inbound_action, messages
from sop_manager.routers.ops_center import (
    PipelineCreate,
    PipelineStatus,
    create_pipeline,
    list_pipelines,
    trigger_pipeline,
    update_pipeline_status,
)
from sop_manager.routers.tasks import (
    TaskAgentHeartbeatIn,
    _agent_claims_path,
    _agent_reports_payload,
    _agent_reports_path,
    _append_jsonl,
    _save_agent_claims,
    task_agent_claims,
    task_agent_heartbeat,
)
from sop_manager.routers.usage import UsageIn, record_usage_event, usage_summary_payload


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


def _user(tenant_id: str = "tenant-a") -> User:
    return User(
        id="u-scope",
        tenant_id=tenant_id,
        username="scope-admin",
        password_hash="x",
        role="super_admin",
        status="active",
    )


def test_analytics_reports_do_not_cross_business_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        created = create_analytics_report(
            ReportIn(title="业务 A 报告", question="风险?", metrics_snapshot={"tasks_total": 1}),
            user=_user(),
        )
        assert created["report"]["business_code"] == "biz-a"

    with scoped_project(tmp_path, business="biz-b", project="project-a"):
        payload = analytics_reports(limit=30, status="", source="", q="")

    assert payload["items"] == []


def test_analytics_report_write_rejects_cross_business_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        created = create_analytics_report(
            ReportIn(title="业务 A 报告", question="风险?", metrics_snapshot={"tasks_total": 1}),
            user=_user(),
        )

    with scoped_project(tmp_path, business="biz-b", project="project-a"):
        with pytest.raises(HTTPException) as exc:
            update_analytics_report_meta(created["report"]["id"], ReportMetaIn(title="越权修改"))

    assert exc.value.status_code == 404


def test_notify_messages_do_not_cross_project_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        created = inbound(InboundMsg(channel="ops", sender="alice", text="项目 A 消息"))
        assert created["project_id"] == "project-a"

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        payload = messages(limit=100)

    assert payload["items"] == []


def test_notify_inbound_action_rejects_cross_project_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        created = inbound(InboundMsg(channel="ops", sender="alice", text="请转任务"))

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        with pytest.raises(HTTPException) as exc:
            inbound_action(created["id"], InboundAction(action="task", dry_run=True))

    assert exc.value.status_code == 404


def test_agent_claims_and_reports_do_not_cross_business_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        _save_agent_claims(
            {
                "version": 1,
                "claims": {
                    "claim-a": {
                        "claim_id": "claim-a",
                        "task_id": "T-scope-agent",
                        "agent": "agent-a",
                        "status": "claimed",
                        "lease_expires_at": "2999-01-01T00:00:00Z",
                        "scope": {
                            "tenant_id": "tenant-a",
                            "tenant_code": "tenant-a",
                            "business_code": "biz-a",
                            "project_id": "project-a",
                            "project_code": "project-a",
                        },
                    }
                },
            }
        )
        _append_jsonl(
            _agent_reports_path(),
            {
                "id": "report-a",
                "task_id": "T-scope-agent",
                "claim_id": "claim-a",
                "agent": "agent-a",
                "status": "completed",
                "created_at": "2026-05-21T00:00:00Z",
                "scope": {
                    "tenant_id": "tenant-a",
                    "tenant_code": "tenant-a",
                    "business_code": "biz-a",
                    "project_id": "project-a",
                    "project_code": "project-a",
                },
            },
        )

    with scoped_project(tmp_path, business="biz-b", project="project-a"):
        claims = task_agent_claims(status="all", limit=100)
        reports = _agent_reports_payload(limit=100)

    assert claims["items"] == []
    assert reports["items"] == []


def test_agent_runs_do_not_cross_business_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        _save_agent_claims(
            {
                "version": 1,
                "claims": {
                    "claim-a": {
                        "claim_id": "claim-a",
                        "task_id": "T-scope-agent",
                        "agent": "agent-a",
                        "status": "claimed",
                        "lease_expires_at": "2999-01-01T00:00:00Z",
                        "scope": {
                            "tenant_id": "tenant-a",
                            "tenant_code": "tenant-a",
                            "business_code": "biz-a",
                            "project_id": "project-a",
                            "project_code": "project-a",
                        },
                    }
                },
            }
        )

    with scoped_project(tmp_path, business="biz-b", project="project-a"):
        payload = agent_runs(agent="", status="", limit=100)

    assert payload["items"] == []


def test_agent_heartbeat_rejects_cross_business_claim(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        _save_agent_claims(
            {
                "version": 1,
                "claims": {
                    "claim-a": {
                        "claim_id": "claim-a",
                        "task_id": "T-scope-agent",
                        "agent": "agent-a",
                        "status": "claimed",
                        "lease_expires_at": "2999-01-01T00:00:00Z",
                        "scope": {
                            "tenant_id": "tenant-a",
                            "tenant_code": "tenant-a",
                            "business_code": "biz-a",
                            "project_id": "project-a",
                            "project_code": "project-a",
                        },
                    }
                },
            }
        )

    with scoped_project(tmp_path, business="biz-b", project="project-a"):
        with pytest.raises(HTTPException) as exc:
            task_agent_heartbeat(TaskAgentHeartbeatIn(claim_id="claim-a", agent="agent-a", progress=20))

    assert exc.value.status_code == 404


def test_ops_center_records_do_not_cross_project_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        created = create_pipeline(PipelineCreate(name="项目 A 流水线", environment="prod", steps=["deploy"]))
        assert created["project_id"] == "project-a"

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        payload = list_pipelines()

    assert payload["items"] == []


def test_ops_center_write_rejects_cross_project_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        created = create_pipeline(PipelineCreate(name="项目 A 流水线", environment="prod", steps=["deploy"]))

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        with pytest.raises(HTTPException) as trigger_exc:
            trigger_pipeline(created["id"])
        with pytest.raises(HTTPException) as status_exc:
            update_pipeline_status(created["id"], PipelineStatus(status="failed", duration_s=12, error_msg="x"))

    assert trigger_exc.value.status_code == 404
    assert status_exc.value.status_code == 404


def test_data_governance_records_do_not_cross_business_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        updated = analytics_asset_patch(
            "asset-tasks",
            DataAssetPatchIn(owner="Biz A Data Owner", tags=["biz-a-only"]),
            _user(),
        )
        assert updated["item"]["owner"] == "Biz A Data Owner"

    with scoped_project(tmp_path, business="biz-b", project="project-a"):
        payload = analytics_assets(type="", status="", q="Biz A Data Owner")

    assert payload["items"] == []


def test_data_development_templates_do_not_cross_project_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        created = analytics_dev_template_upsert(
            DataDevTemplateIn(
                id="tpl-project-a-only",
                name="项目 A 专属数据开发模板",
                engine="SQL",
                assets=["asset-tasks"],
                quality_gates=["required_owner"],
            ),
            _user(),
        )
        assert created["item"]["id"] == "tpl-project-a-only"

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        payload = analytics_dev_templates(status="", q="tpl-project-a-only")

    assert payload["items"] == []


def test_usage_ledger_does_not_cross_business_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        record_usage_event(UsageIn(metric="llm_tokens", value=123, source="scope-test", subject="biz-a-only"))

    with scoped_project(tmp_path, business="biz-b", project="project-a"):
        payload = usage_summary_payload(limit=100)

    assert payload["items"] == []
    assert payload["totals"] == {}


def test_billing_invoices_do_not_cross_business_scope(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        created = snapshot_invoice(period="2026-05")
        assert created["invoice"]["business_code"] == "biz-a"

    with scoped_project(tmp_path, business="biz-b", project="project-a"):
        payload = list_invoices(limit=100)

    assert payload["items"] == []


def test_billing_payment_rejects_cross_project_invoice(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        created = snapshot_invoice(period="2026-05")

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        with pytest.raises(HTTPException) as exc:
            record_payment(PaymentIn(invoice_id=created["invoice"]["id"], amount_usd=1, method="manual"))

    assert exc.value.status_code == 404
