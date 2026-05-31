import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("LlmGatewayWorkbench UX contract", () => {
  const source = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/LlmGatewayWorkbench.tsx"), "utf8");

  it("uses mature adaptive components for the main workbench shell", () => {
    expect(source).toContain("Segmented");
    expect(source).toContain("Table");
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
});
