import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
const commandPaletteSource = readFileSync(resolve(root, "src/components/CommandPalette.tsx"), "utf8");
const menuManagementSource = readFileSync(resolve(root, "src/pages/admin/MenuManagement.tsx"), "utf8");
const agentRunsSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/AgentRunsWorkbench.tsx"), "utf8");
const llmGatewaySource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/LlmGatewayWorkbench.tsx"), "utf8");
const a2aSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ecosystem/A2aWorkbench.tsx"), "utf8");
const dataQualitySource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/DataQualityWorkbench.tsx"), "utf8");
const metricsSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/MetricsWorkbench.tsx"), "utf8");
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
      expect(messages.page.agentRuns.tabs.heartbeat).toBeTruthy();
      expect(messages.page.agentRuns.retryAction).toBeTruthy();
      expect(messages.page.dataQuality.tabs.reports).toBeTruthy();
      expect(messages.page.dataQuality.reportAverageScore).toBeTruthy();
      expect(messages.page.metricsCenter.tabs.monitor).toBeTruthy();
      expect(messages.page.metricsCenter.emptyGovernanceTodos).toBeTruthy();
    }
    expect(agentRunsSource).toContain('t("page.agentRuns.tabs.heartbeat")');
    expect(agentRunsSource).toContain('t("page.agentRuns.emptyRetry")');
    expect(dataQualitySource).toContain("page.dataQuality.tabs.");
    expect(dataQualitySource).toContain('t("page.dataQuality.reportAverageScore")');
    expect(metricsSource).toContain('t("page.metricsCenter.tabs.monitor")');
    expect(metricsSource).toContain('t("page.metricsCenter.emptyGovernanceTodos")');
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
});
