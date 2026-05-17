/** React 管理台为默认入口 */
export const SESSION_PREFER_LIGHT_SHELL = "sop-use-light-shell";
const PARAM_SHELL = "shell";

/**
 * 默认以 React 管理台为主：访问站点根路径且无 hash 时停留在 shell。
 * `?shell=1`：兼容旧入口参数，写入 sessionStorage 并去掉 query。
 */
export function maybeRedirectToPrimaryConsole(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get(PARAM_SHELL) === "1") {
    try {
      sessionStorage.setItem(SESSION_PREFER_LIGHT_SHELL, "1");
    } catch {
      /* ignore */
    }
    params.delete(PARAM_SHELL);
    const q = params.toString();
    const path = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
    try {
      window.history.replaceState(null, "", path || "/");
    } catch {
      /* ignore */
    }
  }
}
