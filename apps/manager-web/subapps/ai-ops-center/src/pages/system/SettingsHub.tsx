import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, CloudCog, Cpu, SearchCheck, Settings, ShieldCheck, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const DOMAIN_I18N: Record<string, string> = {
  account: "nav.settingsAccount",
  runtime: "nav.settingsRuntime",
  sso: "nav.settingsSso",
  billing: "nav.settingsBilling",
  profiles: "nav.settingsProfiles",
  observability: "nav.settingsObservability",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  account: UserCog,
  runtime: Cpu,
  sso: ShieldCheck,
  billing: BarChart3,
  profiles: CloudCog,
  observability: SearchCheck,
};

export function SettingsHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["settingsHub"], queryFn: api.settingsHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.settings.hubTitle")}
        description={t("page.settings.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              {
                label: t("page.settings.hubHealth"),
                value: summary.health_ok ? t("page.settings.hubOk") : t("page.settings.hubFail"),
              },
              { label: t("page.settings.hubMode"), value: String(summary.admin_mode ?? "—") },
              { label: t("page.settings.hubInvoices"), value: summary.invoice_count ?? 0 },
              { label: t("page.settings.hubProfiles"), value: summary.env_profiles ?? 0 },
            ]}
          />
        }
      />

      <Card title={t("page.settings.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? Settings;
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
