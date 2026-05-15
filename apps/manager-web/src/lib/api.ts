/**
 * @ai_safe_edit
 *  - 改 BASE_URL：仅改本文件常量
 *  - 新接口：在末尾加导出 async 函数；TanStack Query 的 hooks 在 hooks/ 目录
 */
import { getProjectId, getToken } from "./authStorage";

const BASE = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  const pid = getProjectId();
  if (pid) h["X-Project-Id"] = pid;
  return h;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseHeaders = authHeaders();
  const extra = (init?.headers || {}) as Record<string, string>;
  const r = await fetch(BASE + path, {
    ...init,
    headers: { ...baseHeaders, ...extra },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => r.statusText);
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; version?: string }>("/api/v1/health"),
  projects: () => request<any[]>("/api/v1/projects"),
  projectOnboarding: (projectId: string) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/onboarding`),
  requirements: () => request<any[]>("/api/v1/requirements"),
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
  deleteRequirement: (id: string) =>
    request<any>(`/api/v1/requirements/${encodeURIComponent(id)}`, { method: "DELETE" }),
  contextMe: () => request<any>("/api/v1/context/me"),
  tasks: (sprintId?: string) => {
    const qs = sprintId ? `?sprint_id=${encodeURIComponent(sprintId)}` : "";
    return request<any[]>(`/api/v1/tasks${qs}`);
  },
  updateTask: (id: string, patch: Record<string, unknown>) =>
    request<any>(`/api/v1/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
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
  sprints: () =>
    request<{ items: any[]; total: number }>("/api/v1/sprints").then((r) => r.items ?? []),
  sprintProgress: (id: string) =>
    request<any>(`/api/v1/sprints/${encodeURIComponent(id)}/progress`),
  workflowTypes: () => request<any[]>("/api/v1/workflows/types"),
  startWorkflow: (body: { type: string; args?: Record<string, unknown> }) =>
    request<any>("/api/v1/workflows/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  marketplaceList: (q = "") =>
    request<{ items: any[]; total: number }>(
      `/api/v1/marketplace/packages?q=${encodeURIComponent(q)}`,
    ),
  auditState: () => request<any>("/api/v1/audit/chain/state"),
  auditVerify: () => request<any>("/api/v1/audit/chain/verify"),
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
  eventsList: (limit = 100, since = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (since) qs.set("since", since);
    return request<{ items: any[]; total: number; cursor: string }>(`/api/v1/events?${qs}`);
  },
  usageSummary: (limit = 5000, since = "") => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (since) qs.set("since", since);
    return request<any>(`/api/v1/usage/summary?${qs}`);
  },
  usageQuota: () => request<any>("/api/v1/usage/quota"),
  usageSetQuota: (limits: Record<string, number>) =>
    request<any>("/api/v1/usage/quota", { method: "PUT", body: JSON.stringify({ limits }) }),
  businesses: () => request<any[]>("/api/v1/businesses"),
  createBusiness: (body: { name: string; description?: string }) =>
    request<any>("/api/v1/businesses", { method: "POST", body: JSON.stringify(body) }),
  platformsList: () => request<any>("/api/v1/platforms"),
  platformsInstallShims: (id: string) =>
    request<any>(`/api/v1/platforms/install-shims/${encodeURIComponent(id)}`, { method: "POST" }),
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
  projectAddMember: (projectId: string, body: { user_id: string; role?: string }) =>
    request<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/members`, {
      method: "POST",
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
  notifyAddChannel: (body: Record<string, unknown>) =>
    request<any>("/api/v1/notify/channels", { method: "POST", body: JSON.stringify(body) }),
  analyticsOverview: () => request<any>("/api/v1/analytics/overview"),
  analyticsNlq: (question: string) =>
    request<any>("/api/v1/analytics/nlq", { method: "POST", body: JSON.stringify({ question }) }),
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
  login: (body: { username: string; password: string; tenant_slug?: string }) =>
    request<{
      token: string;
      user_id: string;
      username: string;
      role: string;
      tenant_id: string;
      tenant_slug?: string;
      tenant_name?: string;
      default_project_id?: string;
    }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
  authMe: () =>
    request<{
      user_id: string;
      username: string;
      role: string;
      tenant_id: string;
      tenant_slug?: string;
      tenant_name?: string;
      email?: string;
    }>("/api/v1/auth/me"),
  tenantOptions: () =>
    request<{
      admin_mode?: "single" | "saas";
      count?: number;
      authorized_for?: string | null;
      items: Array<{ id: string; name: string; slug: string; plan?: string; default?: boolean }>;
    }>("/api/v1/auth/tenant-options"),
  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  metrics: () => fetch(BASE + "/metrics").then((r) => r.text()),
};
