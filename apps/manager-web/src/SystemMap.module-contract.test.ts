import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("SystemMap module contract center", () => {
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const contractPanelSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/SystemModuleContractPanel.tsx"), "utf8");
  const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
  const zhSource = readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8");
  const enSource = readFileSync(resolve(root, "src/i18n/en-US.json"), "utf8");
  const jaSource = readFileSync(resolve(root, "src/i18n/ja-JP.json"), "utf8");

  it("moves manifest, capabilities, and actions into one reusable contract center", () => {
    expect(systemMapSource).toContain("SystemModuleContractPanel");
    expect(contractPanelSource).toContain("export function SystemModuleContractPanel");
    expect(contractPanelSource).toContain('type ContractPanel = "manifest" | "capabilities" | "actions"');
    expect(contractPanelSource).toContain("contractPanel.manifestTitle");
    expect(contractPanelSource).toContain("contractPanel.capabilitiesTitle");
    expect(contractPanelSource).toContain("contractPanel.actionsTitle");
  });

  it("keeps deep links while presenting only one primary menu concept", () => {
    expect(navigationSource).toContain('key: "moduleContract"');
    expect(navigationSource).toContain('path: "#/system-map/contract"');
    expect(navigationSource).toContain('hidden: true, parentKey: "moduleContract"');
    expect(systemMapSource).toContain('window.location.hash = `#/system-map/${panel}`');
    expect(systemMapSource).not.toContain('label: t("nav.moduleManifest"), value: "manifest"');
  });

  it("uses responsive card-first rows instead of fixed mobile grids", () => {
    expect(contractPanelSource).toContain("hidden grid-cols-[1fr_1fr_1.1fr_1.1fr_1.2fr]");
    expect(contractPanelSource).toContain("lg:grid-cols-[1fr_1fr_1.1fr_1.1fr_1.2fr]");
    expect(contractPanelSource).toContain("hidden grid-cols-[1fr_1fr_8rem_11rem]");
    expect(contractPanelSource).toContain("lg:grid-cols-[1fr_1fr_8rem_11rem]");
  });

  it("ships localized labels for the contract center", () => {
    const zh = JSON.parse(zhSource);
    const en = JSON.parse(enSource);
    const ja = JSON.parse(jaSource);
    expect(zh.page.systemMap.moduleContractCenter).toBe("模块契约中心");
    expect(zh.page.systemMap.contractPanel.actionsTitle).toBe("模块动作");
    expect(en.page.systemMap.contractPanel.title).toBe("Module contract center");
    expect(ja.page.systemMap.contractPanel.title).toBe("モジュール契約センター");
  });
});
