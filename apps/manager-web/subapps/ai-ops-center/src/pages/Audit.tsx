import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Space, Table, Tag, Timeline } from "antd";
import { Download, FilePlus2, Search, ShieldCheck } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("@/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);
const EChartsBarLazy = lazy(() =>
  import("@/components/charts/EChartsBar").then((m) => ({ default: m.EChartsBar })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}
import { getProjectId, getToken } from "@/lib/authStorage";

type AuditModule = "chain" | "events" | "actions" | "record";

const inputClass = "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

export function Audit() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [module, setModule] = useState<AuditModule>("chain");
  const [q, setQ] = useState("");
  const [riskLevel, setRiskLevel] = useState("all");
  const [approvalStatus, setApprovalStatus] = useState("pending");
  const [policyDraft, setPolicyDraft] = useState({
    enabled: true,
    mode: "advisory",
    approval_threshold: 60,
    alert_threshold: 35,
    block_threshold: 90,
    notify_channels: "",
    notes: "",
  });
  const [draft, setDraft] = useState({ action: "manual.review", resource_type: "system", resource_id: "", details: "{}" });
  const [taskPreview, setTaskPreview] = useState<any>(null);
  const state = useQuery({ queryKey: ["audit-state"], queryFn: api.auditState, enabled: authed });
  const verify = useQuery({ queryKey: ["audit-verify"], queryFn: api.auditVerify, enabled: authed });
  const summary = useQuery({ queryKey: ["audit-summary"], queryFn: api.auditSummary, enabled: authed });
  const auditChartsQ = useQuery({ queryKey: ["audit-charts"], queryFn: api.auditCharts, enabled: authed });
  const timeline = useQuery({
    queryKey: ["audit-timeline", getProjectId()],
    queryFn: () => api.auditTimeline(60, getProjectId() || undefined),
    enabled: authed && module === "events",
  });
  const events = useQuery({ queryKey: ["audit-events", q], queryFn: () => api.auditEvents(q, 1, 100), enabled: authed && module === "events" });
  const actionPolicy = useQuery({ queryKey: ["audit-action-policy"], queryFn: api.systemPagesActionPolicy, enabled: authed && module === "actions" });
  const approvals = useQuery({ queryKey: ["audit-action-approvals", approvalStatus], queryFn: () => api.systemPagesActionApprovals(approvalStatus, 100), enabled: authed && module === "actions" });
  const actionRuns = useQuery({ queryKey: ["audit-action-runs", riskLevel], queryFn: () => api.systemPagesActionRuns(100, "", "", riskLevel), enabled: authed && module === "actions" });
  useEffect(() => {
    const policy = actionPolicy.data?.policy;
    if (!policy) return;
    setPolicyDraft({
      enabled: Boolean(policy.enabled),
      mode: String(policy.mode || "advisory"),
      approval_threshold: Number(policy.approval_threshold ?? 60),
      alert_threshold: Number(policy.alert_threshold ?? 35),
      block_threshold: Number(policy.block_threshold ?? 90),
      notify_channels: (policy.notify_channels ?? []).join(", "),
      notes: String(policy.notes || ""),
    });
  }, [actionPolicy.data]);
  const savePolicy = useMutation({
    mutationFn: () =>
      api.systemPagesActionPolicyUpdate({
        ...policyDraft,
        notify_channels: policyDraft.notify_channels.split(",").map((x) => x.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["audit-action-policy"] });
      void qc.invalidateQueries({ queryKey: ["audit-action-runs"] });
      void qc.invalidateQueries({ queryKey: ["audit-state"] });
      void qc.invalidateQueries({ queryKey: ["audit-verify"] });
    },
  });
  const reviewApproval = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) =>
      api.systemPagesActionApprovalReview(id, { status, note: status === "approved" ? "approved in Audit console" : "rejected in Audit console" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["audit-action-approvals"] });
      void qc.invalidateQueries({ queryKey: ["audit-state"] });
      void qc.invalidateQueries({ queryKey: ["audit-verify"] });
    },
  });
  const record = useMutation({
    mutationFn: () => {
      let details: Record<string, unknown> = {};
      try {
        details = JSON.parse(draft.details || "{}") as Record<string, unknown>;
      } catch {
        throw new Error(t("page.audit.invalidJson"));
      }
      return api.auditRecord({
        action: draft.action,
        resource_type: draft.resource_type,
        resource_id: draft.resource_id,
        project_id: getProjectId() || "",
        details,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["audit-events"] });
      void qc.invalidateQueries({ queryKey: ["audit-summary"] });
      void qc.invalidateQueries({ queryKey: ["audit-state"] });
      void qc.invalidateQueries({ queryKey: ["audit-verify"] });
    },
  });
  const eventTask = useMutation({
    mutationFn: ({ id, dryRun }: { id: string; dryRun: boolean }) =>
      api.auditEventTask(id, { dry_run: dryRun, priority: "P1", assigned_to: "SecurityOps", dev_tool: "copilot" }),
    onSuccess: (data) => {
      if (data?.dry_run) {
        setTaskPreview(data.item);
      } else {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
        void qc.invalidateQueries({ queryKey: ["audit-events"] });
      }
    },
  });

  if (!authed) return <NeedLogin />;

  const refresh = () => {
    void state.refetch();
    void verify.refetch();
    void summary.refetch();
    void auditChartsQ.refetch();
    void timeline.refetch();
    void events.refetch();
    void actionPolicy.refetch();
    void approvals.refetch();
    void actionRuns.refetch();
  };

  const modules: Array<{ id: AuditModule; label: string }> = [
    { id: "chain", label: t("page.audit.module.chain") },
    { id: "events", label: t("page.audit.module.events") },
    { id: "actions", label: t("page.audit.module.actions") },
    { id: "record", label: t("page.audit.module.record") },
  ];

  const auditActivity = useMemo(() => {
    const trend = auditChartsQ.data?.activity_trend;
    if (!trend?.days?.length) return null;
    return {
      categories: trend.days,
      series: (trend.series ?? []).map((s) => ({
        name: s.name === "failures" ? t("page.audit.failures") : t("page.audit.eventVolume"),
        data: s.data,
      })),
    };
  }, [auditChartsQ.data, t]);

  return (
    <WorkbenchShell
      title={t("page.audit.title")}
      description={t("page.audit.subtitle")}
      actions={<RefreshButton onClick={refresh} pending={state.isFetching || verify.isFetching || summary.isFetching || auditChartsQ.isFetching} />}
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.audit.total"), value: summary.data?.total ?? 0 },
            { label: t("page.audit.failures"), value: summary.data?.failures ?? 0 },
            { label: t("page.audit.last24h"), value: summary.data?.last_24h ?? 0 },
            { label: t("page.audit.last7d"), value: summary.data?.last_7d ?? 0 },
            { label: t("page.audit.count"), value: state.data?.count ?? 0 },
          ]}
        />
      }
    >
    <div className="grid w-full gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-4 xl:self-start">
        <Card title={t("page.audit.modules")}>
          <div className="grid gap-2">
              {modules.map((m) => (
                <button key={m.id} type="button" onClick={() => setModule(m.id)} className={`rounded-xl border px-3 py-2 text-left text-sm font-medium ${module === m.id ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]" : "border-[var(--border)] text-[var(--muted-strong)]"}`}>
                  {m.label}
                </button>
              ))}
          </div>
        </Card>
      </aside>

      <section className="min-w-0 space-y-4">
        {auditActivity ? (
          <WorkbenchPanel title={t("page.audit.activityTrend")}>
            <Suspense fallback={null}>
              <EChartsBarLazy categories={auditActivity.categories} series={auditActivity.series} stacked height={260} />
            </Suspense>
          </WorkbenchPanel>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.keys(pieToRecord(auditChartsQ.data?.by_action)).length ? (
            <WorkbenchPanel title={t("page.audit.byAction")}>
              <Suspense fallback={null}>
                <EChartsDonutLazy data={pieToRecord(auditChartsQ.data?.by_action)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(auditChartsQ.data?.by_resource)).length ? (
            <WorkbenchPanel title={t("page.audit.byResource")}>
              <Suspense fallback={null}>
                <EChartsDonutLazy data={pieToRecord(auditChartsQ.data?.by_resource)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(auditChartsQ.data?.outcome)).length ? (
            <WorkbenchPanel title={t("page.audit.outcome")}>
              <Suspense fallback={null}>
                <EChartsDonutLazy data={pieToRecord(auditChartsQ.data?.outcome)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>

        {module === "chain" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.8fr)]">
            <Card title={t("page.audit.chainHead")}>
              {state.isLoading ? <LoadingBlock /> : null}
              {state.error ? <ErrorBlock message={(state.error as Error).message} /> : null}
              {state.data ? (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <Info label={t("page.audit.count")} value={String(state.data.count ?? 0)} />
                  <Info label="version" value={String(state.data.version ?? "-")} />
                  <div className="sm:col-span-2">
                    <dt className="text-[var(--muted)]">{t("page.audit.prevHash")}</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-[var(--muted-strong)]">{String(state.data.prev_hash ?? "-")}</dd>
                  </div>
                </dl>
              ) : null}
            </Card>
            <Card title={t("page.audit.verify")}>
              {verify.isLoading ? <LoadingBlock /> : null}
              {verify.error ? <ErrorBlock message={(verify.error as Error).message} /> : null}
              {verify.data ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className={`h-5 w-5 ${verify.data.ok ? "text-emerald-600" : "text-rose-600"}`} />
                    <span className="text-sm font-medium">{verify.data.ok ? t("page.audit.verifyOk") : t("page.audit.verifyFail")}</span>
                    <span className="text-xs text-[var(--muted)]">{t("page.audit.total")}: {verify.data.total ?? "-"}</span>
                  </div>
                  {verify.data.errors?.length ? <pre className="overflow-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{JSON.stringify(verify.data.errors, null, 2)}</pre> : null}
                </div>
              ) : null}
            </Card>
          </div>
        ) : null}

        {module === "events" ? (
          <Card
            title={t("page.audit.events")}
            actions={<a className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" href={api.auditExportCsvUrl()} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />{t("page.audit.exportCsv")}</a>}
          >
            <div className="mb-4 flex gap-2">
              <div className="relative min-w-[16rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--muted)]" />
                <input className={`${inputClass} w-full pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("page.audit.searchPh")} />
              </div>
            </div>
            {timeline.data?.days?.length ? (
              <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <p className="mb-3 text-xs font-semibold text-[var(--text)]">{t("page.audit.timeline")}</p>
                <Timeline
                  items={timeline.data.days.map((day) => ({
                    children: (
                      <div>
                        <p className="text-sm font-medium text-[var(--text)]">
                          {day.date} <span className="text-[var(--muted)]">({day.count})</span>
                        </p>
                        <ul className="mt-2 space-y-1 text-xs text-[var(--muted-strong)]">
                          {day.items.slice(0, 5).map((ev) => (
                            <li key={String(ev.id)} className="font-mono">
                              {String(ev.action)} · {String(ev.resource_type || "")}/{String(ev.resource_id || "")} ·{" "}
                              {String(ev.username || ev.user_id || "")}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                  }))}
                />
              </div>
            ) : null}
            {events.isLoading ? <LoadingBlock /> : null}
            {events.error ? <ErrorBlock message={(events.error as Error).message} /> : null}
            {eventTask.error ? <Alert className="mb-3" type="error" showIcon message={(eventTask.error as Error).message} /> : null}
            {eventTask.data && !eventTask.data.dry_run ? <Alert className="mb-3" type="success" showIcon message={t("page.audit.taskCreated")} /> : null}
            <Table
              rowKey={(row: any) => String(row.id)}
              size="middle"
              loading={events.isLoading}
              dataSource={events.data?.items ?? []}
              scroll={{ x: 980 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{ emptyText: t("page.audit.noEvents") }}
              columns={[
                {
                  title: t("page.audit.event"),
                  dataIndex: "path",
                  render: (value: string, row: any) => (
                    <div className="min-w-[22rem]">
                      <div className="font-mono text-xs font-semibold text-[var(--text)]">{value || row.id}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{row.created_at} · {row.username || row.user_id || "-"}</div>
                    </div>
                  ),
                },
                { title: t("page.audit.action"), dataIndex: "action", width: 120 },
                {
                  title: t("page.audit.resource"),
                  width: 200,
                  render: (_: unknown, row: any) => <span className="font-mono text-xs">{row.resource_type}/{row.resource_id}</span>,
                },
                {
                  title: t("page.audit.status"),
                  dataIndex: "status_code",
                  width: 110,
                  render: (value: number) => <Tag color={Number(value) >= 400 ? "red" : "success"}>{value || "-"}</Tag>,
                },
                {
                  title: t("page.audit.actions"),
                  width: 220,
                  fixed: "right",
                  render: (_: unknown, row: any) => (
                    <Space wrap>
                      <Button size="small" loading={eventTask.isPending} onClick={() => eventTask.mutate({ id: row.id, dryRun: true })}>{t("page.audit.previewTask")}</Button>
                      <Button size="small" type={Number(row.status_code) >= 400 ? "primary" : "default"} loading={eventTask.isPending} onClick={() => eventTask.mutate({ id: row.id, dryRun: false })}>{t("page.audit.createTask")}</Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {module === "actions" ? (
          <div className="space-y-4">
            <Card
              title={t("page.audit.actionPolicy")}
              actions={
                <button
                  type="button"
                  className="rounded-xl bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={!actionPolicy.data?.editable || savePolicy.isPending}
                  onClick={() => savePolicy.mutate()}
                >
                  {t("page.audit.savePolicy")}
                </button>
              }
            >
              {actionPolicy.error ? <ErrorBlock message={(actionPolicy.error as Error).message} /> : null}
              <div className="grid gap-3 lg:grid-cols-[10rem_10rem_repeat(3,8rem)_1fr]">
                <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]">
                  <input type="checkbox" checked={policyDraft.enabled} onChange={(e) => setPolicyDraft((v) => ({ ...v, enabled: e.target.checked }))} />
                  {t("page.audit.policyEnabled")}
                </label>
                <select className={inputClass} value={policyDraft.mode} onChange={(e) => setPolicyDraft((v) => ({ ...v, mode: e.target.value }))}>
                  <option value="advisory">{t("page.audit.policyMode.advisory")}</option>
                  <option value="enforce">{t("page.audit.policyMode.enforce")}</option>
                </select>
                <NumberInput label={t("page.audit.alertThreshold")} value={policyDraft.alert_threshold} onChange={(value) => setPolicyDraft((v) => ({ ...v, alert_threshold: value }))} />
                <NumberInput label={t("page.audit.approvalThreshold")} value={policyDraft.approval_threshold} onChange={(value) => setPolicyDraft((v) => ({ ...v, approval_threshold: value }))} />
                <NumberInput label={t("page.audit.blockThreshold")} value={policyDraft.block_threshold} onChange={(value) => setPolicyDraft((v) => ({ ...v, block_threshold: value }))} />
                <input className={inputClass} value={policyDraft.notify_channels} onChange={(e) => setPolicyDraft((v) => ({ ...v, notify_channels: e.target.value }))} placeholder={t("page.audit.notifyChannelsPh")} />
              </div>
              <textarea className={`${inputClass} mt-3 min-h-20 w-full`} value={policyDraft.notes} onChange={(e) => setPolicyDraft((v) => ({ ...v, notes: e.target.value }))} placeholder={t("page.audit.policyNotesPh")} />
              {savePolicy.data ? <p className="mt-2 text-sm text-emerald-600">{t("page.audit.policySaved")}</p> : null}
              {savePolicy.error ? <ErrorBlock message={(savePolicy.error as Error).message} /> : null}
            </Card>

            <Card
              title={t("page.audit.approvalQueue")}
              actions={
                <select className={inputClass} value={approvalStatus} onChange={(e) => setApprovalStatus(e.target.value)}>
                  <option value="pending">{t("page.audit.approvalStatus.pending")}</option>
                  <option value="approved">{t("page.audit.approvalStatus.approved")}</option>
                  <option value="rejected">{t("page.audit.approvalStatus.rejected")}</option>
                  <option value="all">{t("page.audit.riskAll")}</option>
                </select>
              }
            >
              {approvals.error ? <ErrorBlock message={(approvals.error as Error).message} /> : null}
              <div className="mb-3 grid gap-3 md:grid-cols-3">
                <Metric label={t("page.audit.pendingApprovals")} value={approvals.data?.summary?.pending ?? 0} />
                <Metric label={t("page.audit.approvalTotal")} value={approvals.data?.total ?? 0} />
                <Metric label={t("page.audit.approvalEditable")} value={approvals.data?.editable ? "on" : "off"} />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {(approvals.data?.items ?? []).slice(0, 8).map((item: any) => (
                  <article key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--text)]">{item.module_name || item.module_id}</p>
                        <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{item.id} · {item.run_id}</p>
                      </div>
                      <RiskBadge level={String(item.risk?.level || "low")} score={Number(item.risk?.score ?? 0)} />
                    </div>
                    <p className="mt-3 text-sm text-[var(--muted-strong)]">{item.action_name || item.action_id}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{item.policy?.decision || "-"} · {item.reason}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-[var(--surface)] px-2 py-1 text-xs text-[var(--muted-strong)]">{item.status}</span>
                      {item.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            disabled={!approvals.data?.editable || reviewApproval.isPending}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            onClick={() => reviewApproval.mutate({ id: item.id, status: "approved" })}
                          >
                            {t("page.audit.approve")}
                          </button>
                          <button
                            type="button"
                            disabled={!approvals.data?.editable || reviewApproval.isPending}
                            className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-50"
                            onClick={() => reviewApproval.mutate({ id: item.id, status: "rejected" })}
                          >
                            {t("page.audit.reject")}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
              {!approvals.isLoading && !(approvals.data?.items ?? []).length ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">{t("page.audit.noApprovals")}</div>
              ) : null}
            </Card>

            <Card
              title={t("page.audit.actionRuns")}
              actions={
                <select className={inputClass} value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
                  <option value="all">{t("page.audit.riskAll")}</option>
                  <option value="critical">{t("page.audit.risk.critical")}</option>
                  <option value="high">{t("page.audit.risk.high")}</option>
                  <option value="medium">{t("page.audit.risk.medium")}</option>
                  <option value="low">{t("page.audit.risk.low")}</option>
                </select>
              }
            >
              {actionRuns.isLoading ? <LoadingBlock /> : null}
              {actionRuns.error ? <ErrorBlock message={(actionRuns.error as Error).message} /> : null}
              <div className="mb-4 grid gap-3 md:grid-cols-5">
                <Metric label={t("page.audit.actionRunTotal")} value={actionRuns.data?.total ?? 0} />
                <Metric label={t("page.audit.actionRunExecuted")} value={actionRuns.data?.summary?.executed ?? 0} />
                <Metric label={t("page.audit.actionRunTypes")} value={Object.keys(actionRuns.data?.summary?.by_type ?? {}).length} />
                <Metric label={t("page.audit.actionRunModules")} value={Object.keys(actionRuns.data?.summary?.by_module ?? {}).length} />
                <Metric label={t("page.audit.highestRisk")} value={actionRuns.data?.summary?.highest_risk ?? 0} />
              </div>
              <div className="overflow-auto rounded-2xl border border-[var(--border)]">
              <div className="min-w-[70rem]">
                <div className="grid grid-cols-[1.1fr_1fr_8rem_8rem_9rem_1.4fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                  <span>{t("page.audit.run")}</span>
                  <span>{t("page.audit.moduleName")}</span>
                  <span>{t("page.audit.action")}</span>
                  <span>{t("page.audit.riskScore")}</span>
                  <span>{t("page.audit.result")}</span>
                  <span>{t("page.audit.evidence")}</span>
                </div>
                {(actionRuns.data?.items ?? []).map((row: any) => {
                  const chain = row.evidence?.audit_chain;
                  const event = row.evidence?.event;
                  return (
                    <div key={row.id} className="grid grid-cols-[1.1fr_1fr_8rem_8rem_9rem_1.4fr] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs last:border-0">
                      <div className="min-w-0">
                        <p className="truncate font-mono font-semibold text-[var(--text)]">{row.id}</p>
                        <p className="truncate text-[var(--muted)]">{row.created_at}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--text)]">{row.module_name || row.module_id}</p>
                        <p className="truncate font-mono text-[var(--muted)]">{row.capability || "-"}</p>
                      </div>
                      <span className="truncate text-[var(--muted-strong)]">{row.action_name || row.action_id}</span>
                      <RiskBadge level={String(row.risk?.level || "low")} score={Number(row.risk?.score ?? 0)} />
                      <span className={row.executed ? "text-emerald-600" : "text-amber-600"}>{row.result_type || "-"}</span>
                      <div className="min-w-0 space-y-1">
                        <p className="truncate font-mono text-[var(--muted-strong)]">chain: {chain?.hash ? String(chain.hash).slice(0, 18) : chain?.error || "-"}</p>
                        <p className="truncate font-mono text-[var(--muted-strong)]">event: {event?.id || event?.error || "-"}</p>
                        <p className="truncate text-[var(--muted)]">{(row.risk?.recommendations ?? []).slice(0, 1).join(" ")}</p>
                      </div>
                    </div>
                  );
                })}
                {!actionRuns.isLoading && !(actionRuns.data?.items ?? []).length ? (
                  <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">{t("page.audit.noActionRuns")}</div>
                ) : null}
              </div>
            </div>
            </Card>
          </div>
        ) : null}

        {module === "record" ? (
          <Card title={t("page.audit.record")}>
            <div className="grid gap-3 lg:grid-cols-3">
              <input className={inputClass} value={draft.action} onChange={(e) => setDraft((v) => ({ ...v, action: e.target.value }))} placeholder="action" />
              <input className={inputClass} value={draft.resource_type} onChange={(e) => setDraft((v) => ({ ...v, resource_type: e.target.value }))} placeholder="resource_type" />
              <input className={inputClass} value={draft.resource_id} onChange={(e) => setDraft((v) => ({ ...v, resource_id: e.target.value }))} placeholder="resource_id" />
              <textarea className={`${inputClass} min-h-36 font-mono text-xs lg:col-span-3`} value={draft.details} onChange={(e) => setDraft((v) => ({ ...v, details: e.target.value }))} />
            </div>
            <button type="button" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!draft.action.trim() || record.isPending} onClick={() => record.mutate()}>
              <FilePlus2 className="h-4 w-4" />
              {t("page.audit.saveRecord")}
            </button>
            {record.error ? <ErrorBlock message={(record.error as Error).message} /> : null}
            {record.data ? <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(record.data, null, 2)}</pre> : null}
          </Card>
        ) : null}
      </section>
      <Modal
        open={Boolean(taskPreview)}
        title={t("page.audit.taskPreview")}
        onCancel={() => setTaskPreview(null)}
        footer={<Button type="primary" onClick={() => setTaskPreview(null)}>{t("common.close")}</Button>}
        width={760}
      >
        {taskPreview ? (
          <div className="space-y-3">
            <Alert type="info" showIcon message={taskPreview.title} />
            <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(taskPreview, null, 2)}</pre>
          </div>
        ) : null}
      </Modal>
    </div>
    </WorkbenchShell>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 font-mono text-xs text-[var(--text)]">{value}</dd>
    </div>
  );
}

function RiskBadge({ level, score }: { level: string; score: number }) {
  const cls =
    level === "critical"
      ? "bg-rose-600 text-white"
      : level === "high"
        ? "bg-orange-500/15 text-orange-700 dark:text-orange-200"
        : level === "medium"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-200"
          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200";
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 font-semibold ${cls}`}>
      {level} · {score}
    </span>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-[var(--muted)]">{label}</span>
      <input
        className={inputClass}
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value || 0))))}
      />
    </label>
  );
}
