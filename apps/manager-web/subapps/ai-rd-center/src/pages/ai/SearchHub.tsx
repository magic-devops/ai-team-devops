import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, FileCode, Library, SearchCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

const EChartsBarLazy = lazy(() =>
  import("@/components/charts/EChartsBar").then((m) => ({ default: m.EChartsBar })),
);

const DOMAIN_I18N: Record<string, string> = {
  workbench: "page.search.hubWorkbench",
  rag: "nav.ragSearch",
  knowledge: "nav.knowledgeBase",
  specs: "nav.specs",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  workbench: SearchCheck,
  rag: Library,
  knowledge: BookOpen,
  specs: FileCode,
};

export function SearchHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["searchHub"], queryFn: api.searchHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const tableRows = hubQ.data?.charts?.by_table ?? [];
  const barData =
    tableRows.length > 0
      ? {
          categories: tableRows.map((r: { name: string }) => r.name),
          series: [{ name: t("page.search.hubRows"), data: tableRows.map((r: { value: number }) => r.value) }],
        }
      : null;

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.search.hubTitle")}
        description={t("page.search.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              {
                label: t("page.search.hubSemantic"),
                value: summary.semantic_available ? t("page.settings.hubOk") : t("page.settings.hubFail"),
              },
              { label: t("page.search.hubTables"), value: summary.indexed_tables ?? 0 },
              { label: t("page.search.hubReady"), value: summary.ready_tables ?? 0 },
              { label: t("page.search.hubRows"), value: summary.indexed_rows ?? 0 },
            ]}
          />
        }
      >
        {barData ? (
          <WorkbenchPanel title={t("page.search.hubIndexChart")}>
            <Suspense fallback={<LoadingBlock />}>
              <EChartsBarLazy categories={barData.categories} series={barData.series} height={220} />
            </Suspense>
          </WorkbenchPanel>
        ) : null}
      </WorkbenchShell>

      <Card title={t("page.search.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? SearchCheck;
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
