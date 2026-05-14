/** 轻量 React 壳入口（与 console.html 主产品并存） */
export const SESSION_PREFER_LIGHT_SHELL = "sop-use-light-shell";
const PARAM_SHELL = "shell";

/**
 * 默认以完整管理台为主：访问站点根路径且无 hash 时跳转到 /console.html。
 * - `?shell=1`：写入 sessionStorage，不再自动跳转（并去掉 query 保持地址干净）。
 * - `VITE_PRIMARY_UI=shell`：关闭自动跳转（纯前端开发时可设）。
 */
export function maybeRedirectToPrimaryConsole(): void {
  const primary = import.meta.env.VITE_PRIMARY_UI ?? "console";
  if (primary === "shell") return;

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
    return;
  }

  try {
    if (sessionStorage.getItem(SESSION_PREFER_LIGHT_SHELL) === "1") return;
  } catch {
    return;
  }

  const h = window.location.hash;
  /** 无具体路由：视为「打开站点根」，进入主产品完整台 */
  const bare = h === "" || h === "#" || h === "#/";
  if (!bare) return;

  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/" && !path.endsWith("/index.html")) return;

  window.location.replace(`${window.location.origin}/console.html`);
}
