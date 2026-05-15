/**
 * @ai_safe_edit
 *  - 改 BASE_URL：仅改本文件常量
 *  - 新接口：在末尾加导出 async 函数；TanStack Query 的 hooks 在 hooks/ 目录
 */
import { getProjectId, getToken } from "./authStorage";
const BASE = import.meta.env.VITE_API_BASE ?? "";
function authHeaders() {
    const h = { "Content-Type": "application/json" };
    const token = getToken();
    if (token)
        h.Authorization = `Bearer ${token}`;
    const pid = getProjectId();
    if (pid)
        h["X-Project-Id"] = pid;
    return h;
}
async function request(path, init) {
    const baseHeaders = authHeaders();
    const extra = (init?.headers || {});
    const r = await fetch(BASE + path, {
        ...init,
        headers: { ...baseHeaders, ...extra },
    });
    if (!r.ok) {
        const txt = await r.text().catch(() => r.statusText);
        throw new Error(`HTTP ${r.status}: ${txt}`);
    }
    return r.json();
}
export const api = {
    health: () => request("/api/v1/health"),
    projects: () => request("/api/v1/projects"),
    requirements: () => request("/api/v1/requirements"),
    contextMe: () => request("/api/v1/context/me"),
    tasks: (sprintId) => {
        const qs = sprintId ? `?sprint_id=${encodeURIComponent(sprintId)}` : "";
        return request(`/api/v1/tasks${qs}`);
    },
    updateTask: (id, patch) => request(`/api/v1/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    }),
    reorderTasksBoard: (groups) => request("/api/v1/tasks/reorder-board", {
        method: "POST",
        body: JSON.stringify({ groups }),
    }),
    createTask: (body) => request("/api/v1/tasks", { method: "POST", body: JSON.stringify(body) }),
    sprints: () => request("/api/v1/sprints").then((r) => r.items ?? []),
    sprintProgress: (id) => request(`/api/v1/sprints/${encodeURIComponent(id)}/progress`),
    workflowTypes: () => request("/api/v1/workflows/types"),
    startWorkflow: (body) => request("/api/v1/workflows/start", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    marketplaceList: (q = "") => request(`/api/v1/marketplace/packages?q=${encodeURIComponent(q)}`),
    auditState: () => request("/api/v1/audit/chain/state"),
    auditVerify: () => request("/api/v1/audit/chain/verify"),
    copilotAsk: (query) => request("/api/v1/copilot/ask", {
        method: "POST",
        body: JSON.stringify({ query }),
    }),
    knowledgeSearch: (q, category) => {
        const qs = new URLSearchParams({ q });
        if (category)
            qs.set("category", category);
        return request(`/api/v1/knowledge/search?${qs}`);
    },
    memoryHealth: () => request("/api/v1/memory/health"),
    memoryRecent: (limit = 30) => request(`/api/v1/memory/recent?limit=${encodeURIComponent(String(limit))}`),
    memorySearch: (q, limit = 20) => request(`/api/v1/memory/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`),
    memoryAdd: (body) => request("/api/v1/memory", { method: "POST", body: JSON.stringify(body) }),
    businesses: () => request("/api/v1/businesses"),
    platformsList: () => request("/api/v1/platforms"),
    platformsInstallShims: (id) => request(`/api/v1/platforms/install-shims/${encodeURIComponent(id)}`, { method: "POST" }),
    authUsers: () => request("/api/v1/auth/users"),
    notifyChannels: () => request("/api/v1/notify/channels"),
    notifyAddChannel: (body) => request("/api/v1/notify/channels", { method: "POST", body: JSON.stringify(body) }),
    analyticsOverview: () => request("/api/v1/analytics/overview"),
    analyticsNlq: (question) => request("/api/v1/analytics/nlq", { method: "POST", body: JSON.stringify({ question }) }),
    ragSearch: (query, limit = 8) => request("/api/v1/rag/search", {
        method: "POST",
        body: JSON.stringify({ query, limit, hybrid: true, rerank: true }),
    }),
    workerEnqueue: (type, payload = {}) => request("/api/v1/worker/jobs", {
        method: "POST",
        body: JSON.stringify({ type, payload }),
    }),
    login: (body) => request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
    metrics: () => fetch(BASE + "/metrics").then((r) => r.text()),
};
