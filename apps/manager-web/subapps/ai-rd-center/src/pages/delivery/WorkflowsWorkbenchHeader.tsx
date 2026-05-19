import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { LoadingBlock, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
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

export function WorkflowsWorkbenchHeader({
  onRefresh,
  pending,
}: {
  onRefresh: () => void;
  pending?: boolean;
}) {
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const summaryQ = useQuery({ queryKey: ["wf-summary"], queryFn: api.workflowSummary });
  const chartsQ = useQuery({ queryKey: ["wf-charts"], queryFn: api.workflowCharts });
  const engineQ = useQuery({ queryKey: ["wf-engine"], queryFn: api.workflowEngineStatus });
  const summary = summaryQ.data ?? {};
  const byStatus = summary.by_status ?? {};

  return (
    <>
      <WorkbenchShell
        title={t("page.workflows.title")}
        description={t("page.workflows.workbenchDesc")}
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton
              onClick={() => {
                void summaryQ.refetch();
                void chartsQ.refetch();
                void engineQ.refetch();
                onRefresh();
              }}
              pending={pending || summaryQ.isFetching || chartsQ.isFetching}
            />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.workflows.engine"), value: String(summary.engine ?? "-") },
              { label: t("page.workflows.instances"), value: summary.total ?? 0 },
              { label: t("page.workflows.running"), value: byStatus.running ?? 0 },
              {
                label: t("page.workflows.temporal"),
                value: engineQ.data?.temporal_connected ? t("page.workflows.temporalOn") : t("page.workflows.temporalOff"),
              },
            ]}
          />
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {Object.keys(pieToRecord(chartsQ.data?.by_status)).length ? (
            <WorkbenchPanel title={t("page.workflows.chartStatus")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_status)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.by_type)).length ? (
            <WorkbenchPanel title={t("page.workflows.chartType")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_type)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="delivery.workflows"
        context={{
          total: summary.total,
          running: byStatus.running,
          engine: summary.engine,
        }}
        initialPrompt={t("page.workflows.aiCopilotPrefill")}
      />
    </>
  );
}
