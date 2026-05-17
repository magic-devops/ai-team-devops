import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Descriptions, Drawer, Form, Input, Modal, Select, Space, Switch, Table, Tag, Timeline } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

type HookRow = {
  id: string;
  name?: string;
  url?: string;
  events?: string[];
  active?: boolean;
  fail_count?: number;
  last_fired_at?: string;
};

export function WebhooksWorkbench({ focused = false }: { focused?: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<HookRow | null>(null);
  const [form] = Form.useForm<{ name: string; url: string; secret: string; events: string[] }>();

  const hooksQ = useQuery({ queryKey: ["webhooks"], queryFn: api.webhooks });
  const eventsQ = useQuery({ queryKey: ["webhookEvents"], queryFn: api.webhookEvents });
  const deliveriesQ = useQuery({
    queryKey: ["webhookDeliveries", detail?.id],
    queryFn: () => api.webhookDeliveries(detail!.id),
    enabled: Boolean(detail?.id),
  });

  const hooks: HookRow[] = hooksQ.data ?? [];
  const eventOptions = (eventsQ.data?.catalog ?? []).map((e: { id: string; label_zh?: string; label_en?: string }) => ({
    value: e.id,
    label: e.label_zh || e.label_en || e.id,
  }));

  const createMut = useMutation({
    mutationFn: (v: { name: string; url: string; secret: string; events: string[] }) => api.createWebhook(v),
    onSuccess: () => {
      setOpen(false);
      form.resetFields();
      message.success(t("page.webhooks.created"));
      void qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { active?: boolean } }) => api.patchWebhook(id, body),
    onSuccess: () => {
      message.success(t("page.webhooks.updated"));
      void qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => api.testWebhook(id),
    onSuccess: () => message.success(t("page.webhooks.testOk")),
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: () => {
      setDetail(null);
      message.success(t("page.webhooks.deleted"));
      void qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const columns: ColumnsType<HookRow> = [
    { title: t("page.webhooks.name"), dataIndex: "name" },
    { title: "URL", dataIndex: "url", ellipsis: true },
    {
      title: t("page.webhooks.active"),
      dataIndex: "active",
      width: 88,
      render: (v, row) => (
        <Switch
          size="small"
          checked={Boolean(v)}
          loading={patchMut.isPending}
          onChange={(active) => patchMut.mutate({ id: row.id, body: { active } })}
        />
      ),
    },
    {
      title: t("page.webhooks.events"),
      dataIndex: "events",
      render: (ev: string[]) => (
        <Space size={4} wrap>
          {(ev ?? []).slice(0, 2).map((e) => (
            <Tag key={e}>{e}</Tag>
          ))}
          {(ev?.length ?? 0) > 2 ? <Tag>+{ev!.length - 2}</Tag> : null}
        </Space>
      ),
    },
    {
      title: t("common.actions"),
      key: "a",
      width: 180,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setDetail(row)}>
            {t("common.view")}
          </Button>
          <Button size="small" loading={testMut.isPending} onClick={() => testMut.mutate(row.id)}>
            {t("page.webhooks.test")}
          </Button>
          <Button size="small" danger loading={deleteMut.isPending} onClick={() => deleteMut.mutate(row.id)}>
            {t("common.delete")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <WorkbenchShell
      title={t("page.webhooks.title")}
      description={focused ? t("page.webhooks.focusedHint") : t("page.webhooks.desc")}
      actions={
        <Button type="primary" onClick={() => setOpen(true)}>
          {t("page.webhooks.create")}
        </Button>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.webhooks.total"), value: hooks.length },
            { label: t("page.webhooks.active"), value: hooks.filter((h) => h.active).length },
          ]}
        />
      }
    >
      <WorkbenchPanel
        actions={<RefreshButton onClick={() => void hooksQ.refetch()} pending={hooksQ.isFetching} />}
      >
        <Table rowKey="id" loading={hooksQ.isLoading} columns={columns} dataSource={hooks} pagination={{ pageSize: 10 }} />
      </WorkbenchPanel>

      <Drawer title={detail?.name || t("page.webhooks.title")} open={Boolean(detail)} onClose={() => setDetail(null)} width={480}>
        {detail ? (
          <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="URL">{detail.url}</Descriptions.Item>
            <Descriptions.Item label={t("page.webhooks.events")}>
              <Space wrap>
                {(detail.events ?? []).map((e) => (
                  <Tag key={e}>{e}</Tag>
                ))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t("page.webhooks.failCount")}>{detail.fail_count ?? 0}</Descriptions.Item>
            <Descriptions.Item label={t("page.webhooks.lastFired")}>{detail.last_fired_at || "—"}</Descriptions.Item>
          </Descriptions>
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-[var(--text)]">{t("page.webhooks.deliveries")}</p>
            <Timeline
              items={(deliveriesQ.data?.items ?? []).map((d: Record<string, unknown>) => ({
                color: d.ok ? "green" : "red",
                children: (
                  <div className="text-xs">
                    <span className="font-mono">{String(d.event)}</span>
                    <span className="ml-2 text-[var(--muted)]">{String(d.fired_at ?? "")}</span>
                    {d.status_code != null ? <Tag className="ml-1">{String(d.status_code)}</Tag> : null}
                    {d.error ? <p className="mt-1 text-rose-600">{String(d.error)}</p> : null}
                  </div>
                ),
              }))}
            />
            {!deliveriesQ.data?.items?.length && !deliveriesQ.isLoading ? (
              <p className="text-xs text-[var(--muted)]">{t("page.webhooks.noDeliveries")}</p>
            ) : null}
          </div>
          </>
        ) : null}
      </Drawer>

      <Modal title={t("page.webhooks.create")} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={createMut.isPending} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="name" label={t("page.webhooks.name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="url" label="URL" rules={[{ required: true, type: "url" }]}>
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="secret" label={t("page.webhooks.secret")}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="events" label={t("page.webhooks.events")}>
            <Select mode="multiple" className="w-full" options={eventOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </WorkbenchShell>
  );
}
