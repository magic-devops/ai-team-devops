import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, GitBranch, Sparkles, TerminalIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const DOMAIN_I18N: Record<string, string> = {
  workspace: "page.vibe.hubWorkspace",
  copilot: "nav.copilot",
  cli: "nav.cliTools",
  orchestration: "nav.orchestration",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  workspace: Sparkles,
  copilot: Bot,
  cli: TerminalIcon,
  orchestration: GitBranch,
};

export function VibeHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["vibeHub"], queryFn: api.vibeHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.vibe.hubTitle")}
        description={t("page.vibe.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.vibe.hubSessions"), value: summary.sessions ?? 0 },
              { label: t("page.vibe.hubSessionsActive"), value: summary.sessions_active ?? 0 },
              { label: t("page.vibe.hubTemplates"), value: summary.templates ?? 0 },
            ]}
          />
        }
      />

      <Card title={t("page.vibe.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? Sparkles;
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
    </div>
  );
}
