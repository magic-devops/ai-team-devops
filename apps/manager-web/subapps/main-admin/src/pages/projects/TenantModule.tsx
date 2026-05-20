import { PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input as AntInput, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../../../../src/components/Card";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../../../../src/components/PageStates";

const planOptions = ["free", "team", "business", "enterprise"].map((value) => ({ label: value, value }));
const statusOptions = ["active", "suspended", "archived"].map((value) => ({ label: value, value }));

export function TenantModule(props: {
  role: string;
  tenants: any[];
  loading: boolean;
  error: Error | null;
  draft: { name: string; slug: string; plan: string };
  setDraft: (v: { name: string; slug: string; plan: string }) => void;
  createPending: boolean;
  createError: Error | null;
  updatePending: boolean;
  deletePending: boolean;
  onCreate: () => void;
  onUpdate: (tenantId: string, body: { name?: string; plan?: string; status?: string }) => void;
  onDelete: (tenantId: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("all");
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.tenants.filter((tenant) => {
      const haystack = [tenant.id, tenant.name, tenant.slug, tenant.plan, tenant.status].map((x) => String(x ?? "").toLowerCase()).join(" ");
      return (!q || haystack.includes(q)) && (plan === "all" || tenant.plan === plan) && (status === "all" || tenant.status === status);
    });
  }, [props.tenants, query, plan, status]);

  const columns: ColumnsType<any> = [
    {
      title: t("page.projects.tenant"),
      dataIndex: "name",
      width: 360,
      render: (_value, tenant) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text)]" title={tenant.name || tenant.id}>{tenant.name || tenant.id}</div>
          <div className="mt-1 break-all font-mono text-xs text-[var(--muted)]">{tenant.slug || tenant.id}</div>
        </div>
      ),
    },
    {
      title: t("page.projects.plan"),
      dataIndex: "plan",
      width: 150,
      render: (value) => <Tag color={value === "enterprise" ? "gold" : value === "business" ? "blue" : "default"}>{value}</Tag>,
      filters: planOptions.map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value, tenant) => tenant.plan === value,
    },
    {
      title: t("page.projects.status"),
      dataIndex: "status",
      width: 150,
      render: (value) => <Tag color={value === "active" ? "green" : value === "suspended" ? "orange" : "default"}>{value}</Tag>,
      filters: statusOptions.map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value, tenant) => tenant.status === value,
    },
    {
      title: t("page.projects.actions"),
      key: "actions",
      width: 240,
      fixed: "right",
      render: (_value, tenant) => (
        <Space size={8} wrap>
          <Button size="small" onClick={() => setEditingTenant(tenant)}>{t("common.edit")}</Button>
          <Popconfirm
            title={t("page.projects.confirmDeleteTenant", { name: tenant.name })}
            okText={t("common.delete")}
            cancelText={t("common.cancel")}
            okButtonProps={{ danger: true, loading: props.deletePending }}
            onConfirm={() => props.onDelete(tenant.id)}
          >
            <Button size="small" danger loading={props.deletePending}>{t("common.delete")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  const [editingTenant, setEditingTenant] = useState<any>(null);

  if (props.role !== "super_admin") {
    return <Card title={t("page.projects.tenants")}><EmptyState message={t("page.projects.superAdminOnly")} /></Card>;
  }

  return (
    <>
      <Card
        title={t("page.projects.tenants")}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t("page.projects.createTenant")}
          </Button>
        }
      >
        {props.error ? <ErrorBlock message={props.error.message} /> : null}
        <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(16rem,1fr)_12rem_12rem]">
          <AntInput.Search
            allowClear
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("page.projects.searchTenants")}
          />
          <Select value={plan} onChange={setPlan} options={[{ label: t("page.projects.allPlans"), value: "all" }, ...planOptions]} />
          <Select value={status} onChange={setStatus} options={[{ label: t("page.projects.allStatuses"), value: "all" }, ...statusOptions]} />
        </div>
        {props.loading ? <LoadingBlock /> : null}
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={props.loading}
          size="middle"
          scroll={{ x: 880 }}
          locale={{ emptyText: <EmptyState message={t("page.projects.emptyTenants")} /> }}
          pagination={{
            showSizeChanger: true,
            pageSizeOptions: [10, 25, 50, 100],
            defaultPageSize: 25,
            showTotal: (total, range) => t("page.projects.tableSummary", { start: range[0], end: range[1], total }),
          }}
        />
      </Card>

      <CreateTenantModal
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

      <EditTenantModal
        tenant={editingTenant}
        pending={props.updatePending}
        onCancel={() => setEditingTenant(null)}
        onSave={(body) => {
          if (editingTenant) props.onUpdate(editingTenant.id, body);
          setEditingTenant(null);
        }}
      />
    </>
  );
}

function CreateTenantModal(props: {
  open: boolean;
  draft: { name: string; slug: string; plan: string };
  pending: boolean;
  error: Error | null;
  setDraft: (v: { name: string; slug: string; plan: string }) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={props.open}
      title={t("page.projects.createTenant")}
      onCancel={props.onCancel}
      okText={t("page.projects.createTenant")}
      okButtonProps={{ disabled: !props.draft.name.trim() || !props.draft.slug.trim(), loading: props.pending }}
      onOk={props.onCreate}
      destroyOnHidden
    >
      {props.error ? <ErrorBlock message={props.error.message} /> : null}
      <Form layout="vertical" className="mt-3">
        <Form.Item label={t("page.projects.tenantName")} required>
          <AntInput value={props.draft.name} onChange={(e) => props.setDraft({ ...props.draft, name: e.target.value })} placeholder={t("page.projects.tenantNamePh")} />
        </Form.Item>
        <Form.Item label={t("page.projects.tenantSlug")} required>
          <AntInput value={props.draft.slug} onChange={(e) => props.setDraft({ ...props.draft, slug: e.target.value })} placeholder={t("page.projects.tenantSlugPh")} />
        </Form.Item>
        <Form.Item label={t("page.projects.plan")}>
          <Select value={props.draft.plan} onChange={(value) => props.setDraft({ ...props.draft, plan: value })} options={planOptions} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function EditTenantModal(props: {
  tenant: any;
  pending: boolean;
  onCancel: () => void;
  onSave: (body: { name?: string; plan?: string; status?: string }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("free");
  const [status, setStatus] = useState("active");

  useEffect(() => {
    if (!props.tenant) return;
    setName(String(props.tenant.name || ""));
    setPlan(String(props.tenant.plan || "free"));
    setStatus(String(props.tenant.status || "active"));
  }, [props.tenant]);

  return (
    <Modal
      open={Boolean(props.tenant)}
      title={props.tenant ? `${t("common.edit")} · ${props.tenant.name}` : t("common.edit")}
      onCancel={props.onCancel}
      okText={t("common.save")}
      okButtonProps={{ disabled: !name.trim(), loading: props.pending }}
      onOk={() => props.onSave({ name, plan, status })}
      destroyOnHidden
    >
      <Form layout="vertical" className="mt-3">
        <Form.Item label={t("page.projects.tenantName")} required>
          <AntInput value={name} onChange={(e) => setName(e.target.value)} />
        </Form.Item>
        <Form.Item label={t("page.projects.plan")}>
          <Select value={plan} onChange={setPlan} options={planOptions} />
        </Form.Item>
        <Form.Item label={t("page.projects.status")}>
          <Select value={status} onChange={setStatus} options={statusOptions} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
