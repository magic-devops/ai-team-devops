/**
 * @ai_safe_edit
 *  - 改 BASE_URL：仅改本文件常量
 *  - 新接口：在末尾加导出 async 函数；TanStack Query 的 hooks 在 hooks/ 目录
 */
import { clearSession, getToken, getWorkspaceScope, setUserSession, setWorkspaceScope, type SessionPayload } from "./authStorage";

const BASE = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  const scope = getWorkspaceScope();
  if (scope.tenantCode) h["X-Tenant-Code"] = scope.tenantCode;
  if (scope.businessCode) h["X-Business-Code"] = scope.businessCode;
  if (scope.projectId) h["X-Project-Id"] = scope.projectId;
  if (scope.projectCode) h["X-Project-Code"] = scope.projectCode;
  return h;
}

function isMissingProjectScopeError(status: number, body: string) {
  return status === 400 && (
    body.includes("X-Project-Id") ||
    body.includes("绑定同步分区") ||
    body.includes("绑定项目作用域")
  );
}

function isSessionUnauthorized(status: number, body: string) {
  return status === 401 && (
    body.includes("Token 已过期") ||
    body.includes("Token 无效") ||
    body.includes("Token 用户标识无效") ||
    body.includes("Token 用户加载失败") ||
    body.includes("用户不存在或已禁用")
  );
}

function isAuthProbePath(path: string) {
  return path === "/api/v1/auth/me";
}

function clearStaleSessionOnUnauthorized(path: string, status: number, body: string) {
  if (isAuthProbePath(path) && isSessionUnauthorized(status, body) && getToken()) clearSession();
}

function redirectToLogin() {
  if (typeof window === "undefined" || !window.location) return;
  if (window.location.pathname.endsWith("/login.html")) return;
  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(`/login.html?redirect=${encodeURIComponent(redirect)}`);
}

async function bindDefaultProjectScope(tryHydrate = true): Promise<boolean> {
  if (getWorkspaceScope().projectId || !getToken()) return false;
  if (tryHydrate) {
    const hydrated = await hydrateSessionScope();
    if (hydrated) return true;
  }
  const r = await fetch(BASE + "/api/v1/projects", { headers: authHeaders() });
  if (!r.ok) return false;
  const projects = await r.json().catch(() => []) as Array<{
    id?: string;
    tenant_code?: string;
    business_code?: string;
    business_id?: string;
    project_code?: string;
  }>;
  const first = Array.isArray(projects) ? projects.find((item) => item?.id) : undefined;
  if (!first?.id) return false;
  setWorkspaceScope({
    tenantCode: first.tenant_code || null,
    businessCode: first.business_code || first.business_id || null,
    projectId: first.id,
    projectCode: first.project_code || first.id,
  });
  return true;
}

let sessionHydration: Promise<boolean> | null = null;

async function hydrateSessionScope(): Promise<boolean> {
  if (getWorkspaceScope().projectId || !getToken()) return false;
  if (!sessionHydration) {
    sessionHydration = (async () => {
      const token = getToken();
      if (!token) return false;
      const r = await fetch(BASE + "/api/v1/auth/me", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => r.statusText);
        clearStaleSessionOnUnauthorized("/api/v1/auth/me", r.status, txt);
        return false;
      }
      const data = await r.json().catch(() => null) as SessionPayload | null;
      if (!data) return false;
      setUserSession(data);
      return Boolean(data.workspace_scope?.project_id || data.default_project_id);
    })().finally(() => {
      sessionHydration = null;
    });
  }
  return sessionHydration;
}

