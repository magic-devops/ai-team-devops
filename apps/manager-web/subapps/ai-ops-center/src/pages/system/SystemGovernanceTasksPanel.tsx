import { Button, Segmented, Select, Table, Tag } from "antd";
import { ProjectOwnerSelect } from "@/components/DeliveryMemberIdentity";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type SystemGovernanceTasksPanelProps = {
  taskData: any;
  status: string;
  source: string;
  loading?: boolean;
  bulkUpdating?: boolean;
  bulkResult?: any;
  canWrite: boolean;
  onStatusChange: (status: string) => void;
  onSourceChange: (source: string) => void;
  onRefresh: () => void;
  onBulkUpdate: (body: { ids: string[]; dry_run: boolean; status?: string; priority?: string; owner_id?: string }) => void;
};

export function SystemGovernanceTasksPanel({
  taskData,
  status,
  source,
  loading,
  bulkUpdating,
  bulkResult,
  canWrite,
  onStatusChange,
  onSourceChange,
  onRefresh,
  onBulkUpdate,
}: SystemGovernanceTasksPanelProps) {
  const { t } = useTranslation();
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const rows = Array.isArray(taskData?.items) ? taskData.items : [];
  const lanes = Array.isArray(taskData?.lanes) ? taskData.lanes : [];
  const summary = taskData?.summary ?? {};
  const bulkActions = summary.bulk_actions ?? {};
  const fallbackStatuses: string[] = ["pending", "in_progress", "blocked", "completed"];
  const fallbackPriorities: string[] = ["P0", "P1", "P2", "P3"];
  const taskStatusValues: string[] = Array.isArray(summary.status_options)
    ? summary.status_options.map((item: any) => String(item.value)).filter(Boolean)
    : ["all", ...fallbackStatuses];
  const bulkStatusValues: string[] = Array.isArray(bulkActions.statuses) && bulkActions.statuses.length
    ? bulkActions.statuses.map(String)
    : fallbackStatuses;
  const bulkPriorityValues: string[] = Array.isArray(bulkActions.priorities) && bulkActions.priorities.length
    ? bulkActions.priorities.map(String)
    : fallbackPriorities;
  const sourceOptions = Array.isArray(summary.source_options)
    ? summary.source_options.map((item: any) => ({ label: item.label, value: item.value }))
    : [{ label: t("page.systemMap.governanceTasksAllSources"), value: "all" }];
  const statusOptions = taskStatusValues.map((value) => ({
    label: t(`page.systemMap.governanceTaskStatus.${value}`),
    value,
  }));
  const priorityColor = (value: string) => {
    if (value === "P0") return "red";
    if (value === "P1") return "orange";
    if (value === "P2") return "blue";
    return "default";
  };
  const selectedTaskIds = selectedRowKeys.filter(Boolean);
  const canApplyBulk = selectedTaskIds.length > 0 && Boolean(bulkStatus || bulkPriority || bulkAssignee.trim());
  const buildBulkBody = (dry_run: boolean) => ({
    ids: selectedTaskIds,
    dry_run,
    status: bulkStatus || undefined,
    priority: bulkPriority || undefined,
    owner_id: bulkAssignee === "__clear__" ? "" : bulkAssignee || undefined,
  });

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.governanceTasksTitle")}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{taskData?.agent_consumption?.purpose}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={status} onChange={(value) => onStatusChange(String(value))} options={statusOptions} />
          <Select
            className="min-w-44"
            value={source}
            onChange={onSourceChange}
            options={sourceOptions}
            aria-label={t("page.systemMap.governanceTasksSource")}
          />
          <Button htmlType="button" onClick={onRefresh} loading={loading}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <Metric label={t("page.systemMap.governanceTasksTotal")} value={summary.total ?? 0} />
        <Metric label={t("page.systemMap.governanceTasksOpen")} value={summary.open ?? 0} />
        <Metric label={t("page.systemMap.governanceTasksBlocked")} value={summary.blocked ?? 0} />
        <Metric label={t("page.systemMap.governanceTasksCompleted")} value={summary.completed ?? 0} />
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {lanes.filter((lane: any) => lane.count > 0 || source === lane.source).slice(0, 8).map((lane: any) => (
          <a
            key={lane.source}
            href={lane.route}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 transition hover:border-[var(--brand)]"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold text-[var(--text)]">{lane.label}</p>
              <Tag>{lane.count ?? 0}</Tag>
            </div>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {t("page.systemMap.governanceTaskLaneHint", {
                open: lane.open ?? 0,
                completed: lane.completed ?? 0,
              })}
            </p>
            <p className="mt-2 truncate font-mono text-[11px] text-[var(--brand)]">{lane.cli}</p>
          </a>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--muted-strong)]">
            {t("page.systemMap.governanceTaskBulkSelected", { count: selectedTaskIds.length })}
          </span>
          <Select
            className="min-w-36"
            allowClear
            value={bulkStatus || undefined}
            onChange={(value) => setBulkStatus(value || "")}
            placeholder={t("page.systemMap.governanceTaskBulkStatus")}
            options={bulkStatusValues.map((value) => ({
              label: t(`page.systemMap.governanceTaskStatus.${value}`),
              value,
            }))}
          />
          <Select
            className="min-w-32"
            allowClear
            value={bulkPriority || undefined}
            onChange={(value) => setBulkPriority(value || "")}
            placeholder={t("page.systemMap.governanceTaskBulkPriority")}
            options={bulkPriorityValues.map((value) => ({ label: value, value }))}
          />
          <ProjectOwnerSelect
            value={bulkAssignee}
            onChange={setBulkAssignee}
            keepCurrent
            placeholder={t("page.systemMap.governanceTaskBulkAssignee")}
          />
          <Button
            htmlType="button"
            onClick={() => onBulkUpdate(buildBulkBody(true))}
            disabled={!canApplyBulk || bulkUpdating}
          >
            {t("page.systemMap.previewGovernanceTaskBulkUpdate")}
          </Button>
          <Button
            type="primary"
            htmlType="button"
            onClick={() => onBulkUpdate(buildBulkBody(false))}
            loading={bulkUpdating}
            disabled={!canApplyBulk || !canWrite}
            title={!canWrite ? t("capability.denied") : undefined}
          >
            {t("page.systemMap.applyGovernanceTaskBulkUpdate")}
          </Button>
          <Button htmlType="button" onClick={() => setSelectedRowKeys([])} disabled={!selectedTaskIds.length}>
            {t("page.systemMap.clearSelection")}
          </Button>
        </div>
        {bulkResult ? (
          <div className="mt-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted-strong)]">
            <span>
              {t("page.systemMap.governanceTaskBulkResult", {
                planned: bulkResult.summary?.planned ?? 0,
                updated: bulkResult.summary?.updated ?? 0,
                skipped: bulkResult.summary?.skipped ?? 0,
              })}
            </span>
            <span className="ml-3 font-mono text-[var(--brand)]">{bulkResult.agent_consumption?.cli}</span>
          </div>
        ) : null}
      </div>

      <Table
        className="mt-3"
        size="small"
        rowKey={(row) => row.id}
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys.map(String)),
        }}
        pagination={{ pageSize: 8, showSizeChanger: false }}
        dataSource={rows}
        scroll={{ x: 960 }}
        columns={[
          {
            title: t("page.systemMap.governanceTasksTask"),
            dataIndex: "title",
            key: "title",
            render: (_value: string, row: any) => (
              <div className="min-w-0">
                <a className="line-clamp-1 text-xs font-semibold text-[var(--text)] hover:text-[var(--brand)]" href={row.task_url}>
                  {row.title}
                </a>
                <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{row.id} · {row.source_report_id}</p>
              </div>
            ),
          },
          {
            title: t("page.systemMap.governanceTasksSource"),
            dataIndex: "source_label",
            key: "source_label",
            width: 160,
            render: (_value: string, row: any) => (
              <a className="text-xs font-medium text-[var(--brand)] hover:underline" href={row.source_route}>
                {row.source_label}
              </a>
            ),
          },
          {
            title: t("page.systemMap.priority"),
            dataIndex: "priority",
            key: "priority",
            width: 90,
            render: (value: string) => <Tag color={priorityColor(value)}>{value || "-"}</Tag>,
          },
          {
            title: t("page.systemMap.status"),
            dataIndex: "status",
            key: "status",
            width: 120,
            render: (value: string) => <span className="text-xs text-[var(--muted-strong)]">{value || "-"}</span>,
          },
          {
            title: t("page.systemMap.assignedTo"),
            dataIndex: "assigned_to",
            key: "assigned_to",
            width: 140,
            render: (value: string) => <span className="text-xs text-[var(--muted-strong)]">{value || "-"}</span>,
          },
          {
            title: t("page.systemMap.openTaskCenter"),
            key: "task_url",
            width: 130,
            render: (_value: unknown, row: any) => (
              <a className="text-xs font-medium text-[var(--brand)] hover:underline" href={row.task_url}>
                {t("page.systemMap.openTaskCenter")}
              </a>
            ),
          },
        ]}
      />
      <code className="mt-3 block rounded-lg bg-[var(--control-bg)] px-2.5 py-1 text-xs text-[var(--brand)]">
        {taskData?.agent_consumption?.cli ?? "sop pages governance-tasks --json"}
      </code>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}
