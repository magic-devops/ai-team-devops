export const aiDataCenterAppManifest = {
  id: "ai-data-center",
  name: "智能数据中心",
  ownership: "数据源、数据接入、元数据、数据开发、调度、指标、标签、质量和数据服务",
  pageRoots: ["src/pages/data", "src/pages/intelligence"],
  modules: [
    "数据源管理、数据接入与数据交换",
    "元数据、血缘、数据治理与数据质量",
    "数据开发、调度运维、指标中心与标签服务",
    "洞察报告、NLQ 问数与数据服务发布",
  ],
} as const;
