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
  requirements: () => request<any[]>("/api/v1/requirements"),
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
  copilotAsk: (query: string) =>
    request<any>("/api/v1/copilot/ask", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),
  knowledgeSearch: (q: string, category?: string) => {
    const qs = new URLSearchParams({ q });
    if (category) qs.set("category", category);
    return request<any[]>(`/api/v1/knowledge/search?${qs}`);
  },
  memoryHealth: () => request<any>("/api/v1/memory/health"),
  memoryRecent: (limit = 30) =>
    request<any>(`/api/v1/memory/recent?limit=${encodeURIComponent(String(limit))}`),
  memorySearch: (q: string, limit = 20) =>
    request<any>(
      `/api/v1/memory/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`,
    ),
  memoryAdd: (body: { content: string; kind?: string; metadata?: Record<string, unknown> }) =>
    request<any>("/api/v1/memory", { method: "POST", body: JSON.stringify(body) }),
  businesses: () => request<any[]>("/api/v1/businesses"),
  platformsList: () => request<any>("/api/v1/platforms"),
  platformsInstallShims: (id: string) =>
    request<any>(`/api/v1/platforms/install-shims/${encodeURIComponent(id)}`, { method: "POST" }),
  authUsers: () => request<any[]>("/api/v1/auth/users"),
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
      default_project_id?: string;
    }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
  metrics: () => fetch(BASE + "/metrics").then((r) => r.text()),
};
