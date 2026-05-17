/** 旧 console_id / #/legacy/* 书签 → 新平台 hash */
export const CONSOLE_ID_ROUTE_TARGETS: Record<string, string> = {
  dashboard: "#/dashboard",
  "dev-flow": "#/dev-flow",
  analytics: "#/analytics",
  requirements: "#/requirements",
  requirement_pool: "#/requirements/pool",
  smart_review: "#/requirements/review",
  task_generation: "#/requirements/generation",
  batch_governance: "#/requirements/batch",
  plan: "#/tasks/scheduler",
  iteration: "#/tasks/sprints",
  sprints: "#/tasks/sprints",
  "sprints-mgr": "#/tasks/sprints",
  issues: "#/issues",
  search: "#/search",
  vibe: "#/vibe",
  "spec-editor": "#/intelligence/specs",
  docker: "#/ops/env",
  cli: "#/platforms/cli",
  specs: "#/intelligence/specs",
  "design-docs": "#/intelligence/design-docs",
  "knowledge-mgr": "#/intelligence/kb",
  rules: "#/intelligence/rules",
  custom: "#/marketplace",
  agents: "#/platforms/agents",
  skills: "#/skills-hub",
  "skill-repo": "#/skills-hub/repos",
  models: "#/platforms/models",
  orchestration: "#/orchestration",
  mcp: "#/platforms/mcp",
  logs: "#/settings/observability",
  "logs-viewer": "#/settings/observability",
  notify: "#/notify",
  config: "#/projects/delivery-kit",
  system: "#/settings",
  auth: "#/organization",
  tenants: "#/organization",
  "db-config": "#/intelligence/datasources",
  health: "#/settings/runtime",
  webhook: "#/notify/webhooks",
  audit: "#/audit",
};

export function resolveConsoleIdTarget(consoleId: string): string {
  const key = (consoleId || "dashboard").trim().toLowerCase();
  return CONSOLE_ID_ROUTE_TARGETS[key] ?? "#/system-map";
}

/** 将 #/legacy/foo 等旧 hash 规范为新平台路由；无需单独 Bridge 页 */
export function normalizeAppHash(hash: string): string | null {
  const h = hash || "#/dashboard";
  const legacyMatch = h.match(/^#\/legacy\/?([^?]*)/);
  if (legacyMatch) {
    const id = decodeURIComponent(legacyMatch[1] || "dashboard");
    return resolveConsoleIdTarget(id);
  }
  if (h.startsWith("#/legacy-hub")) return "#/system-map";
  return null;
}

export function applyHashNormalization(): boolean {
  const next = normalizeAppHash(window.location.hash);
  if (next && next !== window.location.hash) {
    window.location.replace(`${window.location.pathname}${window.location.search}${next}`);
    return true;
  }
  return false;
}
