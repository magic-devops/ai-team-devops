import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Select, Space, Steps, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkflowDag } from "../shared/WorkflowDag";
import { WorkbenchPanel, WorkbenchQueryGate, WorkbenchStats } from "../shared/workbenchUi";

type WfRow = Record<string, unknown> & { id?: string; name?: string; steps?: unknown[]; nodes?: unknown[] };

export function OrchestrationStudio({ focused = false }: { focused?: boolean }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState("");
  const [wfDetail, setWfDetail] = useState<WfRow | null>(null);

  const toolsQ = useQuery({ queryKey: ["orchTools"], queryFn: api.orchestrationTools });
  const wfQ = useQuery({ queryKey: ["orchWorkflows"], queryFn: api.orchestrationWorkflows });
  const cfgQ = useQuery({ queryKey: ["orchConfig"], queryFn: api.orchestrationConfig });
  const wfDetailQ = useQuery({
    queryKey: ["orchWorkflow", wfDetail?.id],
    queryFn: () => api.orchestrationWorkflow(String(wfDetail!.id)),
    enabled: Boolean(wfDetail?.id),
  });

  const toolsAll = toolsQ.data ?? [];
  const tools = useMemo(() => {
    if (!category) return toolsAll;
    return toolsAll.filter((t: { category?: string }) => (t.category || "") === category);
  }, [toolsAll, category]);

  const categories = useMemo(
    () => [...new Set(toolsAll.map((t: { category?: string }) => t.category).filter(Boolean))] as string[],
    [toolsAll],
  );

  const workflows: WfRow[] = Array.isArray(wfQ.data) ? wfQ.data : [];

  const toolCols: ColumnsType<Record<string, unknown>> = [
    { title: "ID", dataIndex: "id", width: 120 },
    { title: t("page.orchestration.name"), dataIndex: "name", ellipsis: true },
    {
      title: t("page.orchestration.category"),
      dataIndex: "category",
      width: 110,
      render: (v) => <Tag>{String(v || "—")}</Tag>,
    },
    {
      title: t("page.orchestration.available"),
      dataIndex: "available",
      width: 90,
      render: (v) => <Tag color={v ? "success" : "default"}>{v ? "yes" : "no"}</Tag>,
    },
    {
      title: t("common.actions"),
      key: "a",
      width: 100,
      render: () => (
        <Button size="small" href="#/platforms/cli">
          {t("page.orchestration.openCli")}
        </Button>
      ),
    },
  ];

  const wfCols: ColumnsType<WfRow> = [
    { title: "ID", dataIndex: "id", width: 120 },
    { title: t("page.orchestration.name"), dataIndex: "name", ellipsis: true },
    {
      title: t("page.orchestration.steps"),
      key: "steps",
      width: 80,
      render: (_, r) => {
        const steps = r.steps as unknown[] | undefined;
        const nodes = r.nodes as unknown[] | undefined;
        return (steps?.length ?? nodes?.length ?? 0) as number;
      },
    },
    {
      title: t("common.actions"),
      key: "a",
      width: 90,
      render: (_, row) => (
        <Button size="small" onClick={() => setWfDetail(row)}>
          {t("common.view")}
        </Button>
      ),
    },
  ];

  const detailSteps = useMemo(() => {
    const wf = wfDetailQ.data?.workflow ?? wfDetail;
    if (!wf) return [];
    return (wf.steps ?? wf.nodes ?? []) as Array<Record<string, unknown>>;
  }, [wfDetail, wfDetailQ.data]);

  const stepItems = useMemo(() => {
    if (!detailSteps.length) return [];
    const steps = detailSteps;
    return steps.map((s, i) => ({
      title: String(s.name || s.tool || s.id || `Step ${i + 1}`),
      description: s.description ? String(s.description) : undefined,
    }));
  }, [detailSteps]);

  return (
    <WorkbenchShell
      title={t("page.orchestration.title")}
      description={focused ? t("page.orchestration.focusedHint") : t("page.orchestration.desc")}
      actions={
        <Space wrap>
          <Button href="#/platforms/cli">{t("page.orchestration.cliTools")}</Button>
          <Button type="primary" href="#/workflows">
            {t("page.orchestration.linkWorkflows")}
          </Button>
        </Space>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.orchestration.tools"), value: toolsAll.length },
            { label: t("page.orchestration.workflows"), value: workflows.length },
            { label: t("page.orchestration.defaultTool"), value: String(cfgQ.data?.default_tool ?? "—") },
            {
              label: t("page.orchestration.availableTools"),
              value: toolsAll.filter((t: { available?: boolean }) => t.available).length,
            },
          ]}
        />
      }
    >
      <Tabs
        defaultActiveKey="tools"
        items={[
          {
            key: "tools",
            label: t("page.orchestration.devTools"),
            children: (
              <WorkbenchPanel>
                <Select
                  allowClear
                  className="mb-3 min-w-48"
                  placeholder={t("page.orchestration.filterCategory")}
                  value={category || undefined}
                  onChange={(v) => setCategory(v || "")}
                  options={categories.map((c) => ({ value: c, label: c }))}
                />
                <WorkbenchQueryGate query={toolsQ}>
                  <Table rowKey="id" size="small" columns={toolCols} dataSource={tools} pagination={{ pageSize: 10 }} />
                </WorkbenchQueryGate>
              </WorkbenchPanel>
            ),
          },
          {
            key: "workflows",
            label: t("page.orchestration.definitions"),
            children: (
              <WorkbenchPanel>
                <WorkbenchQueryGate query={wfQ}>
                  <Table rowKey="id" size="small" columns={wfCols} dataSource={workflows} pagination={{ pageSize: 8 }} />
                </WorkbenchQueryGate>
              </WorkbenchPanel>
            ),
          },
        ]}
      />

      <Drawer
        title={wfDetail?.name || wfDetail?.id || t("page.orchestration.workflowDetail")}
        open={Boolean(wfDetail)}
        onClose={() => setWfDetail(null)}
        width={520}
      >
        {detailSteps.length ? (
          <>
            <WorkflowDag steps={detailSteps} />
            <Steps direction="vertical" size="small" className="mt-4" items={stepItems} />
          </>
        ) : (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
            {JSON.stringify(wfDetail, null, 2)}
          </pre>
        )}
      </Drawer>
    </WorkbenchShell>
  );
}
