import { PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input as AntInput, Modal, Popconfirm, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../../../../src/components/Card";
import { EmptyState, ErrorBlock } from "../../../../../src/components/PageStates";
import type { Project } from "./types";

export function BusinessModule(props: {
  businesses: any[];
  projects: Project[];
  draft: { name: string; description: string };
  setDraft: (v: { name: string; description: string }) => void;
  createPending: boolean;
  createError: Error | null;
  deletePending: boolean;
  onCreate: () => void;
  onUpdate: (businessId: string, body: { name?: string; description?: string }) => void;
  onDelete: (businessId: string) => void;
  onSelectProject: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<any>(null);
  const [query, setQuery] = useState("");

  const projectCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of props.projects) {
      if (project.business_id) map.set(project.business_id, (map.get(project.business_id) || 0) + 1);
    }
    return map;
  }, [props.projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.businesses.filter((business) => {
      const haystack = [business.id, business.name, business.description].map((x) => String(x ?? "").toLowerCase()).join(" ");
      return !q || haystack.includes(q);
    });
  }, [props.businesses, query]);

  const columns: ColumnsType<any> = [
    {
      title: t("page.projects.business"),
      dataIndex: "name",
      width: 360,
      render: (_value, business) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text)]" title={business.name || business.id}>{business.name || business.id}</div>
          <div className="mt-1 break-all font-mono text-xs text-[var(--muted)]">{business.id}</div>
        </div>
      ),
    },
    {
      title: t("page.projects.description"),
      dataIndex: "description",
      render: (value) => <span className="line-clamp-2 text-sm text-[var(--muted-strong)]">{value || "-"}</span>,
    },
    {
      title: t("page.projects.projectsCount"),
      key: "projectCount",
      width: 130,
      sorter: (a, b) => (projectCounts.get(a.id) || 0) - (projectCounts.get(b.id) || 0),
      render: (_value, business) => <Tag color={(projectCounts.get(business.id) || 0) > 0 ? "blue" : "default"}>{projectCounts.get(business.id) || 0}</Tag>,
    },
    {
      title: t("page.projects.actions"),
      key: "actions",
      width: 230,
      fixed: "right",
      render: (_value, business) => {
        const count = projectCounts.get(business.id) || 0;
        return (
          <Space size={8} wrap>
            <Button size="small" onClick={() => setEditingBusiness(business)}>{t("common.edit")}</Button>
            <Popconfirm
              title={count > 0 ? t("page.projects.businessDeleteBlocked") : t("page.projects.confirmDelete", { name: business.name })}
              okText={t("common.delete")}
              cancelText={t("common.cancel")}
              okButtonProps={{ danger: true, disabled: count > 0, loading: props.deletePending }}
              onConfirm={() => props.onDelete(business.id)}
            >
              <Button size="small" danger disabled={count > 0} loading={props.deletePending}>{t("common.delete")}</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Card
        title={t("page.projects.businessLines")}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t("page.projects.createBusiness")}
          </Button>
        }
      >
        <div className="mb-4">
          <AntInput.Search allowClear value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("page.projects.searchBusiness")} />
        </div>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          size="middle"
          scroll={{ x: 900 }}
          locale={{ emptyText: <EmptyState message={t("page.projects.emptyBusinesses")} /> }}
          pagination={{
            showSizeChanger: true,
            pageSizeOptions: [10, 25, 50, 100],
            defaultPageSize: 25,
            showTotal: (total, range) => t("page.projects.tableSummary", { start: range[0], end: range[1], total }),
          }}
        />
      </Card>

      <CreateBusinessModal
        open={createOpen}
        draft={props.draft}
        pending={props.createPending}
        error={props.createError}
        setDraft={props.setDraft}
        onCancel={() => setCreateOpen(false)}
        onCreate={() => {
          props.onCreate();
          setCreateOpen(false);
        }}
      />

      <EditBusinessModal
        business={editingBusiness}
        onCancel={() => setEditingBusiness(null)}
        onSave={(body) => {
          if (editingBusiness) props.onUpdate(editingBusiness.id, body);
          setEditingBusiness(null);
        }}
      />
    </>
  );
}

function CreateBusinessModal(props: {
  open: boolean;
  draft: { name: string; description: string };
  pending: boolean;
  error: Error | null;
  setDraft: (v: { name: string; description: string }) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={props.open}
      title={t("page.projects.createBusiness")}
      onCancel={props.onCancel}
      okText={t("page.projects.createBusiness")}
      okButtonProps={{ disabled: !props.draft.name.trim(), loading: props.pending }}
      onOk={props.onCreate}
      destroyOnHidden
    >
      {props.error ? <ErrorBlock message={props.error.message} /> : null}
      <Form layout="vertical" className="mt-3">
        <Form.Item label={t("page.projects.business")} required>
          <AntInput value={props.draft.name} onChange={(e) => props.setDraft({ ...props.draft, name: e.target.value })} placeholder={t("page.projects.businessNamePh")} />
        </Form.Item>
        <Form.Item label={t("page.projects.description")}>
          <AntInput.TextArea rows={4} value={props.draft.description} onChange={(e) => props.setDraft({ ...props.draft, description: e.target.value })} placeholder={t("page.projects.businessDescPh")} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function EditBusinessModal(props: {
  business: any;
  onCancel: () => void;
  onSave: (body: { name?: string; description?: string }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!props.business) return;
    setName(String(props.business.name || ""));
    setDescription(String(props.business.description || ""));
  }, [props.business]);

  return (
    <Modal
      open={Boolean(props.business)}
      title={props.business ? `${t("common.edit")} · ${props.business.name}` : t("common.edit")}
      onCancel={props.onCancel}
      okText={t("common.save")}
      okButtonProps={{ disabled: !name.trim() }}
      onOk={() => props.onSave({ name, description })}
      destroyOnHidden
    >
      <Form layout="vertical" className="mt-3">
        <Form.Item label={t("page.projects.business")} required>
          <AntInput value={name} onChange={(e) => setName(e.target.value)} />
        </Form.Item>
        <Form.Item label={t("page.projects.description")}>
          <AntInput.TextArea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
