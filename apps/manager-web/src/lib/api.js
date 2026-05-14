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
    tasks: () => request("/api/v1/tasks"),
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
    login: (body) => request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
    metrics: () => fetch(BASE + "/metrics").then((r) => r.text()),
};
