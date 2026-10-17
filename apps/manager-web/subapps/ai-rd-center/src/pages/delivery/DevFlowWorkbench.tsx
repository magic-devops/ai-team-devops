import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Card, Space, Statistic, Steps, Table, Tag, Typography } from "antd";
import { Suspense, lazy, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { getProjectId, getSessionRevision } from "@/lib/authStorage";
import { assistanceIntent, type AssistanceIntent } from "@/lib/requirementsAssistance";
import { SprintBurndownChart } from "@/pages/shared/SprintBurndownChart";

const EChartsDonutLazy = lazy(() =>
  import("@/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);
import { SprintProgressPanel, StatusDistributionPanel } from "@/pages/shared/SprintProgressPanel";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchQueryGate, WorkbenchStats } from "@/pages/shared/workbenchUi";

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
  const opsPlanQ = useQuery({ queryKey: ["devFlowOpsPlan"], queryFn: api.devFlowOpsPlan });
  const lifecycleQ = useQuery({ queryKey: ["devFlowLifecycle"], queryFn: api.devFlowLifecycle });
  const interactionOpsQ = useQuery({
    queryKey: ["devFlowInteractionOps"],
    queryFn: () => api.pagesInteractionOps({ domain: "delivery", status: "watch", limit: 20 }),
  });
  const [interactionOpsTaskResult, setInteractionOpsTaskResult] = useState<any>(null);
  const workflowIntent = useRef<AssistanceIntent>();

  const startWfMut = useMutation({
    mutationFn: (body: { type: string; args?: Record<string, unknown> }) => {
      workflowIntent.current = assistanceIntent(workflowIntent.current, `${getSessionRevision()}:${getProjectId()}`, "workflow-start", body);
      return api.startWorkflow({ ...body, workflow_id: `wf-${workflowIntent.current.key}` });
    },
    onSuccess: (data) => {
      message.success(t("page.devFlow.workflowStarted", { id: data?.workflow_id ?? "" }));
      window.location.hash = "#/workflows";
      workflowIntent.current = undefined;
    },
    onError: (e) => message.error((e as Error).message),
  });
  const opsTasksMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.devFlowOpsTasks({
        dry_run: dryRun,
        priority: "P1",

        limit: 20,
      }),
    onSuccess: (data) => {
      message.success(
        t("page.devFlow.opsTasksResult", {
          planned: data?.summary?.planned ?? 0,
          created: data?.summary?.created ?? 0,
        }),
      );
      void opsPlanQ.refetch();
    },
    onError: (e) => message.error((e as Error).message),
  });
  const interactionOpsTasksMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.pagesInteractionOpsTasks({
        dry_run: dryRun,
        domain: "delivery",
        status: "watch",
        priority: "P1",

        max_items: 12,
        idempotency_key: "dev-flow:interaction-ops:delivery",
      }),
    onSuccess: (data) => {
      setInteractionOpsTaskResult(data);
      message.success(
        t("page.devFlow.interactionOpsTasksResult", {
          planned: data?.summary?.planned ?? 0,
          created: data?.summary?.created ?? 0,
        }),
      );
      void interactionOpsQ.refetch();
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

          <WorkbenchPanel title={t("page.devFlow.interactionOpsTitle")}>
            <div className="grid gap-3 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
              <Card size="small" className="border-[var(--border)]">
                <Statistic
                  title={t("page.devFlow.deliveryHealth")}
                  value={interactionOpsQ.data?.summary?.health ?? 100}
                  suffix="/100"
                  valueStyle={{
                    color:
                      (interactionOpsQ.data?.summary?.health ?? 100) < 60
                        ? "#dc2626"
                        : (interactionOpsQ.data?.summary?.health ?? 100) < 80
                          ? "#d97706"
                          : "#059669",
                  }}
                />
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="font-mono text-lg font-semibold text-[var(--text)]">{interactionOpsQ.data?.summary?.high ?? 0}</p>
                    <p className="text-xs text-[var(--muted)]">{t("page.devFlow.highRisk")}</p>
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold text-[var(--text)]">{interactionOpsQ.data?.summary?.blocked ?? 0}</p>
                    <p className="text-xs text-[var(--muted)]">{t("page.devFlow.blocked")}</p>
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold text-[var(--text)]">{lifecycleQ.data?.summary?.total ?? 0}</p>
                    <p className="text-xs text-[var(--muted)]">{t("page.devFlow.lifecycleStages")}</p>
                  </div>
                </div>
              </Card>
              <Table
                rowKey={(row: any) => String(row.id)}
                dataSource={interactionOpsQ.data?.items ?? []}
                loading={interactionOpsQ.isLoading || lifecycleQ.isLoading}
                size="small"
                pagination={false}
                scroll={{ x: 860 }}
                locale={{ emptyText: t("page.devFlow.noInteractionOpsRisks") }}
                columns={[
                  { title: t("page.devFlow.lane"), dataIndex: "lane", width: 110, render: (value: string) => <Tag>{value}</Tag> },
                  {
                    title: t("page.devFlow.risk"),
                    dataIndex: "title",
                    render: (value: string, row: any) => (
                      <div>
                        <div className="text-sm font-medium text-[var(--text)]">{value}</div>
                        <div className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">{typeof row.evidence === "string" ? row.evidence : JSON.stringify(row.evidence ?? {})}</div>
                      </div>
                    ),
                  },
                  {
                    title: t("page.devFlow.severity"),
                    dataIndex: "severity",
                    width: 100,
                    render: (value: string) => <Tag color={value === "high" ? "red" : value === "medium" ? "gold" : "blue"}>{value}</Tag>,
                  },
                  {
                    title: t("page.devFlow.command"),
                    dataIndex: "command",
                    width: 260,
                    render: (value: string) => <code className="text-[10px] text-[var(--brand)]">{value}</code>,
                  },
                ]}
              />
              <Card size="small" className="border-[var(--border)]">
                <Space direction="vertical" className="w-full" size="small">
                  <Button block size="small" loading={interactionOpsTasksMut.isPending} onClick={() => interactionOpsTasksMut.mutate(true)}>
                    {t("page.devFlow.previewInteractionOpsTasks")}
                  </Button>
                  <Button block size="small" type="primary" loading={interactionOpsTasksMut.isPending} onClick={() => interactionOpsTasksMut.mutate(false)}>
                    {t("page.devFlow.createInteractionOpsTasks")}
                  </Button>
                  <Button block size="small" href="#/system-map/productization">
                    {t("page.devFlow.openGraphLoopControlRoom")}
                  </Button>
                  <code className="block rounded bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--brand)]">
                    sop pages interaction-ops --domain delivery --json
                  </code>
                  {interactionOpsTaskResult ? (
                    <div className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted)]">
                      {t("page.devFlow.interactionOpsTasksResult", {
                        planned: interactionOpsTaskResult?.summary?.planned ?? 0,
                        created: interactionOpsTaskResult?.summary?.created ?? 0,
                      })}
                    </div>
                  ) : null}
                </Space>
              </Card>
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title={t("page.devFlow.opsPlan")}>
            <div className="grid gap-3 xl:grid-cols-[16rem_minmax(0,1fr)]">
              <Card size="small" className="border-[var(--border)]">
                <Statistic
                  title={t("page.devFlow.flowHealth")}
                  value={opsPlanQ.data?.health?.score ?? 100}
                  suffix="/100"
                  valueStyle={{
                    color: (opsPlanQ.data?.health?.score ?? 100) < 60 ? "#dc2626" : (opsPlanQ.data?.health?.score ?? 100) < 75 ? "#d97706" : "#059669",
                  }}
                />
                <div className="mt-3 flex flex-wrap gap-1">
                  {(opsPlanQ.data?.stages ?? []).map((stage: any) => (
                    <Tag key={stage.id} color={stage.status === "risk" ? "red" : stage.status === "watch" ? "gold" : "green"}>
                      {stage.name}
                    </Tag>
                  ))}
                </div>
              </Card>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Space wrap>
                    <Button size="small" loading={opsTasksMut.isPending} onClick={() => opsTasksMut.mutate(true)}>
                      {t("page.devFlow.previewOpsTasks")}
                    </Button>
                    <Button size="small" type="primary" loading={opsTasksMut.isPending} onClick={() => opsTasksMut.mutate(false)}>
                      {t("page.devFlow.createOpsTasks")}
                    </Button>
                  </Space>
                  <code className="rounded bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--brand)]">sop dev-flow ops-plan --json</code>
                </div>
                <Table
                  rowKey={(row: any) => String(row.id)}
                  dataSource={opsPlanQ.data?.risks ?? []}
                  loading={opsPlanQ.isLoading}
                  size="small"
                  pagination={false}
                  scroll={{ x: 820 }}
                  locale={{ emptyText: t("page.devFlow.noOpsRisks") }}
                  columns={[
                    {
                      title: t("page.devFlow.severity"),
                      dataIndex: "severity",
                      width: 100,
                      render: (value: string) => <Tag color={value === "high" ? "red" : value === "medium" ? "gold" : "blue"}>{value}</Tag>,
                    },
                    { title: t("page.devFlow.category"), dataIndex: "category", width: 120 },
                    {
                      title: t("page.devFlow.risk"),
                      dataIndex: "title",
                      render: (value: string, row: any) => (
                        <div>
                          <div className="text-sm font-medium text-[var(--text)]">{value}</div>
                          <div className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{row.detail}</div>
                        </div>
                      ),
                    },
                    {
                      title: t("page.devFlow.command"),
                      dataIndex: "command",
                      width: 260,
                      render: (value: string) => <code className="text-[10px] text-[var(--brand)]">{value}</code>,
                    },
                  ]}
                />
              </div>
            </div>
          </WorkbenchPanel>

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
