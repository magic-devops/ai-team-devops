import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, ExternalLink, LogOut, Palette, ServerCog, ShieldCheck, SlidersHorizontal, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { clearSession, getProjectId, getToken } from "../lib/authStorage";
import { getThemePreference, setThemePreference, THEME_OPTIONS, type ThemePreference } from "../lib/theme";

function currentRedirectTarget() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/?shell=1#/dashboard";
}

export function Settings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [themePref, setThemePref] = useState<ThemePreference>(() => getThemePreference());
  const token = getToken();
  const projectId = getProjectId();
  const me = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, enabled: Boolean(token), retry: false });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, enabled: Boolean(token), retry: false });

  useEffect(() => {
    const sync = () => setThemePref(getThemePreference());
    window.addEventListener("sop-theme", sync);
    return () => window.removeEventListener("sop-theme", sync);
  }, []);

  useEffect(() => {
    if (!token) {
      window.location.replace(`/login.html?redirect=${encodeURIComponent(currentRedirectTarget())}`);
    }
  }, [token]);

  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      clearSession();
      void qc.invalidateQueries();
      window.location.assign("/login.html");
    },
  });

  if (!token) return null;

  const tenantLabel = me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || "-";
  const healthOk = health.data?.ok === true;

  return (
    <div className="w-full space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
        <Card
          title={t("page.settings.accountCard")}
          actions={<StatusPill tone={me.isError ? "danger" : "ok"} label={me.isError ? t("page.settings.sessionError") : t("auth.secure")} />}
        >
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <ShieldCheck className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-[var(--text)]">{me.data?.username || t("auth.account")}</p>
                  <p className="truncate text-xs text-[var(--muted)]">{me.data?.email || me.data?.role || t("auth.loggedIn")}</p>
                </div>
              </div>
              <button
                type="button"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)] disabled:opacity-50"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <LogOut className="h-4 w-4 text-[var(--brand)]" />
                {t("auth.logout")}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Info label={t("auth.status")} value={t("auth.loggedIn")} />
              <Info label={t("auth.role")} value={me.data?.role || "-"} />
              <Info label={t("auth.tenant")} value={tenantLabel} />
              <Info label={t("auth.project")} value={projectId || "-"} />
            </div>
          </div>
          {me.isError ? <ErrorLine message={(me.error as Error).message} /> : null}
          {!projectId ? <HintLine message={t("auth.noProject")} /> : null}
        </Card>

        <Card title={t("page.settings.runtimeCard")} actions={<StatusPill tone={healthOk ? "ok" : health.isError ? "danger" : "warn"} label={healthOk ? "OK" : health.isError ? "ERR" : "..."} />}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Info label={t("page.settings.manager")} value={healthOk ? "online" : health.isError ? "error" : t("common.loading")} />
            <Info label={t("page.settings.version")} value={String(health.data?.version ?? "-")} />
            <Info label={t("page.settings.apiBase")} value={window.location.origin} />
          </div>
          {health.isError ? <ErrorLine message={(health.error as Error).message} /> : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SettingLink href="/api/v1/health" icon={<ServerCog className="h-5 w-5" />} title={t("page.settings.healthTitle")} body={t("page.settings.healthDesc")} external />
            <SettingLink href="/metrics" icon={<SlidersHorizontal className="h-5 w-5" />} title={t("page.settings.metricsTitle")} body={t("page.settings.metricsDesc")} external />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <Card title={t("page.settings.workspaceCard")}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SettingLink href="#/organization" icon={<UsersRound className="h-5 w-5" />} title={t("page.settings.orgTitle")} body={t("page.settings.orgDesc")} />
            <SettingLink href="#/intelligence" icon={<Database className="h-5 w-5" />} title={t("page.settings.dbTitle")} body={t("page.settings.dbDesc")} />
            <SettingLink href="/console.html" icon={<ExternalLink className="h-5 w-5" />} title={t("page.settings.consoleTitle")} body={t("page.settings.consoleDesc")} external />
            <SettingLink href="/login.html" icon={<ShieldCheck className="h-5 w-5" />} title={t("page.settings.loginTitle")} body={t("page.settings.loginDesc")} external />
          </div>
        </Card>

        <Card title={t("page.settings.themeCard")}>
          <p className="mb-3 text-sm leading-6 text-[var(--muted)]">{t("theme.hint")}</p>
          <div className="grid grid-cols-2 gap-2">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme}
                type="button"
                onClick={() => {
                  setThemePreference(theme);
                  setThemePref(theme);
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  themePref === theme
                    ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                  <Palette className="h-4 w-4" />
                </span>
                <span className="block text-sm font-semibold">{t(`theme.${theme}`)}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs text-[var(--muted-strong)]">{value}</dd>
    </div>
  );
}

function SettingLink({ href, title, body, icon, external = false }: { href: string; title: string; body: string; icon: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      className="group flex min-h-32 flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">{icon}</span>
      <span>
        <span className="mt-3 block text-sm font-semibold text-[var(--text)]">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{body}</span>
      </span>
    </a>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "warn" | "danger"; label: string }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
      : tone === "danger"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function ErrorLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">{message}</div>;
}

function HintLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">{message}</div>;
}
