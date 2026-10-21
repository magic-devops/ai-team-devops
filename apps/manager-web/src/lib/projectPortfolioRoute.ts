export const projectStatuses = ["active", "planning", "paused", "archived"] as const;
export type ProjectStatus = typeof projectStatuses[number];
export const portfolioRiskCodes = ["blocked", "awaiting_review", "recorded_completed", "overdue_unverified", "acceptance_unavailable", "owner_unavailable", "open_issues"] as const;
export type PortfolioRiskCode = typeof portfolioRiskCodes[number];
export type PortfolioRoute = { projectId: string; query: string; businessId: string; statuses: ProjectStatus[]; risks: PortfolioRiskCode[]; cursor: string };
const clean = (value: string | null, max = 200) => value && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : "";
export function parsePortfolioRoute(hash: string): PortfolioRoute {
  const params = new URLSearchParams(hash.split("?")[1]);
  return { projectId: clean(params.get("project_id"), 128), query: clean(params.get("q")), businessId: clean(params.get("business_id"), 128), statuses: projectStatuses.filter((status) => params.getAll("status").includes(status)), risks: portfolioRiskCodes.filter((risk) => params.getAll("risk").includes(risk)), cursor: clean(params.get("cursor"), 1000) };
}
export function portfolioHash(route: Partial<PortfolioRoute> = {}) {
  const params = new URLSearchParams();
  if (route.query) params.set("q", route.query);
  if (route.businessId) params.set("business_id", route.businessId);
  for (const status of projectStatuses) if (route.statuses?.includes(status)) params.append("status", status);
  for (const risk of portfolioRiskCodes) if (route.risks?.includes(risk)) params.append("risk", risk);
  if (route.cursor) params.set("cursor", route.cursor);
  if (route.projectId) params.set("project_id", route.projectId);
  return `#/projects/portfolio${params.size ? `?${params}` : ""}`;
}
export function safePortfolioReturn(value: string) {
  if (!/^#\/projects\/portfolio(?:\?|$)/.test(value) || value.length > 4000) return null;
  return portfolioHash(parsePortfolioRoute(value));
}
export function routeProjectId(hash: string) { return clean(new URLSearchParams(hash.split("?")[1]).get("project_id"), 128); }
export function portfolioReturnFromHash(hash: string) { return safePortfolioReturn(new URLSearchParams(hash.split("?")[1]).get("return_to") || ""); }
export function preserveProjectContext(target: string, source: string) {
  const [path, query] = target.split("?");
  if (path !== "#/dev-flow" && path !== "#/tasks/execution") return target;
  const params = new URLSearchParams(query);
  const projectId = routeProjectId(source);
  if (projectId) params.set("project_id", projectId);
  const back = portfolioReturnFromHash(source);
  if (back) params.set("return_to", back);
  return `${path}${params.size ? `?${params}` : ""}`;
}
export function projectWorkspaceHash(projectId: string, target = "#/dev-flow?view=overview", background = "") {
  const [path, query] = target.split("?");
  if (path !== "#/dev-flow" && path !== "#/tasks/execution" && path !== "#/ecosystem/a2a/dispatch") throw new Error("invalidProjectTarget");
  const params = new URLSearchParams(query);
  params.set("project_id", projectId);
  const safe = safePortfolioReturn(background);
  if (safe) params.set("return_to", safe); else params.delete("return_to");
  return `${path}?${params}`;
}
