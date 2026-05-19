import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Space, Table, Tag, Timeline, Typography } from "antd";
import { BellRing, CheckCircle2, Copy, MessageSquareText, PlugZap, RefreshCw, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";

const EChartsDonutLazy = lazy(() =>
  import("@/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { FlashMessage } from "@/components/FlashMessage";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";
import { getToken } from "@/lib/authStorage";

type NotifyModule = "connectors" | "channels" | "outbound" | "inbound" | "messages";

const inputClass = "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function Notify({ initialModule = "connectors" }: { initialModule?: NotifyModule; focused?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [module, setModule] = useState<NotifyModule>(initialModule);
  const [name, setName] = useState("");
  const [type, setType] = useState("dingtalk");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("task_blocked,issue_p0,sprint_complete,deploy");
  const [sendDraft, setSendDraft] = useState({ channel: "", title: "", content: "", level: "info" });
  const [inboundDraft, setInboundDraft] = useState({ channel: "inbound", sender: "manual", text: "" });
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; message: string } | null>(null);
  const [actionResult, setActionResult] = useState<any>(null);
  const [callbackResult, setCallbackResult] = useState<any>(null);
  const [verifyDraft, setVerifyDraft] = useState({ connector: "webhook", secret: "", timestamp: "", signature: "", body: "" });
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const summary = useQuery({ queryKey: ["notifySummary"], queryFn: api.notifySummary, enabled: authed });
  const charts = useQuery({ queryKey: ["notifyCharts"], queryFn: api.notifyCharts, enabled: authed });
  const timeline = useQuery({
    queryKey: ["notifyTimeline"],
    queryFn: () => api.notifyTimeline(80),
    enabled: authed && module === "messages",
  });
  const connectors = useQuery({ queryKey: ["notifyConnectors"], queryFn: api.notifyConnectors, enabled: authed });
  const templates = useQuery({ queryKey: ["notifyTemplates"], queryFn: api.notifyTemplates, enabled: authed });
  const channels = useQuery({ queryKey: ["notifyChannels"], queryFn: api.notifyChannels, enabled: authed });
  const messages = useQuery({ queryKey: ["notifyMessages"], queryFn: () => api.notifyMessages(100), enabled: authed && module === "messages" });
  const outboundMessages = useQuery({ queryKey: ["notifyMessages", "outbound"], queryFn: () => api.notifyMessages(100, "outbound"), enabled: authed && module === "outbound" });
  const inboundMessages = useQuery({ queryKey: ["notifyMessages", "inbound"], queryFn: () => api.notifyMessages(100, "inbound"), enabled: authed && module === "inbound" });

  const add = useMutation({
    mutationFn: () =>
      api.notifyAddChannel({
        name: name.trim(),
        type,
        webhook_url: url.trim(),
        enabled: true,
        events: events.split(",").map((x) => x.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      setName("");
      setUrl("");
      setFlash({ kind: "ok", message: t("page.notify.saved") });
      invalidate();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const patch = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => api.notifyPatchChannel(name, { enabled }),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (channel: string) => api.notifyDeleteChannel(channel),
    onSuccess: invalidate,
  });
  const test = useMutation({
    mutationFn: (channel: string) => api.notifyTestChannel(channel),
    onSuccess: () => {
      setFlash({ kind: "ok", message: t("page.notify.testSent") });
      invalidate();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const send = useMutation({
    mutationFn: () => api.notifySend(sendDraft),
    onSuccess: () => {
      setSendDraft({ channel: "", title: "", content: "", level: "info" });
      setFlash({ kind: "ok", message: t("page.notify.sent") });
      invalidate();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const inbound = useMutation({
    mutationFn: () => api.notifyInbound(inboundDraft),
    onSuccess: () => {
      setInboundDraft({ channel: "inbound", sender: "manual", text: "" });
      setFlash({ kind: "ok", message: t("page.notify.inboundSaved") });
      invalidate();
    },
  });
  const inboundAction = useMutation({
    mutationFn: ({ id, action, dryRun }: { id: string; action: "task" | "requirement"; dryRun: boolean }) =>
      api.notifyInboundAction(id, { action, dry_run: dryRun, priority: "P1", assigned_to: "Coder", assigned_agent: "PM", dev_tool: "copilot" }),
    onSuccess: (data) => {
      setActionResult(data);
      if (!data?.dry_run) {
        setFlash({ kind: "ok", message: data.action === "requirement" ? t("page.notify.requirementCreated") : t("page.notify.taskCreated") });
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["requirements"] });
      }
      invalidate();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const loadCallback = useMutation({
    mutationFn: (connectorType: string) => api.notifyConnectorCallbackTemplate(connectorType),
    onSuccess: setCallbackResult,
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const verify = useMutation({
    mutationFn: () =>
      api.notifyConnectorVerify(verifyDraft.connector, {
        secret: verifyDraft.secret,
        timestamp: verifyDraft.timestamp,
        signature: verifyDraft.signature,
        body: verifyDraft.body,
      }),
    onSuccess: setVerifyResult,
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["notifyChannels"] });
    void qc.invalidateQueries({ queryKey: ["notifyConnectors"] });
    void qc.invalidateQueries({ queryKey: ["notifyMessages"] });
    void qc.invalidateQueries({ queryKey: ["notifySummary"] });
    void qc.invalidateQueries({ queryKey: ["notifyTimeline"] });
  }

  useEffect(() => {
    setModule(initialModule);
  }, [initialModule]);

  useEffect(() => {
    if (!flash) return;
    const tmr = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(tmr);
  }, [flash]);

  if (!authed) return <NeedLogin />;

  const modules: Array<{ id: NotifyModule; label: string; icon: JSX.Element }> = [
    { id: "connectors", label: t("page.notify.module.connectors"), icon: <PlugZap className="h-5 w-5" /> },
    { id: "channels", label: t("page.notify.module.channels"), icon: <BellRing className="h-5 w-5" /> },
    { id: "outbound", label: t("page.notify.module.outbound"), icon: <Send className="h-5 w-5" /> },
    { id: "inbound", label: t("page.notify.module.inbound"), icon: <MessageSquareText className="h-5 w-5" /> },
    { id: "messages", label: t("page.notify.module.messages"), icon: <MessageSquareText className="h-5 w-5" /> },
  ];

  const refreshAll = () => {
    invalidate();
    if (module === "messages") void timeline.refetch();
  };

  const channelChart = useMemo(() => pieToRecord(charts.data?.by_channel), [charts.data]);
  const directionChart = useMemo(() => pieToRecord(charts.data?.by_direction), [charts.data]);

  return (
    <WorkbenchShell
      title={t("page.notify.title")}
      description={t("page.notify.subtitle")}
      actions={<RefreshButton onClick={refreshAll} pending={summary.isFetching || timeline.isFetching} />}
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.notify.channelsMetric"), value: summary.data?.channels ?? 0 },
            { label: t("page.notify.enabledMetric"), value: summary.data?.enabled ?? 0 },
            { label: t("page.notify.messagesMetric"), value: summary.data?.messages ?? 0 },
            { label: t("page.notify.last24h"), value: summary.data?.last_24h ?? 0 },
            { label: t("page.notify.failuresMetric"), value: summary.data?.failures ?? 0 },
          ]}
        />
      }
    >
    <div className="grid w-full gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-4 xl:self-start">
        <Card title={t("page.notify.modules")}>
          <div className="grid gap-2">
                {modules.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModule(m.id)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium ${module === m.id ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]" : "border-[var(--border)] text-[var(--muted-strong)]"}`}
                >
                  <span className="text-[var(--brand)]">{m.icon}</span>
                  {m.label}
                </button>
              ))}
          </div>
        </Card>
      </aside>

      <section className="min-w-0 space-y-4">
        {flash ? <FlashMessage kind={flash.kind} message={flash.message} onDismiss={() => setFlash(null)} /> : null}

        <div className="grid gap-4 md:grid-cols-2">
          {Object.keys(channelChart).length ? (
            <Card title={t("page.notify.channelDistribution")}>
              <Suspense fallback={null}>
                <EChartsDonutLazy data={channelChart} height={220} />
              </Suspense>
            </Card>
          ) : null}
          {Object.keys(directionChart).length ? (
            <Card title={t("page.notify.directionDistribution")}>
              <Suspense fallback={null}>
                <EChartsDonutLazy data={directionChart} height={220} />
              </Suspense>
            </Card>
          ) : null}
        </div>

        {module === "connectors" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card
              title={t("page.notify.connectors")}
              actions={<button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" onClick={invalidate}><RefreshCw className="h-4 w-4" />{t("common.refresh")}</button>}
            >
              {connectors.isLoading ? <LoadingBlock /> : null}
              {connectors.error ? <ErrorBlock message={(connectors.error as Error).message} /> : null}
              <Table
                rowKey={(row: any) => String(row.type)}
                size="middle"
                loading={connectors.isLoading}
                dataSource={connectors.data?.items ?? []}
                scroll={{ x: 1120 }}
                pagination={false}
                locale={{ emptyText: <EmptyState message={t("page.notify.noConnectors")} /> }}
                columns={[
                  {
                    title: t("page.notify.connector"),
                    dataIndex: "display_name",
                    width: 220,
                    render: (_: unknown, row: any) => (
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[var(--text)]">{row.display_name || row.name}</span>
                          <Tag color={row.maturity === "ga" ? "green" : row.maturity === "beta" ? "blue" : "default"}>{row.maturity}</Tag>
                        </div>
                        <p className="mt-1 font-mono text-xs text-[var(--muted)]">{row.type}</p>
                      </div>
                    ),
                  },
                  {
                    title: t("page.notify.direction"),
                    dataIndex: "direction",
                    width: 170,
                    render: (value: string[]) => <Space wrap>{(value ?? []).map((x) => <Tag key={x}>{x}</Tag>)}</Space>,
                  },
                  {
                    title: t("page.notify.auth"),
                    dataIndex: "auth",
                    width: 260,
                    render: (value: string[]) => <Space wrap>{(value ?? []).map((x) => <Tag key={x} color="purple">{x}</Tag>)}</Space>,
                  },
                  {
                    title: t("page.notify.events"),
                    dataIndex: "events",
                    render: (value: string[]) => <p className="line-clamp-2 text-xs text-[var(--muted-strong)]">{(value ?? []).join(", ")}</p>,
                  },
                  {
                    title: t("page.notify.configured"),
                    dataIndex: "configured_channels",
                    width: 120,
                    render: (value: number) => <span className="font-semibold text-[var(--text)]">{value ?? 0}</span>,
                  },
                  {
                    title: t("page.notify.actions"),
                    width: 220,
                    fixed: "right",
                    render: (_: unknown, row: any) => (
                      <Space wrap>
                        <Button size="small" icon={<Copy className="h-3.5 w-3.5" />} loading={loadCallback.isPending} onClick={() => loadCallback.mutate(row.type)}>{t("page.notify.callback")}</Button>
                        {row.signature ? (
                          <Button
                            size="small"
                            icon={<ShieldCheck className="h-3.5 w-3.5" />}
                            onClick={() => {
                              setVerifyDraft((v) => ({ ...v, connector: row.type }));
                              setVerifyResult(null);
                            }}
                          >
                            {t("page.notify.verify")}
                          </Button>
                        ) : null}
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>

            <div className="space-y-4">
              <Card title={t("page.notify.scope")}>
                <div className="space-y-2 text-sm">
                  {Object.entries(connectors.data?.scope ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                      <span className="text-[var(--muted)]">{k}</span>
                      <span className="truncate font-mono text-xs text-[var(--text)]">{String(v || "-")}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title={t("page.notify.signatureLab")}>
                <div className="space-y-2">
                  <select className={`${inputClass} w-full`} value={verifyDraft.connector} onChange={(e) => setVerifyDraft((v) => ({ ...v, connector: e.target.value }))}>
                    {(connectors.data?.items ?? []).filter((x: any) => x.signature).map((x: any) => <option key={x.type} value={x.type}>{x.display_name || x.name}</option>)}
                  </select>
                  <input className={`${inputClass} w-full`} placeholder={t("page.notify.secretPh")} value={verifyDraft.secret} onChange={(e) => setVerifyDraft((v) => ({ ...v, secret: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder={t("page.notify.timestampPh")} value={verifyDraft.timestamp} onChange={(e) => setVerifyDraft((v) => ({ ...v, timestamp: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder={t("page.notify.signaturePh")} value={verifyDraft.signature} onChange={(e) => setVerifyDraft((v) => ({ ...v, signature: e.target.value }))} />
                  <textarea className={`${inputClass} min-h-24 w-full`} placeholder={t("page.notify.bodyPh")} value={verifyDraft.body} onChange={(e) => setVerifyDraft((v) => ({ ...v, body: e.target.value }))} />
                  <Button block type="primary" loading={verify.isPending} disabled={!verifyDraft.secret.trim()} onClick={() => verify.mutate()}>{t("page.notify.generateSignature")}</Button>
                  {verifyResult ? (
                    <Alert
                      type={verifyResult.matched === false ? "warning" : "success"}
                      showIcon
                      message={verifyResult.matched === false ? t("page.notify.signatureMismatch") : t("page.notify.signatureReady")}
                      description={<Typography.Text copyable code>{verifyResult.expected_signature}</Typography.Text>}
                    />
                  ) : null}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {module === "channels" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card
              title={t("page.notify.channels")}
              actions={<button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" onClick={invalidate}><RefreshCw className="h-4 w-4" />{t("common.refresh")}</button>}
            >
              {channels.isLoading ? <LoadingBlock /> : null}
              {channels.error ? <ErrorBlock message={(channels.error as Error).message} /> : null}
              {(channels.data ?? []).length === 0 && !channels.isLoading && !channels.error ? (
                <EmptyState message={t("page.notify.empty")} />
              ) : (
                <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
                  <div className="grid grid-cols-[1fr_7rem_7rem_12rem] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                    <span>{t("page.notify.channel")}</span>
                    <span>{t("page.notify.type")}</span>
                    <span>{t("page.notify.status")}</span>
                    <span>{t("page.notify.actions")}</span>
                  </div>
                  {(channels.data ?? []).map((ch: any) => (
                    <div key={ch.name} className="grid grid-cols-[1fr_7rem_7rem_12rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--text)]">{ch.name}</p>
                        <p className="truncate text-xs text-[var(--muted)]">{(ch.events ?? []).join(", ")}</p>
                      </div>
                      <span className="text-xs text-[var(--muted-strong)]">{ch.type}</span>
                      <span className={ch.enabled ? "text-xs text-emerald-600" : "text-xs text-[var(--muted)]"}>{ch.enabled ? t("page.notify.enabled") : t("page.notify.disabled")}</span>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs" disabled={test.isPending} onClick={() => test.mutate(ch.name)}>{t("page.notify.test")}</button>
                        <button type="button" className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs" disabled={patch.isPending} onClick={() => patch.mutate({ name: ch.name, enabled: !ch.enabled })}>{ch.enabled ? t("page.notify.disable") : t("page.notify.enable")}</button>
                        <button type="button" className="rounded-lg border border-rose-500/30 px-2 py-1 text-xs text-rose-600" disabled={del.isPending} onClick={() => del.mutate(ch.name)}><Trash2 className="inline h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title={t("page.notify.add")}>
              <div className="space-y-2">
                <input className={`${inputClass} w-full`} placeholder={t("page.notify.namePh")} value={name} onChange={(e) => setName(e.target.value)} />
                <select className={`${inputClass} w-full`} value={type} onChange={(e) => setType(e.target.value)}>
                  {(templates.data?.items ?? []).map((x: any) => <option key={x.type} value={x.type}>{x.name}</option>)}
                  {!templates.data?.items?.length ? <><option value="dingtalk">DingTalk</option><option value="wechat_work">WeCom</option><option value="slack">Slack</option><option value="webhook">Webhook</option></> : null}
                </select>
                <input className={`${inputClass} w-full`} placeholder={t("page.notify.urlPh")} value={url} onChange={(e) => setUrl(e.target.value)} />
                <input className={`${inputClass} w-full`} placeholder={t("page.notify.eventsPh")} value={events} onChange={(e) => setEvents(e.target.value)} />
                <button type="button" className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!name.trim() || !url.trim() || add.isPending} onClick={() => add.mutate()}>{t("common.save")}</button>
              </div>
            </Card>
          </div>
        ) : null}

        {module === "messages" ? (
          <Card title={t("page.notify.messages")}>
            {timeline.data?.days?.length ? (
              <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <p className="mb-3 text-xs font-semibold text-[var(--text)]">{t("page.notify.timeline")}</p>
                <Timeline
                  items={timeline.data.days.map((day) => ({
                    children: (
                      <div>
                        <p className="text-sm font-medium text-[var(--text)]">
                          {day.date} <span className="text-[var(--muted)]">({day.count})</span>
                        </p>
                        <ul className="mt-2 space-y-1 text-xs text-[var(--muted-strong)]">
                          {day.items.slice(0, 5).map((ev: Record<string, unknown>) => (
                            <li key={String(ev.id)} className="font-mono">
                              {String(ev.direction || "")} · {String(ev.channel || "")} · {String(ev.title || ev.content || "").slice(0, 48)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                  }))}
                />
              </div>
            ) : null}
            {messages.isLoading ? <LoadingBlock /> : null}
            {messages.error ? <ErrorBlock message={(messages.error as Error).message} /> : null}
            <Table
              rowKey={(row: any) => String(row.id)}
              size="middle"
              loading={messages.isLoading}
              dataSource={messages.data?.items ?? []}
              scroll={{ x: 980 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{ emptyText: <EmptyState message={t("page.notify.noMessages")} /> }}
              columns={[
                {
                  title: t("page.notify.message"),
                  dataIndex: "title",
                  render: (_: unknown, row: any) => (
                    <div className="min-w-[22rem]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[var(--text)]">{row.title || row.event || row.channel}</span>
                        <Tag color={row.direction === "inbound" ? "blue" : row.direction === "internal" ? "purple" : "green"}>{row.direction}</Tag>
                        <Tag color={row.ok === false ? "red" : "success"}>{row.ok === false ? "failed" : "ok"}</Tag>
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-[var(--muted-strong)]">{row.content || row.text || row.error || row.reason}</p>
                      <p className="mt-1 font-mono text-xs text-[var(--muted)]">{row.id}</p>
                    </div>
                  ),
                },
                { title: t("page.notify.channel"), dataIndex: "channel", width: 160 },
                { title: "ts", dataIndex: "ts", width: 180 },
                {
                  title: t("page.notify.actions"),
                  width: 260,
                  fixed: "right",
                  render: (_: unknown, row: any) => (
                    row.direction === "inbound" ? (
                      <Space wrap>
                        <Button size="small" loading={inboundAction.isPending} onClick={() => inboundAction.mutate({ id: row.id, action: "task", dryRun: true })}>{t("page.notify.previewTask")}</Button>
                        <Button size="small" type="primary" loading={inboundAction.isPending} onClick={() => inboundAction.mutate({ id: row.id, action: "task", dryRun: false })}>{t("page.notify.createTask")}</Button>
                        <Button size="small" loading={inboundAction.isPending} onClick={() => inboundAction.mutate({ id: row.id, action: "requirement", dryRun: false })}>{t("page.notify.createRequirement")}</Button>
                      </Space>
                    ) : null
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {module === "outbound" ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title={t("page.notify.sendTest")}>
              <div className="space-y-2">
                <select className={`${inputClass} w-full`} value={sendDraft.channel} onChange={(e) => setSendDraft((v) => ({ ...v, channel: e.target.value }))}>
                  <option value="">{t("page.notify.pickChannel")}</option>
                  {(channels.data ?? []).map((ch: any) => <option key={ch.name} value={ch.name}>{ch.name}</option>)}
                </select>
                <input className={`${inputClass} w-full`} placeholder={t("page.notify.titlePh")} value={sendDraft.title} onChange={(e) => setSendDraft((v) => ({ ...v, title: e.target.value }))} />
                <textarea className={`${inputClass} min-h-28 w-full`} placeholder={t("page.notify.contentPh")} value={sendDraft.content} onChange={(e) => setSendDraft((v) => ({ ...v, content: e.target.value }))} />
                <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!sendDraft.channel || !sendDraft.title.trim() || send.isPending} onClick={() => send.mutate()}><Send className="h-4 w-4" />{t("page.notify.send")}</button>
              </div>
            </Card>
            <Card title={t("page.notify.outboundMessages")}>
              <Table
                rowKey={(row: any) => String(row.id)}
                size="middle"
                loading={outboundMessages.isLoading}
                dataSource={outboundMessages.data?.items ?? []}
                scroll={{ x: 780 }}
                pagination={{ pageSize: 8, showSizeChanger: true }}
                locale={{ emptyText: <EmptyState message={t("page.notify.noMessages")} /> }}
                columns={[
                  {
                    title: t("page.notify.message"),
                    dataIndex: "title",
                    render: (_: unknown, row: any) => (
                      <div className="min-w-[18rem]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[var(--text)]">{row.title || row.event || row.channel}</span>
                          <Tag color={row.ok === false ? "red" : "success"}>{row.ok === false ? "failed" : "ok"}</Tag>
                        </div>
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-[var(--muted-strong)]">{row.content || row.error || row.reason}</p>
                      </div>
                    ),
                  },
                  { title: t("page.notify.channel"), dataIndex: "channel", width: 140 },
                  { title: "ts", dataIndex: "ts", width: 180 },
                ]}
              />
            </Card>
          </div>
        ) : null}

        {module === "inbound" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card title={t("page.notify.inboundMessages")}>
              <Table
                rowKey={(row: any) => String(row.id)}
                size="middle"
                loading={inboundMessages.isLoading}
                dataSource={inboundMessages.data?.items ?? []}
                scroll={{ x: 980 }}
                pagination={{ pageSize: 8, showSizeChanger: true }}
                locale={{ emptyText: <EmptyState message={t("page.notify.noMessages")} /> }}
                columns={[
                  {
                    title: t("page.notify.message"),
                    dataIndex: "title",
                    render: (_: unknown, row: any) => (
                      <div className="min-w-[22rem]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[var(--text)]">{row.title || row.event || row.channel}</span>
                          <Tag color="blue">{row.direction}</Tag>
                          <Tag color={row.ok === false ? "red" : "success"}>{row.ok === false ? "failed" : "ok"}</Tag>
                        </div>
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-[var(--muted-strong)]">{row.content || row.text || row.error || row.reason}</p>
                        <p className="mt-1 font-mono text-xs text-[var(--muted)]">{row.id}</p>
                      </div>
                    ),
                  },
                  { title: t("page.notify.channel"), dataIndex: "channel", width: 160 },
                  { title: "ts", dataIndex: "ts", width: 180 },
                  {
                    title: t("page.notify.actions"),
                    width: 260,
                    fixed: "right",
                    render: (_: unknown, row: any) => (
                      <Space wrap>
                        <Button size="small" loading={inboundAction.isPending} onClick={() => inboundAction.mutate({ id: row.id, action: "task", dryRun: true })}>{t("page.notify.previewTask")}</Button>
                        <Button size="small" type="primary" loading={inboundAction.isPending} onClick={() => inboundAction.mutate({ id: row.id, action: "task", dryRun: false })}>{t("page.notify.createTask")}</Button>
                        <Button size="small" loading={inboundAction.isPending} onClick={() => inboundAction.mutate({ id: row.id, action: "requirement", dryRun: false })}>{t("page.notify.createRequirement")}</Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
            <Card title={t("page.notify.inbound")}>
              <div className="space-y-2">
                <input className={`${inputClass} w-full`} value={inboundDraft.channel} onChange={(e) => setInboundDraft((v) => ({ ...v, channel: e.target.value }))} />
                <input className={`${inputClass} w-full`} value={inboundDraft.sender} onChange={(e) => setInboundDraft((v) => ({ ...v, sender: e.target.value }))} />
                <textarea className={`${inputClass} min-h-28 w-full`} placeholder={t("page.notify.inboundPh")} value={inboundDraft.text} onChange={(e) => setInboundDraft((v) => ({ ...v, text: e.target.value }))} />
                <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={!inboundDraft.text.trim() || inbound.isPending} onClick={() => inbound.mutate()}><CheckCircle2 className="h-4 w-4" />{t("page.notify.saveInbound")}</button>
              </div>
            </Card>
          </div>
        ) : null}
      </section>
    </div>
      <Modal
        open={Boolean(actionResult?.dry_run)}
        title={t("page.notify.actionPreview")}
        onCancel={() => setActionResult(null)}
        footer={<Button type="primary" onClick={() => setActionResult(null)}>{t("common.close")}</Button>}
        width={760}
      >
        {actionResult?.item ? (
          <div className="space-y-3">
            <Alert type="info" showIcon message={actionResult.item.title} />
            <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(actionResult.item, null, 2)}</pre>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={Boolean(callbackResult)}
        title={t("page.notify.callbackTemplate")}
        onCancel={() => setCallbackResult(null)}
        footer={<Button type="primary" onClick={() => setCallbackResult(null)}>{t("common.close")}</Button>}
        width={820}
      >
        {callbackResult ? (
          <div className="space-y-3">
            <Alert type="info" showIcon message={callbackResult.callback_url || callbackResult.callback_path} />
            <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(callbackResult, null, 2)}</pre>
          </div>
        ) : null}
      </Modal>
    </WorkbenchShell>
  );
}
