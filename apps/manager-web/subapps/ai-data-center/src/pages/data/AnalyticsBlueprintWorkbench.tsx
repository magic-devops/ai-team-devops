import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getProjectId, getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("@/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function AnalyticsBlueprintWorkbench() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedGaps, setSelectedGaps] = useState<string[]>([]);

  const summaryQ = useQuery({
    queryKey: ["analyticsBlueprintSummary"],
    queryFn: api.analyticsBlueprintSummary,
    enabled: authed && hasProject,
  });
  const chartsQ = useQuery({
    queryKey: ["analyticsBlueprintCharts"],
    queryFn: api.analyticsBlueprintCharts,
    enabled: authed && hasProject,
  });
  const blueprintQ = useQuery({
    queryKey: ["analyticsBlueprint"],
    queryFn: api.analyticsBlueprint,
    enabled: authed && hasProject,
  });

  const blueprint = blueprintQ.data;
  const summary = summaryQ.data?.summary ?? blueprint?.summary ?? {};

  const gapTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.analyticsBlueprintTasks({
        ids: selectedGaps.length ? selectedGaps : undefined,
        dry_run: dryRun,
        priority: "P1",
        owner_id: "",
        dev_tool: "codex",
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  if (!authed) return <NeedLogin />;
  if (!hasProject) return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={t("page.analyticsBlueprint.title")}
        description={t("page.analyticsBlueprint.workbenchDesc")}
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton
              onClick={() => {
                void summaryQ.refetch();
                void chartsQ.refetch();
                void blueprintQ.refetch();
              }}
              pending={summaryQ.isFetching || chartsQ.isFetching || blueprintQ.isFetching}
            />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.analytics.platformMaturity"), value: `${summary.maturity ?? "—"}%` },
              { label: t("page.analytics.blueprintCapabilities"), value: summary.capabilities ?? 0 },
              { label: t("page.analytics.blueprintGaps"), value: summary.gaps ?? 0 },
              { label: t("page.analyticsBlueprint.criticalGaps"), value: summary.critical_gaps ?? 0 },
            ]}
          />
        }
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {Object.keys(pieToRecord(chartsQ.data?.by_domain)).length ? (
            <WorkbenchPanel title={t("page.analyticsBlueprint.chartDomain")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_domain)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.maturity_buckets)).length ? (
            <WorkbenchPanel title={t("page.analyticsBlueprint.chartMaturity")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.maturity_buckets)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.gaps_by_priority)).length ? (
            <WorkbenchPanel title={t("page.analyticsBlueprint.chartGapPriority")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.gaps_by_priority)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      {blueprintQ.isLoading ? <LoadingBlock /> : null}
      {blueprintQ.error ? <ErrorBlock message={(blueprintQ.error as Error).message} /> : null}

      {blueprint ? (
        <Card title={t("page.analytics.stackMatrix")}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(blueprint.stack ?? []).map((item: { id: string; name: string; maturity: number; recommendation?: string }) => (
              <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text)]">{item.name}</span>
                  <span className="text-xs font-semibold text-[var(--brand)]">{item.maturity}%</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">{item.recommendation}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {(blueprint.capabilities ?? []).slice(0, 8).map((cap: { id: string; name: string; maturity: number; next?: string }) => (
              <article key={cap.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text)]">{cap.name}</h3>
                  <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{cap.maturity}%</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">{cap.next}</p>
              </article>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-[var(--border)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.blueprintGaps")}</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                  disabled={gapTasks.isPending}
                  onClick={() => gapTasks.mutate(true)}
                >
                  {t("page.analytics.previewBlueprintTasks")}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  disabled={gapTasks.isPending || !selectedGaps.length}
                  onClick={() => gapTasks.mutate(false)}
                >
                  {t("page.analytics.createBlueprintTasks")}
                </button>
              </div>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {(blueprint.gaps ?? []).map((gap: { id: string; title: string; recommendation?: string; priority?: string }) => (
                <label key={gap.id} className="flex cursor-pointer gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedGaps.includes(gap.id)}
                    onChange={(e) =>
                      setSelectedGaps((prev) => (e.target.checked ? [...prev, gap.id] : prev.filter((id) => id !== gap.id)))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--text)]">{gap.title}</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">{gap.recommendation}</span>
                  </span>
                  <span className="text-xs text-[var(--muted)]">{gap.priority}</span>
                </label>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="data.analytics.blueprint"
        context={{ summary, gap_count: summary.gaps }}
        initialPrompt={t("page.analyticsBlueprint.aiPrefill")}
      />
    </div>
  );
}
