/** 与 docs/USER_MANUAL.md 一致：JWT + 当前项目 ID */
export const TOKEN_KEY = "sop-token";
export const PROJECT_ID_KEY = "sop-current-project-id";
export function getToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    }
    catch {
        return null;
    }
}
export function getProjectId() {
    try {
        const v = localStorage.getItem(PROJECT_ID_KEY);
        return v && v.trim() ? v.trim() : null;
    }
    catch {
        return null;
    }
}
function notifySession() {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sop-session"));
    }
}
export function setProjectId(projectId) {
    try {
        if (projectId && projectId.trim()) {
            localStorage.setItem(PROJECT_ID_KEY, projectId.trim());
        }
        else {
            localStorage.removeItem(PROJECT_ID_KEY);
        }
        notifySession();
    }
    catch {
        /* ignore */
    }
}
export function setSession(token, projectId) {
    localStorage.setItem(TOKEN_KEY, token);
    if (projectId && String(projectId).trim()) {
        localStorage.setItem(PROJECT_ID_KEY, String(projectId).trim());
    }
    else {
        localStorage.removeItem(PROJECT_ID_KEY);
    }
    notifySession();
}
export function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROJECT_ID_KEY);
    notifySession();
}
