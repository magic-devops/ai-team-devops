import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("SystemMap isolation task generation", () => {
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const apiSource = readFileSync(resolve(root, "src/lib/api.ts"), "utf8");
  const zhSource = readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8");

  it("exposes the isolation task API contract in frontend code", () => {
    expect(apiSource).toContain("systemPagesIsolationTasks");
    expect(apiSource).toContain("/api/v1/system/pages/isolation-audit/tasks");
    expect(systemMapSource).toContain("api.systemPagesIsolationTasks");
  });

  it("provides product controls for previewing and creating isolation tasks", () => {
    expect(systemMapSource).toContain("includeProtectedIsolation");
    expect(systemMapSource).toContain("previewIsolationTasks");
    expect(systemMapSource).toContain("createIsolationTasks");
    expect(systemMapSource).toContain("isolationTaskResult");
  });

  it("ships localized labels for the isolation task workflow", () => {
    const zh = JSON.parse(zhSource);
    expect(zh.page.systemMap.includeProtectedIsolation).toBe("包含已保护域");
    expect(zh.page.systemMap.previewIsolationTasks).toBe("预览隔离任务");
    expect(zh.page.systemMap.createIsolationTasks).toBe("生成隔离任务");
  });
});
