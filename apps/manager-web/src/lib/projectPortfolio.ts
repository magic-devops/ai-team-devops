import { request } from "./http";
import { getSessionRevision, getToken, getWorkspaceScope, setWorkspaceScope } from "./authStorage";
import { prepareDeliveryIntent, type DeliveryIntent } from "./delivery";
import type { ProgressMetrics } from "./deliveryProgress";
import { portfolioRiskCodes, type PortfolioRiskCode, type PortfolioRoute, type ProjectStatus, projectWorkspaceHash } from "./projectPortfolioRoute";
export type ProjectCapabilities = { can_enter: boolean; can_write: boolean; can_dispatch: boolean; can_configure: boolean; can_transition: boolean; can_archive: boolean; can_restore: boolean };
export type PortfolioProject = { id: string; tenant_id: string; tenant_code: string; business_id: string | null; business_code: string; business_name: string; project_code: string; name: string; description: string; project_path: string; vector_db: string; is_template: boolean; template_id: string; status: ProjectStatus; version: number; created_at: string; updated_at: string; permissions: ProjectCapabilities };
export type PortfolioRiskCounts = Record<PortfolioRiskCode, number> & { total_items: number };
export type PortfolioTarget = { project_id: string; kind: "project" | "task" | "requirement" | "issue" | "milestone" | "execution" | "deployment"; view: string; detail: string; requirement_id: string | null; task_id: string | null; issue_id: string | null; milestone_id: string | null; execution_id: string | null; deployment_id?: string | null; diagnosis_id?: string | null };
export type PortfolioRisk = { id: string; entity_kind: "task" | "requirement" | "issue" | "milestone"; entity_id: string; title: string; categories: PortfolioRiskCode[]; due_on: string | null; target: PortfolioTarget };
export type PortfolioMilestone = { id: string; title: string; starts_on: string | null; ends_on: string; target: PortfolioTarget };
export type ProjectLifecycleFacts = { as_of: string; basis: string; metrics: ProgressMetrics; risk_counts: PortfolioRiskCounts; unclosed_intents_total: number };
export type PortfolioRow = { project: PortfolioProject; facts_source: "live"; facts_as_of: string; basis: string; metrics: ProgressMetrics; risk_counts: PortfolioRiskCounts; unclosed_intents_total: number; nearest_milestone: PortfolioMilestone | null; primary_target: PortfolioTarget };
export type PortfolioSummary = { projects_total: number; status_counts: Record<string, number>; metrics: ProgressMetrics; risk_counts: PortfolioRiskCounts };
export type ProjectPortfolio = { as_of: string; rows: PortfolioRow[]; total: number; next_cursor: string | null; limit: number; summary: PortfolioSummary; summary_scope: "filtered_projects"; permissions: { can_create: boolean } };
export type ProjectArchiveRecord = { id: string; at: string; actor_id: string; actor_name: string; reason: string; preview_basis: string; facts: ProjectLifecycleFacts };
export type ProjectPortfolioDetail = PortfolioRow & { risks: PortfolioRisk[]; lifecycle: { last_archive: ProjectArchiveRecord | null } };
export type ProjectLifecycleBlocker = { code: string; message: string; target: PortfolioTarget; status: string; run_id: string | null };
export type ProjectLifecyclePreview = { project_id: string; version: number; from_status: ProjectStatus; target_status: ProjectStatus; reason: string; preview_basis: string; allowed: boolean; blockers: ProjectLifecycleBlocker[]; warnings: { code: string; message: string; count: number }[]; facts: ProjectLifecycleFacts; permissions: { can_transition: boolean } };
export const projectSessionKey = () => JSON.stringify([getToken(), getSessionRevision(), getWorkspaceScope()]);
export function projectHeaders(projectId: string) { return { "X-Project-Id": projectId, "X-Project-Code": projectId, "X-Business-Code": "" }; }
export function fetchProjectPortfolio(route: Partial<PortfolioRoute> = {}, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: "30" });
  if (route.query) params.set("q", route.query);
  if (route.businessId) params.set("business_id", route.businessId);
  for (const status of route.statuses || []) params.append("status", status);
  for (const risk of route.risks || []) params.append("risk", risk);
  if (route.cursor) params.set("cursor", route.cursor);
  return request<ProjectPortfolio>(`/api/v1/projects/portfolio?${params}`, { signal });
}
export function fetchProjectPortfolioDetail(projectId: string, signal?: AbortSignal) {
  return request<ProjectPortfolioDetail>(`/api/v1/projects/${encodeURIComponent(projectId)}/portfolio`, { signal, headers: projectHeaders(projectId) });
}
export function previewProjectLifecycle(projectId: string, targetStatus: ProjectStatus, reason: string, signal?: AbortSignal) {
  if (!reason.trim() || reason.trim().length > 2000) throw new Error("reasonRequired");
  return request<ProjectLifecyclePreview>("/api/v1/delivery/project-lifecycle-preview", { method: "POST", signal, headers: projectHeaders(projectId), body: JSON.stringify({ target_status: targetStatus, reason: reason.trim() }) });
}
export type LifecycleDraft = { projectId: string; targetStatus: ProjectStatus; reason: string; preview: ProjectLifecyclePreview | null; intent: DeliveryIntent };
export function prepareLifecycleSubmission(draft: LifecycleDraft) {
  const preview = draft.preview;
  if (!preview || !preview.allowed || !preview.permissions.can_transition || preview.project_id !== draft.projectId || preview.target_status !== draft.targetStatus || preview.reason !== draft.reason.trim()) throw new Error("previewRequired");
  const payload = { target_status: preview.target_status, reason: preview.reason, preview_basis: preview.preview_basis };
  const intent = prepareDeliveryIntent(draft.intent, "project.lifecycle", payload);
  if (intent.version !== preview.version) throw new Error("previewRequired");
  return { projectId: draft.projectId, action: "project.lifecycle" as const, payload, version: preview.version, key: intent.key, draft: { ...draft, intent } };
}
export function submitProjectCommand(projectId: string, action: "project.lifecycle" | "project.update", payload: Record<string, unknown>, intent: DeliveryIntent) {
  return request("/api/v1/delivery/commands", { method: "POST", headers: projectHeaders(projectId), body: JSON.stringify({ action, payload, expected_version: intent.version, idempotency_key: intent.key }) });
}
export function portfolioTargetHash(target: PortfolioTarget, background: string) {
  const params = new URLSearchParams({ view: target.view });
  if (target.requirement_id) { params.set("requirement", target.requirement_id); params.set("detail", target.detail); }
  if (target.task_id) params.set("task", target.task_id);
  if (target.issue_id) params.set("issue", target.issue_id);
  if (target.diagnosis_id) params.set("diagnosis_id", target.diagnosis_id);
  if (target.milestone_id) { params.set("milestone_id", target.milestone_id); params.set("scope_id", target.milestone_id); }
  if (target.execution_id) params.set("execution_id", target.execution_id);
  if (target.deployment_id) { params.set("view", "releases"); params.set("deployment_id", target.deployment_id); }
  return projectWorkspaceHash(target.project_id, target.kind !== "execution" && target.task_id && !target.requirement_id ? `#/tasks/execution?task_id=${encodeURIComponent(target.task_id)}` : `#/dev-flow?${params}`, background);
}
export function enterPortfolioProject(project: PortfolioProject, target?: PortfolioTarget, background = "") {
  if (!project.permissions.can_enter || (target && target.project_id !== project.id)) throw new Error("projectUnavailable");
  setWorkspaceScope({ tenantCode: project.tenant_code, businessCode: project.business_code || project.business_id, projectId: project.id, projectCode: project.project_code });
  return target ? portfolioTargetHash(target, background) : projectWorkspaceHash(project.id, undefined, background);
}
export function activeRiskCategories(counts: PortfolioRiskCounts) { return portfolioRiskCodes.filter((code) => counts[code] > 0); }
