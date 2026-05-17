import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

export function EnvOpsWorkbench({ focused = false }: { focused?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const envQ = useQuery({ queryKey: ["envCheckFull"], queryFn: api.envCheckFull, retry: false });
  const dockerQ = useQuery({ queryKey: ["dockerPs"], queryFn: api.dockerPs, retry: false });
  const toolchainQ = useQuery({ queryKey: ["orchToolsEnv"], queryFn: api.orchestrationTools, retry: false });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["envCheckFull"] });
    void qc.invalidateQueries({ queryKey: ["dockerPs"] });
    void qc.invalidateQueries({ queryKey: ["orchToolsEnv"] });
  };

  const builtin = envQ.data?.builtin ?? {};
  const checks = Object.entries(builtin).map(([key, val]) => {
    const row = (val ?? {}) as Record<string, unknown>;
    return {
      key,
      ok: Boolean(row.ok ?? row.status === "ok"),
      message: String(row.message || row.detail || JSON.stringify(row).slice(0, 120)),
    };
  });

  const toolchainRows = useMemo(() => {
    if (!Array.isArray(toolchainQ.data)) return [];
    return toolchainQ.data.map((t: Record<string, unknown>) => ({
      id: String(t.id || ""),
      name: String(t.name || t.id || ""),
      available: Boolean(t.available),
      category: String(t.category || ""),
    }));
  }, [toolchainQ.data]);

  const containers = dockerQ.data?.containers ?? [];

  const checkCols: ColumnsType<(typeof checks)[0]> = [
    { title: t("page.envOps.check"), dataIndex: "key", width: 160 },
    {
      title: t("page.envOps.status"),
      dataIndex: "ok",
      width: 90,
      render: (v) => <Tag color={v ? "success" : "error"}>{v ? "OK" : "FAIL"}</Tag>,
    },
    { title: t("page.envOps.detail"), dataIndex: "message", ellipsis: true },
  ];

  const dockerCols: ColumnsType<Record<string, unknown>> = [
    { title: t("page.envOps.container"), dataIndex: "Names", ellipsis: true },
    { title: t("page.envOps.image"), dataIndex: "Image", ellipsis: true },
    { title: t("page.envOps.state"), dataIndex: "State", width: 100 },
  ];

  const toolCols: ColumnsType<(typeof toolchainRows)[0]> = [
    { title: "ID", dataIndex: "id", width: 120 },
    { title: t("page.orchestration.name"), dataIndex: "name", ellipsis: true },
    { title: t("page.orchestration.category"), dataIndex: "category", width: 110 },
    {
      title: t("page.envOps.status"),
      dataIndex: "available",
      width: 90,
      render: (v) => <Tag color={v ? "success" : "default"}>{v ? "OK" : "—"}</Tag>,
    },
  ];

  return (
    <WorkbenchShell
      title={t("page.envOps.title")}
      description={focused ? t("page.envOps.focusedHint") : t("page.envOps.desc")}
      actions={
        <>
          <RefreshButton onClick={refresh} pending={envQ.isFetching || dockerQ.isFetching || toolchainQ.isFetching} />
          <Button href="#/settings/profiles">{t("page.envOps.profiles")}</Button>
          <Button href="#/orchestration">{t("nav.orchestration")}</Button>
        </>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.envOps.checks"), value: checks.length },
            { label: t("page.envOps.passed"), value: checks.filter((c) => c.ok).length },
            { label: t("page.envOps.containers"), value: containers.length },
          ]}
        />
      }
    >
      {envQ.isError ? <Alert type="warning" showIcon className="mb-4" message={(envQ.error as Error).message} /> : null}
      {dockerQ.data?.error ? <Alert type="info" showIcon className="mb-4" message={String(dockerQ.data.error)} /> : null}

      <Tabs
        items={[
          {
            key: "env",
            label: t("page.envOps.envCheck"),
            children: (
              <WorkbenchPanel>
                <Table size="small" rowKey="key" loading={envQ.isLoading} columns={checkCols} dataSource={checks} pagination={false} />
              </WorkbenchPanel>
            ),
          },
          {
            key: "docker",
            label: t("page.envOps.docker"),
            children: (
              <WorkbenchPanel>
                <Table
                  size="small"
                  rowKey={(r) => String(r.ID || r.Names)}
                  loading={dockerQ.isLoading}
                  columns={dockerCols}
                  dataSource={containers}
                  pagination={{ pageSize: 8 }}
                />
              </WorkbenchPanel>
            ),
          },
          {
            key: "toolchain",
            label: t("page.envOps.toolchain"),
            children: (
              <WorkbenchPanel>
                <p className="mb-3 text-xs text-[var(--muted)]">{t("page.envOps.toolchainHint")}</p>
                {toolchainQ.isError ? (
                  <Alert type="info" showIcon message={(toolchainQ.error as Error).message} />
                ) : (
                  <Table size="small" rowKey="id" loading={toolchainQ.isLoading} columns={toolCols} dataSource={toolchainRows} pagination={{ pageSize: 12 }} />
                )}
              </WorkbenchPanel>
            ),
          },
        ]}
      />
    </WorkbenchShell>
  );
}
