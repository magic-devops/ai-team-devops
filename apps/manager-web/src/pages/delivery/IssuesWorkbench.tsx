import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NeedLogin } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getProjectId, getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { RefreshButton, useDebouncedValue, WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

const SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
const STATUSES = ["open", "resolved"] as const;

type IssueRow = {
  id: string;
  title?: string;
  description?: string;
  type?: string;
  severity?: string;
  status?: string;
  task_id?: string;
  reported_by?: string;
  created_at?: string;
};

export function IssuesWorkbench({ focused = false }: { focused?: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveId, setResolveId] = useState("");
  const [detail, setDetail] = useState<IssueRow | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const debouncedSearch = useDebouncedValue(searchQ.trim(), 320);
  const [createForm] = Form.useForm<{ title: string; description: string; type: string; severity: string }>();
  const [resolveForm] = Form.useForm<{ resolution: string }>();

  const q = useQuery({
    queryKey: ["issues", status, severity, debouncedSearch],
    queryFn: () => api.issues({ status, severity, q: debouncedSearch || undefined, size: 100 }),
    enabled: authed && hasProject,
  });

  const opsPlanQ = useQuery({
    queryKey: ["issueOpsPlan"],
    queryFn: api.issueOpsPlan,
    enabled: authed && hasProject,
  });

  const items = (q.data?.items ?? []) as IssueRow[];
  const metrics = useMemo(() => {
    const open = items.filter((i) => i.status === "open").length;
    const critical = items.filter((i) => i.status === "open" && (i.severity === "P0" || i.severity === "P1")).length;
    return { total: q.data?.total ?? items.length, open, critical, resolved: items.filter((i) => i.status === "resolved").length };
  }, [items, q.data?.total]);

  const createMut = useMutation({
    mutationFn: (v: { title: string; description: string; type: string; severity: string }) => api.createIssue(v),
    onSuccess: () => {
      setCreateOpen(false);
      createForm.resetFields();
      message.success(t("page.issues.created"));
      void qc.invalidateQueries({ queryKey: ["issues"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const resolveMut = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) => api.resolveIssue(id, resolution),
    onSuccess: () => {
      setResolveOpen(false);
      setResolveId("");
      resolveForm.resetFields();
      message.success(t("page.issues.resolvedMsg"));
      void qc.invalidateQueries({ queryKey: ["issues"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteIssue(id),
    onSuccess: () => {
      message.success(t("page.issues.deleted"));
      void qc.invalidateQueries({ queryKey: ["issues"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const opsTasksMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.issueOpsTasks({ dry_run: dryRun, priority: "P1", assigned_to: "IssueOps Agent", limit: 20 }),
    onSuccess: (res) => {
      const summary = res?.summary ?? {};
      message.success(
        t("page.issues.opsTasksResult", {
          planned: summary.planned ?? 0,
          created: summary.created ?? 0,
        }),
      );
      void qc.invalidateQueries({ queryKey: ["issues"] });
      void qc.invalidateQueries({ queryKey: ["issueOpsPlan"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const columns: ColumnsType<IssueRow> = [
    { title: "ID", dataIndex: "id", width: 140, render: (v) => <span className="font-mono text-xs">{v}</span> },
    {
      title: t("page.issues.titleCol"),
      dataIndex: "title",
      ellipsis: true,
      render: (v, row) => (
        <Button type="link" className="!h-auto !p-0 !text-left" onClick={() => setDetail(row)}>
          {v}
        </Button>
      ),
    },
    {
      title: t("page.issues.severity"),
      dataIndex: "severity",
      width: 88,
      render: (v) => <Tag color={v === "P0" || v === "P1" ? "red" : "default"}>{v}</Tag>,
    },
    { title: t("page.issues.type"), dataIndex: "type", width: 90 },
    {
      title: t("page.issues.status"),
      dataIndex: "status",
      width: 100,
      render: (v) => <Tag color={v === "open" ? "processing" : "success"}>{v}</Tag>,
    },
    { title: t("page.issues.reporter"), dataIndex: "reported_by", width: 120, ellipsis: true },
    {
      title: t("page.issues.task"),
      dataIndex: "task_id",
      width: 120,
      render: (v) =>
        v ? (
          <a className="font-mono text-xs text-[var(--brand)] hover:underline" href="#/tasks">
            {v}
          </a>
        ) : (
          "—"
        ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 200,
      render: (_, row) => (
        <Space size="small" wrap>
          {row.status === "open" ? (
            <Button
              size="small"
              onClick={() => {
                setResolveId(row.id);
                setResolveOpen(true);
              }}
            >
              {t("page.issues.resolve")}
            </Button>
          ) : null}
          <Popconfirm title={t("page.issues.confirmDelete")} onConfirm={() => deleteMut.mutate(row.id)}>
            <Button size="small" danger loading={deleteMut.isPending}>
              {t("common.delete")}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const opsRiskColumns: ColumnsType<any> = [
    {
      title: t("page.issues.severity"),
      dataIndex: "severity",
      width: 90,
      render: (v) => <Tag color={v === "P0" || v === "P1" ? "red" : "orange"}>{v}</Tag>,
    },
    { title: t("page.issues.category"), dataIndex: "category", width: 120 },
    {
      title: t("page.issues.risk"),
      dataIndex: "title",
      ellipsis: true,
      render: (v, row) => (
        <div>
          <div className="font-medium text-[var(--text)]">{v}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">{row.description}</div>
        </div>
      ),
    },
    {
      title: t("page.issues.command"),
      dataIndex: "command",
      width: 260,
      render: (v) => <Typography.Text code copyable className="!text-xs">{v}</Typography.Text>,
    },
  ];

  if (!authed) return <NeedLogin />;
  if (!hasProject) {
    return (
      <WorkbenchShell title={t("page.issues.title")} description={t("page.issues.desc")}>
        <WorkbenchPanel>
          <p className="text-sm text-[var(--muted)]">{t("projectSelector.hint")}</p>
        </WorkbenchPanel>
      </WorkbenchShell>
    );
  }

  return (
    <WorkbenchShell
      title={t("page.issues.title")}
      description={focused ? t("page.issues.focusedHint") : t("page.issues.desc")}
      actions={
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          {t("page.issues.create")}
        </Button>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.issues.total"), value: metrics.total },
            { label: t("page.issues.open"), value: metrics.open },
            { label: t("page.issues.critical"), value: metrics.critical },
            { label: t("page.issues.resolved"), value: metrics.resolved },
          ]}
        />
      }
    >
      <WorkbenchPanel
        title={t("page.issues.opsPlan")}
        actions={
          <Space wrap>
            <Button loading={opsTasksMut.isPending} onClick={() => opsTasksMut.mutate(true)}>
              {t("page.issues.previewOpsTasks")}
            </Button>
            <Button type="primary" loading={opsTasksMut.isPending} onClick={() => opsTasksMut.mutate(false)}>
              {t("page.issues.createOpsTasks")}
            </Button>
          </Space>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
          <div className="rounded-md border border-[var(--border)] bg-[var(--panel-muted)] p-4">
            <Statistic
              title={t("page.issues.issueHealth")}
              value={opsPlanQ.data?.health?.score ?? 0}
              suffix="/ 100"
              valueStyle={{ color: opsPlanQ.data?.health?.grade === "risk" ? "#dc2626" : "var(--brand)" }}
            />
            <Tag className="mt-3" color={opsPlanQ.data?.health?.grade === "healthy" ? "green" : opsPlanQ.data?.health?.grade === "watch" ? "gold" : "red"}>
              {opsPlanQ.data?.health?.grade ?? "-"}
            </Tag>
            <div className="mt-4 space-y-1 text-xs text-[var(--muted)]">
              <div>{t("page.issues.staleOpen")}: {opsPlanQ.data?.summary?.stale_open ?? 0}</div>
              <div>{t("page.issues.unlinkedOpen")}: {opsPlanQ.data?.summary?.unlinked_open ?? 0}</div>
            </div>
          </div>
          <div className="min-w-0">
            <Alert
              className="mb-3"
              showIcon
              type={opsPlanQ.data?.health?.grade === "risk" ? "warning" : "info"}
              message={t("page.issues.opsHint")}
              description={<Typography.Text code copyable>sop issue ops-plan --json</Typography.Text>}
            />
            <Table
              rowKey="id"
              size="small"
              loading={opsPlanQ.isLoading}
              columns={opsRiskColumns}
              dataSource={opsPlanQ.data?.risks ?? []}
              pagination={false}
              scroll={{ x: 780 }}
              locale={{ emptyText: t("page.issues.noOpsRisks") }}
            />
          </div>
        </div>
      </WorkbenchPanel>

      <WorkbenchPanel>
        <Space wrap className="mb-4">
          <Input.Search
            allowClear
            className="min-w-[14rem]"
            placeholder={t("page.issues.searchPh")}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          <Select
            allowClear
            placeholder={t("page.issues.allStatus")}
            className="min-w-32"
            value={status || undefined}
            onChange={(v) => setStatus(v || "")}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
          />
          <Select
            allowClear
            placeholder={t("page.issues.allSeverity")}
            className="min-w-32"
            value={severity || undefined}
            onChange={(v) => setSeverity(v || "")}
            options={SEVERITIES.map((s) => ({ value: s, label: s }))}
          />
          <RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />
        </Space>
        <Table
          rowKey="id"
          size="middle"
          loading={q.isLoading}
          columns={columns}
          dataSource={items}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      </WorkbenchPanel>

      <Drawer
        title={detail?.title || detail?.id}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width={480}
      >
        {detail ? (
          <div className="space-y-3 text-sm">
            <div>
              <Typography.Text type="secondary">{t("page.issues.severity")}</Typography.Text>
              <div className="mt-1">
                <Tag color={detail.severity === "P0" || detail.severity === "P1" ? "red" : "default"}>{detail.severity}</Tag>
              </div>
            </div>
            <div>
              <Typography.Text type="secondary">{t("page.issues.status")}</Typography.Text>
              <p className="mt-1">{detail.status}</p>
            </div>
            {detail.description ? (
              <div>
                <Typography.Text type="secondary">{t("page.issues.descPh")}</Typography.Text>
                <p className="mt-1 whitespace-pre-wrap">{detail.description}</p>
              </div>
            ) : null}
            {detail.task_id ? (
              <Button href="#/tasks">{t("page.issues.openTask")}</Button>
            ) : null}
            {detail.status === "open" ? (
              <Button
                type="primary"
                onClick={() => {
                  setResolveId(detail.id);
                  setResolveOpen(true);
                  setDetail(null);
                }}
              >
                {t("page.issues.resolve")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Modal
        title={t("page.issues.create")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createMut.isPending}
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ type: "bug", severity: "P2" }}
          onFinish={(v) => createMut.mutate(v)}
        >
          <Form.Item name="title" label={t("page.issues.titleCol")} rules={[{ required: true }]}>
            <Input placeholder={t("page.issues.titlePh")} />
          </Form.Item>
          <Form.Item name="description" label={t("page.issues.descPh")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="severity" label={t("page.issues.severity")}>
            <Select options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("page.issues.resolve")}
        open={resolveOpen}
        onCancel={() => {
          setResolveOpen(false);
          setResolveId("");
        }}
        onOk={() => resolveForm.submit()}
        confirmLoading={resolveMut.isPending}
        destroyOnHidden
      >
        <Form
          form={resolveForm}
          layout="vertical"
          onFinish={(v) => resolveMut.mutate({ id: resolveId, resolution: v.resolution })}
        >
          <Form.Item name="resolution" label={t("page.issues.resolutionPh")} rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </WorkbenchShell>
  );
}
