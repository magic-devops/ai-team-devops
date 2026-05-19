export const aiOpsCenterAppManifest = {
  id: "ai-ops-center",
  name: "智能运营中心",
  ownership: "商业计费、安全审计、企业 SSO、通知、Webhook、运行配置、环境运维与智能运维",
  pageRoots: ["src/pages/governance", "src/pages/system", "src/pages/ecosystem"],
  modules: [
    "安全审计、模块治理、页面能力与操作审批",
    "企业 SSO、计费、运行配置和观测",
    "通知、Webhook、通信集成和消息流水",
    "环境运维、智能运维、根因分析、Runbook 与自愈",
  ],
} as const;
