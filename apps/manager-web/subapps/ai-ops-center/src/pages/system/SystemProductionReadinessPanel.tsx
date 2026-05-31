import { Segmented, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBlock } from "@/components/PageStates";

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
  domainLabel,
  onStageChange,
}: {
  rows: any[];
  data?: any;
  stage: string;
  loading: boolean;
  errorMessage?: string;
  domainLabel: (id: string) => string;
  onStageChange: (stage: string) => void;
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
        render: (value) => {
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
            <p className="font-mono text-sm font-semibold text-[var(--brand)]">{value}</p>
            <p className="text-[11px] text-[var(--muted)]">{row.readiness_score} contract</p>
          </div>
        ),
      },
      {
        title: t("page.systemMap.productionDimensions"),
        dataIndex: "dimensions",
        render: (value) => (
          <Space size={[4, 4]} wrap>
            {Object.entries(value ?? {}).slice(0, 7).map(([key, dim]: [string, any]) => {
              const statusValue = String(dim.status || "gap");
              const color = statusValue === "ready" || statusValue === "not_required" ? "green" : statusValue === "partial" ? "gold" : "red";
              return (
                <Tag key={key} color={color}>
                  {t(`page.systemMap.productionDimension.${key}`)} {dim.score}
                </Tag>
              );
            })}
          </Space>
        ),
      },
      {
        title: t("page.systemMap.recommendation"),
        dataIndex: "recommendations",
        render: (value) => (
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
          <Metric label={t("page.systemMap.productionAvgScore")} value={data?.summary?.avg_production_score ?? 0} />
          <Segmented
            value={stage}
            onChange={(value) => onStageChange(value as string)}
            options={["all", "gap", "contract_complete", "runtime_ready", "production_ready"].map((value) => ({
              label: t(`page.systemMap.productionStageValue.${value}`),
              value,
            }))}
          />
        </div>
      </div>
      {errorMessage ? <ErrorBlock message={errorMessage} /> : null}
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
