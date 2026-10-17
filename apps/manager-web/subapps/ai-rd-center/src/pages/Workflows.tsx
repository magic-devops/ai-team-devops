import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Descriptions, Drawer, Input, Select, Space, Table, Tag, Timeline, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Activity, GitBranch, ListChecks, Network, Play, Radio, RefreshCw, Send, Terminal, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { FlashMessage } from "@/components/FlashMessage";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getProjectId, getSessionRevision, getToken } from "@/lib/authStorage";
import { assistanceIntent, type AssistanceIntent } from "@/lib/requirementsAssistance";
import { WorkflowsWorkbenchHeader } from "./delivery/WorkflowsWorkbenchHeader";
import { WorkflowHumanReview } from "./delivery/WorkflowHumanReview";
import { WorkflowDag } from "@/pages/shared/WorkflowDag";

type WorkflowModule = "catalog" | "instances" | "events" | "signals" | "ops";

type WorkflowsProps = {
  initialModule?: WorkflowModule;
  focused?: boolean;
};

const inputClass = "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const cls =
    status === "completed" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" :
      status === "failed" || status === "cancelled" ? "bg-rose-500/10 text-rose-700 dark:text-rose-200" :
        "bg-sky-500/10 text-sky-700 dark:text-sky-200";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{t(`assistance.${status}`, { defaultValue: status })}</span>;
}

