"""Every governance task input uses the shared strict responsibility contract."""

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.routing import Match

_INPUTS = {
    "a2a_gateway": "GovernanceTasksIn TrustTasksIn SlaTasksIn ExecutionWindowTasksIn",
    "agents": "AgentRebalanceTasksIn",
    "audit": "AuditTaskIn",
    "copilot": "PlanTasksIn",
    "data_analytics": "DataDevTasksIn DataDevScheduleIn DataDevScheduleActionIn DataDevEvidenceTasksIn DataDevRunbookIn DataGovernanceTasksIn ReportActionTasksIn AttributionTasksIn ReportIntelligenceTasksIn DecisionTasksIn DataBlueprintTasksIn",
    "data_quality": "AlertTasksIn QualityImpactTasksIn QualityRcaTasksIn QualityForecastTasksIn",
    "dev_flow": "DevFlowOpsTasksIn",
    "hermes": "BlueprintTaskIn",
    "issues": "IssueOpsTasksIn",
    "llm_gateway_v2": "GovernanceTasksIn PromptAuditIn CostAttributionIn ModelEvalIn",
    "metadata_management": "MetadataGovernanceTasksIn",
    "metrics_service": "MetricsGovernanceTasksIn",
    "notify": "InboundAction",
    "ops_center": "RcaInsightTasksIn AlertSloEscalationRunIn OpsStrategyLinkageRunIn SelfHealTasksIn",
    "organization": "AccessReviewTasksIn",
    "pages_productization": "InteractionTaskIn InteractionOpsActionIn",
    "platforms_api": "PlatformOpsTasksBody",
    "requirements": "RequirementOpsTasksIn GenerateTasksBody",
    "sprints": "SprintOpsTasksIn",
    "sso": "SsoRiskTasksIn SsoRiskEscalationPolicyIn SsoRiskRunbookIn SsoRiskRunbookActionIn",
    "system_pages": "BacklogTaskIn ReadinessTaskIn ProductionReadinessTaskIn ExperienceTaskIn FrontendPerformanceTaskIn IsolationTaskIn IsolationScanTaskIn IsolationScanCompareTaskIn GovernanceTaskIn GovernanceTaskBulkUpdateIn ModuleActionExecuteIn",
    "tag_service": "TagGovernanceTasksIn",
    "tasks": "TaskCreate TaskUpdate TaskBulkUpdate TaskSchedulerRunbookIn TaskSchedulerInsightTasksIn QualityTasksIn TaskDependencyTasksIn",
    "tenants": "ProjectBootstrapTasksBody ProjectOpsTasksBody",
    "usage": "UsageAlertTasksIn",
    "workflow": "WorkflowOpsTasksIn",
}


@pytest.mark.parametrize("module,name", [(module, name) for module, names in _INPUTS.items() for name in names.split()])
def test_governance_task_inputs_do_not_accept_role_labels_or_nullable_owner(module, name):
    model = getattr(importlib.import_module("sop_manager.routers." + module), name)
    assert model.model_fields["owner_id"].default == ""
    assert "assigned_to" not in model.model_fields
    with pytest.raises(ValidationError, match="assigned_to is read-only"):
        model.model_validate({"assigned_to": "Coder"})
    with pytest.raises(ValidationError) as error:
        model.model_validate({"owner_id": None})
    assert any(row["loc"] == ("owner_id",) for row in error.value.errors())


@pytest.mark.parametrize(
    "name,path",
    [
        ("DeploymentPipelineRemediationIn", "/deployment-pipelines/old/remediation"),
        ("DeploymentRollbackRunbookIn", "/deployment-rollback-runbooks"),
        ("DeploymentRollbackRunbookActionIn", "/deployment-rollback-runbooks/old/action"),
        ("DeploymentExecutionAuditTaskIn", "/deployment-execution-audits/old/tasks"),
    ],
)
def test_retired_deployment_task_inputs_and_creation_endpoints_are_absent(name, path):
    module = importlib.import_module("sop_manager.routers.system_ops")
    assert not hasattr(module, name)

    app = FastAPI()
    app.include_router(module.router)
    url = "/api/v1/system/ops" + path
    scope = {"type": "http", "path": url, "method": "POST", "root_path": ""}
    assert all(route.matches(scope)[0] != Match.FULL for route in app.routes)
    with TestClient(app) as client:
        response = client.post(url, json={"assigned_to": "Coder", "owner_id": None, "dry_run": False})
    assert response.status_code == 404
