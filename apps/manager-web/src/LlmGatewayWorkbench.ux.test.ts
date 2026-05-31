import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("LlmGatewayWorkbench UX contract", () => {
  const source = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/LlmGatewayWorkbench.tsx"), "utf8");

  it("uses mature adaptive components for the main workbench shell", () => {
    expect(source).toContain("Segmented");
    expect(source).toContain("Table");
    expect(source).toContain("Drawer");
    expect(source).toContain("Form");
    expect(source).toContain("Steps");
    expect(source).toContain("scroll={{ x:");
  });

  it("keeps critical tables modular and maintainable", () => {
    expect(source).toContain("routeColumns");
    expect(source).toContain("providerColumns");
    expect(source).toContain("throttleColumns");
    expect(source).toContain("locale={{ emptyText:");
  });

  it("keeps AI-assisted governance as a first-class action", () => {
    expect(source).toContain("AiAssistButton");
    expect(source).toContain("AiAssistDrawer");
    expect(source).toContain("llm-gateway");
  });

  it("keeps low-frequency configuration in drawers instead of inline forms", () => {
    expect(source).toContain("编辑生产策略");
    expect(source).toContain("上报 Provider 健康");
    expect(source).toContain("新建模型路由");
    expect(source).toContain("新建限流策略");
    expect(source).toContain("发起调用决策");
    expect(source).toContain("记录模型调用");
    expect(source).toContain("运行成本归因");
    expect(source).toContain("运行模型评测");
    expect(source).toContain("发起 Prompt 审计");
    expect(source).not.toContain("setShowForm");
    expect(source).not.toContain("className=\"input-base");
  });
});
