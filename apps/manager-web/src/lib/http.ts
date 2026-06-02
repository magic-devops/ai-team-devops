import { clearSession, getToken, getWorkspaceScope, setUserSession, setWorkspaceScope, type SessionPayload } from "./authStorage";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

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
  const r = await fetch(API_BASE + "/api/v1/projects", { headers: authHeaders() });
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
      const r = await fetch(API_BASE + "/api/v1/auth/me", {
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

export async function request<T>(path: string, init?: RequestInit, retriedProjectScope = false): Promise<T> {
  if (!path.startsWith("/api/v1/auth/") && getToken() && !getWorkspaceScope().projectId) {
    await hydrateSessionScope();
  }
  const baseHeaders = authHeaders();
  const extra = (init?.headers || {}) as Record<string, string>;
  const r = await fetch(API_BASE + path, {
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
