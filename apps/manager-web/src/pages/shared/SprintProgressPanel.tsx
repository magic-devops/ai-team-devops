import { Alert, Button, Progress, Space, Tag } from "antd";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkbenchPanel, WorkbenchStats } from "./workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("../../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

export type SprintProgressData = {
  total_tasks?: number;
  completed?: number;
  in_progress?: number;
  pending?: number;
  completion_rate?: number;
  avg_confidence?: number;
  blocked?: Array<{ id: string; title?: string; assigned_to?: string }>;
  open_issues?: Array<{ id: string; title?: string; severity?: string }>;
  sprint?: { id?: string; goal?: string; status?: string };
};

function statusBar(label: string, count: number, total: number, color: string) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div key={label} className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-[var(--muted-strong)]">{label}</span>
        <span className="tabular-nums text-[var(--muted)]">
          {count} ({pct}%)
        </span>
      </div>
      <Progress percent={pct} size="small" showInfo={false} strokeColor={color} />
    </div>
  );
}

/** 迭代进度：完成率、任务分布、阻塞与关联问题 */
export function SprintProgressPanel({
  progress,
  loading,
  tasksHref = "#/tasks/sprints",
  issuesHref = "#/issues",
}: {
  progress?: SprintProgressData | null;
  loading?: boolean;
  tasksHref?: string;
  issuesHref?: string;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <WorkbenchPanel title={t("page.devFlow.sprintProgress")}>
        <Progress percent={0} status="active" />
      </WorkbenchPanel>
    );
  }
  if (!progress) {
    return (
      <WorkbenchPanel title={t("page.devFlow.sprintProgress")}>
        <p className="text-sm text-[var(--muted)]">{t("page.devFlow.noSprintProgress")}</p>
      </WorkbenchPanel>
    );
  }

  const total = Number(progress.total_tasks ?? 0);
  const done = Number(progress.completed ?? 0);
  const inProg = Number(progress.in_progress ?? 0);
  const pending = Number(progress.pending ?? 0);
  const rate = Number(progress.completion_rate ?? 0);
  const blocked = progress.blocked ?? [];
  const openIssues = progress.open_issues ?? [];

  return (
    <WorkbenchPanel
      title={t("page.devFlow.sprintProgress")}
      actions={
        <Space wrap size="small">
          <Button size="small" href={tasksHref}>
            {t("page.devFlow.openSprintTasks")}
          </Button>
          {openIssues.length ? (
            <Button size="small" href={issuesHref}>
              {t("page.devFlow.openSprintIssues")}
            </Button>
          ) : null}
        </Space>
      }
    >
      <WorkbenchStats
        items={[
          { label: t("page.tasks.total"), value: total },
          { label: t("page.tasks.done"), value: done, trend: done > 0 ? "up" : "neutral" },
          { label: t("page.tasks.inProgress"), value: inProg },
          {
            label: t("page.tasks.completion"),
            value: `${rate}%`,
            hint: progress.avg_confidence ? `${t("page.devFlow.avgConfidence")}: ${progress.avg_confidence}` : undefined,
          },
        ]}
      />
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[var(--text)]">{t("page.devFlow.sprintBurndown")}</span>
          <Tag color={rate >= 80 ? "success" : rate >= 50 ? "processing" : "warning"}>{rate}%</Tag>
        </div>
        <Progress percent={rate} status={rate >= 100 ? "success" : "active"} />
      </div>
      {total > 0 ? (
        <div className="mt-4 space-y-2">
          {statusBar(t("page.tasks.done"), done, total, "#22c55e")}
          {statusBar(t("page.tasks.inProgress"), inProg, total, "#0ea5e9")}
          {statusBar(t("page.tasks.statusPending", { defaultValue: "pending" }), pending, total, "#94a3b8")}
        </div>
      ) : null}
      {blocked.length ? (
        <Alert
          className="mt-4"
          type="warning"
          showIcon
          message={t("page.tasks.blockedList")}
          description={
            <ul className="mt-1 space-y-1 text-xs">
              {blocked.slice(0, 5).map((b) => (
                <li key={b.id}>
                  <a href={`#/tasks`} className="font-mono text-[10px] text-[var(--brand)]">
                    {b.id}
                  </a>
                  <span className="ml-2">{b.title}</span>
                </li>
              ))}
              {blocked.length > 5 ? <li className="text-[var(--muted)]">+{blocked.length - 5}</li> : null}
            </ul>
          }
        />
      ) : null}
      {openIssues.length ? (
        <Alert
          className="mt-3"
          type="error"
          showIcon
          message={t("page.devFlow.sprintOpenIssues", { count: openIssues.length })}
          description={
            <ul className="mt-1 space-y-1 text-xs">
              {openIssues.slice(0, 4).map((i) => (
                <li key={i.id}>
                  <Tag className="!mr-1">{i.severity || "?"}</Tag>
                  {i.title || i.id}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}
    </WorkbenchPanel>
  );
}

/** 按状态计数渲染分布条 */
export function StatusDistributionPanel({
  title,
  byStatus,
  colorMap = {},
  chart = true,
}: {
  title: string;
  byStatus?: Record<string, number>;
  colorMap?: Record<string, string>;
  /** 使用 ECharts 环形图，失败回退进度条 */
  chart?: boolean;
}) {
  const [lite, setLite] = useState(!chart);
  const entries = Object.entries(byStatus ?? {}).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!entries.length) return null;

  if (!lite) {
    return (
      <WorkbenchPanel title={title}>
        <Suspense
          fallback={
            <StatusBars title="" byStatus={byStatus} colorMap={colorMap} total={total} entries={entries} />
          }
        >
          <EChartsDonutLazy data={byStatus} height={200} onFailed={() => setLite(true)} />
        </Suspense>
      </WorkbenchPanel>
    );
  }

  const defaultColors: Record<string, string> = {
    completed: "#22c55e",
    done: "#22c55e",
    in_progress: "#0ea5e9",
    open: "#f59e0b",
    pending: "#94a3b8",
    blocked: "#ef4444",
    resolved: "#22c55e",
    ...colorMap,
  };

  return (
    <WorkbenchPanel title={title}>
      <StatusBars
        title={title}
        entries={entries.sort((a, b) => b[1] - a[1])}
        total={total}
        colorMap={defaultColors}
      />
    </WorkbenchPanel>
  );
}

function StatusBars({
  title: _title,
  entries,
  total,
  colorMap,
}: {
  title: string;
  byStatus?: Record<string, number>;
  entries: Array<[string, number]>;
  total: number;
  colorMap: Record<string, string>;
}) {
  return (
    <div className="space-y-2">
      {entries.map(([status, count]) => statusBar(status, count, total, colorMap[status] || "#64748b"))}
    </div>
  );
}
