import { clearSession, getSessionRevision, getToken, getWorkspaceScope, setUserSession, type SessionPayload } from "./authStorage";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type SessionContext = { token: string | null; revision: string | null; scope: ReturnType<typeof getWorkspaceScope> };

function sessionContext(): SessionContext {
  return { token: getToken(), revision: getSessionRevision(), scope: getWorkspaceScope() };
}

function sessionKey(context: SessionContext): string {
  return JSON.stringify(context);
}

function assertCurrent(context: SessionContext) {
  if (sessionKey(context) !== sessionKey(sessionContext())) {
    throw new Error("账号或项目已切换，请在当前工作区重新操作");
  }
}

function authHeaders(context: SessionContext): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const { token, scope } = context;
  if (token) h.Authorization = `Bearer ${token}`;
  if (scope.tenantCode) h["X-Tenant-Code"] = scope.tenantCode;
  if (scope.businessCode) h["X-Business-Code"] = scope.businessCode;
  if (scope.projectId) h["X-Project-Id"] = scope.projectId;
  if (scope.projectCode) h["X-Project-Code"] = scope.projectCode;
  return h;
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

function clearStaleSessionOnUnauthorized(context: SessionContext, path: string, status: number, body: string) {
  assertCurrent(context);
  if (isAuthProbePath(path) && isSessionUnauthorized(status, body) && context.token) clearSession();
}

function redirectToLogin() {
  if (typeof window === "undefined" || !window.location) return;
  if (window.location.pathname.endsWith("/login.html")) return;
  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(`/login.html?redirect=${encodeURIComponent(redirect)}`);
}

const sessionHydrations = new Map<string, Promise<SessionContext>>();

async function hydrateSessionScope(context: SessionContext): Promise<SessionContext> {
  assertCurrent(context);
  if (context.scope.projectId || !context.token) return context;
  const key = sessionKey(context);
  let hydration = sessionHydrations.get(key);
  if (!hydration) {
    hydration = (async () => {
      const r = await fetch(API_BASE + "/api/v1/auth/me", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${context.token}`,
        },
      });
      assertCurrent(context);
      if (!r.ok) {
        const txt = await r.text().catch(() => r.statusText);
        clearStaleSessionOnUnauthorized(context, "/api/v1/auth/me", r.status, txt);
        if (isSessionUnauthorized(r.status, txt)) throw new Error(`HTTP ${r.status}: ${txt}`);
        return context;
      }
      const data = await r.json().catch(() => null) as SessionPayload | null;
      assertCurrent(context);
      if (!data) return context;
      setUserSession(data, { preserveWorkspace: true });
      return sessionContext();
    })().finally(() => {
      if (sessionHydrations.get(key) === hydration) sessionHydrations.delete(key);
    });
    sessionHydrations.set(key, hydration);
  }
  return hydration;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestInSession<T>(path, init, sessionContext());
}

async function requestInSession<T>(path: string, init: RequestInit | undefined, context: SessionContext): Promise<T> {
  if (!path.startsWith("/api/v1/auth/") && context.token && !context.scope.projectId) {
    context = await hydrateSessionScope(context);
  }
  assertCurrent(context);
  const headers = authHeaders(context);
  new Headers(init?.headers).forEach((value, name) => {
    const canonical = Object.keys(headers).find((key) => key.toLowerCase() === name) || name;
    headers[canonical] = value;
  });
  const usesCurrentToken = new Headers(headers).get("Authorization") === `Bearer ${context.token}`;
  const r = await fetch(API_BASE + path, {
    ...init,
    headers,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => r.statusText);
    assertCurrent(context);
    const shouldRedirectLogin = usesCurrentToken && isAuthProbePath(path) && isSessionUnauthorized(r.status, txt);
    if (usesCurrentToken) clearStaleSessionOnUnauthorized(context, path, r.status, txt);
    if (shouldRedirectLogin) redirectToLogin();
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  const data = await r.json() as T;
  assertCurrent(context);
  return data;
}
