import { Button, Progress, Table, Tag } from "antd";
import { useTranslation } from "react-i18next";

type IsolationBaselineComparePanelProps = {
  compareData: any;
  compareTaskResult: any;
  compareTasksPending: boolean;
  canWrite: boolean;
  onPreviewCompareTasks: () => void;
  onCreateCompareTasks: () => void;
};

export function IsolationBaselineComparePanel({
  compareData,
  compareTaskResult,
  compareTasksPending,
  canWrite,
  onPreviewCompareTasks,
  onCreateCompareTasks,
}: IsolationBaselineComparePanelProps) {
  const { t } = useTranslation();
  const compareRows = Array.isArray(compareData?.items) ? compareData.items : [];
  const compareSummary = compareData?.summary ?? {};
  const compareScore = Math.max(0, Math.min(100, Number(compareData?.target?.score ?? 0)));
  const changeColor = (change: string) => {
    if (change === "resolved") return "success";
    if (change === "new_risk" || change === "regressed") return "error";
    if (change === "changed") return "warning";
    return "default";
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.isolationScanCompareTitle")}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{compareData?.agent_consumption?.purpose}</p>
        </div>
        <div className="min-w-44">
          <Progress
            percent={compareScore}
            size="small"
            status={(compareSummary.new_risks ?? 0) > 0 ? "exception" : "success"}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Tag color="red">{t("page.systemMap.isolationScanCompareNewRisks")}: {compareSummary.new_risks ?? 0}</Tag>
          <Tag color="green">{t("page.systemMap.isolationScanCompareResolved")}: {compareSummary.resolved ?? 0}</Tag>
          <Tag color="blue">{t("page.systemMap.isolationScanCompareScoreDelta")}: {compareSummary.score_delta ?? 0}</Tag>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="small" htmlType="button" onClick={onPreviewCompareTasks} disabled={compareTasksPending}>
            {t("page.systemMap.previewIsolationScanCompareTasks")}
          </Button>
          <Button
            size="small"
            type="primary"
            htmlType="button"
            onClick={onCreateCompareTasks}
            disabled={compareTasksPending || !canWrite}
            title={!canWrite ? t("capability.denied") : undefined}
          >
            {t("page.systemMap.createIsolationScanCompareTasks")}
          </Button>
        </div>
      </div>
      {compareTaskResult ? (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--muted-strong)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t("page.systemMap.isolationScanCompareTaskResult", {
                planned: compareTaskResult.summary?.planned ?? 0,
                created: compareTaskResult.summary?.created ?? 0,
                skipped: compareTaskResult.summary?.skipped ?? 0,
              })}
            </span>
            <span className="font-mono text-xs text-[var(--brand)]">{compareTaskResult.agent_consumption?.cli}</span>
          </div>
          {(compareTaskResult.planned ?? []).length ? (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {(compareTaskResult.planned ?? []).slice(0, 4).map((item: any) => (
                <article key={item.source_report_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                  <p className="line-clamp-1 text-xs font-semibold text-[var(--text)]">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-[var(--muted)]">{item.source_report_id} · {item.priority}</p>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <Table
        className="mt-3"
        size="small"
        rowKey={(row) => `${row.id}-${row.change}`}
        pagination={false}
        dataSource={compareRows.filter((row: any) => row.change !== "unchanged").slice(0, 6)}
        columns={[
          {
            title: t("page.systemMap.isolationScanCompareModule"),
            dataIndex: "module",
            key: "module",
            render: (value: string) => <span className="text-xs font-semibold text-[var(--text)]">{value || "-"}</span>,
          },
          {
            title: t("page.systemMap.isolationScanCompareBeforeAfter"),
            key: "before_after",
            render: (_: unknown, row: any) => (
              <span className="text-xs text-[var(--muted-strong)]">
                {row.before_status} {"->"} {row.after_status}
              </span>
            ),
          },
          {
            title: t("page.systemMap.isolationScanCompareChange"),
            dataIndex: "change",
            key: "change",
            render: (value: string) => <Tag color={changeColor(value)}>{value}</Tag>,
          },
        ]}
      />
    </div>
  );
}
