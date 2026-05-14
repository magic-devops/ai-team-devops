import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Activity, FolderKanban, ListTodo, Shield } from "lucide-react";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { getToken } from "../lib/authStorage";

function Err({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
      {message}
    </div>
  );
}

function StatCard({
  title,
  icon: Icon,
  accent,
  children,
}: {
  title: string;
  icon: LucideIcon;
  accent: "sky" | "violet" | "emerald" | "amber";
  children: React.ReactNode;
}) {
  const border =
    accent === "sky"
      ? "border-l-sky-500"
      : accent === "violet"
        ? "border-l-violet-500"
        : accent === "emerald"
          ? "border-l-emerald-500"
          : "border-l-amber-500";

  return (
    <Card
      className={`border-l-4 ${border} bg-gradient-to-br from-white to-slate-50/90 pl-4 dark:from-slate-900/80 dark:to-slate-900/40`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</p>
          <div className="mt-2">{children}</div>
        </div>
        <div className="rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-slate-800/90 dark:text-slate-400" aria-hidden>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { t } = useTranslation();
  const [, bump] = useState(0);
  const hasToken = Boolean(getToken());

  useEffect(() => {
    const onSession = () => bump((x) => x + 1);
    window.addEventListener("sop-session", onSession);
    return () => window.removeEventListener("sop-session", onSession);
  }, []);

  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });
  const audit = useQuery({ queryKey: ["audit"], queryFn: api.auditState });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3">
        {!hasToken ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-50/95"
          >
            <span>{t("auth.dashboardNeedLogin")}</span>
            <a
              href="#/settings"
              className="inline-flex items-center rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400"
            >
              {t("auth.openSettings")}
            </a>
          </div>
        ) : null}

        <div className="rounded-xl border border-sky-200/70 bg-gradient-to-br from-sky-50/90 via-white to-indigo-50/50 px-4 py-3 text-sm text-slate-800 shadow-sm dark:border-sky-500/20 dark:from-slate-900/90 dark:via-slate-900/70 dark:to-indigo-950/30 dark:text-slate-200">
          <p className="font-medium leading-relaxed">
            <span className="text-sky-900 dark:text-sky-200">{t("dashboard.fullConsoleTitle")}</span>{" "}
            <span className="text-slate-700 dark:text-slate-300">{t("dashboard.fullConsoleBody")}</span>
          </p>
          <p className="mt-2 flex flex-wrap gap-2">
            <a
              href="/console.html"
              className="inline-flex items-center rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
            >
              {t("dashboard.openConsoleCta")}
            </a>
            <a
              href="/login.html"
              className="inline-flex items-center rounded-lg border border-sky-200/90 bg-white/90 px-3 py-1.5 text-xs font-medium text-sky-900 shadow-sm hover:bg-white dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              {t("dashboard.openLoginCta")}
            </a>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t("nav.projects")} icon={FolderKanban} accent="sky">
          {projects.isPending ? (
            <div className="h-9 w-16 animate-pulse rounded-md bg-zinc-200/90 dark:bg-zinc-700" />
          ) : projects.isError ? (
            <Err message={(projects.error as Error).message} />
          ) : (
            <div className="text-3xl font-bold tabular-nums tracking-tight text-brand-700 dark:text-brand-400">
              {projects.data?.length ?? "—"}
            </div>
          )}
        </StatCard>

        <StatCard title={t("nav.tasks")} icon={ListTodo} accent="violet">
          {tasks.isPending ? (
            <div className="h-9 w-16 animate-pulse rounded-md bg-zinc-200/90 dark:bg-zinc-700" />
          ) : tasks.isError ? (
            <Err message={(tasks.error as Error).message} />
          ) : (
            <div className="text-3xl font-bold tabular-nums tracking-tight text-brand-700 dark:text-brand-400">
              {tasks.data?.length ?? "—"}
            </div>
          )}
        </StatCard>

        <StatCard title="Manager" icon={Activity} accent="emerald">
          {health.isPending ? (
            <div className="h-9 w-24 animate-pulse rounded-md bg-zinc-200/90 dark:bg-zinc-700" />
          ) : health.isError ? (
            <Err message={(health.error as Error).message} />
          ) : (
            <div className="font-mono text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {health.data?.ok === true ? (
                <>
                  <span className="text-emerald-600 dark:text-emerald-400">ok</span>
                  <span className="text-zinc-400"> · </span>
                  <span>{String(health.data?.version ?? "—")}</span>
                </>
              ) : (
                "—"
              )}
            </div>
          )}
        </StatCard>

        <StatCard title={t("nav.audit")} icon={Shield} accent="amber">
          <div className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
            {audit.isPending ? <div className="text-zinc-500">{t("common.loading")}</div> : null}
            {audit.isError ? <Err message={(audit.error as Error).message} /> : null}
            {audit.data ? (
              <>
                <div className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {audit.data.count}
                </div>
                <div className="truncate font-mono text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
                  {String(audit.data.prev_hash ?? "").slice(0, 24)}…
                </div>
              </>
            ) : !audit.isPending && !audit.isError ? (
              <span className="text-zinc-400">—</span>
            ) : null}
          </div>
        </StatCard>
      </div>
    </div>
  );
}
