import { Button, Checkbox, Table } from "antd";
import { useTranslation } from "react-i18next";
import { IsolationBaselineComparePanel } from "./IsolationBaselineComparePanel";

type IsolationSourceScanPanelProps = {
  scanData: any;
  taskResult: any;
  runResult: any;
  scanRuns: any[];
  isolationScanCompare: any;
  compareTaskResult: any;
  includeProtected: boolean;
  tasksPending: boolean;
  runsPending: boolean;
  compareTasksPending: boolean;
  canWrite: boolean;
  onIncludeProtectedChange: (checked: boolean) => void;
  onPreviewTasks: () => void;
  onCreateTasks: () => void;
  onSaveRun: () => void;
  onPreviewCompareTasks: () => void;
  onCreateCompareTasks: () => void;
};

export function IsolationSourceScanPanel({
  scanData,
  taskResult,
  runResult,
  scanRuns,
  isolationScanCompare,
  compareTaskResult,
  includeProtected,
  tasksPending,
  runsPending,
  compareTasksPending,
  canWrite,
  onIncludeProtectedChange,
  onPreviewTasks,
  onCreateTasks,
  onSaveRun,
  onPreviewCompareTasks,
  onCreateCompareTasks,
}: IsolationSourceScanPanelProps) {
  const { t } = useTranslation();
  const items = scanData?.items ?? [];
  const runRows = Array.isArray(scanRuns) ? scanRuns : [];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.isolationSourceScan")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={includeProtected}
            onChange={(event) => onIncludeProtectedChange(event.target.checked)}
          >
            {t("page.systemMap.includeProtectedIsolationScan")}
          </Checkbox>
          <Button
            size="small"
            htmlType="button"
            onClick={onPreviewTasks}
            disabled={tasksPending}
          >
            {t("page.systemMap.previewIsolationScanTasks")}
          </Button>
          <Button
            size="small"
            type="primary"
            htmlType="button"
            onClick={onCreateTasks}
            disabled={tasksPending || !canWrite}
            title={!canWrite ? t("capability.denied") : undefined}
          >
            {t("page.systemMap.createIsolationScanTasks")}
          </Button>
          <Button
            size="small"
            htmlType="button"
            onClick={onSaveRun}
            disabled={runsPending || !canWrite}
            title={!canWrite ? t("capability.denied") : undefined}
          >
            {t("page.systemMap.saveIsolationScanRun")}
          </Button>
        </div>
      </div>
      <code className="mt-3 block rounded-lg bg-[var(--control-bg)] px-2 py-1 text-[11px] text-[var(--brand)]">
        {scanData?.agent_consumption?.task_api ?? "/api/v1/system/pages/isolation-audit/scan/tasks"}
      </code>
      {runResult?.run ? (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted-strong)]">
          {t("page.systemMap.isolationScanRunSaved", {
            id: runResult.run.id,
            total: runResult.run.summary?.total ?? 0,
            risk: runResult.run.summary?.risk ?? 0,
          })}
        </div>
      ) : null}
      {taskResult ? (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted-strong)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t("page.systemMap.isolationScanTaskResult", {
                planned: taskResult.summary?.planned ?? 0,
                created: taskResult.summary?.created ?? 0,
                skipped: taskResult.summary?.skipped ?? 0,
              })}
            </span>
            <span className="font-mono text-xs text-[var(--brand)]">{taskResult.agent_consumption?.cli}</span>
          </div>
          {(taskResult.planned ?? []).length ? (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {(taskResult.planned ?? []).slice(0, 4).map((item: any) => (
                <article key={item.source_report_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                  <p className="line-clamp-1 text-xs font-semibold text-[var(--text)]">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-[var(--muted)]">{item.source_report_id} · {item.priority}</p>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {items.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {items.slice(0, 4).map((item: any) => (
            <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-[var(--text)]">{item.module}</p>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  item.status === "protected"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                    : item.status === "risk"
                      ? "bg-rose-500/10 text-rose-700 dark:text-rose-200"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-200"
                }`}>
                  {item.status}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{item.file} · {item.storage}</p>
              <p className="mt-2 text-xs font-medium text-[var(--muted-strong)]">{t("page.systemMap.isolationScanRecommendation")}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{item.recommendation}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--muted)]">{t("page.systemMap.isolationNoScanIssues")}</p>
      )}
      <IsolationBaselineComparePanel
        compareData={isolationScanCompare}
        compareTaskResult={compareTaskResult}
        compareTasksPending={compareTasksPending}
        canWrite={canWrite}
        onPreviewCompareTasks={onPreviewCompareTasks}
        onCreateCompareTasks={onCreateCompareTasks}
      />
      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.isolationScanRunHistory")}</p>
          <span className="text-xs text-[var(--muted)]">{scanData?.agent_consumption?.history_api ?? "/api/v1/system/pages/isolation-audit/scan/runs"}</span>
        </div>
        <Table
          size="small"
          rowKey={(row) => row.id}
          pagination={false}
          dataSource={runRows.slice(0, 8)}
          columns={[
            {
              title: t("page.systemMap.isolationScanRunTime"),
              dataIndex: "created_at",
              key: "created_at",
              render: (value: string) => <span className="text-xs text-[var(--muted-strong)]">{value || "-"}</span>,
            },
            {
              title: t("page.systemMap.isolationScanRunScore"),
              key: "score",
              render: (_: unknown, row: any) => <span className="font-mono text-xs text-[var(--text)]">{row.summary?.score ?? 0}/100</span>,
            },
            {
              title: t("page.systemMap.isolationScanRunRisk"),
              key: "risk",
              render: (_: unknown, row: any) => (
                <span className="text-xs text-[var(--muted-strong)]">
                  {row.summary?.risk ?? 0}/{row.summary?.watch ?? 0}
                </span>
              ),
            },
            {
              title: t("page.systemMap.isolationScanRunNote"),
              dataIndex: "note",
              key: "note",
              render: (value: string) => <span className="line-clamp-1 text-xs text-[var(--muted)]">{value || "-"}</span>,
            },
          ]}
        />
      </div>
    </div>
  );
}
