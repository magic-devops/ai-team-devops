import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Form, Input, Modal, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

type CliRow = { id: string; name?: string; cmd?: string; description?: string; installed?: boolean; is_builtin?: boolean };

export function CliToolsWorkbench({ focused = false }: { focused?: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<CliRow | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [output, setOutput] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [runForm] = Form.useForm<{ args: string; stdin: string }>();
  const [createForm] = Form.useForm<{ id: string; name: string; cmd: string; description: string }>();

  const toolsQ = useQuery({ queryKey: ["cliTools"], queryFn: api.cliTools });
  const toolsAll: CliRow[] = (toolsQ.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id || row.tool_id || ""),
    name: row.name as string | undefined,
    cmd: row.cmd as string | undefined,
    description: row.description as string | undefined,
    installed: (row.available ?? row.installed) as boolean | undefined,
    is_builtin: row.is_builtin as boolean | undefined,
  }));

  const tools = useMemo(() => {
    const n = filter.trim().toLowerCase();
    if (!n) return toolsAll;
    return toolsAll.filter(
      (t) =>
        t.id.toLowerCase().includes(n) ||
        (t.name ?? "").toLowerCase().includes(n) ||
        (t.cmd ?? "").toLowerCase().includes(n),
    );
  }, [toolsAll, filter]);

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(output);
      message.success(t("common.copied"));
    } catch {
      message.error(t("common.error", { msg: "copy failed" }));
    }
  };

  const runMut = useMutation({
    mutationFn: (values: { args: string; stdin: string }) =>
      api.cliRun({
        tool: selected!.id,
        args: values.args.trim() ? values.args.trim().split(/\s+/) : [],
        stdin_input: values.stdin || undefined,
        timeout: 120,
      }),
    onSuccess: (data) => {
      setOutput(JSON.stringify(data, null, 2));
      setOutputOpen(true);
      message.success(t("page.cliTools.runSuccess"));
    },
    onError: (e) => message.error((e as Error).message),
  });

  const createMut = useMutation({
    mutationFn: (v: { id: string; name: string; cmd: string; description: string }) =>
      api.cliUpsertTool(v.id, { name: v.name, cmd: v.cmd, description: v.description }),
    onSuccess: () => {
      setCustomOpen(false);
      createForm.resetFields();
      message.success(t("page.cliTools.toolCreated"));
      void qc.invalidateQueries({ queryKey: ["cliTools"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const columns: ColumnsType<CliRow> = [
    { title: "ID", dataIndex: "id", width: 120 },
    { title: t("page.cliTools.name"), dataIndex: "name", ellipsis: true },
    { title: t("page.cliTools.cmd"), dataIndex: "cmd", width: 140 },
    {
      title: t("page.cliTools.status"),
      key: "st",
      width: 100,
      render: (_, r) => <Tag color={r.installed ? "success" : "default"}>{r.installed ? "OK" : "—"}</Tag>,
    },
    {
      title: t("common.actions"),
      key: "a",
      width: 90,
      render: (_, r) => (
        <Button size="small" type={selected?.id === r.id ? "primary" : "default"} onClick={() => setSelected(r)}>
          {t("page.cliTools.run")}
        </Button>
      ),
    },
  ];

  return (
    <WorkbenchShell
      title={t("page.cliTools.title")}
      description={focused ? t("page.cliTools.focusedHint") : t("page.cliTools.desc")}
      actions={
        <Button type="primary" onClick={() => setCustomOpen(true)}>
          {t("page.cliTools.addTool")}
        </Button>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.cliTools.total"), value: toolsAll.length },
            { label: t("page.cliTools.installed"), value: toolsAll.filter((x) => x.installed).length },
          ]}
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <WorkbenchPanel
          title={t("page.cliTools.title")}
          actions={<RefreshButton onClick={() => void toolsQ.refetch()} pending={toolsQ.isFetching} />}
        >
          <Input.Search
            allowClear
            placeholder={t("page.cliTools.searchPh")}
            className="mb-3"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Table rowKey="id" loading={toolsQ.isLoading} columns={columns} dataSource={tools} pagination={{ pageSize: 10 }} />
        </WorkbenchPanel>

        <WorkbenchPanel title={selected?.name || t("page.cliTools.selectTool")}>
          <Form
            form={runForm}
            layout="vertical"
            onFinish={(v) => runMut.mutate(v)}
            disabled={!selected}
          >
            <Form.Item name="args" label={t("page.cliTools.argsPh")}>
              <Input placeholder={t("page.cliTools.argsPh")} />
            </Form.Item>
            <Form.Item name="stdin" label={t("page.cliTools.stdinPh")}>
              <Input.TextArea rows={3} placeholder={t("page.cliTools.stdinPh")} />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={runMut.isPending} disabled={!selected}>
              {t("page.cliTools.execute")}
            </Button>
          </Form>
          {output ? (
            <Button type="link" className="mt-2 !px-0" onClick={() => setOutputOpen(true)}>
              {t("page.cliTools.viewOutput")}
            </Button>
          ) : null}
        </WorkbenchPanel>
      </div>

      <Drawer
        title={selected?.name || t("page.cliTools.execute")}
        open={outputOpen}
        onClose={() => setOutputOpen(false)}
        width={560}
        extra={
          <Button size="small" onClick={() => void copyOutput()}>
            {t("page.cliTools.copyOutput")}
          </Button>
        }
      >
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-muted)] p-3 text-xs">{output}</pre>
      </Drawer>

      <Modal
        title={t("page.cliTools.addTool")}
        open={customOpen}
        onCancel={() => setCustomOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createMut.isPending}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="id" label="ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label={t("page.cliTools.name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="cmd" label={t("page.cliTools.cmd")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t("page.cliTools.description")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </WorkbenchShell>
  );
}
