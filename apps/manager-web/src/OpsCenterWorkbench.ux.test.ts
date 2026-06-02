import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/OpsCenterWorkbench.tsx"), "utf8");
const alertSourcesSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/ops-center/OpsCenterAlertSourcesPanel.tsx"), "utf8");

describe("OpsCenter workbench UX contract", () => {
  it("keeps OpsCenter modules routable and focused", () => {
    expect(source).toContain("OPS_CENTER_TAB_ROUTES");
    expect(source).toContain("readOpsCenterTabFromHash");
    expect(source).toContain("updateOpsCenterHash");
    expect(source).toContain("#/system/ops-center/pipeline");
    expect(source).toContain("#/system/ops-center/alerts");
    expect(source).toContain("#/system/ops-center/rca");
    expect(source).toContain("#/system/ops-center/runbook");
    expect(source).toContain("#/system/ops-center/self-heal");
  });

  it("uses a mature responsive module switch instead of hand-rolled tabs", () => {
    expect(source).toContain("Segmented");
    expect(source).toContain("opsCenterModeSwitch");
    expect(source).toContain("opsCenterModuleQuickSummary");
    expect(source).toContain("lazy(() => import(\"./ops-center/OpsCenterAlertSourcesPanel\")");
    expect(source).toContain("<Suspense fallback=");
    expect(source).toContain("AI 分析当前模块");
    expect(source).not.toContain("border-b-2 transition ${tab === t.id");
  });

  it("keeps alert source setup in a focused drawer flow", () => {
    expect(source).toContain("alertSourceDrawerOpen");
    expect(source).toContain("OpsCenterAlertSourcesPanel");
    expect(source).not.toContain("alertSourceFocusedDrawer");
    expect(alertSourcesSource).toContain("export function OpsCenterAlertSourcesPanel");
    expect(alertSourcesSource).toContain("alertSourceFocusedDrawer");
    expect(alertSourcesSource).toContain("setAlertSourceDrawerOpen(true)");
    expect(alertSourcesSource).toContain("配置生产告警源");
    expect(alertSourcesSource).toContain("<Steps");
    expect(alertSourcesSource).toContain("<Form");
    expect(alertSourcesSource).toContain("createAlertSource.mutate()");
    expect(alertSourcesSource).toContain("只保存 SecretRef，不保存明文密钥");
    expect(alertSourcesSource).not.toContain("告警源名称 *");
    expect(alertSourcesSource).not.toContain("<textarea className=\"input-base min-h-32 w-full font-mono text-xs\" placeholder=\"样例 payload JSON，用于无外网或 Webhook dry-run 测试\"");
  });

  it("keeps alert noise policy and silence setup in a focused drawer flow", () => {
    expect(source).toContain("alertNoiseConfigDrawer");
    expect(source).toContain("OpsCenterAlertSourcesPanel");
    expect(source).not.toContain("alertNoiseFocusedDrawer");
    expect(alertSourcesSource).toContain("alertNoiseFocusedDrawer");
    expect(alertSourcesSource).toContain("setAlertNoiseConfigDrawer(\"policy\")");
    expect(alertSourcesSource).toContain("setAlertNoiseConfigDrawer(\"silence\")");
    expect(alertSourcesSource).toContain("配置降噪策略");
    expect(alertSourcesSource).toContain("配置告警静默");
    expect(alertSourcesSource).toContain("createAlertNoisePolicy.mutate()");
    expect(alertSourcesSource).toContain("createAlertSilence.mutate()");
    expect(alertSourcesSource).not.toContain("<input className=\"input-base w-full\" placeholder=\"策略名称\"");
    expect(alertSourcesSource).not.toContain("<textarea className=\"input-base min-h-16 w-full font-mono text-xs\" placeholder=\"匹配器 key=value，每行一个\"");
  });

  it("keeps SLO escalation setup in a focused drawer flow", () => {
    expect(source).toContain("alertSloEscalationDrawerOpen");
    expect(source).toContain("OpsCenterAlertSourcesPanel");
    expect(source).not.toContain("alertSloEscalationFocusedDrawer");
    expect(alertSourcesSource).toContain("alertSloEscalationFocusedDrawer");
    expect(alertSourcesSource).toContain("setAlertSloEscalationDrawerOpen(true)");
    expect(alertSourcesSource).toContain("配置 SLO 自动升级");
    expect(alertSourcesSource).toContain("当前升级策略");
    expect(alertSourcesSource).toContain("saveAlertSloEscalationPolicy.mutate()");
    expect(alertSourcesSource).toContain("runAlertSloEscalation.mutate(true)");
    expect(alertSourcesSource).toContain("runAlertSloEscalation.mutate(false)");
    expect(alertSourcesSource).not.toContain("<select className=\"input-base\" value={alertSloEscalationForm.min_risk_level}");
    expect(alertSourcesSource).not.toContain("<textarea className=\"input-base mt-2 min-h-16 w-full text-xs\" value={alertSloEscalationForm.note}");
  });

  it("keeps strategy canary audit setup in a focused drawer flow", () => {
    expect(source).toContain("alertStrategyCanaryDrawerOpen");
    expect(source).toContain("OpsCenterAlertSourcesPanel");
    expect(source).not.toContain("alertStrategyCanaryFocusedDrawer");
    expect(alertSourcesSource).toContain("alertStrategyCanaryFocusedDrawer");
    expect(alertSourcesSource).toContain("setAlertStrategyCanaryDrawerOpen(true)");
    expect(alertSourcesSource).toContain("配置策略灰度审计");
    expect(alertSourcesSource).toContain("审计配置摘要");
    expect(alertSourcesSource).toContain("runAlertStrategyCanaryAudit.mutate()");
    expect(alertSourcesSource).toContain("updateAlertStrategyCanary.mutate");
    expect(alertSourcesSource).not.toContain("<select className=\"input-base\" value={alertStrategyCanaryForm.policy_id}");
    expect(alertSourcesSource).not.toContain("<textarea className=\"input-base mt-2 min-h-16 w-full text-xs\" value={alertStrategyCanaryForm.note}");
  });

  it("keeps cross-module linkage setup in a focused drawer flow", () => {
    expect(source).toContain("opsStrategyLinkageDrawerOpen");
    expect(source).toContain("OpsCenterAlertSourcesPanel");
    expect(source).not.toContain("opsStrategyLinkageFocusedDrawer");
    expect(alertSourcesSource).toContain("opsStrategyLinkageFocusedDrawer");
    expect(alertSourcesSource).toContain("setOpsStrategyLinkageDrawerOpen(true)");
    expect(alertSourcesSource).toContain("配置跨模块联动");
    expect(alertSourcesSource).toContain("联动配置摘要");
    expect(alertSourcesSource).toContain("runOpsStrategyLinkage.mutate(true)");
    expect(alertSourcesSource).toContain("runOpsStrategyLinkage.mutate(false)");
    expect(alertSourcesSource).not.toContain("<input className=\"input-base\" placeholder=\"动作 create_task,im_notify\" value={opsStrategyLinkageForm.actions}");
    expect(alertSourcesSource).not.toContain("<textarea className=\"input-base mt-2 min-h-16 w-full text-xs\" value={opsStrategyLinkageForm.note}");
  });

  it("keeps RCA insight configuration in a focused drawer flow", () => {
    expect(source).toContain("rcaInsightDrawerOpen");
    expect(source).toContain("rcaInsightFocusedDrawer");
    expect(source).toContain("setRcaInsightDrawerOpen(true)");
    expect(source).toContain("配置智能根因归因");
    expect(source).toContain("归因范围");
    expect(source).toContain("任务化参数");
    expect(source).toContain("analyzeRcaInsights.mutate()");
    expect(source).toContain("createRcaInsightTasks.mutate(true)");
    expect(source).toContain("createRcaInsightTasks.mutate(false)");
    expect(source).not.toContain("<input className=\"input-base\" placeholder=\"Agent Run ID\" value={rcaInsightFilter.run_id}");
    expect(source).not.toContain("<select className=\"input-base\" value={rcaInsightFilter.priority}");
  });

  it("keeps manual RCA creation in a focused drawer flow", () => {
    expect(source).toContain("rcaCreateDrawerOpen");
    expect(source).toContain("rcaCreateFocusedDrawer");
    expect(source).toContain("setRcaCreateDrawerOpen(true)");
    expect(source).toContain("新建 RCA");
    expect(source).toContain("事件信息");
    expect(source).toContain("根因与处置");
    expect(source).toContain("创建后闭环");
    expect(source).toContain("createRca.mutate()");
    expect(source).not.toContain("<input className=\"input-base\" placeholder=\"事件 ID *\" value={rcaForm.incident_id}");
    expect(source).not.toContain("<textarea className=\"input-base w-full h-16 resize-none\" placeholder=\"根因描述 *\"");
  });

  it("keeps Runbook version editing in a focused drawer flow", () => {
    expect(source).toContain("runbookEditorDrawerOpen");
    expect(source).toContain("runbookEditorFocusedDrawer");
    expect(source).toContain("setRunbookEditorDrawerOpen(true)");
    expect(source).toContain("新建 Runbook");
    expect(source).toContain("编辑 Runbook 版本");
    expect(source).toContain("Runbook 身份");
    expect(source).toContain("执行步骤");
    expect(source).toContain("版本证据");
    expect(source).toContain("saveRb.mutate()");
    expect(source).not.toContain("<input className=\"input-base\" placeholder=\"Runbook 名称 *\" value={rbForm.name}");
    expect(source).not.toContain("<textarea className=\"input-base w-full h-24 resize-none\" placeholder=\"操作步骤（每行一步）\"");
  });

  it("keeps self-heal policy and signal setup in focused drawer flows", () => {
    expect(source).toContain("selfHealPolicyDrawerOpen");
    expect(source).toContain("selfHealSignalDrawerOpen");
    expect(source).toContain("selfHealPolicyFocusedDrawer");
    expect(source).toContain("selfHealSignalFocusedDrawer");
    expect(source).toContain("setSelfHealPolicyDrawerOpen(true)");
    expect(source).toContain("setSelfHealSignalDrawerOpen(true)");
    expect(source).toContain("新建自愈策略");
    expect(source).toContain("配置自愈评估信号");
    expect(source).toContain("createSh.mutate()");
    expect(source).toContain("evaluateSh.mutate()");
    expect(source).toContain("createHealTasks.mutate(true)");
    expect(source).toContain("createHealTasks.mutate(false)");
    expect(source).not.toContain("<input className=\"input-base w-full\" placeholder=\"触发条件 * (如 cpu > 90)\"");
    expect(source).not.toContain("<textarea\n                  className=\"input-base min-h-32 w-full font-mono text-xs\"");
  });

  it("keeps self-heal guarded action handling in a focused drawer flow", () => {
    expect(source).toContain("selfHealActionDrawerOpen");
    expect(source).toContain("selectedHealActionId");
    expect(source).toContain("selectedHealAction");
    expect(source).toContain("selfHealActionFocusedDrawer");
    expect(source).toContain("处置自愈护栏动作");
    expect(source).toContain("处理动作");
    expect(source).toContain("actionStepIndex");
    expect(source).toContain("approveAction.mutate(selectedHealAction.id)");
    expect(source).toContain("applyAction.mutate(selectedHealAction.id)");
    expect(source).toContain("verifyAction.mutate(selectedHealAction.id)");
    expect(source).toContain("rollbackAction.mutate(selectedHealAction.id)");
    expect(source).not.toContain("onClick={() => approveAction.mutate(item.id)}");
    expect(source).not.toContain("onClick={() => applyAction.mutate(item.id)}");
    expect(source).not.toContain("onClick={() => verifyAction.mutate(item.id)}");
    expect(source).not.toContain("onClick={() => rollbackAction.mutate(item.id)}");
  });
});
