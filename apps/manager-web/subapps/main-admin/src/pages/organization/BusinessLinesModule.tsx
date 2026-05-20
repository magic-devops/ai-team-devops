import { Button, Form, Input, Modal, Popconfirm, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Building2, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../../../../src/components/PageStates";
import { ModuleFrame } from "./ModuleFrame";
import type { BusinessRow, ProjectRow } from "./types";

export function BusinessLinesModule({
  businesses,
  projects,
  loading,
  errors,
  createPending,
  updatePending,
  deletePending,
  onCreate,
  onUpdate,
  onDelete,
}: {
  businesses: BusinessRow[];
  projects: ProjectRow[];
  loading: boolean;
  errors: Array<Error | null | undefined>;
  createPending: boolean;
  updatePending: boolean;
  deletePending: boolean;
  onCreate: (body: { name: string; description?: string }) => void;
  onUpdate: (businessId: string, body: { name?: string; description?: string }) => void;
  onDelete: (businessId: string) => void;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [editing, setEditing] = useState<BusinessRow | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", description: "" });

  useEffect(() => {
    if (!editing) return;
    setEditDraft({ name: editing.name || "", description: editing.description || "" });
  }, [editing]);

  const columns: ColumnsType<BusinessRow> = [
    {
      title: t("page.organization.businessName"),
      dataIndex: "name",
      width: 280,
      render: (value, row) => (
        <div>
          <div className="font-medium text-[var(--text)]">{value}</div>
          <div className="font-mono text-xs text-[var(--muted)]">{row.business_code || row.id}</div>
        </div>
      ),
    },
    { title: t("page.organization.businessDesc"), dataIndex: "description", ellipsis: true },
    {
      title: t("page.organization.businessProjectCount"),
      dataIndex: "project_count",
      width: 130,
      render: (value, row) => {
        const count = value ?? projects.filter((p) => p.business_id === row.id).length;
        return <Tag color={count > 0 ? "blue" : "default"}>{count}</Tag>;
      },
    },
    {
      title: t("page.organization.actions"),
      width: 170,
      align: "right",
      render: (_value, row) => (
        <Space size={6}>
          <Button size="small" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(row)}>{t("common.edit")}</Button>
          <Popconfirm
            title={t("page.organization.confirmDeleteBusiness", { name: row.name })}
            okText={t("common.delete")}
            cancelText={t("common.cancel")}
            onConfirm={() => onDelete(row.id)}
          >
            <Button size="small" danger loading={deletePending} title={t("page.organization.deleteBusiness")} icon={<Trash2 className="h-4 w-4" />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <ModuleFrame
      title={t("page.organization.businesses")}
      description={t("page.organization.businessesHint")}
      actions={<Button type="primary" icon={<Building2 className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>{t("page.organization.addBusiness")}</Button>}
    >
      {loading ? <LoadingBlock /> : null}
      {errors.filter(Boolean).map((error) => <ErrorBlock key={error!.message} message={error!.message} />)}
      {businesses.length === 0 && !loading ? (
        <EmptyState message={t("page.organization.emptyBusiness")} />
      ) : (
        <Table rowKey="id" columns={columns} dataSource={businesses} pagination={{ pageSize: 10, showSizeChanger: true }} />
      )}

      <Modal
        title={t("page.organization.addBusiness")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          onCreate({ name: draft.name.trim(), description: draft.description.trim() });
          setDraft({ name: "", description: "" });
          setCreateOpen(false);
        }}
        okButtonProps={{ disabled: !draft.name.trim(), loading: createPending }}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Form layout="vertical">
          <Form.Item label={t("page.organization.businessName")} required><Input value={draft.name} onChange={(e) => setDraft((x) => ({ ...x, name: e.target.value }))} /></Form.Item>
          <Form.Item label={t("page.organization.businessDesc")}><Input.TextArea rows={3} value={draft.description} onChange={(e) => setDraft((x) => ({ ...x, description: e.target.value }))} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`${t("common.edit")} · ${editing?.name || ""}`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => {
          if (!editing) return;
          onUpdate(editing.id, { name: editDraft.name.trim(), description: editDraft.description.trim() });
          setEditing(null);
        }}
        okButtonProps={{ disabled: !editDraft.name.trim(), loading: updatePending }}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Form layout="vertical">
          <Form.Item label={t("page.organization.businessName")} required><Input value={editDraft.name} onChange={(e) => setEditDraft((x) => ({ ...x, name: e.target.value }))} /></Form.Item>
          <Form.Item label={t("page.organization.businessDesc")}><Input.TextArea rows={3} value={editDraft.description} onChange={(e) => setEditDraft((x) => ({ ...x, description: e.target.value }))} /></Form.Item>
        </Form>
      </Modal>
    </ModuleFrame>
  );
}
