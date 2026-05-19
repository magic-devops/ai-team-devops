import { Alert, Button, List, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ClipboardCheck, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../components/PageStates";
import { WorkbenchStats } from "../shared/workbenchUi";
import { translateAccessFinding, translateAccessKind, translateAccessRecommendation, translateAccessSeverity } from "./accessReviewI18n";
import { ModuleFrame } from "./ModuleFrame";
import type { OrganizationAccessFinding, OrganizationAccessReview } from "./types";

export function AccessReviewModule({
  review,
  loading,
  error,
  taskPreview,
  taskPending = false,
  taskError,
  onPreviewTasks,
  onCreateTasks,
}: {
  review?: OrganizationAccessReview;
  loading: boolean;
  error?: Error | null;
  taskPreview?: { items?: Array<Record<string, unknown>>; created?: Array<Record<string, unknown>>; dry_run?: boolean };
  taskPending?: boolean;
  taskError?: Error | null;
  onPreviewTasks?: () => void;
  onCreateTasks?: () => void;
}) {
  const { t } = useTranslation();
  const columns: ColumnsType<OrganizationAccessFinding> = [
    {
      title: t("page.organization.accessSeverity"),
      dataIndex: "severity",
      width: 110,
      render: (value) => <Tag color={value === "high" ? "red" : value === "medium" ? "orange" : "blue"}>{translateAccessSeverity(t, value)}</Tag>,
    },
    { title: t("page.organization.accessRisk"), dataIndex: "title", width: 300, render: (_value, row) => translateAccessFinding(t, row, "title") },
    { title: t("page.organization.accessKind"), dataIndex: "kind", width: 180, render: (value) => translateAccessKind(t, value) },
    { title: t("page.organization.accessProject"), dataIndex: "project_name", width: 180, render: (value, row) => value || row.project_id || "-" },
    { title: t("page.organization.accessOwner"), dataIndex: "owner", width: 140, render: (value) => value || "-" },
    { title: t("page.organization.accessCommand"), dataIndex: "command", ellipsis: true, render: (value) => value || "-" },
  ];

  return (
    <ModuleFrame title={t("page.organization.accessReview")} description={t("page.organization.accessReviewHint")}>
      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error.message} /> : null}
      {taskError ? <ErrorBlock message={taskError.message} /> : null}
      {!loading && !review ? <EmptyState message={t("page.organization.accessEmpty")} /> : null}
      {review ? (
        <div className="space-y-4">
          <WorkbenchStats
            items={[
              { label: t("page.organization.accessScore"), value: review.score, hint: review.grade },
              { label: t("page.organization.accessFindings"), value: review.summary.findings },
              { label: t("page.organization.accessHigh"), value: review.summary.by_severity?.high ?? 0 },
              { label: t("page.organization.accessProjects"), value: review.summary.projects },
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                  <ShieldAlert className="h-4 w-4 text-[var(--brand)]" />
                  {t("page.organization.accessFindings")}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button loading={taskPending} onClick={onPreviewTasks}>{t("page.organization.accessPreviewTasks")}</Button>
                  <Button type="primary" loading={taskPending} onClick={onCreateTasks}>{t("page.organization.accessCreateTasks")}</Button>
                </div>
              </div>
              <Table
                rowKey="id"
                columns={columns}
                dataSource={review.findings}
                pagination={{ pageSize: 8, showSizeChanger: true }}
                scroll={{ x: 980 }}
                locale={{ emptyText: t("page.organization.accessNoRisk") }}
              />
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                  <ClipboardCheck className="h-4 w-4 text-[var(--brand)]" />
                  {t("page.organization.accessRecommendations")}
                </div>
                <List
                  size="small"
                  dataSource={review.recommendations}
                  renderItem={(item, index) => <List.Item><span className="text-[var(--muted-strong)]">{translateAccessRecommendation(t, item, index)}</span></List.Item>}
                />
              </div>
              {taskPreview ? (
                <Alert
                  showIcon
                  type={taskPreview.dry_run ? "info" : "success"}
                  message={taskPreview.dry_run ? t("page.organization.accessTaskPreview") : t("page.organization.accessTaskCreated")}
                  description={`${(taskPreview.items || []).length} / ${(taskPreview.created || []).length}`}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </ModuleFrame>
  );
}