async function request<T>(path: string, init?: RequestInit, retriedProjectScope = false): Promise<T> {
  if (!path.startsWith("/api/v1/auth/") && getToken() && !getWorkspaceScope().projectId) {
    await hydrateSessionScope();
  }
  const baseHeaders = authHeaders();
  const extra = (init?.headers || {}) as Record<string, string>;
  const r = await fetch(BASE + path, {
    ...init,
    headers: { ...baseHeaders, ...extra },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => r.statusText);
    const shouldRedirectLogin = isAuthProbePath(path) && isSessionUnauthorized(r.status, txt);
    clearStaleSessionOnUnauthorized(path, r.status, txt);
    if (shouldRedirectLogin) redirectToLogin();
    if (!retriedProjectScope && path !== "/api/v1/projects" && isMissingProjectScopeError(r.status, txt)) {
      const bound = await bindDefaultProjectScope(false);
      if (bound) return request<T>(path, init, true);
    }
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; version?: string }>("/api/v1/health"),
  dashboardSummary: () => request<any>("/api/v1/dashboard/summary"),
  dashboardCharts: () =>
    request<{
      ok: boolean;
      requirement_status: Array<{ name: string; value: number }>;
      task_status: Array<{ name: string; value: number }>;
      task_priority: Array<{ name: string; value: number }>;
      requirement_priority: Array<{ name: string; value: number }>;
      risk_levels: Array<{ name: string; value: number }>;
      activity_trend: { days: string[]; series: Array<{ name: string; data: number[] }> };
    }>("/api/v1/dashboard/charts"),
  hermesBlueprint: () => request<any>("/api/v1/hermes/blueprint"),
  hermesBlueprintTasks: (body: { ids?: string[]; dry_run?: boolean; priority?: string; assigned_to?: string; dev_tool?: string }) =>
    request<any>("/api/v1/hermes/blueprint/tasks", { method: "POST", body: JSON.stringify(body) }),
  tenants: () => request<any[]>("/api/v1/tenants"),
  createTenant: (body: { name: string; slug: string; plan?: string }) =>
    request<any>("/api/v1/tenants", { method: "POST", body: JSON.stringify(body) }),
  updateTenant: (tenantId: string, body: { name?: string; plan?: string; status?: string; config?: Record<string, unknown> }) =>
    request<any>(`/api/v1/tenants/${encodeURIComponent(tenantId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTenant: (tenantId: string) =>
    request<any>(`/api/v1/tenants/${encodeURIComponent(tenantId)}`, { method: "DELETE" }),
  projects: () => request<any[]>("/api/v1/projects"),
  projectsSummary: () => request<any>("/api/v1/projects/summary"),
  createProject: (body: Record<string, unknown>) =>
    request<any>("/api/v1/projects", { method: "POST", body: JSON.stringify(body) }),
  updateProject: (projectId: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteProject: (projectId: string) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
  projectTemplates: () => request<any[]>("/api/v1/projects/templates"),
  projectSetTemplate: (projectId: string, isTemplate: boolean) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/set-template?is_template=${isTemplate ? "true" : "false"}`, {
      method: "PATCH",
    }),
  cloneProject: (templateId: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(templateId)}/clone`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cloneProjectPreview: (templateId: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(templateId)}/clone-preview`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  projectOnboarding: (projectId: string) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/onboarding`),
  projectReview: (projectId: string) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/review`),
  projectOpsPlan: (projectId: string) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/ops-plan`),
  projectOpsTasks: (projectId: string, body: { dry_run?: boolean; priority?: string; assigned_to?: string; categories?: string[] }) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/ops-tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  projectBootstrapTasks: (projectId: string, body: { dry_run?: boolean; priority?: string; assigned_to?: string }) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/bootstrap-tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  requirements: (params: { status?: string; priority?: string; q?: string; assigned_agent?: string; dev_tool?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) qs.set(key, String(value));
    }
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<any[]>(`/api/v1/requirements${suffix}`);
  },
  requirementsSummary: () => request<any>("/api/v1/requirements/summary"),
  requirementOpsPlan: () => request<any>("/api/v1/requirements/ops-plan"),
  requirementOpsTasks: (body: {
    dry_run?: boolean;
    priority?: string;
    assigned_to?: string;
    categories?: string[];
    limit?: number;
  }) => request<any>("/api/v1/requirements/ops-tasks", { method: "POST", body: JSON.stringify(body) }),
  parseRequirementsDocument: (body: {
    text: string;
    filename?: string;
    mode?: string;
    agent?: string;
    cli?: string;
    auto_priority?: boolean;
    auto_acceptance?: boolean;
    assigned_agent?: string;
    dev_tool?: string;
  }) =>
    request<any>("/api/v1/requirements/parse-document", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  batchCreateRequirements: (body: { items: Array<Record<string, unknown>> }) =>
    request<any>("/api/v1/requirements/batch", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createRequirement: (body: {
    title: string;
    description?: string;
    priority?: string;
    acceptance_criteria?: string[];
    tags?: string[];
    assigned_agent?: string;
    dev_tool?: string;
  }) =>
    request<any>("/api/v1/requirements", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateRequirement: (id: string, patch: Record<string, unknown>) =>
    request<any>(`/api/v1/requirements/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  bulkUpdateRequirements: (body: { ids: string[]; status?: string; priority?: string; assigned_agent?: string; dev_tool?: string }) =>
    request<any>("/api/v1/requirements/bulk", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteRequirement: (id: string) =>
    request<any>(`/api/v1/requirements/${encodeURIComponent(id)}`, { method: "DELETE" }),
  generateRequirementTasks: (
    id: string,
    body: {
      dry_run?: boolean;
      mode?: string;
      max_tasks?: number;
      sprint_id?: string;
      assigned_to?: string;
      dev_tool?: string;
      create_dependencies?: boolean;
    },
  ) =>
    request<any>(`/api/v1/requirements/${encodeURIComponent(id)}/generate-tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reviewRequirement: (id: string) =>
    request<any>(`/api/v1/requirements/${encodeURIComponent(id)}/review`, { method: "POST" }),
  applyRequirementReview: (
    id: string,
    body: { acceptance_criteria?: string[]; tags?: string[]; human_notes?: string },
  ) =>
    request<any>(`/api/v1/requirements/${encodeURIComponent(id)}/apply-review`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  contextMe: () => request<any>("/api/v1/context/me"),
  tasks: (params: { sprint_id?: string; status?: string; priority?: string; source?: string; q?: string } | string = {}) => {
    const normalized = typeof params === "string" ? { sprint_id: params } : params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(normalized)) {
      if (value) qs.set(key, String(value));
    }
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<any[]>(`/api/v1/tasks${suffix}`);
  },
  tasksSummary: () => request<any>("/api/v1/tasks/summary"),
  tasksCharts: () =>
    request<{
      ok: boolean;
      by_status: Array<{ name: string; value: number }>;
      by_priority: Array<{ name: string; value: number }>;
      by_source: Array<{ name: string; value: number }>;
      by_tool: Array<{ name: string; value: number }>;
    }>("/api/v1/tasks/charts"),
  copilotSummarize: (items: string[]) =>
    request<{ ok?: boolean; summary?: string; answer?: string }>("/api/v1/copilot/summarize", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  copilotSuggest: (goal: string, context = "") =>
    request<any>("/api/v1/copilot/suggest", {
      method: "POST",
      body: JSON.stringify({ goal, context }),
    }),
  updateTask: (id: string, patch: Record<string, unknown>) =>
    request<any>(`/api/v1/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  bulkUpdateTasks: (body: { ids: string[]; status?: string; priority?: string; assigned_to?: string }) =>
    request<any>("/api/v1/tasks/bulk", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  dispatchTasks: (body: { ids?: string[]; dry_run?: boolean; max_items?: number; include_blocked?: boolean; strategy?: string }) =>
    request<any>("/api/v1/tasks/dispatch-plan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskSchedulerPlan: (body: {
    ids?: string[];
    dry_run?: boolean;
    max_items?: number;
    max_parallel?: number;
    include_blocked?: boolean;
    policy?: string;
    event?: string;
    agent_pool?: string[];
  }) =>
    request<any>("/api/v1/tasks/scheduler/plan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskSchedulerRuns: (limit = 20, q = "", includeArchived = false) => {
    const qs = new URLSearchParams({ limit: String(limit), include_archived: includeArchived ? "true" : "false" });
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/tasks/scheduler/runs?${qs}`);
  },
  taskSchedulerRunAction: (scheduleId: string, body: { action: string; dry_run?: boolean; policy?: string; max_parallel?: number; include_blocked?: boolean; note?: string }) =>
    request<any>(`/api/v1/tasks/scheduler/runs/${encodeURIComponent(scheduleId)}/action`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskSchedulerOpsSummary: () => request<any>("/api/v1/tasks/scheduler/ops-summary"),
  taskSchedulerRunbook: (body: Record<string, unknown>) =>
    request<any>("/api/v1/tasks/scheduler/runbook", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskSchedulerInsights: (body: Record<string, unknown>) =>
    request<any>("/api/v1/tasks/scheduler/insights", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskSchedulerInsightTasks: (body: Record<string, unknown>) =>
    request<any>("/api/v1/tasks/scheduler/insights/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskAgentFeed: (limit = 10, agent = "", includeBlocked = false) => {
    const qs = new URLSearchParams({ limit: String(limit), include_blocked: includeBlocked ? "true" : "false" });
    if (agent) qs.set("agent", agent);
    return request<any>(`/api/v1/tasks/agent-feed?${qs}`);
  },
  taskAgentClaims: (status = "active", limit = 50) =>
    request<any>(`/api/v1/tasks/agent-feed/claims?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(String(limit))}`),
  taskAgentClaim: (body: { task_id?: string; packet_id?: string; agent?: string; dev_tool?: string; lease_seconds?: number; force?: boolean; auto_start?: boolean; note?: string }) =>
    request<any>("/api/v1/tasks/agent-feed/claim", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskAgentExecutionPlan: (body: { claim_id?: string; task_id?: string; agent?: string; include_context?: boolean }) =>
    request<any>("/api/v1/tasks/agent-feed/execution-plan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskAgentPlan: (taskId: string, claimId = "", agent = "", includeContext = true) => {
    const qs = new URLSearchParams({ include_context: includeContext ? "true" : "false" });
    if (claimId) qs.set("claim_id", claimId);
    if (agent) qs.set("agent", agent);
    return request<any>(`/api/v1/tasks/${encodeURIComponent(taskId)}/agent-plan?${qs.toString()}`);
  },
  taskAgentHeartbeat: (body: { claim_id?: string; task_id?: string; agent?: string; progress?: number; state?: string; status_message?: string; extend_seconds?: number }) =>
    request<any>("/api/v1/tasks/agent-feed/heartbeat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskAgentReport: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/tasks/${encodeURIComponent(id)}/agent-report`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskAgentReports: (limit = 100, status = "", agent = "", taskId = "", q = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (status) qs.set("status", status);
    if (agent) qs.set("agent", agent);
    if (taskId) qs.set("task_id", taskId);
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/tasks/agent-feed/reports?${qs.toString()}`);
  },
  taskQualityPolicy: () => request<any>("/api/v1/tasks/quality/policy"),
  taskQualityPolicyUpdate: (body: Record<string, unknown>) =>
    request<any>("/api/v1/tasks/quality/policy", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  taskQualitySummary: (limit = 100) =>
    request<any>(`/api/v1/tasks/quality/summary?limit=${encodeURIComponent(String(limit))}`),
  taskQualityTasks: (body: Record<string, unknown>) =>
    request<any>("/api/v1/tasks/quality/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskQuality: (id: string) => request<any>(`/api/v1/tasks/${encodeURIComponent(id)}/quality`),
  taskQualityEvaluate: (body: Record<string, unknown>) =>
    request<any>("/api/v1/tasks/quality/evaluate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  taskDependencies: () => request<any>("/api/v1/tasks/dependencies"),
  taskDependencyTasks: (body: Record<string, unknown>) =>
    request<any>("/api/v1/tasks/dependencies/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addTaskDependency: (id: string, body: { target_id: string; type?: string; note?: string }) =>
    request<any>(`/api/v1/tasks/${encodeURIComponent(id)}/dependencies`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteTaskDependency: (id: string, targetId: string, type = "") => {
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    return request<any>(`/api/v1/tasks/${encodeURIComponent(id)}/dependencies/${encodeURIComponent(targetId)}${qs}`, { method: "DELETE" });
  },
  reorderTasksBoard: (groups: Record<string, string[]>) =>
    request<any>("/api/v1/tasks/reorder-board", {
      method: "POST",
      body: JSON.stringify({ groups }),
    }),
  createTask: (body: {
    title: string;
    description?: string;
    priority?: string;
    sprint_id?: string;
    assigned_to?: string;
  }) =>
    request<any>("/api/v1/tasks", { method: "POST", body: JSON.stringify(body) }),
  deleteTask: (id: string) =>
    request<any>(`/api/v1/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  sprints: () =>
    request<{ items: any[]; total: number }>("/api/v1/sprints").then((r) => r.items ?? []),
  sprintProgress: (id: string) =>
    request<any>(`/api/v1/sprints/${encodeURIComponent(id)}/progress`),
  sprintsSummary: (projectId?: string) => {
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return request<{
      ok: boolean;
      total: number;
      by_status: Record<string, number>;
      active_sprint: Record<string, unknown> | null;
      active_progress: Record<string, unknown> | null;
    }>(`/api/v1/sprints/summary${qs}`);
  },
  sprintBurndown: (sprintId: string) =>
    request<{
      ok: boolean;
      sprint: Record<string, unknown>;
      stats: Record<string, unknown>;
      ideal: Array<{ day: number; remaining: number }>;
      actual: Array<{ day: number; remaining: number }>;
      span_days: number;
      elapsed_days: number;
    }>(`/api/v1/sprints/${encodeURIComponent(sprintId)}/burndown`),
  sprintOpsPlan: (sprintId = "") => {
    const qs = sprintId ? `?sprint_id=${encodeURIComponent(sprintId)}` : "";
    return request<any>(`/api/v1/sprints/ops-plan${qs}`);
  },
  sprintOpsTasks: (body: {
    dry_run?: boolean;
    priority?: string;
    assigned_to?: string;
    sprint_id?: string;
    categories?: string[];
    limit?: number;
  }) => request<any>("/api/v1/sprints/ops-tasks", { method: "POST", body: JSON.stringify(body) }),
  workflowTypes: () => request<any[]>("/api/v1/workflows/types"),
  workflowSummary: () => request<any>("/api/v1/workflows/summary"),
  workflowCharts: () =>
    request<{
      ok: boolean;
      by_status: Array<{ name: string; value: number }>;
      by_type: Array<{ name: string; value: number }>;
    }>("/api/v1/workflows/charts"),
  workflowInstances: (limit = 100, status = "", type = "", q = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (status) qs.set("status", status);
    if (type) qs.set("type", type);
    if (q) qs.set("q", q);
    return request<{ ok: boolean; items: any[]; total: number }>(`/api/v1/workflows/instances?${qs}`);
  },
  workflowEvents: (limit = 100, workflowId = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (workflowId) qs.set("workflow_id", workflowId);
    return request<{ ok: boolean; items: any[]; total: number }>(`/api/v1/workflows/events?${qs}`);
  },
  workflowEngineStatus: () =>
    request<{
      ok: boolean;
      configured_engine: string;
      active_engine: string;
      temporal_host: string;
      temporal_namespace: string;
      temporal_connected: boolean;
      probe: { ok: boolean; reason: string };
    }>("/api/v1/workflows/engine/status"),
  workflowOpsPlan: () => request<any>("/api/v1/workflows/ops-plan"),
  workflowOpsTasks: (body: { dry_run?: boolean; priority?: string; assigned_to?: string }) =>
    request<any>("/api/v1/workflows/ops-tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  workflowDetail: (workflowId: string, eventsLimit = 80) =>
    request<{
      ok: boolean;
      engine?: string;
      instance: Record<string, unknown>;
      events: Array<Record<string, unknown>>;
      signals: unknown[];
      result?: unknown;
      error?: string;
      dag?: {
        workflow_type: string;
        current_step_id: string;
        steps: Array<Record<string, unknown>>;
        edges?: Array<{ source: string; target: string }>;
      };
      temporal?: Record<string, unknown>;
    }>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/detail?events_limit=${eventsLimit}`),
  startWorkflow: (body: { type: string; args?: Record<string, unknown> }) =>
    request<any>("/api/v1/workflows/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  signalWorkflow: (workflowId: string, body: { signal: string; payload?: Record<string, unknown> }) =>
    request<any>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/signal`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelWorkflow: (workflowId: string) =>
    request<any>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/cancel`, { method: "POST" }),
  bulkCancelWorkflows: (workflowIds: string[]) =>
    request<any>("/api/v1/workflows/bulk-cancel", {
      method: "POST",
      body: JSON.stringify({ workflow_ids: workflowIds }),
    }),
  marketplaceList: (q = "", type = "", sort = "rating") => {
    const qs = new URLSearchParams({ q, sort, size: "60" });
    if (type) qs.set("type", type);
    return request<{ items: any[]; total: number }>(`/api/v1/marketplace/packages?${qs}`);
  },
  marketplaceSummary: () => request<any>("/api/v1/marketplace/summary"),
  marketplaceInstalled: () => request<any[]>("/api/v1/marketplace/installed"),
  marketplaceRefresh: () => request<any>("/api/v1/marketplace/refresh", { method: "POST" }),
  marketplaceVerify: (name: string) =>
    request<any>(`/api/v1/marketplace/packages/${encodeURIComponent(name)}/verify`),
  marketplaceRatings: (name: string, limit = 20) =>
    request<{ ok: boolean; items: any[]; total: number }>(
      `/api/v1/marketplace/packages/${encodeURIComponent(name)}/ratings?limit=${encodeURIComponent(String(limit))}`,
    ),
  marketplaceInstall: (body: { name: string; version?: string; verify_signature?: boolean }) =>
    request<any>("/api/v1/marketplace/install", { method: "POST", body: JSON.stringify(body) }),
  marketplaceUninstall: (name: string) =>
    request<any>(`/api/v1/marketplace/installed/${encodeURIComponent(name)}`, { method: "DELETE" }),
  marketplaceRate: (body: { package: string; score: number; comment?: string }) =>
    request<any>("/api/v1/marketplace/rate", { method: "POST", body: JSON.stringify(body) }),
  marketplaceLegacyList: (q = "") =>
    request<{ items: any[]; total: number }>(
      `/api/v1/marketplace/packages?q=${encodeURIComponent(q)}`,
    ),
  auditState: () => request<any>("/api/v1/audit/chain/state"),
  auditVerify: () => request<any>("/api/v1/audit/chain/verify"),
  auditSummary: () =>
    request<{
      ok: boolean;
      total: number;
      failures: number;
      last_24h?: number;
      last_7d?: number;
      by_action: Record<string, number>;
      by_resource: Record<string, number>;
    }>("/api/v1/audit/summary"),
  auditCharts: () =>
    request<{
      ok: boolean;
      activity_trend: { days: string[]; series: Array<{ name: string; data: number[] }> };
      by_action: Array<{ name: string; value: number }>;
      by_resource: Array<{ name: string; value: number }>;
      outcome: Array<{ name: string; value: number }>;
    }>("/api/v1/audit/charts"),
  auditTimeline: (limit = 80, projectId?: string) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (projectId) qs.set("project_id", projectId);
    return request<{
      ok: boolean;
      total: number;
      days: Array<{ date: string; count: number; items: Array<Record<string, unknown>> }>;
    }>(`/api/v1/audit/timeline?${qs}`);
  },
  auditEvents: (q = "", page = 1, size = 100) => {
    const qs = new URLSearchParams({ q, page: String(page), size: String(size) });
    return request<{ ok: boolean; items: any[]; total: number }>(`/api/v1/audit/events?${qs}`);
  },
  auditRecord: (body: { action: string; resource_type?: string; resource_id?: string; project_id?: string; details?: Record<string, unknown> }) =>
    request<any>("/api/v1/audit/record", { method: "POST", body: JSON.stringify(body) }),
  auditEventTask: (auditId: string, body: { dry_run?: boolean; priority?: string; assigned_to?: string; dev_tool?: string }) =>
    request<any>(`/api/v1/audit/events/${encodeURIComponent(auditId)}/task`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  auditExportCsvUrl: () => "/api/v1/audit/export.csv",
  copilotAsk: (query: string, context?: Record<string, unknown>, session_id = "", run_id = "") =>
    request<any>("/api/v1/copilot/ask", {
      method: "POST",
      body: JSON.stringify({ query, session_id, run_id, ...(context ? { context } : {}) }),
    }),
  copilotSessions: (limit = 100) =>
    request<{ ok: boolean; items: any[]; total: number }>(
      `/api/v1/copilot/sessions?limit=${encodeURIComponent(String(limit))}`,
    ),
  copilotSession: (sessionId: string, limit = 100) =>
    request<{ ok: boolean; session_id: string; items: any[]; total: number }>(
      `/api/v1/copilot/sessions/${encodeURIComponent(sessionId)}?limit=${encodeURIComponent(String(limit))}`,
    ),
  copilotCommands: (q = "", limit = 30) => {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    return request<{ ok: boolean; items: any[]; total: number }>(`/api/v1/copilot/commands?${qs}`);
  },
  copilotResolveCommand: (query: string, limit = 8) =>
    request<{ ok: boolean; best?: any; items: any[]; total: number }>("/api/v1/copilot/commands/resolve", {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    }),
  copilotPlan: (body: { query: string; context?: Record<string, unknown>; session_id?: string; run_id?: string }) =>
    request<any>("/api/v1/copilot/plan", { method: "POST", body: JSON.stringify(body) }),
  copilotPlanTasks: (body: {
    query?: string;
    plan: Record<string, unknown>;
    commands?: Record<string, unknown>[];
    dry_run?: boolean;
    priority?: string;
    assigned_to?: string;
    dev_tool?: string;
  }) =>
    request<any>("/api/v1/copilot/plan/tasks", { method: "POST", body: JSON.stringify(body) }),
  knowledgeSearch: (q: string, category?: string) => {
    const qs = new URLSearchParams({ q });
    if (category) qs.set("category", category);
    return request<any[]>(`/api/v1/knowledge/search?${qs}`);
  },
  knowledgeCreate: (body: { title: string; content: string; category?: string; tags?: string[] }) =>
    request<any>("/api/v1/knowledge", { method: "POST", body: JSON.stringify(body) }),
  rules: () => request<any[]>("/api/v1/rules"),
  ruleCreate: (body: { rule: string; category?: string; source?: string; confidence?: number }) =>
    request<any>("/api/v1/rules", { method: "POST", body: JSON.stringify(body) }),
  reflectionDistill: (body: { days?: number; category?: string; limit?: number; dry_run?: boolean }) =>
    request<any>("/api/v1/reflections/distill", { method: "POST", body: JSON.stringify(body) }),
  reflectionProposals: (limit = 100) =>
    request<any[]>(`/api/v1/reflections/proposals?limit=${encodeURIComponent(String(limit))}`),
  reflectionReviewProposal: (proposalId: string, body: { status: "approved" | "rejected"; note?: string; reviewer?: string }) =>
    request<any>(`/api/v1/reflections/proposals/${encodeURIComponent(proposalId)}/review`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  memoryHealth: () => request<any>("/api/v1/memory/health"),
  memoryRecent: (limit = 30) =>
    request<any>(`/api/v1/memory/recent?limit=${encodeURIComponent(String(limit))}`),
  memorySearch: (q: string, limit = 20) =>
    request<any>(
      `/api/v1/memory/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`,
    ),
  memoryAdd: (body: { content: string; kind?: string; metadata?: Record<string, unknown> }) =>
    request<any>("/api/v1/memory", { method: "POST", body: JSON.stringify(body) }),
  dbDrivers: () => request<any>("/api/v1/db-config/drivers"),
  dbConnections: () => request<{ items: any[]; total: number }>("/api/v1/db-config/connections"),
  dbUpsertConnection: (name: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/db-config/connections/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  dbTestConnection: (name: string, url = "") => {
    const qs = url ? `?url=${encodeURIComponent(url)}` : "";
    return request<any>(`/api/v1/db-config/connections/${encodeURIComponent(name)}/test${qs}`, {
      method: "POST",
    });
  },
  dbDeleteConnection: (name: string) =>
    request<{ ok: boolean }>(`/api/v1/db-config/connections/${encodeURIComponent(name)}`, { method: "DELETE" }),
  eventsList: (limit = 100, since = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (since) qs.set("since", since);
    return request<{ items: any[]; total: number; cursor: string }>(`/api/v1/events?${qs}`);
  },
  usageCharts: (limit = 5000) =>
    request<{
      ok: boolean;
      by_metric: Array<{ name: string; value: number }>;
      by_source: Array<{ name: string; value: number }>;
      activity_trend: { days: string[]; series: Array<{ name: string; data: number[] }> };
    }>(`/api/v1/usage/charts?limit=${encodeURIComponent(String(limit))}`),
  usageSummary: (limit = 5000, since = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (since) qs.set("since", since);
    return request<any>(`/api/v1/usage/summary?${qs}`);
  },
  usageQuota: () => request<any>("/api/v1/usage/quota"),
  usageSetQuota: (limits: Record<string, number>) =>
    request<any>("/api/v1/usage/quota", { method: "PUT", body: JSON.stringify({ limits }) }),
  usageAlerts: (limit = 5000) =>
    request<{ ok: boolean; items: any[]; total: number; summary: Record<string, number> }>(
      `/api/v1/usage/alerts?limit=${encodeURIComponent(String(limit))}`,
    ),
  usageAlertTasks: (body: { ids?: string[]; dry_run?: boolean; priority?: string; assigned_to?: string; dev_tool?: string }) =>
    request<any>("/api/v1/usage/alerts/tasks", { method: "POST", body: JSON.stringify(body) }),
  billingSubscription: () => request<any>("/api/v1/billing/subscription"),
  billingPlans: () => request<{ ok: boolean; items: any[] }>("/api/v1/billing/plans"),
  billingAlerts: () => request<{ ok: boolean; items: any[]; total: number }>("/api/v1/billing/alerts"),
  billingSummary: () => request<any>("/api/v1/billing/summary"),
  billingInvoice: (period = "") => {
    const qs = period ? `?period=${encodeURIComponent(period)}` : "";
    return request<any>(`/api/v1/billing/invoice${qs}`);
  },
  billingInvoiceCsvUrl: (period = "") =>
    `/api/v1/billing/invoice/export.csv${period ? `?period=${encodeURIComponent(period)}` : ""}`,
  billingInvoices: (limit = 20) =>
    request<{ ok: boolean; items: any[]; total: number }>(
      `/api/v1/billing/invoices?limit=${encodeURIComponent(String(limit))}`,
    ),
  billingSnapshotInvoice: (period = "") => {
    const qs = period ? `?period=${encodeURIComponent(period)}` : "";
    return request<any>(`/api/v1/billing/invoice/snapshot${qs}`, { method: "POST" });
  },
  billingUpdateInvoiceStatus: (invoiceId: string, status: string, note = "") =>
    request<any>(`/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    }),
  billingPayments: (invoiceId = "", limit = 50) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (invoiceId) qs.set("invoice_id", invoiceId);
    return request<{ ok: boolean; items: any[]; total: number }>(`/api/v1/billing/payments?${qs}`);
  },
  billingRecordPayment: (body: {
    invoice_id: string;
    amount_usd: number;
    method?: string;
    external_ref?: string;
    note?: string;
  }) =>
    request<any>("/api/v1/billing/payments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  billingUpdateSubscription: (body: {
    plan: string;
    status?: string;
    billing_email?: string;
    renewal_at?: string;
    auto_apply_quota?: boolean;
    metadata?: Record<string, unknown>;
  }) =>
    request<any>("/api/v1/billing/subscription", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  systemPages: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value && value !== "all") qs.set(key, value);
    });
    return request<any>(`/api/v1/system/pages${qs.toString() ? `?${qs}` : ""}`);
  },
  systemPagesValidate: () => request<any>("/api/v1/system/pages/validate"),
  systemPagesManifest: () => request<any>("/api/v1/system/pages/manifest"),
  systemPagesManifestMe: () => request<any>("/api/v1/system/pages/manifest/me"),
  systemPagesActions: () => request<any>("/api/v1/system/pages/actions"),
  systemPagesActionsMe: () => request<any>("/api/v1/system/pages/actions/me"),
  systemPagesActionPolicy: () => request<any>("/api/v1/system/pages/actions/policy"),
  systemPagesActionPolicyUpdate: (body: {
    enabled?: boolean;
    mode?: string;
    approval_threshold?: number;
    alert_threshold?: number;
    block_threshold?: number;
    notify_channels?: string[];
    notes?: string;
  }) =>
    request<any>("/api/v1/system/pages/actions/policy", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  systemPagesActionApprovals: (status = "pending", limit = 100) =>
    request<any>(`/api/v1/system/pages/actions/approvals?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(String(limit))}`),
  systemPagesActionApprovalReview: (approvalId: string, body: { status: "approved" | "rejected"; note?: string }) =>
    request<any>(`/api/v1/system/pages/actions/approvals/${encodeURIComponent(approvalId)}/review`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  systemPagesActionRuns: (limit = 50, moduleId = "", actionId = "", riskLevel = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (moduleId) qs.set("module_id", moduleId);
    if (actionId) qs.set("action_id", actionId);
    if (riskLevel && riskLevel !== "all") qs.set("risk_level", riskLevel);
    return request<any>(`/api/v1/system/pages/actions/runs?${qs}`);
  },
  systemPagesActionPlan: (body: { module_id: string; action_id: string; dry_run?: boolean }) =>
    request<any>("/api/v1/system/pages/actions/plan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  systemPagesActionExecute: (body: { module_id: string; action_id: string; dry_run?: boolean; assigned_to?: string; priority?: string }) =>
    request<any>("/api/v1/system/pages/actions/execute", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  systemPagesCapabilities: () => request<any>("/api/v1/system/pages/capabilities"),
  systemPagesCapabilitiesMe: () => request<any>("/api/v1/system/pages/capabilities/me"),
  systemPagesHealth: () => request<any>("/api/v1/system/pages/health"),
  systemPagesMicroApps: () => request<any>("/api/v1/system/pages/micro-apps"),
  systemPagesMenuPreferencesMe: () => request<any>("/api/v1/system/pages/menu/preferences/me"),
  systemPagesMenuPreferencesUpdate: (body: {
    favorites?: string[];
    quick_access?: string[];
    recents?: string[];
    density?: string;
    menu_layout?: string;
    menu_effect?: string;
    show_recents?: boolean;
    show_favorites?: boolean;
    show_menu_counts?: boolean;
    show_menu_meta?: boolean;
    show_quick_panel?: boolean;
    collapsed_groups?: Record<string, boolean>;
    collapsed_categories?: Record<string, boolean>;
    collapsed_modules?: Record<string, boolean>;
  }) =>
    request<any>("/api/v1/system/pages/menu/preferences/me", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  systemPagesLegacyMigrationPlan: () => request<any>("/api/v1/system/pages/legacy/migration-plan"),
  systemLegacyPage: (consoleId: string) =>
    request<any>(`/api/v1/system/pages/legacy/${encodeURIComponent(consoleId)}`),
  systemPagesCapabilityCheck: (body: { capability: string; action?: "read" | "write" | "admin" }) =>
    request<any>("/api/v1/system/pages/capabilities/check", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  systemPagesBacklogTasks: (body: { ids?: string[]; dry_run?: boolean; priority?: string; assigned_to?: string }) =>
    request<any>("/api/v1/system/pages/backlog/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  businesses: () => request<any[]>("/api/v1/businesses"),
  createBusiness: (body: { name: string; description?: string }) =>
    request<any>("/api/v1/businesses", { method: "POST", body: JSON.stringify(body) }),
  updateBusiness: (businessId: string, body: { name?: string; description?: string }) =>
    request<any>(`/api/v1/businesses/${encodeURIComponent(businessId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteBusiness: (businessId: string) =>
    request<any>(`/api/v1/businesses/${encodeURIComponent(businessId)}`, { method: "DELETE" }),
  platformsList: () => request<any>("/api/v1/platforms"),
  platformsSummary: () =>
    request<{
      ok: boolean;
      platforms_total: number;
      cli_available: number;
      ready: number;
      hook_shim_present: number;
      config_present: number;
    }>("/api/v1/platforms/summary"),
  platformsCharts: () =>
    request<{
      ok: boolean;
      readiness: Array<{ name: string; value: number }>;
      cli: Array<{ name: string; value: number }>;
      hooks: Array<{ name: string; value: number }>;
      platforms: Array<{ id: string; label: string; ready: boolean; cli_available: boolean; score: number }>;
    }>("/api/v1/platforms/charts"),
  platformsInstallShims: (id: string) =>
    request<any>(`/api/v1/platforms/install-shims/${encodeURIComponent(id)}`, { method: "POST" }),
  platformsOpsPlan: () => request<any>("/api/v1/platforms/ops-plan"),
  platformsOpsTasks: (body: { dry_run?: boolean; priority?: string; assigned_to?: string; categories?: string[] }) =>
    request<any>("/api/v1/platforms/ops-tasks", { method: "POST", body: JSON.stringify(body) }),
  agents: () => request<any[]>("/api/v1/agents"),
  agentsBuiltin: () => request<any[]>("/api/v1/agents/builtin"),
  agentsSummary: () => request<any>("/api/v1/agents/summary"),
  agentRunsSummary: () => request<any>("/api/v1/agents/runs/summary"),
  agentRuns: (agent = "", status = "", limit = 100) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (agent) qs.set("agent", agent);
    if (status) qs.set("status", status);
    return request<any>(`/api/v1/agents/runs?${qs}`);
  },
  agentRunsSlo: () => request<any>("/api/v1/agents/runs/slo"),
  agentRunsRebalanceTasks: (body: { dry_run?: boolean; priority?: string; assigned_to?: string; categories?: string[] }) =>
    request<any>("/api/v1/agents/runs/rebalance-tasks", { method: "POST", body: JSON.stringify(body) }),
  agentGroups: () => request<any[]>("/api/v1/agents/groups"),
  agentProfile: (id: string) => request<any>(`/api/v1/agents/${encodeURIComponent(id)}/profile`),
  agentBootstrapBuiltin: (overwrite = false) =>
    request<any>(`/api/v1/agents/bootstrap-builtin?overwrite=${overwrite ? "true" : "false"}`, { method: "POST" }),
  agentCreate: (body: Record<string, unknown>) =>
    request<any>("/api/v1/agents", { method: "POST", body: JSON.stringify(body) }),
  agentDelete: (id: string) =>
    request<any>(`/api/v1/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  agentGroupCreate: (body: Record<string, unknown>) =>
    request<any>("/api/v1/agents/groups", { method: "POST", body: JSON.stringify(body) }),
  agentGroupDelete: (id: string) =>
    request<any>(`/api/v1/agents/groups/${encodeURIComponent(id)}`, { method: "DELETE" }),
  mcpServers: () => request<any[]>("/api/v1/mcp"),
  mcpSummary: () => request<any>("/api/v1/mcp/summary"),
  mcpBuiltin: () => request<any[]>("/api/v1/mcp/builtin"),
  mcpProfile: () => request<any>("/api/v1/mcp/profile"),
  mcpUpsert: (body: Record<string, unknown>) =>
    request<any>("/api/v1/mcp", { method: "POST", body: JSON.stringify(body) }),
  mcpDelete: (name: string) =>
    request<any>(`/api/v1/mcp/${encodeURIComponent(name)}`, { method: "DELETE" }),
  mcpInstallBuiltin: (name: string) =>
    request<any>(`/api/v1/mcp/install-builtin/${encodeURIComponent(name)}`, { method: "POST" }),
  mcpInstallAllBuiltin: () =>
    request<any>("/api/v1/mcp/install-builtin", { method: "POST" }),
  models: () => request<any>("/api/v1/models"),
  modelsSetDefault: (modelId: string) =>
    request<any>(`/api/v1/models/default?model_id=${encodeURIComponent(modelId)}`, { method: "PUT" }),
  modelsUpsertProvider: (name: string, body: { name: string; api_key?: string; base_url?: string; enabled?: boolean }) =>
    request<any>(`/api/v1/models/providers/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  modelsDeleteProvider: (name: string) =>
    request<any>(`/api/v1/models/providers/${encodeURIComponent(name)}`, { method: "DELETE" }),
  modelsTestProvider: (name: string) =>
    request<any>(`/api/v1/models/providers/${encodeURIComponent(name)}/test`, { method: "POST" }),
  modelsAddCustom: (body: { id: string; provider: string; name: string; context?: number; api_key?: string }) =>
    request<any>("/api/v1/models/custom", { method: "POST", body: JSON.stringify(body) }),
  modelsDeleteCustom: (modelId: string) =>
    request<any>(`/api/v1/models/custom/${encodeURIComponent(modelId)}`, { method: "DELETE" }),
  modelsSetRole: (body: { role: string; model_id: string }) =>
    request<any>("/api/v1/models/role-model", { method: "PUT", body: JSON.stringify(body) }),
  authUsers: () => request<any[]>("/api/v1/auth/users"),
  authCreateUser: (body: { username: string; password: string; email?: string; role?: string }) =>
    request<any>("/api/v1/auth/users", { method: "POST", body: JSON.stringify(body) }),
  authUpdateUser: (userId: string, body: { email?: string; role?: string; status?: string; password?: string }) =>
    request<any>(`/api/v1/auth/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  authDeleteUser: (userId: string) =>
    request<any>(`/api/v1/auth/users/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  projectMembers: (projectId: string) =>
    request<any[]>(`/api/v1/projects/${encodeURIComponent(projectId)}/members`),
  projectMemberCandidates: (projectId: string) =>
    request<any[]>(`/api/v1/projects/${encodeURIComponent(projectId)}/member-candidates`),
  projectAddMember: (projectId: string, body: { user_id: string; role?: string }) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  projectUpdateMember: (projectId: string, userId: string, body: { role: string }) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  projectRemoveMember: (projectId: string, userId: string) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
  roleConstants: () =>
    request<{ user_roles: string[]; project_member_roles: string[]; data_hub_import_roles: string[] }>(
      "/api/v1/auth/role-constants",
    ),
  notifyChannels: () => request<any[]>("/api/v1/notify/channels"),
  notifyConnectors: () => request<{ items: any[]; total: number; scope: Record<string, string> }>("/api/v1/notify/connectors"),
  notifyConnectorCallbackTemplate: (connectorType: string) =>
    request<any>(`/api/v1/notify/connectors/${encodeURIComponent(connectorType)}/callback-template`),
  notifyConnectorVerify: (connectorType: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/notify/connectors/${encodeURIComponent(connectorType)}/verify`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  notifyTemplates: () => request<{ items: any[] }>("/api/v1/notify/templates"),
  notifySummary: () =>
    request<{
      ok: boolean;
      channels: number;
      enabled: number;
      messages: number;
      failures: number;
      last_24h?: number;
      by_direction?: Record<string, number>;
      by_channel?: Record<string, number>;
      by_channel_type?: Record<string, number>;
    }>("/api/v1/notify/summary"),
  notifyTimeline: (limit = 80, direction = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (direction) qs.set("direction", direction);
    return request<{
      ok: boolean;
      total: number;
      days: Array<{ date: string; count: number; items: Array<Record<string, unknown>> }>;
    }>(`/api/v1/notify/timeline?${qs}`);
  },
  organizationSummary: () =>
    request<{
      ok: boolean;
      users_total: number;
      users_active: number;
      businesses_total: number;
      projects_total: number;
      project_members_total: number;
      tenant_admins: number;
    }>("/api/v1/organization/summary"),
  organizationPolicy: () =>
    request<any>("/api/v1/organization/policy"),
  organizationPolicyUpdate: (body: Record<string, unknown>) =>
    request<any>("/api/v1/organization/policy", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  organizationPolicyReset: () =>
    request<any>("/api/v1/organization/policy/reset", { method: "POST" }),
  organizationPolicyCheck: (body: Record<string, unknown>) =>
    request<any>("/api/v1/organization/policy/check", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  organizationPolicyHistory: (limit = 50) =>
    request<any>(`/api/v1/organization/policy/history?limit=${encodeURIComponent(String(limit))}`),
  organizationAccessReview: () =>
    request<any>("/api/v1/organization/access-review"),
  organizationAccessReviewTasks: (body: Record<string, unknown>) =>
    request<any>("/api/v1/organization/access-review/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  notifyMessages: (limit = 100, direction = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (direction) qs.set("direction", direction);
    return request<{ items: any[]; total: number }>(`/api/v1/notify/messages?${qs}`);
  },
  notifyAddChannel: (body: Record<string, unknown>) =>
    request<any>("/api/v1/notify/channels", { method: "POST", body: JSON.stringify(body) }),
  notifyPatchChannel: (name: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/notify/channels/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  notifyDeleteChannel: (name: string) =>
    request<any>(`/api/v1/notify/channels/${encodeURIComponent(name)}`, { method: "DELETE" }),
  notifyTestChannel: (name: string) =>
    request<any>(`/api/v1/notify/test/${encodeURIComponent(name)}`, { method: "POST" }),
  notifySend: (body: { channel: string; title: string; content: string; level?: string }) =>
    request<any>("/api/v1/notify/send", { method: "POST", body: JSON.stringify(body) }),
  notifyInbound: (body: { channel?: string; sender?: string; text: string; event?: string; payload?: Record<string, unknown> }) =>
    request<any>("/api/v1/notify/inbound", { method: "POST", body: JSON.stringify(body) }),
  notifyInboundAction: (messageId: string, body: { action?: "task" | "requirement"; dry_run?: boolean; priority?: string; assigned_to?: string; assigned_agent?: string; dev_tool?: string }) =>
    request<any>(`/api/v1/notify/inbound/${encodeURIComponent(messageId)}/action`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  analyticsOverview: () => request<any>("/api/v1/analytics/overview"),
  analyticsCharts: () =>
    request<{
      ok: boolean;
      task_status: Array<{ name: string; value: number }>;
      issue_priority: Array<{ name: string; value: number }>;
      activity_trend: { days: string[]; series: Array<{ name: string; data: number[] }> };
    }>("/api/v1/analytics/charts"),
  analyticsCatalog: () => request<{ ok: boolean; items: any[]; total: number }>("/api/v1/analytics/catalog"),
  analyticsGovernanceHub: () => request<any>("/api/v1/analytics/governance/hub"),
  analyticsGovernanceDomainSummary: (domain: string) =>
    request<any>(`/api/v1/analytics/governance/domains/${encodeURIComponent(domain)}/summary`),
  analyticsGovernanceDomainCharts: (domain: string) =>
    request<any>(`/api/v1/analytics/governance/domains/${encodeURIComponent(domain)}/charts`),
  analyticsAssets: (type = "", status = "", q = "") => {
    const qs = new URLSearchParams();
    if (type) qs.set("type", type);
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/analytics/assets${qs.toString() ? `?${qs}` : ""}`);
  },
  analyticsPatchAsset: (assetId: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/analytics/assets/${encodeURIComponent(assetId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  analyticsMetricsCenter: (domain = "", q = "") => {
    const qs = new URLSearchParams();
    if (domain) qs.set("domain", domain);
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/analytics/metrics/center${qs.toString() ? `?${qs}` : ""}`);
  },
  analyticsUpsertMetric: (body: Record<string, unknown>) =>
    request<any>("/api/v1/analytics/metrics/center", { method: "POST", body: JSON.stringify(body) }),
  analyticsTags: (category = "", q = "") => {
    const qs = new URLSearchParams();
    if (category) qs.set("category", category);
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/analytics/tags${qs.toString() ? `?${qs}` : ""}`);
  },
  analyticsUpsertTag: (body: Record<string, unknown>) =>
    request<any>("/api/v1/analytics/tags", { method: "POST", body: JSON.stringify(body) }),
  analyticsDataServices: (status = "", q = "") => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/analytics/services${qs.toString() ? `?${qs}` : ""}`);
  },
  analyticsUpsertDataService: (body: Record<string, unknown>) =>
    request<any>("/api/v1/analytics/services", { method: "POST", body: JSON.stringify(body) }),
  analyticsPublishDataService: (serviceId: string, body: { status?: string; note?: string }) =>
    request<any>(`/api/v1/analytics/services/${encodeURIComponent(serviceId)}/publish`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  analyticsDevTemplates: (status = "", q = "") => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/analytics/development/templates${qs.toString() ? `?${qs}` : ""}`);
  },
  analyticsUpsertDevTemplate: (body: Record<string, unknown>) =>
    request<any>("/api/v1/analytics/development/templates", { method: "POST", body: JSON.stringify(body) }),
  analyticsDevTemplateTasks: (body: { ids?: string[]; dry_run?: boolean; priority?: string; assigned_to?: string; dev_tool?: string }) =>
    request<any>("/api/v1/analytics/development/tasks", { method: "POST", body: JSON.stringify(body) }),
  analyticsDevSchedule: (body: { ids?: string[]; dry_run?: boolean; max_parallel?: number; policy?: string; priority?: string; assigned_to?: string; dev_tool?: string; event?: string }) =>
    request<any>("/api/v1/analytics/development/schedule", { method: "POST", body: JSON.stringify(body) }),
  analyticsDevOpsSummary: () => request<any>("/api/v1/analytics/development/ops-summary"),
  analyticsDevRunbook: (body: { schedule_id?: string; packet_id?: string; decisions?: string[]; include_unclaimed?: boolean; dry_run?: boolean; priority?: string; assigned_to?: string; dev_tool?: string }) =>
    request<any>("/api/v1/analytics/development/runbook", { method: "POST", body: JSON.stringify(body) }),
  analyticsDevSchedules: (limit = 20, q = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/analytics/development/schedules?${qs}`);
  },
  analyticsDevScheduleDetail: (scheduleId: string) =>
    request<any>(`/api/v1/analytics/development/schedules/${encodeURIComponent(scheduleId)}`),
  analyticsDevScheduleAction: (scheduleId: string, body: { action: "rerun" | "cancel" | "archive" | "restore"; dry_run?: boolean; max_parallel?: number; policy?: string; priority?: string; assigned_to?: string; dev_tool?: string; note?: string }) =>
    request<any>(`/api/v1/analytics/development/schedules/${encodeURIComponent(scheduleId)}/action`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  analyticsDevAgentFeed: (limit = 20, scheduleId = "", agent = "", includeBlocked = false) => {
    const qs = new URLSearchParams({ limit: String(limit), include_blocked: String(includeBlocked) });
    if (scheduleId) qs.set("schedule_id", scheduleId);
    if (agent) qs.set("agent", agent);
    return request<any>(`/api/v1/analytics/development/agent-feed?${qs}`);
  },
  analyticsDevAgentFeedAction: (body: { schedule_id: string; packet_id: string; action: "claim" | "heartbeat" | "report"; agent?: string; progress?: number; status?: string; summary?: string; artifact_url?: string; evidence?: any[]; blockers?: string[]; warnings?: string[]; note?: string }) =>
    request<any>("/api/v1/analytics/development/agent-feed/action", { method: "POST", body: JSON.stringify(body) }),
  analyticsDevEvidence: (limit = 20, scheduleId = "", packetId = "", decision = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (scheduleId) qs.set("schedule_id", scheduleId);
    if (packetId) qs.set("packet_id", packetId);
    if (decision) qs.set("decision", decision);
    return request<any>(`/api/v1/analytics/development/evidence?${qs}`);
  },
  analyticsDevEvidenceTasks: (body: { schedule_id?: string; packet_id?: string; decisions?: string[]; dry_run?: boolean; priority?: string; assigned_to?: string; dev_tool?: string }) =>
    request<any>("/api/v1/analytics/development/evidence/tasks", { method: "POST", body: JSON.stringify(body) }),
  analyticsDevEvidenceNotify: (body: { schedule_id?: string; packet_id?: string; decisions?: string[]; channels?: string[]; dry_run?: boolean }) =>
    request<any>("/api/v1/analytics/development/evidence/notify", { method: "POST", body: JSON.stringify(body) }),
  analyticsQualityRules: () => request<any>("/api/v1/analytics/quality/rules"),
  analyticsQualityEvaluate: (body: { asset_ids?: string[] }) =>
    request<any>("/api/v1/analytics/quality/evaluate", { method: "POST", body: JSON.stringify(body) }),
  analyticsQualityAlerts: (severity = "", q = "") => {
    const qs = new URLSearchParams();
    if (severity) qs.set("severity", severity);
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/analytics/quality/alerts${qs.toString() ? `?${qs}` : ""}`);
  },
  analyticsQualityAlertTasks: (body: { ids?: string[]; dry_run?: boolean; priority?: string; assigned_to?: string; dev_tool?: string }) =>
    request<any>("/api/v1/analytics/quality/alerts/tasks", { method: "POST", body: JSON.stringify(body) }),
  analyticsQualityAlertNotify: (body: { channels?: string[]; dry_run?: boolean }) =>
    request<any>("/api/v1/analytics/quality/alerts/notify", { method: "POST", body: JSON.stringify(body) }),
  analyticsGovernanceTasks: (body: { ids?: string[]; dry_run?: boolean; priority?: string; assigned_to?: string; dev_tool?: string }) =>
    request<any>("/api/v1/analytics/governance/tasks", { method: "POST", body: JSON.stringify(body) }),
  analyticsLineage: () => request<any>("/api/v1/analytics/lineage"),
  analyticsLineageImpact: (nodeId: string) =>
    request<{
      ok: boolean;
      node_id: string;
      upstream: Array<Record<string, unknown>>;
      downstream: Array<Record<string, unknown>>;
      upstream_count: number;
      downstream_count: number;
    }>(`/api/v1/analytics/lineage/impact?node_id=${encodeURIComponent(nodeId)}`),
  analyticsExportCsvUrl: () => "/api/v1/analytics/export.csv",
  analyticsNlq: (question: string) =>
    request<any>("/api/v1/analytics/nlq", { method: "POST", body: JSON.stringify({ question }) }),
  analyticsBlueprint: () => request<any>("/api/v1/analytics/blueprint"),
  analyticsBlueprintSummary: () => request<any>("/api/v1/analytics/blueprint/summary"),
  analyticsBlueprintCharts: () => request<any>("/api/v1/analytics/blueprint/charts"),
  analyticsBlueprintTasks: (body: { ids?: string[]; dry_run?: boolean; priority?: string; assigned_to?: string; dev_tool?: string }) =>
    request<any>("/api/v1/analytics/blueprint/tasks", { method: "POST", body: JSON.stringify(body) }),
  analyticsReports: (limit = 30, status = "", source = "", q = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (status) qs.set("status", status);
    if (source) qs.set("source", source);
    if (q) qs.set("q", q);
    return request<{ ok: boolean; items: any[]; total: number }>(`/api/v1/analytics/reports?${qs}`);
  },
  analyticsReportsSummary: () => request<any>("/api/v1/analytics/reports/summary"),
  analyticsReportsCharts: () => request<any>("/api/v1/analytics/reports/charts"),
  marketplaceCharts: () => request<any>("/api/v1/marketplace/charts"),
  notifyCharts: () => request<any>("/api/v1/notify/charts"),
  copilotHub: () => request<any>("/api/v1/copilot/hub"),
  platformsHub: () => request<any>("/api/v1/platforms/hub"),
  auditHub: () => request<any>("/api/v1/audit/hub"),
  systemPagesHub: () => request<any>("/api/v1/system/pages/hub"),
  skillsHub: () => request<any>("/api/v1/skills/hub"),
  projectsHub: () => request<any>("/api/v1/projects/hub"),
  organizationHub: () => request<any>("/api/v1/organization/hub"),
  requirementsHub: () => request<any>("/api/v1/requirements/hub"),
  requirementsCharts: () => request<any>("/api/v1/requirements/charts"),
  tasksHub: () => request<any>("/api/v1/tasks/hub"),
  workflowsHub: () => request<any>("/api/v1/workflows/hub"),
  searchHub: () => request<any>("/api/v1/search/hub"),
  vibeHub: () => request<any>("/api/v1/vibe/hub"),
  analyticsDataHub: () => request<any>("/api/v1/analytics/hub"),
  orchestrationHub: () => request<any>("/api/v1/orchestration/hub"),
  envOpsHub: () => request<any>("/api/v1/system/ops/hub"),
  settingsHub: () => request<any>("/api/v1/settings/hub"),
  dashboardHub: () => request<any>("/api/v1/dashboard/hub"),
  devFlowHub: () => request<any>("/api/v1/dev-flow/hub"),
  issuesHub: () => request<any>("/api/v1/issues/hub"),
  issuesCharts: () => request<any>("/api/v1/issues/charts"),
  issuesSummary: () => request<any>("/api/v1/issues/summary"),
  marketplaceHub: () => request<any>("/api/v1/marketplace/hub"),
  notifyHub: () => request<any>("/api/v1/notify/hub"),
  analyticsReportSubscription: () => request<any>("/api/v1/analytics/report-subscription"),
  analyticsUpdateReportSubscription: (body: { enabled?: boolean; auto_on_publish?: boolean; channels?: string[] }) =>
    request<any>("/api/v1/analytics/report-subscription", { method: "PUT", body: JSON.stringify(body) }),
  analyticsTestReportSubscription: () =>
    request<any>("/api/v1/analytics/report-subscription/test", { method: "POST" }),
  analyticsCreateReport: (body: { title?: string; question?: string; answer?: string; metrics_snapshot?: Record<string, unknown> }) =>
    request<any>("/api/v1/analytics/reports", { method: "POST", body: JSON.stringify(body) }),
  analyticsUpdateReportStatus: (reportId: string, status: "draft" | "published" | "archived") =>
    request<any>(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  analyticsUpdateReportMeta: (
    reportId: string,
    body: { title?: string; owner?: string; tags?: string[]; note?: string; pinned?: boolean },
  ) =>
    request<any>(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/meta`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  analyticsDeleteReport: (reportId: string) =>
    request<any>(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}`, { method: "DELETE" }),
  analyticsReportMarkdownUrl: (reportId: string) =>
    `/api/v1/analytics/reports/${encodeURIComponent(reportId)}.md`,
  analyticsNotifyReport: (reportId: string, body: { channels: string[]; dry_run?: boolean }) =>
    request<any>(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/notify`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  analyticsReportActionTasks: (
    reportId: string,
    body: { preview?: boolean; max_tasks?: number; priority?: string; assigned_to?: string; dev_tool?: string },
  ) =>
    request<any>(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/action-tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  dataExchangeSummary: () => request<any>("/api/v1/data-exchange/summary"),
  dataExchangeCharts: () => request<any>("/api/v1/data-exchange/charts"),
  intelligenceHub: () => request<any>("/api/v1/intelligence/hub"),
  dataExchangeExportUrl: (modules: string[] = []) => {
    const qs = modules.length ? `?modules=${encodeURIComponent(modules.join(","))}` : "";
    return `/api/v1/data-exchange/export${qs}`;
  },
  dataExchangePreview: (body: Record<string, unknown>) =>
    request<any>("/api/v1/data-exchange/preview", { method: "POST", body: JSON.stringify(body) }),
  dataExchangeImport: (body: Record<string, unknown>) =>
    request<any>("/api/v1/data-exchange/import", { method: "POST", body: JSON.stringify(body) }),
  dataExchangeJobs: (limit = 30) =>
    request<any>(`/api/v1/data-exchange/jobs?limit=${encodeURIComponent(String(limit))}`),
  dataExchangeExportJob: (modules: string[] = []) =>
    request<any>("/api/v1/data-exchange/export-job", {
      method: "POST",
      body: JSON.stringify({ modules }),
    }),
  ragSearch: (query: string, limit = 8) =>
    request<any>("/api/v1/rag/search", {
      method: "POST",
      body: JSON.stringify({ query, limit, hybrid: true, rerank: true }),
    }),
  workerEnqueue: (type: string, payload: Record<string, unknown> = {}) =>
    request<any>("/api/v1/worker/jobs", {
      method: "POST",
      body: JSON.stringify({ type, payload }),
    }),
  workerHealth: () => request<any>("/api/v1/worker/health"),
  workerTypes: () => request<{ ok: boolean; items: any[] }>("/api/v1/worker/types"),
  workerSummary: () => request<any>("/api/v1/worker/summary"),
  workerJobs: (limit = 100, status = "", type = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (status) qs.set("status", status);
    if (type) qs.set("type", type);
    return request<{ ok: boolean; items: any[]; summary?: any }>(`/api/v1/worker/jobs?${qs}`);
  },
  workerCancel: (jobId: string) =>
    request<any>(`/api/v1/worker/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
  workerRetry: (jobId: string) =>
    request<any>(`/api/v1/worker/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" }),
  syncHealth: () => request<any>("/api/v1/sync/health"),
  syncModules: () => request<{ ok: boolean; items: any[] }>("/api/v1/sync/modules"),
  syncSummary: () => request<any>("/api/v1/sync/summary"),
  syncPull: (modules = "tasks,requirements,issues,sprints,rules,specs,templates", cursor = "", limit = 50) => {
    const qs = new URLSearchParams({ modules, cursor, limit: String(limit) });
    return request<any>(`/api/v1/sync/pull?${qs}`);
  },
  syncJournal: (since = "", limit = 100) => {
    const qs = new URLSearchParams({ since, limit: String(limit) });
    return request<any>(`/api/v1/sync/journal?${qs}`);
  },
  syncPush: (body: { module: string; action?: "upsert" | "delete"; record?: Record<string, unknown>; idempotency_key?: string }) =>
    request<any>("/api/v1/sync/push", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { username: string; password: string; tenant_slug?: string }) =>
    request<SessionPayload>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
  authMe: () =>
    request<SessionPayload>("/api/v1/auth/me"),
  tenantOptions: () =>
    request<{
      admin_mode?: "single" | "saas";
      count?: number;
      authorized_for?: string | null;
      items: Array<{ id: string; name: string; slug: string; plan?: string; default?: boolean }>;
    }>("/api/v1/auth/tenant-options"),
  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  ssoConfig: () => request<any>("/api/v1/sso/config"),
  ssoUpsertProvider: (provider: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/sso/providers/${encodeURIComponent(provider)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  ssoDeleteProvider: (provider: string) =>
    request<any>(`/api/v1/sso/providers/${encodeURIComponent(provider)}`, { method: "DELETE" }),
  ssoTestProvider: (provider: string) =>
    request<any>(`/api/v1/sso/providers/${encodeURIComponent(provider)}/test`, { method: "POST" }),
  ssoRolePreview: (provider: string, body: { email?: string; groups?: string[]; tenant_domain_map?: Record<string, string>; role_map?: Record<string, string> }) =>
    request<any>(`/api/v1/sso/providers/${encodeURIComponent(provider)}/role-preview`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  opsProfiles: () => request<any>("/api/v1/system/ops/profiles"),
  opsUpsertProfile: (profile: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  opsActivateProfile: (profile: string) =>
    request<any>(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}/activate`, { method: "POST" }),
  opsDeleteProfile: (profile: string) =>
    request<any>(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}`, { method: "DELETE" }),
  opsProfileEnv: (profile: string) =>
    request<any>(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}/env`),
  opsProfileBundle: (profile: string) =>
    request<any>(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}/bundle`),
  opsProfileComposeUrl: (profile: string) =>
    `/api/v1/system/ops/profiles/${encodeURIComponent(profile)}/compose.override.yml`,
  opsDoctor: () => request<any>("/api/v1/system/ops/doctor"),
  opsObservability: () => request<any>("/api/v1/system/ops/observability"),
  opsLogs: (name = "sop.app.log", limit = 200, level = "", q = "") => {
    const qs = new URLSearchParams({ name, limit: String(limit) });
    if (level) qs.set("level", level);
    if (q) qs.set("q", q);
    return request<any>(`/api/v1/system/ops/logs?${qs}`);
  },
  metrics: () => fetch(BASE + "/metrics").then((r) => r.text()),

  workspaceSearch: (q: string) =>
    request<Array<{ type: string; id?: string; title?: string; description?: string; snippet?: string }>>(
      `/api/v1/search?q=${encodeURIComponent(q)}`,
    ),
  semanticSearchStatus: () =>
    request<{
      ok: boolean;
      available: boolean;
      reason?: string;
      tables: Array<{ table: string; rows: number; ready: boolean }>;
      default_tables: string;
    }>("/api/v1/semantic-search/status"),
  semanticSearch: (
    q: string,
    tables = "tasks,requirements,issues,knowledge,design_docs,specs",
    mode: "vector" | "keyword" | "hybrid" = "hybrid",
    limit = 8,
  ) =>
    request<{
      ok: boolean;
      available: boolean;
      mode?: string;
      vector_used?: boolean;
      total?: number;
      items: Array<{
        table?: string;
        type?: string;
        id?: string;
        title?: string;
        snippet?: string;
        status?: string;
        priority?: string;
        score?: number;
        source?: string;
      }>;
      reason?: string;
    }>(
      `/api/v1/semantic-search?q=${encodeURIComponent(q)}&tables=${encodeURIComponent(tables)}&mode=${mode}&limit=${limit}`,
    ),

  issues: (params: { status?: string; severity?: string; q?: string; page?: number; size?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.severity) qs.set("severity", params.severity);
    if (params.q) qs.set("q", params.q);
    if (params.page) qs.set("page", String(params.page));
    if (params.size) qs.set("size", String(params.size));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ total: number; items: unknown[] }>(`/api/v1/issues${suffix}`);
  },
  createIssue: (body: { title: string; description?: string; type?: string; severity?: string; task_id?: string }) =>
    request<{ ok: boolean; id: string }>("/api/v1/issues", { method: "POST", body: JSON.stringify(body) }),
  updateIssue: (id: string, patch: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/v1/issues/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  resolveIssue: (id: string, resolution: string) =>
    request<{ ok: boolean }>(`/api/v1/issues/${encodeURIComponent(id)}/resolve`, {
      method: "PATCH",
      body: JSON.stringify({ resolution }),
    }),
  deleteIssue: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/issues/${encodeURIComponent(id)}`, { method: "DELETE" }),
  issueOpsPlan: () => request<any>("/api/v1/issues/ops-plan"),
  issueOpsTasks: (body: {
    dry_run?: boolean;
    priority?: string;
    assigned_to?: string;
    categories?: string[];
    limit?: number;
  }) => request<any>("/api/v1/issues/ops-tasks", { method: "POST", body: JSON.stringify(body) }),

  specsList: () => request<Array<{ path: string; category?: string; size?: number }>>("/api/v1/specs"),
  specsSummary: () =>
    request<{ ok: boolean; total: number; by_category: Record<string, number>; total_bytes: number }>(
      "/api/v1/specs/summary",
    ),
  specsContent: (path: string) =>
    request<{ content?: string; type?: string }>(`/api/v1/specs/content?path=${encodeURIComponent(path)}`),
  specsSaveContent: (path: string, content: string) =>
    request<{ ok: string }>(`/api/v1/specs/content?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  designDocsList: () => request<any[]>("/api/v1/design-docs"),
  designDocGet: (docId: string) => request<{ ok: boolean; meta: Record<string, unknown>; content: string }>(
    `/api/v1/design-docs/${encodeURIComponent(docId)}`,
  ),
  designDocCreate: (body: { title: string; initial_content?: string; category?: string; tags?: string[] }) =>
    request<{ ok: boolean; id: string }>("/api/v1/design-docs", { method: "POST", body: JSON.stringify(body) }),
  designDocVersions: (docId: string) =>
    request<{ ok: boolean; versions: Array<{ v: number; created_at?: string; note?: string }>; current_version: number }>(
      `/api/v1/design-docs/${encodeURIComponent(docId)}/versions`,
    ),
  designDocVersionGet: (docId: string, version: number) =>
    request<{ ok: boolean; version: number; content: string }>(
      `/api/v1/design-docs/${encodeURIComponent(docId)}/versions/${version}`,
    ),
  designDocAddVersion: (docId: string, content: string, note = "编辑保存") =>
    request<{ ok: boolean; version: number }>(`/api/v1/design-docs/${encodeURIComponent(docId)}/versions`, {
      method: "POST",
      body: JSON.stringify({ content, note }),
    }),
  designDocRestore: (docId: string, version: number) =>
    request<{ ok: boolean; version: number }>(`/api/v1/design-docs/${encodeURIComponent(docId)}/restore`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  designDocPatchMeta: (docId: string, patch: { title?: string; category?: string; tags?: string[] }) =>
    request<{ ok: boolean }>(`/api/v1/design-docs/${encodeURIComponent(docId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  designDocDelete: (docId: string) =>
    request<{ ok: boolean }>(`/api/v1/design-docs/${encodeURIComponent(docId)}`, { method: "DELETE" }),
  designDocAiImprove: (docId: string, body: { instruction: string; mode?: "expand" | "review" | "diagram" | "free" }) =>
    request<{ ok: boolean; version?: number }>(`/api/v1/design-docs/${encodeURIComponent(docId)}/ai-improve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  designDocCompare: (docId: string, fromVersion: number, toVersion: number) =>
    request<{
      ok: boolean;
      added_lines: number;
      removed_lines: number;
      diff_preview: string;
      truncated: boolean;
    }>(
      `/api/v1/design-docs/${encodeURIComponent(docId)}/compare?from=${fromVersion}&to=${toVersion}`,
    ),

  devFlowTemplates: () =>
    request<{ ok: boolean; items: Array<Record<string, unknown>> }>("/api/v1/dev-flow/templates"),

  devFlowOpsPlan: () => request<any>("/api/v1/dev-flow/ops-plan"),
  devFlowOpsTasks: (body: { dry_run?: boolean; priority?: string; assigned_to?: string; categories?: string[]; limit?: number }) =>
    request<any>("/api/v1/dev-flow/ops-tasks", { method: "POST", body: JSON.stringify(body) }),

  devFlowBurndown: (sprintId?: string) => {
    const qs = sprintId ? `?sprint_id=${encodeURIComponent(sprintId)}` : "";
    return request<{
      ok: boolean;
      sprint: Record<string, unknown>;
      stats: Record<string, unknown>;
      ideal: Array<{ day: number; remaining: number }>;
      actual: Array<{ day: number; remaining: number }>;
      span_days: number;
      elapsed_days: number;
    }>(`/api/v1/dev-flow/burndown${qs}`);
  },

  skillsList: () => request<any[]>("/api/v1/skills"),
  skillCreate: (body: {
    skill_id: string;
    name: string;
    description: string;
    agent_role?: string;
    trigger?: string;
    execution?: string;
  }) => request<{ ok: boolean; skill_id: string }>("/api/v1/skills", { method: "POST", body: JSON.stringify(body) }),
  skillDelete: (skillId: string) =>
    request<{ ok: boolean }>(`/api/v1/skills/${encodeURIComponent(skillId)}`, { method: "DELETE" }),
  skillRepoList: () => request<any[]>("/api/v1/skill-repo/repos"),
  skillRepoAdd: (body: { id: string; name: string; url: string; branch?: string; description?: string }) =>
    request<{ ok: boolean }>("/api/v1/skill-repo/repos", { method: "POST", body: JSON.stringify(body) }),
  skillRepoSync: (repoId: string) =>
    request<any>(`/api/v1/skill-repo/repos/${encodeURIComponent(repoId)}/sync`, { method: "POST" }),
  skillRepoInstalled: () => request<Record<string, unknown>>("/api/v1/skill-repo/installed"),

  devFlowSummary: () => request<any>("/api/v1/dev-flow/summary"),
  devFlowCharts: () =>
    request<{
      ok: boolean;
      requirement_status: Array<{ name: string; value: number }>;
      task_status: Array<{ name: string; value: number }>;
      issue_severity: Array<{ name: string; value: number }>;
      issues_open: number;
      issues_critical: number;
    }>("/api/v1/dev-flow/charts"),
  vibeSessions: () => request<{ sessions: any[] }>("/api/v1/vibe/sessions"),
  vibeSession: (id: string) => request<any>(`/api/v1/vibe/sessions/${encodeURIComponent(id)}`),
  vibeCreateSession: (body: { title?: string }) =>
    request<any>("/api/v1/vibe/sessions", { method: "POST", body: JSON.stringify(body) }),
  vibeDeleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/vibe/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  vibeTemplates: () => request<any[]>("/api/v1/vibe/templates"),
  vibeRun: (body: { prompt: string; tool?: string; memory_context?: string }) =>
    request<any>("/api/v1/vibe/run", { method: "POST", body: JSON.stringify(body) }),
  cliTools: () => request<any[]>("/api/v1/cli"),
  cliRun: (body: { tool: string; args?: string[]; stdin_input?: string; timeout?: number }) =>
    request<any>("/api/v1/cli/run", { method: "POST", body: JSON.stringify(body) }),
  cliUpsertTool: (toolId: string, body: { name: string; cmd: string; description?: string }) =>
    request<any>(`/api/v1/cli/tools/${encodeURIComponent(toolId)}`, { method: "POST", body: JSON.stringify(body) }),
  envCheckFull: () => request<any>("/api/v1/env/check/full"),
  dockerPs: () => request<any>("/api/v1/env/docker/ps"),
  orchestrationTools: () => request<any[]>("/api/v1/orchestration/tools"),
  orchestrationWorkflows: () => request<any[]>("/api/v1/orchestration/workflows"),
  orchestrationWorkflow: (wfId: string) =>
    request<{ ok: boolean; workflow: Record<string, unknown>; step_count: number }>(
      `/api/v1/orchestration/workflows/${encodeURIComponent(wfId)}`,
    ),
  orchestrationConfig: () => request<any>("/api/v1/orchestration/config"),
  orchestrationEnvironmentChecks: () => request<any>("/api/v1/orchestration/environment-checks"),
  webhooks: () => request<any[]>("/api/v1/webhooks"),
  webhookEvents: () => request<{ events: string[]; catalog: any[] }>("/api/v1/webhooks/events"),
  createWebhook: (body: { name: string; url: string; secret?: string; events?: string[] }) =>
    request<any>("/api/v1/webhooks", { method: "POST", body: JSON.stringify(body) }),
  deleteWebhook: (id: string) => request<any>(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testWebhook: (id: string) => request<any>(`/api/v1/webhooks/${encodeURIComponent(id)}/test`, { method: "POST" }),
  patchWebhook: (id: string, body: { name?: string; url?: string; secret?: string; events?: string[]; active?: boolean }) =>
    request<{ ok: boolean }>(`/api/v1/webhooks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  webhookDeliveries: (hookId: string, limit = 50) =>
    request<{ ok: boolean; items: Array<Record<string, unknown>>; total: number }>(
      `/api/v1/webhooks/${encodeURIComponent(hookId)}/deliveries?limit=${limit}`,
    ),

  // ── Agent Runs ──────────────────────────────────────────────────────────
  agentRunsList: (agentId = "", status = "", limit = 100) =>
    request<any>(`/api/v1/agent-runs?agent_id=${agentId}&status=${status}&limit=${limit}`),
  agentRunCreate: (body: { agent_id: string; task_id?: string; meta?: Record<string, unknown> }) =>
    request<any>("/api/v1/agent-runs", { method: "POST", body: JSON.stringify(body) }),
  agentRunHeartbeat: (runId: string) =>
    request<any>(`/api/v1/agent-runs/${encodeURIComponent(runId)}/heartbeat`, { method: "PUT" }),
  agentRunStatus: (runId: string, body: { status: string; error_msg?: string; retry_count?: number }) =>
    request<any>(`/api/v1/agent-runs/${encodeURIComponent(runId)}/status`, { method: "PUT", body: JSON.stringify(body) }),
  agentRunEvidence: (runId: string, body: { artifact?: Record<string, unknown>; gate_results?: Record<string, unknown>; confidence?: number }) =>
    request<any>(`/api/v1/agent-runs/${encodeURIComponent(runId)}/evidence`, { method: "POST", body: JSON.stringify(body) }),
  agentRunDelete: (runId: string) =>
    request<any>(`/api/v1/agent-runs/${encodeURIComponent(runId)}`, { method: "DELETE" }),
  agentRunProfiles: () => request<any>("/api/v1/agent-runs/profiles"),
  agentRunsSummaryV2: () => request<any>("/api/v1/agent-runs/summary"),

  // ── Data Quality ────────────────────────────────────────────────────────
  dataQualityRules: (domain = "", status = "") =>
    request<any>(`/api/v1/data-quality/rules?domain=${domain}&status=${status}`),
  dataQualityRuleCreate: (body: { name: string; domain?: string; rule_type?: string; expression?: string; severity?: string }) =>
    request<any>("/api/v1/data-quality/rules", { method: "POST", body: JSON.stringify(body) }),
  dataQualityRuleUpdate: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/data-quality/rules/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  dataQualityRuleDelete: (id: string) =>
    request<any>(`/api/v1/data-quality/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  dataQualityRuns: (ruleId = "", limit = 50) =>
    request<any>(`/api/v1/data-quality/runs?rule_id=${ruleId}&limit=${limit}`),
  dataQualityRunCreate: (body: { rule_id: string; dataset?: string }) =>
    request<any>("/api/v1/data-quality/runs", { method: "POST", body: JSON.stringify(body) }),
  dataQualityRunFinish: (id: string) =>
    request<any>(`/api/v1/data-quality/runs/${encodeURIComponent(id)}/finish`, { method: "POST" }),
  dataQualityAlerts: (severity = "", status = "") =>
    request<any>(`/api/v1/data-quality/alerts?severity=${severity}&status=${status}`),
  dataQualityAlertResolve: (id: string) =>
    request<any>(`/api/v1/data-quality/alerts/${encodeURIComponent(id)}/resolve`, { method: "POST" }),
  dataQualitySummary: () => request<any>("/api/v1/data-quality/summary"),

  // ── Metrics Service ─────────────────────────────────────────────────────
  metricsCatalog: (domain = "", metricType = "") =>
    request<any>(`/api/v1/metrics-service/catalog?domain=${domain}&metric_type=${metricType}`),
  metricCreate: (body: { name: string; domain?: string; metric_type?: string; formula?: string; unit?: string; owner?: string }) =>
    request<any>("/api/v1/metrics-service/catalog", { method: "POST", body: JSON.stringify(body) }),
  metricUpdate: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/metrics-service/catalog/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  metricDelete: (id: string) =>
    request<any>(`/api/v1/metrics-service/catalog/${encodeURIComponent(id)}`, { method: "DELETE" }),
  metricPublishApi: (metricId: string) =>
    request<any>(`/api/v1/metrics-service/api-publish?metric_id=${encodeURIComponent(metricId)}`, { method: "POST" }),
  metricsPublished: () => request<any>("/api/v1/metrics-service/api-publish"),
  metricValues: (metricId: string, grain = "day") =>
    request<any>(`/api/v1/metrics-service/catalog/${encodeURIComponent(metricId)}/values?grain=${encodeURIComponent(grain)}`),
  metricsSummary: () => request<any>("/api/v1/metrics-service/summary"),

  // ── Tag Service ─────────────────────────────────────────────────────────
  tagCatalog: (category = "") => request<any>(`/api/v1/tag-service/catalog?category=${category}`),
  tagCreate: (body: { name: string; category?: string; description?: string; value_type?: string; owner?: string }) =>
    request<any>("/api/v1/tag-service/catalog", { method: "POST", body: JSON.stringify(body) }),
  tagUpdate: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/tag-service/catalog/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  tagDelete: (id: string) =>
    request<any>(`/api/v1/tag-service/catalog/${encodeURIComponent(id)}`, { method: "DELETE" }),
  tagRules: () => request<any>("/api/v1/tag-service/rules"),
  tagRuleCreate: (body: { tag_id: string; condition?: Record<string, unknown>; priority?: number }) =>
    request<any>("/api/v1/tag-service/rules", { method: "POST", body: JSON.stringify(body) }),
  tagRuleDelete: (id: string) =>
    request<any>(`/api/v1/tag-service/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  tagOntology: () => request<any>("/api/v1/tag-service/ontology"),
  tagEntityCreate: (body: { entity_type: string; name: string; attributes?: Record<string, unknown> }) =>
    request<any>("/api/v1/tag-service/ontology/entities", { method: "POST", body: JSON.stringify(body) }),
  tagEntityDelete: (id: string) =>
    request<any>(`/api/v1/tag-service/ontology/entities/${encodeURIComponent(id)}`, { method: "DELETE" }),
  tagSummary: () => request<any>("/api/v1/tag-service/summary"),

  // ── Data Ingest ─────────────────────────────────────────────────────────
  dataIngestConnectors: (connectorType = "") =>
    request<any>(`/api/v1/data-ingest/connectors?connector_type=${connectorType}`),
  dataIngestConnectorCreate: (body: { name: string; connector_type?: string; host?: string; port?: number; database?: string }) =>
    request<any>("/api/v1/data-ingest/connectors", { method: "POST", body: JSON.stringify(body) }),
  dataIngestConnectorUpdate: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/data-ingest/connectors/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  dataIngestConnectorDelete: (id: string) =>
    request<any>(`/api/v1/data-ingest/connectors/${encodeURIComponent(id)}`, { method: "DELETE" }),
  dataIngestConnectorTest: (id: string) =>
    request<any>(`/api/v1/data-ingest/connectors/${encodeURIComponent(id)}/test`, { method: "POST" }),
  dataIngestConnectorSchema: (id: string) =>
    request<any>(`/api/v1/data-ingest/connectors/${encodeURIComponent(id)}/schema`),
  dataIngestJobs: (connectorId = "", status = "") =>
    request<any>(`/api/v1/data-ingest/jobs?connector_id=${connectorId}&status=${status}`),
  dataIngestJobCreate: (body: { connector_id: string; name: string; ingest_mode?: string; schedule?: string; target_table?: string }) =>
    request<any>("/api/v1/data-ingest/jobs", { method: "POST", body: JSON.stringify(body) }),
  dataIngestJobUpdate: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/data-ingest/jobs/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  dataIngestJobRun: (id: string) =>
    request<any>(`/api/v1/data-ingest/jobs/${encodeURIComponent(id)}/run`, { method: "POST" }),
  dataIngestJobStatus: (id: string, body: { status: string; rows_ingested?: number; error_msg?: string }) =>
    request<any>(`/api/v1/data-ingest/jobs/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify(body) }),
  dataIngestJobDelete: (id: string) =>
    request<any>(`/api/v1/data-ingest/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  dataIngestSummary: () => request<any>("/api/v1/data-ingest/summary"),

  // ── A2A Gateway ─────────────────────────────────────────────────────────
  a2aRegistry: (agentType = "") => request<any>(`/api/v1/a2a/registry?agent_type=${agentType}`),
  a2aRegister: (body: { name: string; agent_type?: string; endpoint?: string; capabilities?: string[] }) =>
    request<any>("/api/v1/a2a/registry", { method: "POST", body: JSON.stringify(body) }),
  a2aDeregister: (id: string) =>
    request<any>(`/api/v1/a2a/registry/${encodeURIComponent(id)}`, { method: "DELETE" }),
  a2aAgentStatus: (id: string, status: string) =>
    request<any>(`/api/v1/a2a/registry/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  a2aNegotiate: (body: { task_type: string; task_description?: string; required_capabilities?: string[] }) =>
    request<any>("/api/v1/a2a/negotiate", { method: "POST", body: JSON.stringify(body) }),
  a2aDispatch: (body: { agent_id: string; task_id: string; payload?: Record<string, unknown> }) =>
    request<any>("/api/v1/a2a/dispatch", { method: "POST", body: JSON.stringify(body) }),
  a2aDispatches: (agentId = "", status = "") => request<any>(`/api/v1/a2a/dispatch?agent_id=${agentId}&status=${status}`),
  a2aEvidence: (agentId = "") => request<any>(`/api/v1/a2a/evidence?agent_id=${agentId}`),
  a2aReceiveEvidence: (body: { dispatch_id: string; status: string; artifact?: Record<string, unknown>; confidence?: number }) =>
    request<any>("/api/v1/a2a/evidence", { method: "POST", body: JSON.stringify(body) }),
  a2aSummary: () => request<any>("/api/v1/a2a/summary"),

  // ── LLM Gateway v2 ──────────────────────────────────────────────────────
  llmRoutes: () => request<any>("/api/v1/llm-gateway/routes"),
  llmRouteCreate: (body: { name: string; task_type?: string; model_id: string; priority?: number; fallback_model_id?: string }) =>
    request<any>("/api/v1/llm-gateway/routes", { method: "POST", body: JSON.stringify(body) }),
  llmRouteUpdate: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/llm-gateway/routes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  llmRouteDelete: (id: string) =>
    request<any>(`/api/v1/llm-gateway/routes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  llmResolveRoute: (taskType = "general") =>
    request<any>(`/api/v1/llm-gateway/resolve?task_type=${encodeURIComponent(taskType)}`, { method: "POST" }),
  llmCostStats: (modelId = "", period = "7d") =>
    request<any>(`/api/v1/llm-gateway/cost?model_id=${modelId}&period=${period}`),
  llmRecordCost: (body: { model_id: string; prompt_tokens?: number; completion_tokens?: number; cost_usd?: number; latency_ms?: number; task_type?: string }) =>
    request<any>("/api/v1/llm-gateway/cost", { method: "POST", body: JSON.stringify(body) }),
  llmThrottle: () => request<any>("/api/v1/llm-gateway/throttle"),
  llmThrottleCreate: (body: { model_id: string; rpm_limit?: number; tpm_limit?: number }) =>
    request<any>("/api/v1/llm-gateway/throttle", { method: "POST", body: JSON.stringify(body) }),
  llmThrottleUpdate: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/llm-gateway/throttle/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  llmThrottleDelete: (id: string) =>
    request<any>(`/api/v1/llm-gateway/throttle/${encodeURIComponent(id)}`, { method: "DELETE" }),
  llmGatewaySummary: () => request<any>("/api/v1/llm-gateway/summary"),

  // ── Ops Center ──────────────────────────────────────────────────────────
  opsPipelines: () => request<any>("/api/v1/ops-center/pipelines"),
  opsPipelineCreate: (body: { name: string; environment?: string; steps?: string[] }) =>
    request<any>("/api/v1/ops-center/pipelines", { method: "POST", body: JSON.stringify(body) }),
  opsPipelineTrigger: (id: string) =>
    request<any>(`/api/v1/ops-center/pipelines/${encodeURIComponent(id)}/trigger`, { method: "PUT" }),
  opsPipelineStatus: (id: string, body: { status: string; duration_s?: number; error_msg?: string }) =>
    request<any>(`/api/v1/ops-center/pipelines/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify(body) }),
  opsPipelineDelete: (id: string) =>
    request<any>(`/api/v1/ops-center/pipelines/${encodeURIComponent(id)}`, { method: "DELETE" }),
  opsRca: () => request<any>("/api/v1/ops-center/rca"),
  opsRcaCreate: (body: { incident_id: string; root_cause: string; impact?: string; resolution?: string }) =>
    request<any>("/api/v1/ops-center/rca", { method: "POST", body: JSON.stringify(body) }),
  opsRcaResolve: (id: string) =>
    request<any>(`/api/v1/ops-center/rca/${encodeURIComponent(id)}/resolve`, { method: "PUT" }),
  opsRunbooks: () => request<any>("/api/v1/ops-center/runbooks"),
  opsRunbookCreate: (body: { name: string; steps?: string[]; tags?: string[] }) =>
    request<any>("/api/v1/ops-center/runbooks", { method: "POST", body: JSON.stringify(body) }),
  opsRunbookDelete: (id: string) =>
    request<any>(`/api/v1/ops-center/runbooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  opsSelfHeal: () => request<any>("/api/v1/ops-center/self-heal"),
  opsSelfHealCreate: (body: { trigger_condition: string; action: string; enabled?: boolean }) =>
    request<any>("/api/v1/ops-center/self-heal", { method: "POST", body: JSON.stringify(body) }),
  opsSelfHealUpdate: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/v1/ops-center/self-heal/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  opsSelfHealApply: (id: string) =>
    request<any>(`/api/v1/ops-center/self-heal/${encodeURIComponent(id)}/apply`, { method: "POST" }),
  opsSelfHealDelete: (id: string) =>
    request<any>(`/api/v1/ops-center/self-heal/${encodeURIComponent(id)}`, { method: "DELETE" }),
  opsCenterSummary: () => request<any>("/api/v1/ops-center/summary"),
};
