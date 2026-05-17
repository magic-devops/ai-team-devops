import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Card, Steps, Typography } from "antd";
import { Suspense, lazy, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { SprintBurndownChart } from "../shared/SprintBurndownChart";

const EChartsDonutLazy = lazy(() =>
  import("../../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);
import { SprintProgressPanel, StatusDistributionPanel } from "../shared/SprintProgressPanel";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchQueryGate, WorkbenchStats } from "../shared/workbenchUi";

const PIPELINE = [
  { hash: "#/requirements", key: "requirements", step: 0 },
  { hash: "#/tasks", key: "tasks", step: 1 },
  { hash: "#/issues/tracker", key: "issues", step: 2 },
  { hash: "#/tasks/sprints", key: "sprints", step: 3 },
  { hash: "#/intelligence/design-docs", key: "designDocs", step: 4 },
  { hash: "#/workflows", key: "workflows", step: 5 },
] as const;

export function DevFlowWorkbench() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const q = useQuery({ queryKey: ["devFlowSummary"], queryFn: api.devFlowSummary });
  const templatesQ = useQuery({ queryKey: ["devFlowTemplates"], queryFn: api.devFlowTemplates });

  const startWfMut = useMutation({
    mutationFn: (body: { type: string; args?: Record<string, unknown> }) => api.startWorkflow(body),
    onSuccess: (data) => {
      message.success(t("page.devFlow.workflowStarted", { id: data?.workflow_id ?? "" }));
      window.location.hash = "#/workflows";
    },
    onError: (e) => message.error((e as Error).message),
  });
  const s = q.data;
  const sprint = s?.sprint as { id?: string; goal?: string; status?: string } | undefined;
  const sprintId = sprint?.id ? String(sprint.id) : "";

  const burndownQ = useQuery({
    queryKey: ["devFlowBurndown", sprintId],
    queryFn: () => api.devFlowBurndown(sprintId),
    enabled: Boolean(sprintId),
  });
  const chartsQ = useQuery({ queryKey: ["devFlowCharts"], queryFn: api.devFlowCharts });
  const issueSeverityMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const row of chartsQ.data?.issue_severity ?? []) {
      m[row.name] = row.value;
    }
    return m;
  }, [chartsQ.data]);
  const sprintProgress = s?.sprint_progress;

  const openIssues = Number(s?.issues?.open ?? 0);
  const criticalOpen = Number(s?.issues?.critical_open ?? 0);
  const currentStep = openIssues > 0 ? 2 : Number(s?.tasks?.sprint_scope ?? 0) > 0 ? 1 : 0;

  return (
    <WorkbenchShell
      title={t("page.devFlow.title")}
      description={t("page.devFlow.desc")}
      actions={
        <>
          <Button href="#/search">{t("nav.globalSearch")}</Button>
          <Button href="#/vibe">{t("nav.vibe")}</Button>
          <Button type="primary" href="#/tasks">
            {t("page.devFlow.openTasks")}
          </Button>
        </>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.devFlow.reqTotal"), value: s?.requirements?.total ?? "—" },
            { label: t("page.devFlow.taskSprint"), value: s?.tasks?.sprint_scope ?? "—" },
            {
              label: t("page.devFlow.issuesOpen"),
              value: openIssues,
              trend: criticalOpen > 0 ? "down" : openIssues > 0 ? "neutral" : "up",
              hint: criticalOpen > 0 ? `${t("page.devFlow.criticalOpen")}: ${criticalOpen}` : undefined,
            },
            {
              label: t("page.devFlow.sprintActive"),
              value: sprint?.goal || sprint?.id || t("page.devFlow.noSprint"),
            },
            { label: t("page.devFlow.designDocs"), value: s?.design_docs?.count ?? "—" },
          ]}
        />
      }
    >
      <WorkbenchQueryGate query={q}>
        <div className="space-y-4">
          {criticalOpen > 0 ? (
            <Alert
              type="error"
              showIcon
              message={t("page.devFlow.criticalAlert", { count: criticalOpen })}
              action={
                <Button size="small" href="#/issues">
                  {t("page.devFlow.viewIssues")}
                </Button>
              }
            />
          ) : null}

          <div className="grid gap-4 xl:grid-cols-2">
            <StatusDistributionPanel title={t("page.devFlow.reqByStatus")} byStatus={s?.requirements?.by_status} />
            <StatusDistributionPanel title={t("page.devFlow.taskByStatus")} byStatus={s?.tasks?.by_status} />
          </div>

          {Object.keys(issueSeverityMap).length ? (
            <WorkbenchPanel title={t("page.devFlow.issueSeverity")}>
              <Suspense fallback={null}>
                <EChartsDonutLazy data={issueSeverityMap} height={220} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}

          {sprintId && sprintProgress ? (
            <>
              <SprintProgressPanel progress={sprintProgress} />
              {burndownQ.data ? (
                <WorkbenchPanel title={t("page.devFlow.burndownTitle")}>
                  <SprintBurndownChart data={burndownQ.data} />
                </WorkbenchPanel>
              ) : null}
            </>
          ) : sprintId ? (
            <SprintProgressPanel progress={null} loading={q.isLoading} />
          ) : (
            <WorkbenchPanel title={t("page.devFlow.sprintProgress")}>
              <p className="text-sm text-[var(--muted)]">{t("page.devFlow.noSprint")}</p>
              <Button className="mt-3" href="#/tasks/sprints">
                {t("page.devFlow.manageSprints")}
              </Button>
            </WorkbenchPanel>
          )}

          <WorkbenchPanel title={t("page.devFlow.templates")}>
            <div className="grid gap-3 md:grid-cols-3">
              {(templatesQ.data?.items ?? []).map((tpl: Record<string, unknown>) => (
                <Card key={String(tpl.id)} size="small" className="border-[var(--border)]">
                  <Typography.Text strong className="text-sm">
                    {String(tpl.name)}
                  </Typography.Text>
                  <p className="mt-1 text-xs text-[var(--muted)]">{String(tpl.description)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {((tpl.links as Array<{ label: string; hash: string }>) ?? []).map((l) => (
                      <Button key={l.hash} size="small" href={l.hash}>
                        {l.label}
                      </Button>
                    ))}
                    {tpl.workflow_type ? (
                      <Button
                        size="small"
                        type="primary"
                        loading={startWfMut.isPending}
                        onClick={() =>
                          startWfMut.mutate({
                            type: String(tpl.workflow_type),
                            args: { sprint_id: sprintId || undefined },
                          })
                        }
                      >
                        {t("page.devFlow.runWorkflow")}
                      </Button>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title={t("page.devFlow.pipeline")}>
            <Steps
              current={currentStep}
              size="small"
              className="mb-4"
              items={PIPELINE.map((p) => ({
                title: t(`nav.${p.key}`, { defaultValue: p.key }),
              }))}
            />
            <div className="flex flex-wrap gap-2">
              {PIPELINE.map((l) => (
                <Button key={l.hash} href={l.hash}>
                  {t(`nav.${l.key}`, { defaultValue: l.key })}
                </Button>
              ))}
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title={t("page.devFlow.repoHints")}>
            <div className="flex flex-wrap gap-3 text-sm">
              <RepoHint ok={s?.repo_hints?.dockerfile} label="Dockerfile" />
              <RepoHint ok={s?.repo_hints?.compose} label="Compose" />
              <RepoHint ok={s?.repo_hints?.specs_dir} label="specs/" />
            </div>
            <p className="mt-3 font-mono text-xs text-[var(--muted)]">{s?.project_path || "—"}</p>
          </WorkbenchPanel>

          <WorkbenchPanel title={t("page.devFlow.quickTools")}>
            <div className="flex flex-wrap gap-2">
              <Button href="#/orchestration">{t("nav.orchestration")}</Button>
              <Button href="#/intelligence/specs">{t("nav.specs")}</Button>
              <Button href="#/platforms/cli">{t("nav.cliTools")}</Button>
              <Button href="#/ops/env">{t("nav.envOps")}</Button>
              <Button href="#/copilot">{t("nav.copilot")}</Button>
            </div>
          </WorkbenchPanel>
        </div>
      </WorkbenchQueryGate>
    </WorkbenchShell>
  );
}

function RepoHint({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${
        ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-[var(--border)] text-[var(--muted)]"
      }`}
    >
      <span className="text-xs font-medium">{ok ? "✓" : "—"}</span>
      {label}
    </span>
  );
}
