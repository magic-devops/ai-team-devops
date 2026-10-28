import { Segmented, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBlock } from "@/components/PageStates";
import { CatalogAssessmentCounts } from "@/components/CatalogAssessmentCounts";
import { assessmentText, isAssessedNumber } from "@/lib/catalogAssessment";

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">
      <p className="text-[11px] font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

export function SystemProductionReadinessPanel({
  rows,
  data,
  stage,
  loading,
  errorMessage,
  taskResult,
  taskPending,
  canCreateTasks,
  domainLabel,
  onStageChange,
  onPreviewTasks,
  onCreateTasks,
}: {
  rows: any[];
  data?: any;
  stage: string;
  loading: boolean;
  errorMessage?: string;
  taskResult?: any;
  taskPending?: boolean;
  canCreateTasks?: boolean;
  domainLabel: (id: string) => string;
  onStageChange: (stage: string) => void;
  onPreviewTasks?: () => void;
  onCreateTasks?: () => void;
}) {
  const { t } = useTranslation();
  const columns = useMemo<ColumnsType<any>>(
    () => [
      {
        title: t("page.systemMap.module"),
        dataIndex: "name",
        render: (_value, row) => (
          <div className="min-w-0">
            <a className="truncate text-sm font-semibold text-[var(--text)] hover:text-[var(--brand)]" href={row.path}>{row.name}</a>
            <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{row.id} · {domainLabel(String(row.domain))}</p>
          </div>
        ),
      },
      {
        title: t("page.systemMap.productionStage"),
        dataIndex: "stage",
        width: 150,
        render: (value, row) => {
          if (!isAssessedNumber(row.production_score)) return <Tag>{t("catalogAssessment.unassessed")}</Tag>;
          const stageValue = String(value || "gap");
          const color = stageValue === "production_ready" ? "green" : stageValue === "runtime_ready" ? "blue" : stageValue === "contract_complete" ? "gold" : "red";
          return <Tag color={color}>{t(`page.systemMap.productionStageValue.${stageValue}`)}</Tag>;
        },
      },
      {
        title: t("page.systemMap.productionScore"),
        dataIndex: "production_score",
        width: 120,
        render: (value, row) => (
          <div>
            <p className="font-mono text-sm font-semibold text-[var(--muted-strong)]">{assessmentText(value, t("catalogAssessment.unassessed"))}</p>
            <p className="text-[11px] text-[var(--muted)]">{assessmentText(row.readiness_score, t("catalogAssessment.unassessed"))} contract</p>
          </div>
        ),
      },
      {
        title: t("page.systemMap.productionDimensions"),
        dataIndex: "dimensions",
        render: (value, row) => !isAssessedNumber(row.production_score) ? <Tag>{t("catalogAssessment.unassessed")}</Tag> : (
          <Space size={[4, 4]} wrap>
            {Object.entries(value ?? {}).slice(0, 7).map(([key, dim]: [string, any]) => {
              const statusValue = String(dim.status || "gap");
              const color = !isAssessedNumber(dim.score) ? undefined : statusValue === "ready" || statusValue === "not_required" ? "green" : statusValue === "partial" ? "gold" : "red";
              return (
                <Tag key={key} color={color}>
                  {t(`page.systemMap.productionDimension.${key}`)} {assessmentText(dim.score, t("catalogAssessment.unassessed"))}
                </Tag>
              );
            })}
          </Space>
        ),
      },
      {
        title: t("page.systemMap.recommendation"),
        dataIndex: "recommendations",
        render: (value, row) => !isAssessedNumber(row.production_score) ? <span className="text-xs text-[var(--muted)]">{t("catalogAssessment.unassessed")}</span> : (
          <div className="max-w-lg space-y-1">
            {(value ?? []).slice(0, 2).map((item: string, index: number) => (
              <p key={`${item}-${index}`} className="line-clamp-1 text-xs text-[var(--muted-strong)]">{item}</p>
            ))}
            {!(value ?? []).length ? <span className="text-xs text-emerald-600 dark:text-emerald-300">{t("page.systemMap.productionNoGap")}</span> : null}
          </div>
        ),
      },
    ],
    [domainLabel, t],
  );

  return (
    <div className="systemProductionReadinessPanel rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.productionReadinessTitle")}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{data?.agent_consumption?.purpose}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Metric label={t("page.systemMap.productionReady")} value={data?.summary?.production_ready ?? 0} />
          <Metric label={t("page.systemMap.runtimeReady")} value={data?.summary?.runtime_ready ?? 0} />
          <Metric label={t("page.systemMap.productionAvgScore")} value={assessmentText(data?.summary?.avg_production_score, t("catalogAssessment.unassessed"))} />
          <CatalogAssessmentCounts value={data?.summary} />
          <Segmented
            value={stage}
            onChange={(value) => onStageChange(value as string)}
            options={["all", "unassessed", "gap", "contract_complete", "runtime_ready", "production_ready"].map((value) => ({
              label: value === "unassessed" ? t("catalogAssessment.unassessed") : t(`page.systemMap.productionStageValue.${value}`),
              value,
            }))}
          />
          <button
            type="button"
            onClick={onPreviewTasks}
            disabled={taskPending}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:border-[var(--brand)]/50 disabled:opacity-50"
          >
            {t("page.systemMap.previewProductionTasks")}
          </button>
          <button
            type="button"
            onClick={onCreateTasks}
            disabled={taskPending || !canCreateTasks}
            className="rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {t("page.systemMap.createProductionTasks")}
          </button>
        </div>
      </div>
      {errorMessage ? <ErrorBlock message={errorMessage} /> : null}
      {taskResult ? (
        <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted-strong)]">
          {t("page.systemMap.productionTaskResult", {
            planned: taskResult.summary?.planned ?? 0,
            created: taskResult.summary?.created ?? 0,
            skipped: taskResult.summary?.skipped ?? 0,
          })}
        </div>
      ) : null}
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows.slice(0, 12)}
        loading={loading}
        pagination={false}
        scroll={{ x: 980 }}
        locale={{ emptyText: t("page.systemMap.noProductionRows") }}
      />
    </div>
  );
}
