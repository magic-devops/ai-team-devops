import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Segmented, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton, SearchInput } from "@/components/PageStates";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

const TERMINAL_STATUSES = new Set(["success", "failed", "cancelled"]);
type AgentRunsTab = "runs" | "heartbeat" | "profiles" | "retry";
const TAB_KEYS: AgentRunsTab[] = ["runs", "heartbeat", "profiles", "retry"];

function statusColor(status?: string) {
  if (status === "success") return "green";
  if (status === "failed") return "red";
  if (status === "running") return "blue";
  if (status === "retrying") return "gold";
  if (status === "cancelled") return "default";
  return "processing";
}

export function AgentRunsWorkbench({ focused = false, initialTab = "runs" }: { focused?: boolean; initialTab?: AgentRunsTab }) {
  const authed = Boolean(getToken());
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<AgentRunsTab>(initialTab);

  useEffect(() => setTab(initialTab), [initialTab]);

  const summaryQ = useQuery({ queryKey: ["agentRunsSummaryV2"], queryFn: api.agentRunsSummaryV2, enabled: authed });
  const runsQ = useQuery({ queryKey: ["agentRunsList", statusFilter], queryFn: () => api.agentRunsList("", statusFilter), enabled: authed });
  const profilesQ = useQuery({ queryKey: ["agentRunProfiles"], queryFn: api.agentRunProfiles, enabled: authed && tab === "profiles" });

  const heartbeat = useMutation({
    mutationFn: (id: string) => api.agentRunHeartbeat(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agentRunsList"] }),
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.agentRunStatus(id, { status }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentRunsList"] }); void qc.invalidateQueries({ queryKey: ["agentRunsSummaryV2"] }); void qc.invalidateQueries({ queryKey: ["agentRunProfiles"] }); },
  });
  const retryRun = useMutation({
    mutationFn: (id: string) => api.agentRunRetry(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentRunsList"] }); void qc.invalidateQueries({ queryKey: ["agentRunsSummaryV2"] }); void qc.invalidateQueries({ queryKey: ["agentRunProfiles"] }); },
  });
  const cancelRun = useMutation({
    mutationFn: (id: string) => api.agentRunCancel(id, { reason: "manual cancel from AgentOps" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentRunsList"] }); void qc.invalidateQueries({ queryKey: ["agentRunsSummaryV2"] }); void qc.invalidateQueries({ queryKey: ["agentRunProfiles"] }); },
  });
  const createRun = useMutation({
    mutationFn: () => api.agentRunCreate({ agent_id: `manual-agent-${Date.now()}`, task_id: `manual-task-${Date.now()}`, meta: { source: "manager-web" } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentRunsList"] }); void qc.invalidateQueries({ queryKey: ["agentRunsSummaryV2"] }); },
  });
  const writeEvidence = useMutation({
    mutationFn: (id: string) => api.agentRunEvidence(id, { artifact: { note: "manual evidence" }, gate_results: { build: "passed" }, confidence: 0.96 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agentRunsList"] }),
  });
  const deleteRun = useMutation({
    mutationFn: (id: string) => api.agentRunDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agentRunsList"] }),
  });

  if (!authed) return <NeedLogin />;

  const s = summaryQ.data?.summary ?? {};
  const runs = (runsQ.data?.items ?? []).filter((r: any) => !q || r.agent_id?.includes(q) || r.task_id?.includes(q));
  const profiles = profilesQ.data?.profiles ?? [];
  const runningRuns = runs.filter((r: any) => r.status === "running");
  const retryRuns = runs.filter((r: any) => r.status === "failed" || r.status === "retrying");
  const agentTabs = TAB_KEYS.map((id) => ({ id, label: t(`page.agentRuns.tabs.${id}`) }));
  const currentTab = agentTabs.find((item) => item.id === tab) ?? agentTabs[0];
  const runActions = (r: any) => (
    <Space size={[4, 4]} wrap>
      {r.status === "running" ? <Button type="link" size="small" onClick={() => heartbeat.mutate(r.id)}>{t("page.agentRuns.actions.heartbeat")}</Button> : null}
      {r.status === "pending" ? <Button type="link" size="small" onClick={() => updateStatus.mutate({ id: r.id, status: "running" })}>{t("page.agentRuns.actions.start")}</Button> : null}
      {r.status === "running" ? <Button type="link" size="small" onClick={() => updateStatus.mutate({ id: r.id, status: "success" })}>{t("page.agentRuns.actions.success")}</Button> : null}
      {r.status === "failed" ? <Button type="link" size="small" disabled={retryRun.isPending} onClick={() => retryRun.mutate(r.id)}>{t("page.agentRuns.retryAction")}</Button> : null}
      {!TERMINAL_STATUSES.has(String(r.status)) ? <Button type="link" size="small" disabled={cancelRun.isPending} onClick={() => cancelRun.mutate(r.id)}>{t("page.agentRuns.actions.cancel")}</Button> : null}
      <Button type="link" size="small" onClick={() => writeEvidence.mutate(r.id)}>{t("page.agentRuns.addEvidence")}</Button>
      <Button type="link" size="small" danger onClick={() => deleteRun.mutate(r.id)}>{t("page.agentRuns.actions.delete")}</Button>
    </Space>
  );
  const runColumns: ColumnsType<any> = [
    {
      title: "Agent ID",
      dataIndex: "agent_id",
      render: (value: string) => <span className="font-mono text-xs text-[var(--text)]">{value?.slice(0, 18) || "-"}</span>,
    },
    {
      title: "Task ID",
      dataIndex: "task_id",
      render: (value: string) => <span className="font-mono text-xs text-[var(--muted)]">{value?.slice(0, 12) || t("page.agentRuns.unboundTask")}</span>,
    },
    {
      title: t("page.agentRuns.status"),
      dataIndex: "status",
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{value || "-"}</Tag>,
    },
    {
      title: t("page.agentRuns.confidence"),
      dataIndex: "confidence",
      width: 110,
      render: (value: number) => value != null ? `${(value * 100).toFixed(0)}%` : "-",
    },
    {
      title: t("page.agentRuns.retryCount"),
      dataIndex: "retry_count",
      width: 90,
      render: (value: number) => value ?? 0,
    },
    {
      title: t("page.agentRuns.startedAt"),
      dataIndex: "started_at",
      width: 180,
      render: (value: string) => value?.slice(0, 19).replace("T", " ") || "-",
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 260,
      render: (_value, row) => runActions(row),
    },
  ];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={focused ? t(`page.agentRuns.modules.${tab}.title`) : t("page.agentRuns.workbenchTitle")}
        description={focused ? t(`page.agentRuns.modules.${tab}.description`) : t("page.agentRuns.workbenchDesc")}
        actions={<><AiAssistButton onClick={() => setAiOpen(true)} /><RefreshButton onClick={() => { void runsQ.refetch(); void summaryQ.refetch(); }} pending={runsQ.isFetching} /></>}
        metrics={
          <WorkbenchStats items={[
            { label: t("page.agentRuns.metrics.total"), value: s.total ?? 0 },
            { label: t("page.agentRuns.metrics.running"), value: s.running ?? 0, trend: "up" },
            { label: t("page.agentRuns.metrics.successRate"), value: `${s.success_rate ?? 0}%`, trend: "up" },
            { label: t("page.agentRuns.metrics.avgDuration"), value: s.avg_duration_s ?? 0 },
          ]} />
        }
      />

      {focused ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.agentRuns.focusedTag")}</span>
              <a href="#/ai/agent-ops" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.agentRuns.backToHub")}</a>
              <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.agentRuns.focusedHint")}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-[var(--text)]">{currentTab.label}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t(`page.agentRuns.modules.${tab}.focus`)}</p>
          </div>
          <Select
            className="min-w-48"
            value={tab}
            onChange={(value) => setTab(value as AgentRunsTab)}
            options={agentTabs.map((item) => ({ value: item.id, label: item.label }))}
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
          <Segmented
            value={tab}
            onChange={(value) => setTab(value as AgentRunsTab)}
            options={agentTabs.map((item) => ({ value: item.id, label: item.label }))}
          />
        </div>
      )}

      {tab === "runs" && (
        <WorkbenchPanel title={t("page.agentRuns.panels.runs")} actions={
          <div className="flex flex-wrap gap-2">
            <SearchInput value={q} onChange={setQ} placeholder={t("page.agentRuns.searchPlaceholder")} />
            <Select
              className="min-w-36"
              value={statusFilter || "all"}
              onChange={(value) => setStatusFilter(value === "all" ? "" : value)}
              options={[
                { value: "all", label: t("page.agentRuns.allStatuses") },
                ...["pending", "running", "success", "failed", "retrying", "cancelled"].map((value) => ({ value, label: value })),
              ]}
            />
            <Button type="primary" loading={createRun.isPending} onClick={() => createRun.mutate()}>{t("page.agentRuns.createRun")}</Button>
          </div>
        }>
          <Table
            className="hidden md:block"
            rowKey="id"
            size="small"
            columns={runColumns}
            dataSource={runs}
            loading={runsQ.isLoading || runsQ.isFetching}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            scroll={{ x: 980 }}
            locale={{ emptyText: t("page.agentRuns.emptyRuns") }}
          />
          <div className="grid gap-3 md:hidden">
            {runs.map((r: any) => (
              <article key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-[var(--text)]">{r.agent_id}</p>
                    <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{r.task_id || t("page.agentRuns.unboundTask")}</p>
                  </div>
                  <Tag color={statusColor(r.status)}>{r.status}</Tag>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2"><p className="font-semibold text-[var(--text)]">{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : "-"}</p><p className="text-[var(--muted)]">{t("page.agentRuns.confidence")}</p></div>
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2"><p className="font-semibold text-[var(--text)]">{r.retry_count ?? 0}</p><p className="text-[var(--muted)]">{t("page.agentRuns.retryCount")}</p></div>
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2"><p className="font-semibold text-[var(--text)]">{r.started_at?.slice(11, 19) || "-"}</p><p className="text-[var(--muted)]">{t("page.agentRuns.startedAt")}</p></div>
                </div>
                <div className="mt-3">{runActions(r)}</div>
              </article>
            ))}
            {!runs.length ? <p className="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-sm text-[var(--muted)]">{t("page.agentRuns.emptyRuns")}</p> : null}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "heartbeat" && (
        <WorkbenchPanel title={t("page.agentRuns.heartbeatTitle")} actions={<RefreshButton onClick={() => { void runsQ.refetch(); void summaryQ.refetch(); }} pending={runsQ.isFetching} />}>
          <div className="grid gap-3 lg:grid-cols-2">
            {runningRuns.map((r: any) => (
              <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-[var(--text)]">{r.agent_id}</p>
                    <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{r.task_id || t("page.agentRuns.unboundTask")}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{r.status}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                    <p className="font-semibold text-[var(--text)]">{r.heartbeat_count ?? 0}</p>
                    <p className="text-[var(--muted)]">{t("page.agentRuns.heartbeatCount")}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                    <p className="font-semibold text-[var(--text)]">{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : "—"}</p>
                    <p className="text-[var(--muted)]">{t("page.agentRuns.confidence")}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                    <p className="font-semibold text-[var(--text)]">{r.updated_at?.slice(11, 19) || "—"}</p>
                    <p className="text-[var(--muted)]">{t("page.agentRuns.lastUpdated")}</p>
                  </div>
                </div>
                <button onClick={() => heartbeat.mutate(r.id)} className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--brand)] hover:bg-[var(--brand-soft)]">{t("page.agentRuns.sendHeartbeat")}</button>
              </div>
            ))}
            {!runningRuns.length && <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)] lg:col-span-2">{t("page.agentRuns.emptyRunning")}</p>}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "profiles" && (
        <WorkbenchPanel title={t("page.agentRuns.panels.profiles")} actions={<RefreshButton onClick={() => void profilesQ.refetch()} pending={profilesQ.isFetching} />}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {profiles.length === 0 && <p className="col-span-3 py-8 text-center text-sm text-[var(--muted)]">{t("page.agentRuns.emptyProfiles")}</p>}
            {profiles.map((p: any) => (
              <div key={p.agent_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="font-mono text-xs text-[var(--muted)] mb-2">{p.agent_id}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-lg font-bold text-[var(--text)]">{p.total_runs}</p><p className="text-xs text-[var(--muted)]">{t("page.agentRuns.metrics.total")}</p></div>
                  <div><p className="text-lg font-bold text-green-600">{p.success_rate}%</p><p className="text-xs text-[var(--muted)]">{t("page.agentRuns.metrics.successRate")}</p></div>
                  <div><p className="text-lg font-bold text-[var(--text)]">{p.avg_duration_s}s</p><p className="text-xs text-[var(--muted)]">{t("page.agentRuns.metrics.avgDuration")}</p></div>
                </div>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "retry" && (
        <WorkbenchPanel title={t("page.agentRuns.retryTitle")} actions={<RefreshButton onClick={() => { void runsQ.refetch(); void summaryQ.refetch(); }} pending={runsQ.isFetching} />}>
          <div className="space-y-3">
            {retryRuns.map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold text-[var(--text)]">{r.agent_id}</p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">{r.task_id || t("page.agentRuns.unboundTask")} · retry {r.retry_count ?? 0}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Tag color={statusColor(r.status)}>{r.status}</Tag>
                  <Button size="small" type="primary" disabled={retryRun.isPending || r.status === "retrying"} onClick={() => retryRun.mutate(r.id)}>{t("page.agentRuns.retryAction")}</Button>
                  <Button size="small" onClick={() => writeEvidence.mutate(r.id)}>{t("page.agentRuns.addEvidence")}</Button>
                </div>
              </div>
            ))}
            {!retryRuns.length && <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">{t("page.agentRuns.emptyRetry")}</p>}
          </div>
        </WorkbenchPanel>
      )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="agent-runs" title={t("page.agentRuns.aiTitle")} initialPrompt={t("page.agentRuns.aiPrompt")} />
    </div>
  );
}
