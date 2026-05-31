import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ecosystem/A2aWorkbench.tsx"), "utf8");
const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
const systemPagesSource = readFileSync(resolve(root, "../manager/sop_manager/routers/system_pages.py"), "utf8");

describe("A2A workbench UX contract", () => {
  it("routes protocol modules into focused subpages", () => {
    expect(navigationSource).toContain('subnav("ecosystem/a2a", "registry", "negotiate", "sla", "windows", "dispatch", "evidence")');
    expect(navigationSource).toContain('key: "a2aRegistry"');
    expect(navigationSource).toContain('key: "a2aNegotiate"');
    expect(navigationSource).toContain('key: "a2aSla"');
    expect(navigationSource).toContain('key: "a2aWindows"');
    expect(navigationSource).toContain('key: "a2aDispatch"');
    expect(navigationSource).toContain('key: "a2aEvidence"');
    expect(navigationSource).toContain('pageElement(A2aWorkbenchPage, { focused: true, initialTab: "registry" })');
    expect(navigationSource).toContain('hidden: true, parentKey: "a2aGateway"');
  });

  it("uses the focused route state to remove repeated gateway chrome", () => {
    expect(source).toContain("A2A_TAB_META");
    expect(source).toContain("activeMeta");
    expect(source).toContain("showGlobalMetrics");
    expect(source).toContain('title={focused ? activeMeta.title : "A2A 网关"}');
    expect(source).toContain("当前聚焦");
    expect(source).toContain("返回 A2A 网关");
    expect(source).not.toContain("focused: _focused");
  });

  it("keeps System Pages governance aware of A2A submodules", () => {
    expect(systemPagesSource).toContain('"a2aGateway": [');
    expect(systemPagesSource).toContain('("registry", "Agent 注册")');
    expect(systemPagesSource).toContain('("negotiate", "能力协商")');
    expect(systemPagesSource).toContain('("dispatch", "任务分发")');
    expect(systemPagesSource).toContain('("evidence", "执行证据")');
    expect(systemPagesSource).toContain('("a2aGateway", "registry"): "#/ecosystem/a2a/registry"');
  });
});
