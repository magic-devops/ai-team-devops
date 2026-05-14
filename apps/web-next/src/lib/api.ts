/**
 * @ai_safe_edit
 *  - 改 BASE_URL：仅改本文件常量
 *  - 新接口：在末尾加导出 async 函数；TanStack Query 的 hooks 在 hooks/ 目录
 */
const BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
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
  tasks: () => request<any[]>("/api/v1/tasks"),
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
  copilotAsk: (question: string) =>
    request<any>("/api/v1/copilot/ask", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
  metrics: () => fetch(BASE + "/metrics").then((r) => r.text()),
};
