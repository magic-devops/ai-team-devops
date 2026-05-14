import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { clearSession, getProjectId, getToken, setSession } from "../lib/authStorage";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";

export function Settings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [themePref, setThemePref] = useState<ThemePreference>(() => getThemePreference());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");

  const token = getToken();
  const projectId = getProjectId();

  useEffect(() => {
    const sync = () => setThemePref(getThemePreference());
    window.addEventListener("sop-theme", sync);
    return () => window.removeEventListener("sop-theme", sync);
  }, []);

  const login = useMutation({
    mutationFn: () =>
      api.login({
        username: username.trim(),
        password,
        ...(tenantSlug.trim() ? { tenant_slug: tenantSlug.trim() } : {}),
      }),
    onSuccess: (data) => {
      setSession(data.token, data.default_project_id || undefined);
      setPassword("");
      void qc.invalidateQueries();
    },
  });

  return (
    <div className="space-y-4">
      <Card title={t("auth.title")}>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{t("auth.hint")}</p>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          <a href="/console.html" className="font-medium text-brand-700 underline dark:text-brand-400">
            {t("auth.consoleLink")}
          </a>
        </p>
        {token ? (
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-zinc-500">{t("auth.status")}</span>{" "}
              <span className="font-medium text-emerald-600">{t("auth.loggedIn")}</span>
            </div>
            {projectId ? (
              <div className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                X-Project-Id: {projectId}
              </div>
            ) : (
              <div className="text-xs text-amber-700 dark:text-amber-400">
                {t("auth.noProject")}
              </div>
            )}
            <button
              type="button"
              className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
              onClick={() => {
                clearSession();
                void qc.invalidateQueries();
              }}
            >
              {t("auth.logout")}
            </button>
          </div>
        ) : (
          <form
            className="max-w-md space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
          >
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">{t("auth.username")}</span>
              <input
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">{t("auth.password")}</span>
              <input
                type="password"
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">{t("auth.tenantSlug")}</span>
              <input
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder={t("auth.tenantPlaceholder")}
              />
            </label>
            <button
              type="submit"
              disabled={!username.trim() || !password || login.isPending}
              className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {t("auth.login")}
            </button>
            {login.error ? (
              <div className="text-sm text-red-600">{(login.error as Error).message}</div>
            ) : null}
          </form>
        )}
      </Card>

      <Card title={t("page.settings.themeCard")}>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t("theme.hint")}</p>
        <label className="block max-w-xs text-sm text-slate-700 dark:text-slate-300">
          <span className="mb-1 block font-medium">{t("theme.label")}</span>
          <select
            value={themePref}
            onChange={(e) => {
              const v = e.target.value as ThemePreference;
              setThemePreference(v);
              setThemePref(v);
            }}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100"
          >
            <option value="light">{t("theme.light")}</option>
            <option value="dark">{t("theme.dark")}</option>
            <option value="system">{t("theme.system")}</option>
          </select>
        </label>
      </Card>
    </div>
  );
}
