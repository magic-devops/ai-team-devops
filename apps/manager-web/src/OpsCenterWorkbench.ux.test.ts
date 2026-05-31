import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/OpsCenterWorkbench.tsx"), "utf8");

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
    expect(source).toContain("AI 分析当前模块");
    expect(source).not.toContain("border-b-2 transition ${tab === t.id");
  });

  it("keeps alert source setup in a focused drawer flow", () => {
    expect(source).toContain("alertSourceDrawerOpen");
    expect(source).toContain("alertSourceFocusedDrawer");
    expect(source).toContain("setAlertSourceDrawerOpen(true)");
    expect(source).toContain("配置生产告警源");
    expect(source).toContain("<Steps");
    expect(source).toContain("<Form");
    expect(source).toContain("createAlertSource.mutate()");
    expect(source).toContain("只保存 SecretRef，不保存明文密钥");
    expect(source).not.toContain("告警源名称 *");
    expect(source).not.toContain("<textarea className=\"input-base min-h-32 w-full font-mono text-xs\" placeholder=\"样例 payload JSON，用于无外网或 Webhook dry-run 测试\"");
  });

  it("keeps alert noise policy and silence setup in a focused drawer flow", () => {
    expect(source).toContain("alertNoiseConfigDrawer");
    expect(source).toContain("alertNoiseFocusedDrawer");
    expect(source).toContain("setAlertNoiseConfigDrawer(\"policy\")");
    expect(source).toContain("setAlertNoiseConfigDrawer(\"silence\")");
    expect(source).toContain("配置降噪策略");
    expect(source).toContain("配置告警静默");
    expect(source).toContain("createAlertNoisePolicy.mutate()");
    expect(source).toContain("createAlertSilence.mutate()");
    expect(source).not.toContain("<input className=\"input-base w-full\" placeholder=\"策略名称\"");
    expect(source).not.toContain("<textarea className=\"input-base min-h-16 w-full font-mono text-xs\" placeholder=\"匹配器 key=value，每行一个\"");
  });

  it("keeps SLO escalation setup in a focused drawer flow", () => {
    expect(source).toContain("alertSloEscalationDrawerOpen");
    expect(source).toContain("alertSloEscalationFocusedDrawer");
    expect(source).toContain("setAlertSloEscalationDrawerOpen(true)");
    expect(source).toContain("配置 SLO 自动升级");
    expect(source).toContain("当前升级策略");
    expect(source).toContain("saveAlertSloEscalationPolicy.mutate()");
    expect(source).toContain("runAlertSloEscalation.mutate(true)");
    expect(source).toContain("runAlertSloEscalation.mutate(false)");
    expect(source).not.toContain("<select className=\"input-base\" value={alertSloEscalationForm.min_risk_level}");
    expect(source).not.toContain("<textarea className=\"input-base mt-2 min-h-16 w-full text-xs\" value={alertSloEscalationForm.note}");
  });

  it("keeps strategy canary audit setup in a focused drawer flow", () => {
    expect(source).toContain("alertStrategyCanaryDrawerOpen");
    expect(source).toContain("alertStrategyCanaryFocusedDrawer");
    expect(source).toContain("setAlertStrategyCanaryDrawerOpen(true)");
    expect(source).toContain("配置策略灰度审计");
    expect(source).toContain("审计配置摘要");
    expect(source).toContain("runAlertStrategyCanaryAudit.mutate()");
    expect(source).toContain("updateAlertStrategyCanary.mutate");
    expect(source).not.toContain("<select className=\"input-base\" value={alertStrategyCanaryForm.policy_id}");
    expect(source).not.toContain("<textarea className=\"input-base mt-2 min-h-16 w-full text-xs\" value={alertStrategyCanaryForm.note}");
  });

  it("keeps cross-module linkage setup in a focused drawer flow", () => {
    expect(source).toContain("opsStrategyLinkageDrawerOpen");
    expect(source).toContain("opsStrategyLinkageFocusedDrawer");
    expect(source).toContain("setOpsStrategyLinkageDrawerOpen(true)");
    expect(source).toContain("配置跨模块联动");
    expect(source).toContain("联动配置摘要");
    expect(source).toContain("runOpsStrategyLinkage.mutate(true)");
    expect(source).toContain("runOpsStrategyLinkage.mutate(false)");
    expect(source).not.toContain("<input className=\"input-base\" placeholder=\"动作 create_task,im_notify\" value={opsStrategyLinkageForm.actions}");
    expect(source).not.toContain("<textarea className=\"input-base mt-2 min-h-16 w-full text-xs\" value={opsStrategyLinkageForm.note}");
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
});
