import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "../../components/ai/AiAssistDrawer";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { Analytics } from "../Analytics";
import { api } from "../../lib/api";
import { getProjectId, getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("../../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function DataExchangeWorkbench() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [aiOpen, setAiOpen] = useState(false);

  const summaryQ = useQuery({
    queryKey: ["dataExchangeSummary"],
    queryFn: api.dataExchangeSummary,
    enabled: authed && hasProject,
  });
  const chartsQ = useQuery({
    queryKey: ["dataExchangeCharts"],
    queryFn: api.dataExchangeCharts,
    enabled: authed && hasProject,
  });

  const exchange = summaryQ.data ?? {};
  const modules = exchange.modules ?? [];
  const sqlTotal = modules.filter((m: { kind?: string }) => m.kind === "sql").reduce((s: number, m: { count?: number }) => s + (m.count ?? 0), 0);
  const vectorTotal = Number(modules.find((m: { name?: string }) => m.name === "agent_reflections")?.count ?? 0);

  if (!authed) return <NeedLogin />;
  if (!hasProject) return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={t("page.dataExchange.title")}
        description={t("page.dataExchange.workbenchDesc")}
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton
              onClick={() => {
                void summaryQ.refetch();
                void chartsQ.refetch();
              }}
              pending={summaryQ.isFetching || chartsQ.isFetching}
            />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.dataExchange.modules"), value: modules.length },
              { label: t("page.dataExchange.records"), value: exchange.total ?? 0 },
              { label: t("page.dataExchange.sqlEntities"), value: sqlTotal },
              { label: t("page.dataExchange.vectorRows"), value: vectorTotal },
            ]}
          />
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {Object.keys(pieToRecord(chartsQ.data?.by_module)).length ? (
            <WorkbenchPanel title={t("page.dataExchange.chartModules")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_module)} height={220} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.by_kind)).length ? (
            <WorkbenchPanel title={t("page.dataExchange.chartKind")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_kind)} height={220} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      {summaryQ.error ? <ErrorBlock message={(summaryQ.error as Error).message} /> : null}
      <Analytics section="exchange" />

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="data.exchange"
        context={{ total: exchange.total, modules: modules.length }}
        initialPrompt={t("page.dataExchange.aiPrefill")}
      />
    </div>
  );
}