export function Workflows({ initialModule = "catalog", focused = false }: WorkflowsProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [module, setModule] = useState<WorkflowModule>(initialModule);
  const [type, setType] = useState("");
  const [args, setArgs] = useState("{}");
  const [selected, setSelected] = useState("");
  const [detailId, setDetailId] = useState("");
  const [instanceStatus, setInstanceStatus] = useState("");
  const [instanceType, setInstanceType] = useState("");
  const [instanceQuery, setInstanceQuery] = useState("");
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
  const [signalDraft, setSignalDraft] = useState({ signal: "pause", payload: "{}" });
  const startIntent = useRef<AssistanceIntent>();
  const signalIntent = useRef<AssistanceIntent>();
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  const types = useQuery({ queryKey: ["wf-types"], queryFn: api.workflowTypes, enabled: authed && hasProject });
  const summary = useQuery({ queryKey: ["wf-summary"], queryFn: api.workflowSummary, enabled: authed && hasProject });
  const engineStatus = useQuery({ queryKey: ["wf-engine"], queryFn: api.workflowEngineStatus, enabled: authed && hasProject });
  const opsPlan = useQuery({ queryKey: ["wf-ops-plan"], queryFn: api.workflowOpsPlan, enabled: authed && hasProject && module === "ops" });
  const instances = useQuery({
    queryKey: ["wf-instances", instanceStatus, instanceType, instanceQuery],
    queryFn: () => api.workflowInstances(300, instanceStatus, instanceType, instanceQuery.trim()),
    enabled: authed && hasProject,
    refetchInterval: (query) => query.state.data?.items.some((row) => !["completed", "failed", "cancelled"].includes(row.status)) ? 5000 : false,
  });
  const events = useQuery({ queryKey: ["wf-events", selected], queryFn: () => api.workflowEvents(100, selected), enabled: authed && hasProject && (module === "events" || module === "signals") });
  const detailQ = useQuery({
    queryKey: ["wf-detail", detailId],
    queryFn: () => api.workflowDetail(detailId),
    enabled: authed && hasProject && Boolean(detailId),
    refetchInterval: (query) => query.state.data && !["completed", "failed", "cancelled"].includes(query.state.data.status || "") ? 5000 : false,
  });
  const selectedDetail = useQuery({
    queryKey: ["wf-detail", selected],
    queryFn: () => api.workflowDetail(selected),
    enabled: authed && hasProject && Boolean(selected) && module === "signals",
    refetchInterval: (query) => query.state.data && !["completed", "failed", "cancelled"].includes(query.state.data.status || "") ? 5000 : false,
  });
  const selectedType = String(selectedDetail.data?.instance?.type || "");
  const allowedSignals: string[] = (types.data ?? []).find((definition: { type: string }) => definition.type === selectedType)?.signals || [];
  const advancedSignals = allowedSignals.filter((value) => !["approve", "request_changes", "reject"].includes(value));
  const selectedAdvancedSignal = advancedSignals.includes(signalDraft.signal) ? signalDraft.signal : advancedSignals[0] || "";

  const start = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(args || "{}") as Record<string, unknown>;
      } catch {
        throw new Error(t("page.workflows.invalidJson"));
      }
      const body = { type, args: parsed };
      startIntent.current = assistanceIntent(startIntent.current, `${getSessionRevision()}:${getProjectId()}`, "workflow-start", body);
      return api.startWorkflow({ ...body, workflow_id: `wf-${startIntent.current.key}` });
    },
    onSuccess: (data) => {
      setSelected(String(data?.workflow_id ?? ""));
      setFlash({ kind: "ok", message: t("page.workflows.started", { id: data?.workflow_id ?? data?.id ?? "-" }) });
      invalidate();
      startIntent.current = undefined;
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const signal = useMutation({
    mutationFn: () => {
      if (!selectedAdvancedSignal) throw new Error(t("assistance.advancedHint"));
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(signalDraft.payload || "{}") as Record<string, unknown>;
      } catch {
        throw new Error(t("page.workflows.invalidJson"));
      }
      signalIntent.current = assistanceIntent(signalIntent.current, `${getSessionRevision()}:${getProjectId()}:${selected}`, selectedAdvancedSignal, payload);
      return api.signalWorkflow(selected, { signal: selectedAdvancedSignal, payload: { ...payload, signal_id: payload.signal_id || signalIntent.current.key } });
    },
    onSuccess: () => {
      setFlash({ kind: "ok", message: t("page.workflows.signalSent") });
      invalidate();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const cancel = useMutation({
    mutationFn: (workflowId: string) => api.cancelWorkflow(workflowId),
    onSuccess: () => {
      setFlash({ kind: "ok", message: t("page.workflows.cancelled") });
      invalidate();
    },
  });
  const bulkCancel = useMutation({
    mutationFn: () => api.bulkCancelWorkflows(selectedWorkflowIds),
    onSuccess: (data) => {
      setSelectedWorkflowIds([]);
      setFlash({ kind: "ok", message: t("page.workflows.bulkCancelled", { count: data?.count ?? 0 }) });
      invalidate();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const opsTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.workflowOpsTasks({ dry_run: dryRun, priority: "P1" }),
    onSuccess: (data) => {
      setFlash({ kind: "ok", message: t("page.workflows.opsTasksResult", { planned: data?.summary?.planned ?? 0, created: data?.summary?.created ?? 0 }) });
      invalidate();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["wf-summary"] });
    void qc.invalidateQueries({ queryKey: ["wf-charts"] });
    void qc.invalidateQueries({ queryKey: ["wf-instances"] });
    void qc.invalidateQueries({ queryKey: ["wf-events"] });
    void qc.invalidateQueries({ queryKey: ["wf-ops-plan"] });
    void qc.invalidateQueries({ queryKey: ["wf-detail"] });
  }

  useEffect(() => {
    if (!flash) return;
    const tmr = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(tmr);
  }, [flash]);

  useEffect(() => {
    setModule(initialModule);
  }, [initialModule]);

  if (!authed) return <NeedLogin />;
  if (!hasProject) return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;

  const modules: Array<{ id: WorkflowModule; label: string; icon: JSX.Element }> = [
    { id: "catalog", label: t("page.workflows.module.catalog"), icon: <GitBranch className="h-5 w-5" /> },
    { id: "instances", label: t("page.workflows.module.instances"), icon: <Play className="h-5 w-5" /> },
    { id: "events", label: t("page.workflows.module.events"), icon: <Radio className="h-5 w-5" /> },
    { id: "signals", label: t("page.workflows.module.signals"), icon: <Network className="h-5 w-5" /> },
    { id: "ops", label: t("page.workflows.module.ops"), icon: <Activity className="h-5 w-5" /> },
  ];
  const workflowTypeOptions = (types.data ?? []).map((wf: any) => ({ value: wf.type, label: wf.type }));
  const instanceColumns: ColumnsType<any> = [
    {
      title: t("page.workflows.instance"),
      dataIndex: "workflow_id",
      render: (_value, row) => (
        <button type="button" className="min-w-0 text-left" onClick={() => { setSelected(row.workflow_id); setModule("events"); }}>
          <p className="truncate font-mono text-xs font-semibold text-[var(--text)]">{row.workflow_id}</p>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">{row.run_id}</p>
        </button>
      ),
    },
    {
      title: t("page.workflows.type"),
      dataIndex: "type",
      width: 170,
      render: (value) => <Tag>{value}</Tag>,
    },
    {
      title: t("page.workflows.status"),
      dataIndex: "status",
      width: 130,
      render: (value) => <StatusBadge status={String(value ?? "-")} />,
    },
    {
      title: t("page.workflows.duration"),
      dataIndex: "duration_s",
      width: 120,
      render: (value) => `${Number(value ?? 0)}s`,
    },
    {
      title: t("page.workflows.actions"),
      dataIndex: "actions",
      width: 190,
      render: (_value, row) => (
        <Space size={6} wrap>
          <Button size="small" onClick={() => setDetailId(row.workflow_id)}>{t("common.view")}</Button>
          <Button size="small" onClick={() => { setSelected(row.workflow_id); setModule("events"); }}>{t("page.workflows.events")}</Button>
          <Button
            size="small"
            danger
            icon={<XCircle className="h-3.5 w-3.5" />}
            disabled={cancel.isPending || !row.permissions?.write || ["completed", "failed", "cancelled"].includes(row.status)}
            onClick={() => cancel.mutate(row.workflow_id)}
          />
        </Space>
      ),
    },
  ];

  return (
    <div className="w-full space-y-4">
      <WorkflowsWorkbenchHeader
        onRefresh={invalidate}
        pending={start.isPending || signal.isPending || cancel.isPending || bulkCancel.isPending}
      />
      <div className="grid w-full gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-4 xl:self-start">
          <Card title={focused ? t(`page.workflows.module.${module}`) : t("page.workflows.title")}>
          <div className="grid gap-3">
            <Summary label={t("page.workflows.engine")} value={summary.data?.engine ?? "-"} />
            <Summary
              label={t("page.workflows.temporal")}
              value={engineStatus.data?.temporal_connected ? t("page.workflows.temporalOn") : t("page.workflows.temporalOff")}
            />
            <Summary label={t("page.workflows.instances")} value={summary.data?.total ?? 0} />
            <Summary label={t("page.workflows.running")} value={summary.data?.by_status?.running ?? 0} />
            <div className="mt-2 grid gap-2">
              {modules.map((m) => (
                <button key={m.id} type="button" onClick={() => setModule(m.id)} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium ${module === m.id ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]" : "border-[var(--border)] text-[var(--muted-strong)]"}`}>
                  <span className="text-[var(--brand)]">{m.icon}</span>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </aside>

      <section className="min-w-0 space-y-4">
        {flash ? <FlashMessage kind={flash.kind} message={flash.message} onDismiss={() => setFlash(null)} /> : null}

        {module === "catalog" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card title={t("page.workflows.available")} actions={<RefreshButton onClick={invalidate} />}>
              {types.isLoading ? <LoadingBlock /> : null}
              {types.error ? <ErrorBlock message={(types.error as Error).message} /> : null}
              {(types.data ?? []).length === 0 && !types.isLoading && !types.error ? <EmptyState message={t("page.workflows.empty")} /> : null}
              <div className="grid gap-3 lg:grid-cols-2">
                {(types.data ?? []).map((wf: any) => (
                  <button key={wf.type} type="button" className={`rounded-2xl border p-4 text-left ${type === wf.type ? "border-[var(--brand)] bg-[var(--brand-softer)]" : "border-[var(--border)] bg-[var(--surface)]"}`} onClick={() => setType(wf.type)}>
                    <div className="font-mono text-sm font-semibold text-[var(--text)]">{wf.type}</div>
                    <p className="mt-2 text-sm text-[var(--muted-strong)]">{wf.description}</p>
                    <p className="mt-3 text-xs text-[var(--muted)]">{t("page.workflows.signals")}: {(wf.signals ?? []).join(", ") || "-"}</p>
                  </button>
                ))}
              </div>
            </Card>
            <Card title={t("page.workflows.start")}>
              <div className="space-y-3">
                <select className={`${inputClass} w-full`} value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">{t("page.workflows.choose")}</option>
                  {(types.data ?? []).map((wf: any) => <option key={wf.type} value={wf.type}>{wf.type}</option>)}
                </select>
                <textarea className={`${inputClass} min-h-40 w-full font-mono text-xs`} value={args} onChange={(e) => setArgs(e.target.value)} placeholder='{"key": "value"}' />
                <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!type || start.isPending} onClick={() => start.mutate()}>
                  <Play className="h-4 w-4" />
                  {start.isPending ? t("common.loading") : t("page.workflows.startBtn")}
                </button>
              </div>
            </Card>
          </div>
        ) : null}

        {module === "instances" ? (
          <Card title={t("page.workflows.instances")} actions={<RefreshButton onClick={invalidate} />}>
            {instances.isLoading ? <LoadingBlock /> : null}
            {instances.error ? <ErrorBlock message={(instances.error as Error).message} /> : null}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <Input.Search
                className="min-w-[18rem] flex-1"
                allowClear
                value={instanceQuery}
                onChange={(e) => setInstanceQuery(e.target.value)}
                placeholder={t("page.workflows.searchInstances")}
              />
              <Select
                className="min-w-40"
                allowClear
                placeholder={t("page.workflows.allStatuses")}
                value={instanceStatus || undefined}
                onChange={(value) => setInstanceStatus(value || "")}
                options={[
                  { value: "running", label: "running" },
                  { value: "completed", label: "completed" },
                  { value: "failed", label: "failed" },
                  { value: "cancelled", label: "cancelled" },
                ]}
              />
              <Select
                className="min-w-52"
                allowClear
                placeholder={t("page.workflows.allTypes")}
                value={instanceType || undefined}
                onChange={(value) => setInstanceType(value || "")}
                options={workflowTypeOptions}
              />
              <Button
                onClick={() => {
                  setInstanceQuery("");
                  setInstanceStatus("");
                  setInstanceType("");
                }}
              >
                {t("common.reset")}
              </Button>
              <Button
                danger
                disabled={!selectedWorkflowIds.length || bulkCancel.isPending}
                loading={bulkCancel.isPending}
                onClick={() => bulkCancel.mutate()}
              >
                {t("page.workflows.bulkCancel", { count: selectedWorkflowIds.length })}
              </Button>
            </div>
            <Table
              rowKey="workflow_id"
              columns={instanceColumns}
              dataSource={instances.data?.items ?? []}
              loading={instances.isLoading}
              size="middle"
              scroll={{ x: 900 }}
              rowSelection={{
                selectedRowKeys: selectedWorkflowIds,
                onChange: (keys) => setSelectedWorkflowIds(keys.map(String)),
                getCheckboxProps: (record) => ({
                  disabled: !record.permissions?.write || ["completed", "failed", "cancelled"].includes(record.status),
                }),
              }}
              pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100], showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}` }}
            />
          </Card>
        ) : null}

        {module === "events" ? (
          <div className="grid gap-4">
            <Card title={t("page.workflows.events")}>
              <select className={`${inputClass} mb-3 w-full`} value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">{t("page.workflows.allInstances")}</option>
                {(instances.data?.items ?? []).map((row: any) => <option key={row.workflow_id} value={row.workflow_id}>{row.workflow_id}</option>)}
              </select>
              <ul className="space-y-2">
                {(events.data?.items ?? []).map((evt: any) => (
                  <li key={evt.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-[var(--text)]">{evt.workflow_id}</span>
                      <span className="text-xs text-[var(--muted)]">{evt.ts}</span>
                    </div>
                    <pre className="mt-2 max-h-40 overflow-auto text-xs text-[var(--muted-strong)]">{JSON.stringify(evt, null, 2)}</pre>
                  </li>
                ))}
                {events.isSuccess && !(events.data?.items ?? []).length ? <EmptyState message={t("page.workflows.noEvents")} /> : null}
              </ul>
            </Card>
          </div>
        ) : null}

        {module === "signals" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card title={t("page.workflows.signalTargets")}>
              <Table
                rowKey="workflow_id"
                columns={instanceColumns.filter((column: any) => column.dataIndex !== "actions")}
                dataSource={(instances.data?.items ?? []).filter((row: any) => !["completed", "failed", "cancelled"].includes(row.status))}
                loading={instances.isLoading}
                size="middle"
                scroll={{ x: 720 }}
                pagination={{ pageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50] }}
                onRow={(record) => ({
                  onClick: () => setSelected(record.workflow_id),
                })}
              />
              {instances.isSuccess && !(instances.data?.items ?? []).some((row: any) => !["completed", "failed", "cancelled"].includes(row.status)) ? (
                <EmptyState message={t("page.workflows.noSignalTargets")} />
              ) : null}
            </Card>
            <Card title={t("page.workflows.signal")}>
              <div className="space-y-2">
                <select className={`${inputClass} w-full`} value={selected} onChange={(e) => setSelected(e.target.value)}>
                  <option value="">{t("page.workflows.chooseInstance")}</option>
                  {(instances.data?.items ?? []).map((row: any) => <option key={row.workflow_id} value={row.workflow_id}>{row.workflow_id}</option>)}
                </select>
                {selectedDetail.isLoading && <LoadingBlock />}
                {selectedDetail.error && <ErrorBlock message={(selectedDetail.error as Error).message} />}
                {selectedDetail.data && <WorkflowHumanReview key={selected} workflowId={selected} detail={selectedDetail.data} onSaved={invalidate} />}
                <details className="rounded-lg border border-[var(--border)] p-3"><summary className="cursor-pointer text-sm font-medium">{t("assistance.advancedSignal")}</summary><p className="my-3 text-xs text-[var(--muted)]">{t("assistance.advancedHint")}</p>
                <label className="grid gap-1 text-xs">{t("page.workflows.signal")}<select className={`${inputClass} w-full`} value={selectedAdvancedSignal} onChange={(e) => setSignalDraft((v) => ({ ...v, signal: e.target.value }))}><option value="">—</option>{advancedSignals.map((value) => <option key={value} value={value}>{t(`assistance.${value}`, { defaultValue: value })}</option>)}</select></label>
                <label className="mt-2 grid gap-1 text-xs">JSON<textarea className={`${inputClass} min-h-32 w-full font-mono text-xs`} value={signalDraft.payload} onChange={(e) => setSignalDraft((v) => ({ ...v, payload: e.target.value }))} /></label>
                <button type="button" className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white" disabled={!selectedDetail.data?.permissions?.write || ["completed", "failed", "cancelled"].includes(selectedDetail.data?.status || "") || !selectedAdvancedSignal || signal.isPending} onClick={() => signal.mutate()}>
                  <Send className="h-4 w-4" />
                  {t("page.workflows.sendSignal")}
                </button></details>
              </div>
            </Card>
          </div>
        ) : null}

        {module === "ops" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card title={t("page.workflows.opsPlan")} actions={<RefreshButton onClick={invalidate} />}>
              {opsPlan.isLoading ? <LoadingBlock /> : null}
              {opsPlan.error ? <ErrorBlock message={(opsPlan.error as Error).message} /> : null}
              {opsPlan.data ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Summary label={t("page.workflows.opsHealth")} value={opsPlan.data.health?.score ?? 0} />
                    <Summary label={t("page.workflows.opsGrade")} value={opsPlan.data.health?.grade ?? "-"} />
                    <Summary label={t("page.workflows.opsTasks")} value={opsPlan.data.task_candidates?.length ?? 0} />
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {(opsPlan.data.commands ?? []).map((cmd: any) => (
                      <button
                        key={cmd.id}
                        type="button"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
                        onClick={() => void navigator.clipboard.writeText(cmd.command)}
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                          <Terminal className="h-4 w-4 text-[var(--brand)]" />
                          {cmd.title}
                        </div>
                        <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">{cmd.command}</p>
                      </button>
                    ))}
                  </div>
                  {(opsPlan.data.health?.risks ?? []).length ? (
                    <div className="grid gap-2">
                      {(opsPlan.data.health.risks ?? []).map((risk: any) => (
                        <div key={risk.id} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-[var(--text)]">
                          <span className="font-semibold">{risk.level}</span> · {risk.message}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>
            <Card title={t("page.workflows.opsActions")}>
              <div className="grid gap-2">
                <Button icon={<ListChecks className="h-4 w-4" />} loading={opsTasks.isPending} onClick={() => opsTasks.mutate(true)}>
                  {t("page.workflows.previewOpsTasks")}
                </Button>
                <Button type="primary" icon={<ListChecks className="h-4 w-4" />} loading={opsTasks.isPending} onClick={() => opsTasks.mutate(false)}>
                  {t("page.workflows.createOpsTasks")}
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                {(opsPlan.data?.task_candidates ?? []).map((task: any) => (
                  <div key={task.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                    <div className="font-medium text-[var(--text)]">{task.title}</div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{task.description}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}
      </section>

      <Drawer
        title={detailId || t("page.workflows.instanceDetail")}
        open={Boolean(detailId)}
        onClose={() => setDetailId("")}
        width="min(720px, 100vw)"
      >
        {detailQ.isLoading ? <LoadingBlock /> : null}
        {detailQ.error ? <ErrorBlock message={(detailQ.error as Error).message} /> : null}
        {detailQ.data ? (
          <div className="space-y-4 text-sm">
            <WorkflowHumanReview key={detailId} workflowId={detailId} detail={detailQ.data} onSaved={invalidate} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Summary label={t("page.workflows.status")} value={String(detailQ.data.instance?.status ?? "—")} />
              <Summary label={t("page.workflows.type")} value={String(detailQ.data.instance?.type ?? "—")} />
              <Summary label={t("page.workflows.duration")} value={`${Number(detailQ.data.instance?.duration_s ?? 0)}s`} />
              <Summary label={t("page.workflows.engine")} value={String(detailQ.data.engine ?? detailQ.data.instance?.engine ?? "—")} />
            </div>
            {detailQ.data.dag?.steps?.length ? (
              <div>
                <Typography.Text strong className="text-xs">
                  {t("page.workflows.dag")}
                </Typography.Text>
                <div className="mt-2">
                  <WorkflowDag
                    steps={detailQ.data.dag.steps as Array<Record<string, unknown>>}
                    edges={detailQ.data.dag?.edges}
                    currentStepId={detailQ.data.dag.current_step_id}
                  />
                </div>
              </div>
            ) : null}
            {detailQ.data.temporal ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <Typography.Text strong className="text-xs">
                  {t("page.workflows.temporalState")}
                </Typography.Text>
                <Descriptions column={1} size="small" className="mt-2">
                  <Descriptions.Item label={t("page.workflows.temporalAvailable")}>
                    {detailQ.data.temporal.available ? t("common.yes") : t("common.no")}
                  </Descriptions.Item>
                  {detailQ.data.temporal.status_name ? (
                    <Descriptions.Item label={t("page.workflows.status")}>
                      {String(detailQ.data.temporal.status_name)}
                    </Descriptions.Item>
                  ) : null}
                  {detailQ.data.temporal.task_queue ? (
                    <Descriptions.Item label={t("page.workflows.taskQueue")}>
                      {String(detailQ.data.temporal.task_queue)}
                    </Descriptions.Item>
                  ) : null}
                  {detailQ.data.temporal.history_length != null ? (
                    <Descriptions.Item label={t("page.workflows.historyLength")}>
                      {String(detailQ.data.temporal.history_length)}
                    </Descriptions.Item>
                  ) : null}
                  {detailQ.data.temporal.reason ? (
                    <Descriptions.Item label={t("page.workflows.temporalReason")}>
                      {String(detailQ.data.temporal.reason)}
                    </Descriptions.Item>
                  ) : null}
                </Descriptions>
              </div>
            ) : null}
            {detailQ.data.error ? (
              <Typography.Paragraph type="danger" className="!mb-0 text-xs">
                {detailQ.data.error}
              </Typography.Paragraph>
            ) : null}
            {detailQ.data.result != null ? (
              <pre className="max-h-32 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-xs">
                {JSON.stringify(detailQ.data.result, null, 2)}
              </pre>
            ) : null}
            <Typography.Text strong className="text-xs">
              {t("page.workflows.eventTimeline")}
            </Typography.Text>
            <Timeline
              items={(detailQ.data.events ?? []).map((evt: Record<string, unknown>) => ({
                children: (
                  <div>
                    <span className="font-mono text-[10px] text-[var(--muted)]">{String(evt.ts ?? "")}</span>
                    <div className="font-medium">{String(evt.event ?? evt.signal ?? "event")}</div>
                    {evt.status ? <Tag className="mt-1">{String(evt.status)}</Tag> : null}
                  </div>
                ),
              }))}
            />
          </div>
        ) : null}
      </Drawer>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]" onClick={onClick}>
      <RefreshCw className="h-4 w-4" />
    </button>
  );
}
