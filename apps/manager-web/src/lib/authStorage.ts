/** 与 docs/USER_MANUAL.md 一致：JWT + 当前项目 ID */
export const TOKEN_KEY = "sop-token";
export const PROJECT_ID_KEY = "sop-current-project-id";
export const TENANT_CODE_KEY = "sop-current-tenant-code";
export const BUSINESS_CODE_KEY = "sop-current-business-code";
export const PROJECT_CODE_KEY = "sop-current-project-code";
export const USER_KEY = "sop-user";
const SESSION_REVISION_KEY = "sop-session-revision";

export type WorkspaceScope = {
  tenantCode?: string | null;
  businessCode?: string | null;
  projectId?: string | null;
  projectCode?: string | null;
};

export type SessionPayload = {
  access_token?: string | null;
  token?: string | null;
  user_id?: string | null;
  username?: string | null;
  email?: string | null;
  role?: string | null;
  tenant_id?: string | null;
  tenant_code?: string | null;
  tenant_slug?: string | null;
  tenant_name?: string | null;
  default_project_id?: string | null;
  default_project_code?: string | null;
  default_business_code?: string | null;
  workspace_scope?: {
    tenant_code?: string | null;
    business_code?: string | null;
    project_id?: string | null;
    project_code?: string | null;
  } | null;
  permissions?: Record<string, unknown> | null;
  session_status?: string | null;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isExpiredJwt(token: string): boolean {
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === "number" ? payload.exp : Number(payload?.exp);
  return Number.isFinite(exp) && exp <= Math.floor(Date.now() / 1000);
}

export function getToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token && isExpiredJwt(token)) {
      clearSession();
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

function getStoredValue(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Distinguishes separate logins even when the server reissues the same JWT. */
export function getSessionRevision(): string | null {
  return getStoredValue(SESSION_REVISION_KEY);
}

function renewSessionRevision() {
  localStorage.setItem(SESSION_REVISION_KEY, globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
}

export function getProjectId(): string | null {
  return getStoredValue(PROJECT_ID_KEY);
}

export function getTenantCode(): string | null {
  return getStoredValue(TENANT_CODE_KEY);
}

export function getBusinessCode(): string | null {
  return getStoredValue(BUSINESS_CODE_KEY);
}

export function getProjectCode(): string | null {
  return getStoredValue(PROJECT_CODE_KEY);
}

export function getWorkspaceScope(): Required<WorkspaceScope> {
  return {
    tenantCode: getTenantCode(),
    businessCode: getBusinessCode(),
    projectId: getProjectId(),
    projectCode: getProjectCode() || getProjectId(),
  };
}

function notifySession() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("sop-session"));
  }
}

function setOrRemove(key: string, value: string | null | undefined): boolean {
  try {
    const next = value && value.trim() ? value.trim() : "";
    const prev = localStorage.getItem(key) || "";
    if (next) {
      localStorage.setItem(key, next);
    } else {
      localStorage.removeItem(key);
    }
    return prev !== next;
  } catch {
    return false;
  }
}

export function setWorkspaceScope(scope: WorkspaceScope) {
  let changed = false;
  if ("tenantCode" in scope) changed = setOrRemove(TENANT_CODE_KEY, scope.tenantCode) || changed;
  if ("businessCode" in scope) changed = setOrRemove(BUSINESS_CODE_KEY, scope.businessCode) || changed;
  if ("projectId" in scope) changed = setOrRemove(PROJECT_ID_KEY, scope.projectId) || changed;
  if ("projectCode" in scope) changed = setOrRemove(PROJECT_CODE_KEY, scope.projectCode) || changed;
  if (changed) notifySession();
}

export function setProjectId(projectId: string | null) {
  setWorkspaceScope({
    projectId,
    projectCode: projectId,
    businessCode: null,
  });
}

export function setSession(token: string, projectId: string | null | undefined, tenantCode?: string | null) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    renewSessionRevision();
    const scope: WorkspaceScope = {
      projectId: projectId ? String(projectId) : null,
      projectCode: projectId ? String(projectId) : null,
    };
    if (tenantCode !== undefined) scope.tenantCode = tenantCode;
    setWorkspaceScope(scope);
    notifySession();
  } catch {
    notifySession();
  }
}

export function setUserSession(payload: SessionPayload, options: { preserveWorkspace?: boolean } = {}) {
  try {
    const token = payload.token || payload.access_token;
    if (token) {
      localStorage.setItem(TOKEN_KEY, String(token));
      renewSessionRevision();
    }
    if (payload.user_id || payload.username || payload.role || payload.tenant_id) {
      localStorage.setItem(USER_KEY, JSON.stringify({
        id: payload.user_id || "",
        username: payload.username || "",
        email: payload.email || "",
        role: payload.role || "",
        tenant_id: payload.tenant_id || "",
        tenant_code: payload.tenant_code || "",
        tenant_slug: payload.tenant_slug || "",
        tenant_name: payload.tenant_name || "",
        permissions: payload.permissions || null,
        session_status: payload.session_status || "active",
      }));
    }
    if (!options.preserveWorkspace || !getProjectId()) {
      const ws = payload.workspace_scope || {};
      setWorkspaceScope({
        tenantCode: ws.tenant_code || payload.tenant_code || payload.tenant_slug || payload.tenant_id || null,
        businessCode: ws.business_code || payload.default_business_code || null,
        projectId: ws.project_id || payload.default_project_id || null,
        projectCode: ws.project_code || payload.default_project_code || ws.project_id || payload.default_project_id || null,
      });
    }
    if (token) notifySession();
  } catch {
    notifySession();
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_REVISION_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(PROJECT_ID_KEY);
  localStorage.removeItem(TENANT_CODE_KEY);
  localStorage.removeItem(BUSINESS_CODE_KEY);
  localStorage.removeItem(PROJECT_CODE_KEY);
  notifySession();
}
