"""Every governance task input uses the shared strict responsibility contract."""

import importlib

import pytest
from pydantic import ValidationError


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
    "system_ops": "DeploymentPipelineRemediationIn DeploymentRollbackRunbookIn DeploymentRollbackRunbookActionIn DeploymentExecutionAuditTaskIn",
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
