/**
 * @ai_safe_edit
 *   - 新增页面：在 src/pages/ 加文件 + 在 NAV 数组加项
 *   - 改主题：tailwind.config.js 的 brand 色阶
 *   - 路由：当前用最小化 hash 路由；如需 nested route 切换到 @tanstack/react-router
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dashboard } from "./pages/Dashboard";
import { Projects } from "./pages/Projects";
import { Tasks } from "./pages/Tasks";
import { Workflows } from "./pages/Workflows";
import { Marketplace } from "./pages/Marketplace";
import { Audit } from "./pages/Audit";
import { Copilot } from "./pages/Copilot";
import { Settings } from "./pages/Settings";

const NAV = [
  { key: "dashboard", path: "#/dashboard", el: <Dashboard /> },
  { key: "projects", path: "#/projects", el: <Projects /> },
  { key: "tasks", path: "#/tasks", el: <Tasks /> },
  { key: "workflows", path: "#/workflows", el: <Workflows /> },
  { key: "marketplace", path: "#/marketplace", el: <Marketplace /> },
  { key: "audit", path: "#/audit", el: <Audit /> },
  { key: "copilot", path: "#/copilot", el: <Copilot /> },
  { key: "settings", path: "#/settings", el: <Settings /> },
] as const;

export function App() {
  const { t, i18n } = useTranslation();
  const [hash, setHash] = useState(window.location.hash || "#/dashboard");

  useEffect(() => {
    const h = () => setHash(window.location.hash || "#/dashboard");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  const current = NAV.find((n) => hash.startsWith(n.path)) ?? NAV[0];

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="px-5 py-4 text-lg font-semibold text-brand-600">SOP Manager</div>
        <nav className="px-2">
          {NAV.map((n) => (
            <a
              key={n.key}
              href={n.path}
              className={`block rounded px-3 py-2 text-sm ${
                current.key === n.key
                  ? "bg-brand-50 text-brand-700"
                  : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {t(`nav.${n.key}`)}
            </a>
          ))}
        </nav>
      </aside>
      <main className="flex-1 px-6 py-5">
        <header className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t(`page.${current.key}.title`)}</h1>
          <select
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:bg-zinc-800 dark:border-zinc-700"
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            aria-label="language"
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
            <option value="ja-JP">日本語</option>
          </select>
        </header>
        {current.el}
      </main>
    </div>
  );
}
