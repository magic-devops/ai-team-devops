import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "../../components/ai/AiAssistDrawer";
import { LoadingBlock, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
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

export function TasksWorkbenchHeader({
  onRefresh,
  pending,
}: {
  onRefresh: () => void;
  pending?: boolean;
}) {
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const summaryQ = useQuery({ queryKey: ["tasksSummary"], queryFn: api.tasksSummary });
  const chartsQ = useQuery({ queryKey: ["tasksCharts"], queryFn: api.tasksCharts });
  const summary = summaryQ.data?.summary ?? {};

  return (
    <>
      <WorkbenchShell
        title={t("page.tasks.title")}
        description={t("page.tasks.desc")}
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton
              onClick={() => {
                void summaryQ.refetch();
                void chartsQ.refetch();
                onRefresh();
              }}
              pending={pending || summaryQ.isFetching || chartsQ.isFetching}
            />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.tasks.total"), value: summary.total ?? 0 },
              { label: t("page.tasks.inProgress"), value: summary.in_progress ?? 0 },
              { label: t("page.tasks.depBlocked"), value: summary.blocked ?? 0 },
              { label: t("page.tasks.done"), value: summary.completed ?? 0 },
              { label: t("page.tasks.completion"), value: `${summary.completion_rate ?? 0}%` },
            ]}
          />
        }
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {Object.keys(pieToRecord(chartsQ.data?.by_status)).length ? (
            <WorkbenchPanel title={t("page.tasks.chartStatus")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_status)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.by_priority)).length ? (
            <WorkbenchPanel title={t("page.tasks.chartPriority")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_priority)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.by_source)).length ? (
            <WorkbenchPanel title={t("page.tasks.chartSource")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_source)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="delivery.tasks"
        context={{
          total: summary.total,
          blocked: summary.blocked,
          in_progress: summary.in_progress,
        }}
        initialPrompt={t("page.tasks.aiCopilotPrefill")}
      />
    </>
  );
}
