import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

type ConnRow = { name: string; driver?: string; url_masked?: string; status?: string };

export function DataSourcesWorkbench({ focused = false }: { focused?: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form] = Form.useForm<{ name: string; url: string; driver: string }>();

  const connQ = useQuery({ queryKey: ["dbConnections"], queryFn: api.dbConnections });
  const driversQ = useQuery({ queryKey: ["dbDrivers"], queryFn: api.dbDrivers });

  const items: ConnRow[] = connQ.data?.items ?? [];
  const driverList = Array.isArray(driversQ.data?.drivers)
    ? driversQ.data.drivers
    : Array.isArray(driversQ.data)
      ? driversQ.data
      : ["mysql", "postgresql", "oceanbase"];

  const openCreate = () => {
    setEditingName(null);
    form.resetFields();
    form.setFieldsValue({ driver: "mysql" });
    setEditOpen(true);
  };

  const openEdit = (row: ConnRow) => {
    setEditingName(row.name);
    form.setFieldsValue({ name: row.name, driver: row.driver || "mysql", url: "" });
    setEditOpen(true);
  };

  const testMut = useMutation({
    mutationFn: (name: string) => api.dbTestConnection(name),
    onSuccess: (data, name) => {
      const ok = Boolean(data?.ok);
      setTestResult((r) => ({ ...r, [name]: ok ? "OK" : String(data?.error || "fail") }));
      if (ok) message.success(t("page.dataSources.testOk"));
      else message.warning(String(data?.error || t("common.error", { msg: "test failed" })));
    },
    onError: (e) => message.error((e as Error).message),
  });

  const saveMut = useMutation({
    mutationFn: (v: { name: string; url: string; driver: string }) => {
      const target = editingName || v.name;
      return api.dbUpsertConnection(target, { url: v.url, driver: v.driver });
    },
    onSuccess: () => {
      setEditOpen(false);
      setEditingName(null);
      form.resetFields();
      message.success(t("page.dataSources.saved"));
      void qc.invalidateQueries({ queryKey: ["dbConnections"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.dbDeleteConnection(name),
    onSuccess: () => {
      message.success(t("page.dataSources.deleted"));
      void qc.invalidateQueries({ queryKey: ["dbConnections"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const columns: ColumnsType<ConnRow> = [
    { title: t("page.dataSources.name"), dataIndex: "name" },
    { title: t("page.dataSources.driver"), dataIndex: "driver", width: 120 },
    { title: t("page.dataSources.url"), dataIndex: "url_masked", ellipsis: true },
    {
      title: t("common.actions"),
      key: "a",
      width: 220,
      render: (_, row) => (
        <span className="flex flex-wrap gap-1">
          <Button size="small" onClick={() => openEdit(row)}>
            {t("page.dataSources.edit")}
          </Button>
          <Button size="small" loading={testMut.isPending} onClick={() => testMut.mutate(row.name)}>
            {t("page.dataSources.test")}
          </Button>
          <Popconfirm title={t("page.dataSources.confirmDelete")} onConfirm={() => deleteMut.mutate(row.name)}>
            <Button size="small" danger>
              {t("common.delete")}
            </Button>
          </Popconfirm>
          {testResult[row.name] ? (
            <Tag color={testResult[row.name] === "OK" ? "success" : "error"}>{testResult[row.name]}</Tag>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <WorkbenchShell
      title={t("page.dataSources.title")}
      description={focused ? t("page.dataSources.focusedHint") : t("page.dataSources.desc")}
      actions={
        <Button type="primary" onClick={openCreate}>
          {t("page.dataSources.add")}
        </Button>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.dataSources.total"), value: items.length },
            { label: t("page.dataSources.drivers"), value: driverList.length },
          ]}
        />
      }
    >
      <WorkbenchPanel actions={<RefreshButton onClick={() => void connQ.refetch()} pending={connQ.isFetching} />}>
        <Table rowKey="name" loading={connQ.isLoading} columns={columns} dataSource={items} pagination={{ pageSize: 10 }} />
      </WorkbenchPanel>

      <Modal
        title={editingName ? t("page.dataSources.edit") : t("page.dataSources.add")}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMut.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
          <Form.Item name="name" label={t("page.dataSources.name")} rules={[{ required: true }]}>
            <Input disabled={Boolean(editingName)} />
          </Form.Item>
          <Form.Item name="driver" label={t("page.dataSources.driver")} rules={[{ required: true }]}>
            <Select options={driverList.map((d: string) => ({ value: d, label: d }))} />
          </Form.Item>
          <Form.Item
            name="url"
            label={t("page.dataSources.url")}
            rules={[{ required: !editingName }]}
            extra={editingName ? t("page.dataSources.urlPh") : undefined}
          >
            <Input.TextArea rows={2} placeholder={t("page.dataSources.urlPh")} />
          </Form.Item>
        </Form>
      </Modal>
    </WorkbenchShell>
  );
}
