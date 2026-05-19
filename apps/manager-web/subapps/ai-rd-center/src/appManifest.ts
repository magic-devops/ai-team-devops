export const aiRdCenterAppManifest = {
  id: "ai-rd-center",
  name: "智能研发中心",
  ownership: "需求、方案、任务、AI 开发、调度、监控、质量评审与研发运维闭环",
  pageRoots: ["src/pages/product", "src/pages/delivery", "src/pages/ai", "src/pages/intelligence"],
  modules: [
    "需求池、需求评审与 AI 拆解",
    "任务执行、问题跟踪、工作流与编排调度",
    "Copilot、Vibe、方案文档与研发搜索",
    "研发质量评审、交付审计与运行看板",
  ],
} as const;
