import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("SystemMap readiness task generation", () => {
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const experiencePrioritySource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/SystemExperiencePriorityPanel.tsx"), "utf8");
  const apiSource = readFileSync(resolve(root, "src/lib/api.ts"), "utf8");
  const zhSource = readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8");

  it("exposes the readiness task API contract in frontend code", () => {
    expect(apiSource).toContain("systemPagesReadinessTasks");
    expect(apiSource).toContain("/api/v1/system/pages/readiness/tasks");
    expect(systemMapSource).toContain("api.systemPagesReadinessTasks");
  });

  it("exposes production readiness as a first-class SystemMap data source", () => {
    expect(apiSource).toContain("systemPagesProductionReadiness");
    expect(apiSource).toContain("/api/v1/system/pages/production-readiness");
    expect(systemMapSource).toContain("api.systemPagesProductionReadiness");
    expect(systemMapSource).toContain("productionReadinessTitle");
    expect(systemMapSource).toContain("productionColumns");
  });

  it("adds focused experience governance instead of extending the page as one long matrix", () => {
    expect(apiSource).toContain("systemPagesExperienceReview");
    expect(apiSource).toContain("/api/v1/system/pages/experience-review");
    expect(apiSource).toContain("systemPagesExperienceTasks");
    expect(apiSource).toContain("/api/v1/system/pages/experience-review/tasks");
    expect(systemMapSource).toContain("api.systemPagesExperienceReview");
    expect(systemMapSource).toContain("api.systemPagesExperienceTasks");
    expect(systemMapSource).toContain("readinessDetailView");
    expect(systemMapSource).toContain("experienceColumns");
    expect(systemMapSource).toContain("SystemExperiencePriorityPanel");
    expect(systemMapSource).toContain("focusedExperienceTasks");
    expect(experiencePrioritySource).toContain("export function SystemExperiencePriorityPanel");
    expect(experiencePrioritySource).toContain("experiencePriorityQueue");
    expect(experiencePrioritySource).toContain("experienceAiChangePack");
    expect(experiencePrioritySource).toContain("weakestExperienceDimension");
    expect(experiencePrioritySource).toContain("onPreviewModuleTask");
    expect(experiencePrioritySource).toContain("onCreateModuleTask");
  });

  it("provides product controls for previewing and creating readiness tasks", () => {
    expect(systemMapSource).toContain("includeCompleteReadiness");
    expect(systemMapSource).toContain("previewReadinessTasks");
    expect(systemMapSource).toContain("createReadinessTasks");
    expect(systemMapSource).toContain("readinessTaskResult");
  });

  it("ships localized labels for the readiness task workflow", () => {
    const zh = JSON.parse(zhSource);
    expect(zh.page.systemMap.includeCompleteReadiness).toBe("包含完整模块");
    expect(zh.page.systemMap.previewReadinessTasks).toBe("预览完整度任务");
    expect(zh.page.systemMap.createReadinessTasks).toBe("生成完整度任务");
    expect(zh.page.systemMap.productionReadinessTitle).toBe("生产就绪矩阵");
    expect(zh.page.systemMap.productionStageValue.production_ready).toBe("生产就绪");
    expect(zh.page.systemMap.experienceReviewTitle).toBe("体验与产品化治理");
    expect(zh.page.systemMap.readinessDetailViewValue.experience).toBe("体验治理");
    expect(zh.page.systemMap.previewExperienceTasks).toBe("预览体验任务");
    expect(zh.page.systemMap.createExperienceTasks).toBe("生成体验任务");
    expect(zh.page.systemMap.experiencePriorityTitle).toBe("体验治理优先队列");
    expect(zh.page.systemMap.previewModuleExperienceTask).toBe("预览该模块任务");
    expect(zh.page.systemMap.experienceAiChangePack).toBe("AI 改造包");
  });
});
