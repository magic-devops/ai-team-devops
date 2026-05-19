export const aiFoundationAppManifest = {
  id: "ai-foundation",
  name: "智能基础服务",
  ownership: "AI 底座、知识记忆、技能插件、Agent、模型网关、A2A 与平台资产市场",
  pageRoots: ["src/pages/ai", "src/pages/ecosystem", "src/pages/intelligence"],
  modules: [
    "知识库 / RAG / 记忆 / 规则",
    "技能、插件、市场与 CLI 工具",
    "Agent 运行、MCP、A2A 与模型网关",
    "基础服务治理与平台能力运营",
  ],
} as const;
