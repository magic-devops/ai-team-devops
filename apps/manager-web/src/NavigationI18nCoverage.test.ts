import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
const commandPaletteSource = readFileSync(resolve(root, "src/components/CommandPalette.tsx"), "utf8");
const menuManagementSource = readFileSync(resolve(root, "src/pages/admin/MenuManagement.tsx"), "utf8");
const agentRunsSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/AgentRunsWorkbench.tsx"), "utf8");
const opsCenterSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/OpsCenterWorkbench.tsx"), "utf8");
const llmGatewaySource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/LlmGatewayWorkbench.tsx"), "utf8");
const a2aSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ecosystem/A2aWorkbench.tsx"), "utf8");
const knowledgeGraphSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/KnowledgeGraphWorkbench.tsx"), "utf8");
const dataIngestSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/DataIngestWorkbench.tsx"), "utf8");
const dataQualitySource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/DataQualityWorkbench.tsx"), "utf8");
const metricsSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/MetricsWorkbench.tsx"), "utf8");
const tagSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/TagWorkbench.tsx"), "utf8");
const dataDevSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/DataDevWorkbench.tsx"), "utf8");
const navItemKeys = Array.from(navigationSource.matchAll(/^\s*\{ key: "([^"]+)", path:/gm)).map((match) => match[1]);

describe("navigation i18n coverage", () => {
  for (const locale of ["zh-CN", "en-US", "ja-JP"] as const) {
    it(`translates every registered navigation item in ${locale}`, () => {
      const messages = JSON.parse(readFileSync(resolve(root, `src/i18n/${locale}.json`), "utf8"));
      const missing = navItemKeys.filter((key) => !messages.nav?.[key]);
      expect(missing).toEqual([]);
    });
  }

  it("keeps Menu Management page chrome localized", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"] as const) {
      const messages = JSON.parse(readFileSync(resolve(root, `src/i18n/${locale}.json`), "utf8"));
      expect(messages.nav.menuManagement).toBeTruthy();
      expect(messages.page.menuManagement.title).toBeTruthy();
      expect(messages.page.menuManagement.description).toBeTruthy();
      expect(messages.page.menuManagement.searchPlaceholder).toBeTruthy();
      expect(messages.page.menuManagement.backendStatus).toBeTruthy();
      expect(messages.page.menuManagement.issueError).toBeTruthy();
      expect(messages.page.menuManagement.issueWarning).toBeTruthy();
    }
    expect(commandPaletteSource).toContain("page.${item.key}.description");
    expect(menuManagementSource).toContain('t("page.menuManagement.issueError")');
    expect(menuManagementSource).toContain('t("page.menuManagement.issueWarning")');
    expect(navigationSource).not.toContain('key: "menuManagement", path: "#/admin/menu", el: pageElement(MenuManagementPage), group: "governance", icon: Rows3, category: "module-governance", capability: "governance.menu-management", badge: "new", description:');
  });

  it("localizes focused AgentOps and data governance subviews", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"] as const) {
      const messages = JSON.parse(readFileSync(resolve(root, `src/i18n/${locale}.json`), "utf8"));
      expect(messages.page.agentOps.modulesTitle).toBeTruthy();
      expect(messages.page.agentRuns.workbenchTitle).toBeTruthy();
      expect(messages.page.agentRuns.workbenchDesc).toBeTruthy();
      expect(messages.page.agentRuns.focusedHint).toBeTruthy();
      expect(messages.page.agentRuns.focusedTag).toBeTruthy();
      expect(messages.page.agentRuns.modules.runs.title).toBeTruthy();
      expect(messages.page.agentRuns.modules.runs.description).toBeTruthy();
      expect(messages.page.agentRuns.modules.heartbeat.focus).toBeTruthy();
      expect(messages.page.agentRuns.modules.profiles.focus).toBeTruthy();
      expect(messages.page.agentRuns.metrics.successRate).toBeTruthy();
      expect(messages.page.agentRuns.panels.runs).toBeTruthy();
      expect(messages.page.agentRuns.tabs.heartbeat).toBeTruthy();
      expect(messages.page.agentRuns.retryAction).toBeTruthy();
      expect(messages.page.opsCenter.workbenchTitle).toBeTruthy();
      expect(messages.page.opsCenter.focusedHint).toBeTruthy();
      expect(messages.page.opsCenter.metrics.healthScore).toBeTruthy();
      expect(messages.page.opsCenter.tabs.alerts).toBeTruthy();
      expect(messages.page.opsCenter.modules.pipeline.description).toBeTruthy();
      expect(messages.page.opsCenter.modules["self-heal"].focus).toBeTruthy();
      expect(messages.page.dataIngest.workbenchTitle).toBeTruthy();
      expect(messages.page.dataIngest.focusedHint).toBeTruthy();
      expect(messages.page.dataIngest.tabs.schemas).toBeTruthy();
      expect(messages.page.dataIngest.modules.connectors.title).toBeTruthy();
      expect(messages.page.dataIngest.modules.cdc.focus).toBeTruthy();
      expect(messages.page.dataQuality.tabs.reports).toBeTruthy();
      expect(messages.page.dataQuality.workbenchTitle).toBeTruthy();
      expect(messages.page.dataQuality.focusedHint).toBeTruthy();
      expect(messages.page.dataQuality.modules.rules.title).toBeTruthy();
      expect(messages.page.dataQuality.modules.alerts.focus).toBeTruthy();
      expect(messages.page.dataQuality.reportAverageScore).toBeTruthy();
      expect(messages.page.metricsCenter.tabs.monitor).toBeTruthy();
      expect(messages.page.metricsCenter.workbenchTitle).toBeTruthy();
      expect(messages.page.metricsCenter.focusedHint).toBeTruthy();
      expect(messages.page.metricsCenter.modules.semantic.title).toBeTruthy();
      expect(messages.page.metricsCenter.modules.monitor.focus).toBeTruthy();
      expect(messages.page.metricsCenter.emptyGovernanceTodos).toBeTruthy();
      expect(messages.page.tagService.workbenchTitle).toBeTruthy();
      expect(messages.page.tagService.focusedHint).toBeTruthy();
      expect(messages.page.tagService.tabs.rules).toBeTruthy();
      expect(messages.page.tagService.modules.ontology.title).toBeTruthy();
      expect(messages.page.tagService.modules.profiles.focus).toBeTruthy();
      expect(messages.page.dataDev.focusedHint).toBeTruthy();
      expect(messages.page.dataDev.tabs.agent_feed).toBeTruthy();
      expect(messages.page.dataDev.metrics.readyPackets).toBeTruthy();
      expect(messages.page.dataDev.modules.sql_editor.title).toBeTruthy();
      expect(messages.page.dataDev.modules.spark_jobs.focus).toBeTruthy();
      expect(messages.page.dataDev.modules.schedules.description).toBeTruthy();
      expect(messages.page.opsCenter.workbenchTitle).toBeTruthy();
      expect(messages.page.opsCenter.focusedHint).toBeTruthy();
      expect(messages.page.opsCenter.tabs.pipeline).toBeTruthy();
      expect(messages.page.opsCenter.metrics.healthScore).toBeTruthy();
      expect(messages.page.opsCenter.modules.alerts.output).toBeTruthy();
      expect(messages.page.opsCenter.modules["self-heal"].focus).toBeTruthy();
    }
    expect(agentRunsSource).toContain("page.agentRuns.tabs.${id}");
    expect(agentRunsSource).toContain('t("page.agentRuns.emptyRetry")');
    expect(agentRunsSource).toContain('t("page.agentRuns.workbenchTitle")');
    expect(agentRunsSource).toContain('t("page.agentRuns.focusedHint")');
    expect(agentRunsSource).toContain("page.agentRuns.modules.");
    expect(agentRunsSource).toContain("page.agentRuns.metrics.");
    expect(opsCenterSource).toContain('t("page.opsCenter.workbenchTitle")');
    expect(opsCenterSource).toContain("page.opsCenter.modules.");
    expect(opsCenterSource).toContain("page.opsCenter.metrics.");
    expect(dataIngestSource).toContain("page.dataIngest.tabs.");
    expect(dataIngestSource).toContain("page.dataIngest.modules.");
    expect(dataIngestSource).toContain('t("page.dataIngest.workbenchTitle")');
    expect(dataQualitySource).toContain("page.dataQuality.tabs.");
    expect(dataQualitySource).toContain("page.dataQuality.modules.");
    expect(dataQualitySource).toContain('t("page.dataQuality.workbenchTitle")');
    expect(dataQualitySource).toContain('t("page.dataQuality.reportAverageScore")');
    expect(metricsSource).toContain("page.metricsCenter.tabs.");
    expect(metricsSource).toContain("page.metricsCenter.modules.");
    expect(metricsSource).toContain('t("page.metricsCenter.workbenchTitle")');
    expect(metricsSource).toContain('t("page.metricsCenter.emptyGovernanceTodos")');
    expect(tagSource).toContain("page.tagService.tabs.");
    expect(tagSource).toContain("page.tagService.modules.");
    expect(tagSource).toContain('t("page.tagService.workbenchTitle")');
    expect(dataDevSource).toContain("page.dataDev.tabs.");
    expect(dataDevSource).toContain("page.dataDev.modules.");
    expect(dataDevSource).toContain('t("page.dataDev.title")');
    expect(opsCenterSource).toContain("page.opsCenter.tabs.");
    expect(opsCenterSource).toContain("page.opsCenter.modules.");
    expect(opsCenterSource).toContain('t("page.opsCenter.workbenchTitle")');
  });

  it("localizes LLM gateway focused route chrome", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"] as const) {
      const messages = JSON.parse(readFileSync(resolve(root, `src/i18n/${locale}.json`), "utf8"));
      expect(messages.page.llmGateway.workbenchTitle).toBeTruthy();
      expect(messages.page.llmGateway.focusedHint).toBeTruthy();
      expect(messages.page.llmGateway.metricHealth).toBeTruthy();
      expect(messages.page.llmGateway.tabs.policy).toBeTruthy();
      expect(messages.page.llmGateway.tabs.attribution).toBeTruthy();
      expect(messages.page.llmGateway.tabs.eval).toBeTruthy();
    }
    expect(llmGatewaySource).toContain('t("page.llmGateway.workbenchTitle")');
    expect(llmGatewaySource).toContain("page.llmGateway.tabs.");
  });

  it("localizes A2A protocol focused route chrome", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"] as const) {
      const messages = JSON.parse(readFileSync(resolve(root, `src/i18n/${locale}.json`), "utf8"));
      expect(messages.page.a2aGateway.workbenchTitle).toBeTruthy();
      expect(messages.page.a2aGateway.focusedHint).toBeTruthy();
      expect(messages.page.a2aGateway.metricHealth).toBeTruthy();
      expect(messages.page.a2aGateway.tabLabels.registry).toBeTruthy();
      expect(messages.page.a2aGateway.tabs.registry.title).toBeTruthy();
      expect(messages.page.a2aGateway.tabs.dispatches.focus).toBeTruthy();
    }
    expect(a2aSource).toContain('t("page.a2aGateway.workbenchTitle")');
    expect(a2aSource).toContain("page.a2aGateway.tabLabels.");
    expect(a2aSource).toContain("page.a2aGateway.tabs.");
  });

  it("localizes knowledge graph focused route chrome", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"] as const) {
      const messages = JSON.parse(readFileSync(resolve(root, `src/i18n/${locale}.json`), "utf8"));
      expect(messages.page.knowledgeGraph.workbenchTitle).toBeTruthy();
      expect(messages.page.knowledgeGraph.focusedHint).toBeTruthy();
      expect(messages.page.knowledgeGraph.metricNodes).toBeTruthy();
      expect(messages.page.knowledgeGraph.tabs.build.label).toBeTruthy();
      expect(messages.page.knowledgeGraph.tabs.lineage.title).toBeTruthy();
      expect(messages.page.knowledgeGraph.tabs.profile.focus).toBeTruthy();
    }
    expect(knowledgeGraphSource).toContain('t("page.knowledgeGraph.workbenchTitle")');
    expect(knowledgeGraphSource).toContain("page.knowledgeGraph.tabs.");
  });
});
