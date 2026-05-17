/** 与 docs/USER_MANUAL.md 一致：JWT + 当前项目 ID */
export const TOKEN_KEY = "sop-token";
export const PROJECT_ID_KEY = "sop-current-project-id";
export const TENANT_CODE_KEY = "sop-current-tenant-code";
export const BUSINESS_CODE_KEY = "sop-current-business-code";
export const PROJECT_CODE_KEY = "sop-current-project-code";
export function getToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    }
    catch {
        return null;
    }
}
function getStoredValue(key) {
    try {
        const v = localStorage.getItem(key);
        return v && v.trim() ? v.trim() : null;
    }
    catch {
        return null;
    }
}
export function getProjectId() {
    return getStoredValue(PROJECT_ID_KEY);
}
export function getTenantCode() {
    return getStoredValue(TENANT_CODE_KEY);
}
export function getBusinessCode() {
    return getStoredValue(BUSINESS_CODE_KEY);
}
export function getProjectCode() {
    return getStoredValue(PROJECT_CODE_KEY);
}
export function getWorkspaceScope() {
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
function setOrRemove(key, value) {
    try {
        const next = value && value.trim() ? value.trim() : "";
        const prev = localStorage.getItem(key) || "";
        if (next) {
            localStorage.setItem(key, next);
        }
        else {
            localStorage.removeItem(key);
        }
        return prev !== next;
    }
    catch {
        return false;
    }
}
export function setWorkspaceScope(scope) {
    let changed = false;
    if ("tenantCode" in scope)
        changed = setOrRemove(TENANT_CODE_KEY, scope.tenantCode) || changed;
    if ("businessCode" in scope)
        changed = setOrRemove(BUSINESS_CODE_KEY, scope.businessCode) || changed;
    if ("projectId" in scope)
        changed = setOrRemove(PROJECT_ID_KEY, scope.projectId) || changed;
    if ("projectCode" in scope)
        changed = setOrRemove(PROJECT_CODE_KEY, scope.projectCode) || changed;
    if (changed)
        notifySession();
}
export function setProjectId(projectId) {
    setWorkspaceScope({
        projectId,
        projectCode: projectId,
        businessCode: null,
    });
}
export function setSession(token, projectId, tenantCode) {
    try {
        localStorage.setItem(TOKEN_KEY, token);
        const scope = {
            projectId: projectId ? String(projectId) : null,
            projectCode: projectId ? String(projectId) : null,
        };
        if (tenantCode !== undefined)
            scope.tenantCode = tenantCode;
        setWorkspaceScope(scope);
    }
    catch {
        notifySession();
    }
}
export function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROJECT_ID_KEY);
    localStorage.removeItem(TENANT_CODE_KEY);
    localStorage.removeItem(BUSINESS_CODE_KEY);
    localStorage.removeItem(PROJECT_CODE_KEY);
    notifySession();
}
