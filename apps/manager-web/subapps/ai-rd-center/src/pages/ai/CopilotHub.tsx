import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Command, Network } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  chat: Bot,
  commands: Command,
  "tool-plan": Network,
};

const DOMAIN_I18N: Record<string, string> = {
  chat: "nav.copilot",
  commands: "nav.copilotCommands",
  "tool-plan": "nav.copilotToolPlan",
};

export function CopilotHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["copilotHub"], queryFn: api.copilotHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const recent = hubQ.data?.recent_sessions ?? [];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.copilot.hubTitle")}
        description={t("page.copilot.hubDesc")}
        actions={
          <>
            <a
              href="#/copilot/chat"
              className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              {t("page.copilot.openChat")}
            </a>
            <RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.copilot.hubSessions"), value: summary.sessions ?? 0 },
              { label: t("page.copilot.hubSkills"), value: summary.skills ?? 0 },
            ]}
          />
        }
      />
      <Card title={t("page.copilot.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? Bot;
            const labelKey = DOMAIN_I18N[domain.id];
            return (
              <a
                key={domain.id}
                href={domain.path}
                className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
              >
                <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">
                    {labelKey ? t(labelKey) : domain.id}
                    <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">{domain.path}</span>
                </span>
              </a>
            );
          })}
        </div>
      </Card>
      {recent.length ? (
        <Card title={t("page.copilot.recentSessions")}>
          <ul className="divide-y divide-[var(--border)]">
            {recent.map((s: { session_id: string; title?: string; updated_at?: string }) => (
              <li key={s.session_id} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                <a href="#/copilot/chat" className="font-medium text-[var(--brand)] hover:underline">
                  {s.title || s.session_id}
                </a>
                <span className="text-xs text-[var(--muted)]">{s.updated_at}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
