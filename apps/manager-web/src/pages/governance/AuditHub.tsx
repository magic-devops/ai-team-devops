import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BellRing, Check, Command, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  chain: ShieldCheck,
  events: BellRing,
  actions: Command,
  approvals: Check,
};

const DOMAIN_I18N: Record<string, string> = {
  chain: "nav.auditChain",
  events: "nav.auditEvents",
  actions: "nav.auditModuleActions",
  approvals: "nav.auditApprovals",
};

export function AuditHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["auditHub"], queryFn: api.auditHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.audit.hubTitle")}
        description={t("page.audit.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.audit.hubTotal"), value: summary.total ?? 0 },
              { label: t("page.audit.hubFailures"), value: summary.failures ?? 0 },
              { label: t("page.audit.hubLast24h"), value: summary.last_24h ?? 0 },
              { label: t("page.audit.hubChain"), value: summary.chain_valid ? t("page.audit.verifyOk") : t("page.audit.verifyFail") },
            ]}
          />
        }
      />
      <Card title={t("page.audit.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? ShieldCheck;
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
