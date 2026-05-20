import { ArrowRightOutlined, RobotOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, List, Progress, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../../../src/components/Card";
import { ErrorBlock, LoadingBlock, RefreshButton } from "../../../../src/components/PageStates";
import { api } from "../../../../src/lib/api";
import { WorkbenchShell } from "../../../../src/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "../../../../src/pages/shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("../../../../src/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);
const EChartsBarLazy = lazy(() =>
  import("../../../../src/components/charts/EChartsBar").then((m) => ({ default: m.EChartsBar })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

const quickLinks = [
  { href: "#/dev-flow/workbench", nav: "devFlow", desc: "dashboard.linkDevFlow" },
  { href: "#/projects", nav: "projects", desc: "dashboard.linkProjects" },
  { href: "#/requirements", nav: "requirements", desc: "dashboard.linkReqs" },
  { href: "#/tasks", nav: "tasks", desc: "dashboard.linkTasks" },
  { href: "#/search", nav: "globalSearch", desc: "dashboard.linkSearch" },
  { href: "#/workflows", nav: "workflows", desc: "dashboard.linkWorkflows" },
  { href: "#/copilot", nav: "copilot", desc: "dashboard.linkCopilot" },
  { href: "#/intelligence", nav: "intelligence", desc: "dashboard.linkIntel" },
  { href: "#/platforms", nav: "platforms", desc: "dashboard.linkPlatforms" },
  { href: "#/analytics", nav: "analytics", desc: "dashboard.linkAnalytics" },
] as const;

export function Dashboard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selectedGaps, setSelectedGaps] = useState<string[]>([]);
  const summary = useQuery({ queryKey: ["dashboardSummary"], queryFn: api.dashboardSummary });
  const charts = useQuery({ queryKey: ["dashboardCharts"], queryFn: api.dashboardCharts });
  const blueprint = useQuery({ queryKey: ["hermesBlueprint"], queryFn: api.hermesBlueprint });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });

  const activitySeries = useMemo(() => {
    const trend = charts.data?.activity_trend;
    if (!trend?.days?.length) return null;
    return {
      categories: trend.days,
      series: (trend.series ?? []).map((s) => ({
        name: s.name === "tasks" ? t("nav.tasks") : t("nav.requirements"),
        data: s.data,
      })),
    };
  }, [charts.data, t]);

  const data = summary.data ?? {};
  const metrics = data.metrics ?? {};
  const riskColumns: ColumnsType<any> = [
    {
      title: t("dashboard.risk"),
      dataIndex: "title",
      render: (_value, row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Tag color={row.level === "high" ? "red" : row.level === "medium" ? "gold" : "blue"}>{row.level}</Tag>
            <span className="font-medium text-[var(--text)]">{row.title}</span>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.description}</p>
        </div>
      ),
    },
    {
      title: t("dashboard.action"),
      dataIndex: "target",
      width: 140,
      render: (target) => <Button size="small" href={target} icon={<ArrowRightOutlined />}>{t("dashboard.open")}</Button>,
    },
  ];

  const openAi = () => {
    sessionStorage.setItem(
      "sop-copilot-prefill",
      t("dashboard.aiPrompt", {
        projects: metrics.projects ?? 0,
        requirements: metrics.requirements ?? 0,
        tasks: metrics.tasks ?? 0,
        blocked: metrics.blocked_tasks ?? 0,
        delivery: metrics.delivery_rate ?? 0,
      }),
    );
    window.location.hash = "#/copilot";
  };

  const blueprintTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.hermesBlueprintTasks({
        ids: selectedGaps,
        dry_run: dryRun,
        priority: "P1",
        assigned_to: "Platform Agent",
        dev_tool: "codex",
      }),
    onSuccess: (result) => {
      if (!result?.dry_run) {
        setSelectedGaps([]);
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      }
    },
  });

  if (summary.isLoading) return <LoadingBlock />;
  if (summary.isError) return <ErrorBlock message={(summary.error as Error).message} />;

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("dashboard.operatingTitle")}
        description={t("dashboard.operatingDesc")}
        actions={
          <Space wrap>
            <RefreshButton
              onClick={() => {
                void summary.refetch();
                void charts.refetch();
              }}
              pending={summary.isFetching || charts.isFetching}
            />
            <Button icon={<RobotOutlined />} onClick={openAi}>{t("dashboard.askAi")}</Button>
            <Button type="primary" href="#/projects" icon={<ArrowRightOutlined />}>{t("dashboard.enterWorkspace")}</Button>
          </Space>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("nav.projects"), value: metrics.projects ?? 0, hint: `${t("dashboard.active")}: ${metrics.active_projects ?? 0}` },
              { label: t("nav.requirements"), value: metrics.requirements ?? 0 },
              { label: t("nav.tasks"), value: metrics.tasks ?? 0, hint: `${t("dashboard.blocked")}: ${metrics.blocked_tasks ?? 0}` },
              { label: t("dashboard.deliveryRate"), value: `${metrics.delivery_rate ?? 0}%` },
              { label: t("dashboard.risks"), value: (data.risks ?? []).length },
              { label: "Manager", value: health.data?.ok ? "OK" : "—" },
            ]}
          />
        }
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[var(--text)]">{t("dashboard.deliveryHealth")}</span>
              <Tag color={(metrics.delivery_rate ?? 0) >= 80 ? "green" : (metrics.delivery_rate ?? 0) >= 50 ? "gold" : "red"}>
                {metrics.delivery_rate ?? 0}%
              </Tag>
            </div>
            <Progress percent={Number(metrics.delivery_rate ?? 0)} />
          </div>
          <Alert
            type={(data.risks ?? []).some((r: any) => r.level === "high") ? "error" : (data.risks ?? []).length ? "warning" : "success"}
            showIcon
            message={t("dashboard.operatingSignal")}
            description={(data.risks ?? []).length ? t("dashboard.riskSignal") : t("dashboard.okSignal")}
          />
        </div>

        {activitySeries ? (
          <WorkbenchPanel title={t("dashboard.activityTrend")}>
            <Suspense fallback={null}>
              <EChartsBarLazy categories={activitySeries.categories} series={activitySeries.series} asLine height={260} />
            </Suspense>
          </WorkbenchPanel>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.keys(pieToRecord(charts.data?.task_status)).length ? (
            <WorkbenchPanel title={t("dashboard.taskStatusChart")}>
              <Suspense fallback={null}>
                <EChartsDonutLazy data={pieToRecord(charts.data?.task_status)} height={220} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(charts.data?.requirement_status)).length ? (
            <WorkbenchPanel title={t("dashboard.reqStatusChart")}>
              <Suspense fallback={null}>
                <EChartsDonutLazy data={pieToRecord(charts.data?.requirement_status)} height={220} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(charts.data?.risk_levels)).length ? (
            <WorkbenchPanel title={t("dashboard.riskLevels")}>
              <Suspense fallback={null}>
                <EChartsDonutLazy data={pieToRecord(charts.data?.risk_levels)} height={220} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      <Card
        title={t("dashboard.hermesTitle")}
        actions={
          <Space wrap>
            <Button
              disabled={!selectedGaps.length}
              loading={blueprintTasks.isPending}
              onClick={() => blueprintTasks.mutate(true)}
            >
              {t("dashboard.previewGapTasks")}
            </Button>
            <Button
              type="primary"
              disabled={!selectedGaps.length}
              loading={blueprintTasks.isPending}
              onClick={() => blueprintTasks.mutate(false)}
            >
              {t("dashboard.createGapTasks")}
            </Button>
          </Space>
        }
      >
        {blueprint.isLoading ? <LoadingBlock /> : null}
        {blueprint.isError ? <ErrorBlock message={(blueprint.error as Error).message} /> : null}
        {blueprintTasks.data && !blueprintTasks.data.dry_run ? (
          <Alert className="mb-3" type="success" showIcon message={t("dashboard.gapTasksCreated", { count: blueprintTasks.data.created ?? 0 })} />
        ) : null}
        {blueprintTasks.data?.dry_run ? (
          <Alert className="mb-3" type="info" showIcon message={t("dashboard.gapTasksPreview", { count: blueprintTasks.data.items?.length ?? 0 })} />
        ) : null}
        <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{blueprint.data?.architecture?.name ?? "Hermes"}</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted-strong)]">{blueprint.data?.architecture?.positioning}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <Info label={t("dashboard.scopeTenant")} value={blueprint.data?.scope?.tenant_code ?? "-"} />
              <Info label={t("dashboard.scopeBusiness")} value={blueprint.data?.scope?.business_code ?? "-"} />
              <Info label={t("dashboard.scopeProject")} value={blueprint.data?.scope?.project_id ?? "-"} />
              <Info label={t("dashboard.platformMaturity")} value={`${blueprint.data?.summary?.maturity ?? 0}%`} />
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-3">
              {(blueprint.data?.architecture?.layers ?? []).slice(0, 6).map((layer: string) => (
                <div key={layer} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted-strong)]">
                  {layer}
                </div>
              ))}
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("dashboard.productNavigation")}</p>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={blueprint.data?.product_navigation ?? []}
                  pagination={false}
                  scroll={{ x: 760 }}
                  columns={[
                    { title: t("dashboard.domain"), dataIndex: "name", width: 130, render: (value: string) => <Tag color="cyan">{value}</Tag> },
                    {
                      title: t("dashboard.modules"),
                      dataIndex: "modules",
                      width: 260,
                      render: (items: string[]) => <Space size={[4, 4]} wrap>{(items ?? []).map((item) => <Tag key={item}>{item}</Tag>)}</Space>,
                    },
                    { title: t("dashboard.permission"), dataIndex: "permission", width: 130, render: (value: string) => <span className="font-mono text-xs">{value}</span> },
                    { title: t("dashboard.goal"), dataIndex: "goal" },
                  ]}
                />
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("dashboard.technologyUpgrade")}</p>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={blueprint.data?.technology_upgrades ?? []}
                  pagination={{ pageSize: 4, showSizeChanger: false }}
                  scroll={{ x: 820 }}
                  columns={[
                    {
                      title: t("dashboard.capability"),
                      dataIndex: "name",
                      width: 180,
                      render: (value: string, row: any) => (
                        <div>
                          <div className="font-medium text-[var(--text)]">{value}</div>
                          <Tag className="mt-1" color={row.phase === "P0" ? "red" : row.phase === "P1" ? "gold" : "blue"}>{row.phase}</Tag>
                        </div>
                      ),
                    },
                    {
                      title: t("dashboard.targetStack"),
                      dataIndex: "target_stack",
                      width: 260,
                      render: (items: string[]) => <Space size={[4, 4]} wrap>{(items ?? []).slice(0, 4).map((item) => <Tag key={item} color="blue">{item}</Tag>)}</Space>,
                    },
                    { title: t("dashboard.strategy"), dataIndex: "strategy" },
                  ]}
                />
              </div>
            </div>
            <Table
              rowKey="id"
              size="small"
              dataSource={blueprint.data?.capabilities ?? []}
              pagination={{ pageSize: 5, showSizeChanger: true }}
              scroll={{ x: 920 }}
              columns={[
                {
                  title: t("dashboard.capability"),
                  dataIndex: "name",
                  render: (value: string, row: any) => (
                    <div>
                      <div className="font-medium text-[var(--text)]">{value}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{row.next}</div>
                    </div>
                  ),
                },
                { title: t("dashboard.domain"), dataIndex: "domain", width: 120, render: (value: string) => <Tag>{value}</Tag> },
                {
                  title: t("dashboard.maturity"),
                  dataIndex: "maturity",
                  width: 180,
                  render: (value: number) => <Progress percent={value} size="small" />,
                },
                {
                  title: "AI",
                  dataIndex: "ai_surfaces",
                  width: 240,
                  render: (items: string[]) => (
                    <Space size={[4, 4]} wrap>{(items ?? []).slice(0, 3).map((item) => <Tag key={item} color="blue">{item}</Tag>)}</Space>
                  ),
                },
              ]}
            />
            <Table
              rowKey="id"
              size="small"
              dataSource={blueprint.data?.integrations ?? []}
              pagination={{ pageSize: 5, showSizeChanger: true }}
              scroll={{ x: 980 }}
              columns={[
                {
                  title: t("dashboard.integration"),
                  dataIndex: "name",
                  render: (value: string, row: any) => (
                    <div>
                      <div className="font-medium text-[var(--text)]">{value}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{row.next}</div>
                    </div>
                  ),
                },
                { title: t("dashboard.category"), dataIndex: "category", width: 120, render: (value: string) => <Tag>{value}</Tag> },
                { title: t("dashboard.status"), dataIndex: "status", width: 120, render: (value: string) => <Tag color={value === "supported" ? "green" : value === "planned" ? "gold" : "blue"}>{value}</Tag> },
                {
                  title: t("dashboard.direction"),
                  dataIndex: "direction",
                  width: 170,
                  render: (items: string[]) => <Space size={[4, 4]} wrap>{(items ?? []).map((item) => <Tag key={item}>{item}</Tag>)}</Space>,
                },
                {
                  title: t("dashboard.events"),
                  dataIndex: "events",
                  width: 260,
                  render: (items: string[]) => <Space size={[4, 4]} wrap>{(items ?? []).slice(0, 3).map((item) => <Tag key={item} color="purple">{item}</Tag>)}</Space>,
                },
              ]}
            />
            <Table
              rowKey="id"
              size="small"
              dataSource={blueprint.data?.gaps ?? []}
              pagination={false}
              scroll={{ x: 820 }}
              rowSelection={{
                selectedRowKeys: selectedGaps,
                onChange: (keys) => setSelectedGaps(keys.map(String)),
              }}
              columns={[
                { title: t("dashboard.gap"), dataIndex: "title" },
                { title: t("dashboard.priority"), dataIndex: "priority", width: 90, render: (value: string) => <Tag color={value === "P0" ? "red" : "gold"}>{value}</Tag> },
                { title: t("dashboard.recommendation"), dataIndex: "recommendation" },
              ]}
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card title={t("dashboard.riskBoard")}>
          <Table
            rowKey="id"
            columns={riskColumns}
            dataSource={data.risks ?? []}
            pagination={false}
            locale={{ emptyText: t("dashboard.noRisks") }}
            size="middle"
          />
        </Card>

        <Card title={t("dashboard.nextActions")}>
          <List
            dataSource={data.next_actions ?? []}
            renderItem={(item: any) => (
              <List.Item
                actions={[
                  <Button key="open" size="small" type={item.priority === "P0" ? "primary" : "default"} href={item.target}>
                    {t("dashboard.open")}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={<span className="text-sm text-[var(--text)]">{item.title}</span>}
                  description={<Tag color={item.priority === "P0" ? "red" : item.priority === "P1" ? "gold" : "default"}>{item.priority}</Tag>}
                />
              </List.Item>
            )}
          />
        </Card>
      </div>

      <Card title={t("dashboard.quickLinks")}>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {quickLinks.map((link) => (
            <a key={link.href} href={link.href} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-sm transition hover:border-[var(--brand)] hover:bg-[var(--brand-softer)]">
              <p className="font-semibold text-[var(--text)]">{t(`nav.${link.nav}`)}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{t(link.desc)}</p>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--surface)] px-2 py-2">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate font-mono text-xs text-[var(--text)]">{value || "-"}</p>
    </div>
  );
}
