import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, Input, InputNumber, Select, Space, Table, Tag as AntTag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Bot, CheckCircle2, Clock, GitBranch, Play, RefreshCw, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";
import { buildSchedulePayload, derivePacketStats, toggleTemplateSelection } from "./dataDevModel";

type Tab = "templates" | "schedules" | "agent_feed" | "evidence" | "runbook";
type LegacyTab = "sql_editor" | "spark_jobs" | "flink_jobs" | "schedules";
type FocusKey = Tab | LegacyTab;

const TAB_KEYS: Tab[] = ["templates", "schedules", "agent_feed", "evidence", "runbook"];
const FOCUS_KEYS: FocusKey[] = ["templates", "sql_editor", "spark_jobs", "flink_jobs", "schedules", "agent_feed", "evidence", "runbook"];
const TAB_HREF: Record<Tab, string> = {
  templates: "#/data/dev",
  schedules: "#/data/dev/schedules",
  agent_feed: "#/data/dev/agent-feed",
  evidence: "#/data/dev/evidence",
  runbook: "#/data/dev/runbook",
};
const FOCUS_HREF: Record<FocusKey, string> = {
  ...TAB_HREF,
  sql_editor: "#/data/dev/sql_editor",
  spark_jobs: "#/data/dev/spark_jobs",
  flink_jobs: "#/data/dev/flink_jobs",
};

const ENGINES = ["SQL", "Spark", "Flink", "Python", "dbt"];
const POLICIES = ["quality_first", "balanced", "throughput", "cost_saver"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];
const DECISIONS = ["pass", "warn", "block"];
const FOCUS_META: Record<FocusKey, { titleKey: string; descriptionKey: string; focusKey: string; engine?: string }> = {
  templates: {
    titleKey: "page.dataDev.modules.templates.title",
    descriptionKey: "page.dataDev.modules.templates.description",
    focusKey: "page.dataDev.modules.templates.focus",
  },
  schedules: {
    titleKey: "page.dataDev.modules.schedules.title",
    descriptionKey: "page.dataDev.modules.schedules.description",
    focusKey: "page.dataDev.modules.schedules.focus",
  },
  agent_feed: {
    titleKey: "page.dataDev.modules.agent_feed.title",
    descriptionKey: "page.dataDev.modules.agent_feed.description",
    focusKey: "page.dataDev.modules.agent_feed.focus",
  },
  evidence: {
    titleKey: "page.dataDev.modules.evidence.title",
    descriptionKey: "page.dataDev.modules.evidence.description",
    focusKey: "page.dataDev.modules.evidence.focus",
  },
  runbook: {
    titleKey: "page.dataDev.modules.runbook.title",
    descriptionKey: "page.dataDev.modules.runbook.description",
    focusKey: "page.dataDev.modules.runbook.focus",
  },
  sql_editor: {
    titleKey: "page.dataDev.modules.sql_editor.title",
    descriptionKey: "page.dataDev.modules.sql_editor.description",
    focusKey: "page.dataDev.modules.sql_editor.focus",
    engine: "SQL",
  },
  spark_jobs: {
    titleKey: "page.dataDev.modules.spark_jobs.title",
    descriptionKey: "page.dataDev.modules.spark_jobs.description",
    focusKey: "page.dataDev.modules.spark_jobs.focus",
    engine: "Spark",
  },
  flink_jobs: {
    titleKey: "page.dataDev.modules.flink_jobs.title",
    descriptionKey: "page.dataDev.modules.flink_jobs.description",
    focusKey: "page.dataDev.modules.flink_jobs.focus",
    engine: "Flink",
  },
};

function normalizeTab(tab?: Tab | LegacyTab): Tab {
  if (tab === "schedules") return "schedules";
  if (tab === "sql_editor" || tab === "spark_jobs" || tab === "flink_jobs") return "templates";
  return tab ?? "templates";
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function shortDate(value?: string) {
  return value ? value.slice(0, 19).replace("T", " ") : "-";
}

function statusColor(status?: string) {
  if (status === "applied" || status === "completed" || status === "pass" || status === "success" || status === "ready") return "green";
  if (status === "archived" || status === "blocked" || status === "block" || status === "failed") return "red";
  if (status === "running" || status === "warn" || status === "claimed") return "gold";
  return "default";
}

function listTags(items?: string[], color = "geekblue") {
  const values = Array.isArray(items) ? items : [];
  if (!values.length) return <span className="text-xs text-[var(--muted)]">-</span>;
  return <Space size={[0, 4]} wrap>{values.map((item) => <AntTag key={item} color={color}>{item}</AntTag>)}</Space>;
}

export function DataDevWorkbench({ focused = false, initialTab }: { focused?: boolean; initialTab?: Tab | LegacyTab }) {
  const authed = Boolean(getToken());
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(normalizeTab(initialTab));
  const focusKey: FocusKey = focused && initialTab && tab === normalizeTab(initialTab) ? initialTab : tab;
  const [aiOpen, setAiOpen] = useState(false);
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scheduleId, setScheduleId] = useState("");
  const [packetFilter, setPacketFilter] = useState("");
  const [decision, setDecision] = useState("");
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<any>(null);
  const [runbookResult, setRunbookResult] = useState<any>(null);
  const [templateForm, setTemplateForm] = useState({
    id: "",
    name: "",
    engine: "SQL",
    status: "active",
    priority: "P1",
    owner: "Data Platform Agent",
    dev_tool: "codex",
    assets: "",
    quality_gates: "schema_valid,owner_declared,quality_report",
    description: "",
  });
  const [scheduleForm, setScheduleForm] = useState({
    dryRun: true,
    maxParallel: 4,
    policy: "quality_first",
    priority: "P1",
    assignedTo: "Data Platform Agent",
    devTool: "codex",
  });
  const [reportForm, setReportForm] = useState({
    agent: "Data Platform Agent",
    summary: t("page.dataDev.agentFeed.defaultSummary"),
    artifactUrl: "",
  });

  useEffect(() => {
    setTab(normalizeTab(initialTab));
    setShowTemplateForm(false);
  }, [initialTab]);

  const templatesQ = useQuery({ queryKey: ["dataDevTemplates", q], queryFn: () => api.analyticsDevTemplates("", q), enabled: authed });
  const opsQ = useQuery({ queryKey: ["dataDevOpsSummary"], queryFn: api.analyticsDevOpsSummary, enabled: authed });
  const schedulesQ = useQuery({ queryKey: ["dataDevSchedules", q], queryFn: () => api.analyticsDevSchedules(30, q), enabled: authed && tab === "schedules" });
  const agentFeedQ = useQuery({
    queryKey: ["dataDevAgentFeed", scheduleId, packetFilter],
    queryFn: () => api.analyticsDevAgentFeed(40, scheduleId, packetFilter, true),
    enabled: authed && tab === "agent_feed",
  });
  const evidenceQ = useQuery({
    queryKey: ["dataDevEvidence", scheduleId, packetFilter, decision],
    queryFn: () => api.analyticsDevEvidence(60, scheduleId, packetFilter, decision),
    enabled: authed && tab === "evidence",
  });

  const templates = templatesQ.data?.items ?? [];
  const schedules = schedulesQ.data?.items ?? [];
  const packets = agentFeedQ.data?.items ?? [];
  const evidence = evidenceQ.data?.items ?? [];
  const activeMetaDef = FOCUS_META[focusKey] ?? FOCUS_META[tab];
  const activeMeta = {
    title: t(activeMetaDef.titleKey),
    description: t(activeMetaDef.descriptionKey),
    focus: t(activeMetaDef.focusKey),
  };
  const visibleTemplates = activeMetaDef.engine && tab === "templates"
    ? templates.filter((tpl: any) => String(tpl.engine ?? "").toLowerCase() === activeMetaDef.engine?.toLowerCase())
    : templates;
  const packetStats = useMemo(() => derivePacketStats(packets), [packets]);
  const tabLabel = (tabId: Tab) => {
    if (tabId === "templates") return `${t("page.dataDev.tabs.templates")} (${templates.length})`;
    if (tabId === "schedules") return `${t("page.dataDev.tabs.schedules")} (${schedules.length})`;
    if (tabId === "agent_feed") return `${t("page.dataDev.tabs.agent_feed")} (${packets.length})`;
    if (tabId === "evidence") return `${t("page.dataDev.tabs.evidence")} (${evidence.length})`;
    return t("page.dataDev.tabs.runbook");
  };

  const upsertTemplate = useMutation({
    mutationFn: () => api.analyticsUpsertDevTemplate({
      ...templateForm,
      id: templateForm.id.trim(),
      name: templateForm.name.trim(),
      assets: splitCsv(templateForm.assets),
      quality_gates: splitCsv(templateForm.quality_gates),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dataDevTemplates"] });
      setShowTemplateForm(false);
      setTemplateForm((prev) => ({ ...prev, id: "", name: "", description: "" }));
    },
  });

  const createTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.analyticsDevTemplateTasks({
      ids: selectedIds,
      dry_run: dryRun,
      priority: scheduleForm.priority,
      assigned_to: scheduleForm.assignedTo,
      dev_tool: scheduleForm.devTool,
    }),
  });

  const scheduleMut = useMutation({
    mutationFn: (dryRun: boolean) => api.analyticsDevSchedule(buildSchedulePayload({ ...scheduleForm, selectedIds, dryRun })),
    onSuccess: (data) => {
      setScheduleResult(data);
      if (!data?.dry_run) {
        void qc.invalidateQueries({ queryKey: ["dataDevSchedules"] });
        void qc.invalidateQueries({ queryKey: ["dataDevAgentFeed"] });
      }
    },
  });

  const scheduleAction = useMutation({
    mutationFn: ({ id, action, dryRun = true }: { id: string; action: "rerun" | "cancel" | "archive" | "restore"; dryRun?: boolean }) =>
      api.analyticsDevScheduleAction(id, {
        action,
        dry_run: dryRun,
        max_parallel: scheduleForm.maxParallel,
        policy: scheduleForm.policy,
        priority: scheduleForm.priority,
        assigned_to: scheduleForm.assignedTo,
        dev_tool: scheduleForm.devTool,
        note: "manager-web:data-development",
      }),
    onSuccess: (data) => {
      setScheduleResult(data);
      void qc.invalidateQueries({ queryKey: ["dataDevSchedules"] });
      void qc.invalidateQueries({ queryKey: ["dataDevAgentFeed"] });
    },
  });

  const packetAction = useMutation({
    mutationFn: ({ packet, action }: { packet: any; action: "claim" | "heartbeat" | "report" }) =>
      api.analyticsDevAgentFeedAction({
        schedule_id: packet.schedule_id,
        packet_id: packet.packet_id,
        action,
        agent: reportForm.agent,
        progress: action === "claim" ? 5 : action === "heartbeat" ? 50 : 100,
        status: action === "report" ? "completed" : "running",
        summary: action === "report" ? reportForm.summary : "",
        artifact_url: action === "report" ? reportForm.artifactUrl : "",
        evidence: action === "report" ? [{ type: "manager-web", note: reportForm.summary }] : [],
        note: "manager-web:data-development",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dataDevAgentFeed"] });
      void qc.invalidateQueries({ queryKey: ["dataDevEvidence"] });
    },
  });

  const evidenceTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.analyticsDevEvidenceTasks({
      schedule_id: scheduleId,
      packet_id: packetFilter,
      decisions: decision ? [decision] : ["block", "warn"],
      dry_run: dryRun,
      priority: "P1",
      assigned_to: "Data Quality Agent",
      dev_tool: "codex",
    }),
  });

  const runbook = useMutation({
    mutationFn: (dryRun: boolean) => api.analyticsDevRunbook({
      schedule_id: scheduleId,
      packet_id: packetFilter,
      decisions: decision ? [decision] : ["block", "warn"],
      include_unclaimed: true,
      dry_run: dryRun,
      priority: "P1",
      assigned_to: "Data Automation Agent",
      dev_tool: "codex",
    }),
    onSuccess: setRunbookResult,
  });

  const templateColumns: ColumnsType<any> = [
    {
      title: t("page.dataDev.templates.choose"),
      key: "choose",
      width: 80,
      render: (_value, row) => <Checkbox checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((ids) => toggleTemplateSelection(ids, row.id))} />,
    },
    {
      title: t("page.dataDev.templates.template"),
      dataIndex: "name",
      render: (_value, row) => (
        <div className="min-w-[220px]">
          <p className="font-semibold text-[var(--text)]">{row.name}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{row.description || row.id}</p>
        </div>
      ),
    },
    { title: t("page.dataDev.templates.engine"), dataIndex: "engine", width: 110, render: (value) => <AntTag color="blue">{value || "-"}</AntTag> },
    { title: t("page.dataDev.templates.priority"), dataIndex: "priority", width: 100, render: (value) => <AntTag>{value || "-"}</AntTag> },
    {
      title: t("page.dataDev.templates.ownerTool"),
      key: "ownerTool",
      width: 210,
      render: (_value, row) => <span className="text-xs text-[var(--muted)]">{row.owner || "-"} / {row.dev_tool || "-"}</span>,
    },
    {
      title: t("page.dataDev.templates.qualityGates"),
      dataIndex: "quality_gates",
      render: (items) => listTags(items, "purple"),
    },
  ];

  const scheduleColumns: ColumnsType<any> = [
    { title: t("page.dataDev.schedules.id"), dataIndex: "id", render: (value) => <span className="font-mono text-xs">{value}</span> },
    { title: t("page.dataDev.schedules.status"), dataIndex: "status", width: 110, render: (value) => <AntTag color={statusColor(value)}>{value || "-"}</AntTag> },
    { title: t("page.dataDev.schedules.policyColumn"), dataIndex: "policy", width: 140 },
    {
      title: t("page.dataDev.schedules.countColumn"),
      key: "counts",
      width: 150,
      render: (_value, row) => <span className="text-xs text-[var(--muted)]">{row.templates ?? 0} / {row.packets ?? 0} / {row.created_tasks ?? 0}</span>,
    },
    { title: t("page.dataDev.schedules.createdAt"), dataIndex: "created_at", width: 180, render: (value) => <span className="text-xs text-[var(--muted)]">{shortDate(value)}</span> },
    {
      title: t("common.actions"),
      key: "actions",
      width: 250,
      render: (_value, row) => (
        <Space wrap>
          <Button size="small" type="link" onClick={() => { setScheduleId(row.id); setTab("agent_feed"); }}>{t("page.dataDev.schedules.agentFeed")}</Button>
          <Button size="small" type="link" loading={scheduleAction.isPending} onClick={() => scheduleAction.mutate({ id: row.id, action: "rerun", dryRun: true })}>{t("page.dataDev.schedules.previewRerun")}</Button>
          <Button size="small" type="link" loading={scheduleAction.isPending} onClick={() => scheduleAction.mutate({ id: row.id, action: row.status === "archived" ? "restore" : "archive", dryRun: false })}>
            {row.status === "archived" ? t("page.dataDev.schedules.restore") : t("page.dataDev.schedules.archive")}
          </Button>
        </Space>
      ),
    },
  ];

  const packetColumns: ColumnsType<any> = [
    {
      title: t("page.dataDev.agentFeed.packet"),
      key: "packet",
      render: (_value, row) => (
        <div className="min-w-[200px]">
          <p className="font-mono text-xs text-[var(--text)]">{row.packet_id}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{row.title || row.template_id}</p>
        </div>
      ),
    },
    { title: t("page.dataDev.agentFeed.status"), dataIndex: "ready", width: 100, render: (ready) => <AntTag color={ready ? "green" : "red"}>{ready ? "ready" : "blocked"}</AntTag> },
    {
      title: t("page.dataDev.agentFeed.agentLane"),
      key: "agentLane",
      width: 210,
      render: (_value, row) => <span className="text-xs text-[var(--muted)]">{row.assigned_to || "-"} / {row.lane || "-"}</span>,
    },
    { title: t("page.dataDev.agentFeed.qualityGates"), dataIndex: "quality_gates", render: (items) => listTags(items, "purple") },
    {
      title: t("page.dataDev.agentFeed.report"),
      key: "report",
      width: 120,
      render: (_value, row) => <AntTag color={statusColor(row.report?.status || row.claim?.status)}>{row.report?.status || row.claim?.status || "-"}</AntTag>,
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 220,
      render: (_value, row) => (
        <Space wrap>
          <Button size="small" type="link" disabled={!row.ready} loading={packetAction.isPending} onClick={() => packetAction.mutate({ packet: row, action: "claim" })}>{t("page.dataDev.agentFeed.claim")}</Button>
          <Button size="small" type="link" loading={packetAction.isPending} onClick={() => packetAction.mutate({ packet: row, action: "heartbeat" })}>{t("page.dataDev.agentFeed.heartbeat")}</Button>
          <Button size="small" type="link" loading={packetAction.isPending} onClick={() => packetAction.mutate({ packet: row, action: "report" })}>{t("page.dataDev.agentFeed.reportEvidence")}</Button>
        </Space>
      ),
    },
  ];

  const evidenceColumns: ColumnsType<any> = [
    {
      title: t("page.dataDev.evidence.packet"),
      key: "packet",
      render: (_value, row) => (
        <div className="min-w-[220px]">
          <p className="font-semibold text-[var(--text)]">{row.title || row.packet_id}</p>
          <p className="mt-0.5 font-mono text-xs text-[var(--muted)]">{row.schedule_id} / {row.packet_id}</p>
        </div>
      ),
    },
    { title: t("page.dataDev.evidence.decision"), dataIndex: ["quality", "decision"], width: 110, render: (value) => <AntTag color={statusColor(value)}>{value || "-"}</AntTag> },
    { title: t("page.dataDev.evidence.score"), dataIndex: ["quality", "score"], width: 90, render: (value) => value ?? "-" },
    { title: t("page.dataDev.evidence.missingGates"), dataIndex: ["quality", "missing_required_gates"], render: (items) => listTags(items, "red") },
    { title: t("page.dataDev.evidence.artifact"), dataIndex: "artifact_url", render: (value) => value ? <a href={value} target="_blank" rel="noreferrer" className="text-xs text-[var(--brand)]">{value}</a> : <span className="text-xs text-[var(--muted)]">-</span> },
  ];

  if (!authed) return <NeedLogin />;

  const summary = opsQ.data?.summary ?? templatesQ.data?.summary ?? {};
  const canSchedule = selectedIds.length > 0 && !scheduleMut.isPending;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={focused ? activeMeta.title : t("page.dataDev.title")}
        description={focused ? activeMeta.description : t("page.dataDev.desc")}
        actions={<AiAssistButton onClick={() => setAiOpen(true)} />}
        metrics={
          <WorkbenchStats items={[
            { label: t("page.dataDev.metrics.templates"), value: summary.dev_templates ?? templates.length ?? 0 },
            { label: t("page.dataDev.metrics.schedules"), value: summary.schedules ?? schedules.length ?? 0 },
            { label: t("page.dataDev.metrics.readyPackets"), value: summary.ready_unclaimed ?? packetStats.ready ?? 0 },
            { label: t("page.dataDev.metrics.qualityBlocked"), value: summary.quality_blocked ?? 0, trend: (summary.quality_blocked ?? 0) > 0 ? "down" : "neutral" },
          ]} />
        }
      />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
        {focused ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.dataDev.focusedTag")}</span>
                {activeMetaDef.engine ? <AntTag color="blue">{activeMetaDef.engine}</AntTag> : null}
                <a href="#/data/dev" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.dataDev.backToHub")}</a>
                <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.dataDev.focusedHint")}</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[var(--text)]">{activeMeta.focus}</p>
            </div>
            <Select
              className="min-w-56"
              value={focusKey}
              options={FOCUS_KEYS.map((key) => ({ value: key, label: t(FOCUS_META[key].titleKey) }))}
              onChange={(next) => { window.location.hash = FOCUS_HREF[next as FocusKey].slice(1); }}
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap gap-1">
            {TAB_KEYS.map((tabId) => (
              <Button key={tabId} type={tab === tabId ? "primary" : "text"} onClick={() => { setTab(tabId); setShowTemplateForm(false); }}>
                {tabLabel(tabId)}
              </Button>
            ))}
          </div>
        )}
      </div>

      {tab === "templates" ? (
        <WorkbenchPanel
          title={t("page.dataDev.panels.templates")}
          actions={
            <Space wrap>
              <Input.Search className="min-w-72" allowClear value={q} onChange={(event) => setQ(event.target.value)} placeholder={t("page.dataDev.templates.search")} />
              <RefreshButton onClick={() => void templatesQ.refetch()} pending={templatesQ.isFetching} />
              <Button type="primary" onClick={() => setShowTemplateForm((value) => !value)}>{t("page.dataDev.templates.create")}</Button>
            </Space>
          }
        >
          {showTemplateForm ? (
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Input placeholder={t("page.dataDev.templates.idRequired")} value={templateForm.id} onChange={(event) => setTemplateForm((value) => ({ ...value, id: event.target.value }))} />
                <Input placeholder={t("page.dataDev.templates.nameRequired")} value={templateForm.name} onChange={(event) => setTemplateForm((value) => ({ ...value, name: event.target.value }))} />
                <Select value={templateForm.engine} options={ENGINES.map((engine) => ({ value: engine, label: engine }))} onChange={(engine) => setTemplateForm((value) => ({ ...value, engine }))} />
                <Select value={templateForm.priority} options={PRIORITIES.map((priority) => ({ value: priority, label: priority }))} onChange={(priority) => setTemplateForm((value) => ({ ...value, priority }))} />
                <Input placeholder={t("page.dataDev.templates.owner")} value={templateForm.owner} onChange={(event) => setTemplateForm((value) => ({ ...value, owner: event.target.value }))} />
                <Input placeholder={t("page.dataDev.templates.devTool")} value={templateForm.dev_tool} onChange={(event) => setTemplateForm((value) => ({ ...value, dev_tool: event.target.value }))} />
                <Input className="md:col-span-3" placeholder={t("page.dataDev.templates.assetsPlaceholder")} value={templateForm.assets} onChange={(event) => setTemplateForm((value) => ({ ...value, assets: event.target.value }))} />
                <Input className="md:col-span-3" placeholder={t("page.dataDev.templates.qualityGatesPlaceholder")} value={templateForm.quality_gates} onChange={(event) => setTemplateForm((value) => ({ ...value, quality_gates: event.target.value }))} />
                <Input.TextArea className="md:col-span-3" rows={3} placeholder={t("page.dataDev.templates.descriptionPlaceholder")} value={templateForm.description} onChange={(event) => setTemplateForm((value) => ({ ...value, description: event.target.value }))} />
              </div>
              <Space className="mt-3" wrap>
                <Button type="primary" disabled={!templateForm.id.trim() || !templateForm.name.trim()} loading={upsertTemplate.isPending} onClick={() => upsertTemplate.mutate()}>
                  {t("page.dataDev.templates.save")}
                </Button>
                <Button onClick={() => setShowTemplateForm(false)}>{t("common.cancel")}</Button>
              </Space>
            </div>
          ) : null}

          <Table rowKey="id" size="middle" columns={templateColumns} dataSource={visibleTemplates} loading={templatesQ.isFetching} pagination={{ pageSize: 8 }} locale={{ emptyText: activeMetaDef.engine ? t("page.dataDev.emptyEngineTemplates") : t("page.dataDev.templates.empty") }} />

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <span className="text-sm text-[var(--muted)]">{t("page.dataDev.templates.selectedCount", { count: selectedIds.length })}</span>
            <Button disabled={!selectedIds.length} loading={createTasks.isPending} onClick={() => createTasks.mutate(true)}>{t("page.dataDev.templates.previewTasks")}</Button>
            <Button type="primary" disabled={!selectedIds.length} loading={createTasks.isPending} onClick={() => createTasks.mutate(false)}>{t("page.dataDev.templates.createTasks")}</Button>
            {createTasks.data ? <span className="text-xs text-[var(--muted)]">{t("page.dataDev.templates.taskResult", { count: (createTasks.data as any).items?.length ?? (createTasks.data as any).created ?? 0 })}</span> : null}
          </div>
        </WorkbenchPanel>
      ) : null}

      {tab === "schedules" ? (
        <WorkbenchPanel title={t("page.dataDev.panels.schedules")} actions={<RefreshButton onClick={() => void schedulesQ.refetch()} pending={schedulesQ.isFetching} />}>
          <div className="mb-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 md:grid-cols-6">
            <Select value={scheduleForm.policy} options={POLICIES.map((policy) => ({ value: policy, label: policy }))} onChange={(policy) => setScheduleForm((value) => ({ ...value, policy }))} />
            <InputNumber min={1} max={20} value={scheduleForm.maxParallel} onChange={(maxParallel) => setScheduleForm((value) => ({ ...value, maxParallel: Number(maxParallel ?? 1) }))} />
            <Select value={scheduleForm.priority} options={PRIORITIES.map((priority) => ({ value: priority, label: priority }))} onChange={(priority) => setScheduleForm((value) => ({ ...value, priority }))} />
            <Input value={scheduleForm.assignedTo} placeholder={t("page.dataDev.schedules.assignedTo")} onChange={(event) => setScheduleForm((value) => ({ ...value, assignedTo: event.target.value }))} />
            <Input value={scheduleForm.devTool} placeholder={t("page.dataDev.schedules.devTool")} onChange={(event) => setScheduleForm((value) => ({ ...value, devTool: event.target.value }))} />
            <Space wrap>
              <Button disabled={!canSchedule} icon={<Sparkles className="h-4 w-4" />} loading={scheduleMut.isPending} onClick={() => scheduleMut.mutate(true)}>{t("page.dataDev.schedules.preview")}</Button>
              <Button type="primary" disabled={!canSchedule} icon={<Play className="h-4 w-4" />} loading={scheduleMut.isPending} onClick={() => scheduleMut.mutate(false)}>{t("page.dataDev.schedules.apply")}</Button>
            </Space>
          </div>

          {scheduleResult ? (
            <Alert
              className="mb-4"
              type="info"
              showIcon
              message={t("page.dataDev.schedules.result", { id: scheduleResult.schedule_id || scheduleResult.item?.id || "-" })}
              description={t("page.dataDev.schedules.resultDesc", {
                dryRun: String(scheduleResult.dry_run ?? false),
                packets: scheduleResult.agent_packets?.length ?? scheduleResult.summary?.packets ?? 0,
                tasks: scheduleResult.created ?? scheduleResult.summary?.created_tasks ?? 0,
              })}
            />
          ) : null}

          <Table rowKey="id" size="middle" columns={scheduleColumns} dataSource={schedules} loading={schedulesQ.isFetching} pagination={{ pageSize: 8 }} locale={{ emptyText: t("page.dataDev.schedules.empty") }} />
        </WorkbenchPanel>
      ) : null}

      {tab === "agent_feed" ? (
        <WorkbenchPanel title={t("page.dataDev.panels.agentFeed")} actions={<RefreshButton onClick={() => void agentFeedQ.refetch()} pending={agentFeedQ.isFetching} />}>
          <div className="mb-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 lg:grid-cols-5">
            <Input placeholder={t("page.dataDev.agentFeed.scheduleId")} value={scheduleId} onChange={(event) => setScheduleId(event.target.value)} />
            <Input placeholder={t("page.dataDev.agentFeed.filter")} value={packetFilter} onChange={(event) => setPacketFilter(event.target.value)} />
            <Input placeholder={t("page.dataDev.agentFeed.agent")} value={reportForm.agent} onChange={(event) => setReportForm((value) => ({ ...value, agent: event.target.value }))} />
            <Input placeholder={t("page.dataDev.agentFeed.artifactUrl")} value={reportForm.artifactUrl} onChange={(event) => setReportForm((value) => ({ ...value, artifactUrl: event.target.value }))} />
            <Input placeholder={t("page.dataDev.agentFeed.summary")} value={reportForm.summary} onChange={(event) => setReportForm((value) => ({ ...value, summary: event.target.value }))} />
          </div>
          <WorkbenchStats items={[
            { label: t("page.dataDev.agentFeed.ready"), value: packetStats.ready },
            { label: t("page.dataDev.agentFeed.blocked"), value: packetStats.blocked, trend: packetStats.blocked > 0 ? "down" : "neutral" },
            { label: t("page.dataDev.agentFeed.claimed"), value: packetStats.claimed },
            { label: t("page.dataDev.agentFeed.reported"), value: packetStats.reported },
          ]} />
          <div className="mt-4">
            <Table rowKey={(row) => `${row.schedule_id}:${row.packet_id}`} size="middle" columns={packetColumns} dataSource={packets} loading={agentFeedQ.isFetching} pagination={{ pageSize: 8 }} locale={{ emptyText: t("page.dataDev.agentFeed.empty") }} />
          </div>
        </WorkbenchPanel>
      ) : null}

      {tab === "evidence" ? (
        <WorkbenchPanel title={t("page.dataDev.panels.evidence")} actions={<RefreshButton onClick={() => void evidenceQ.refetch()} pending={evidenceQ.isFetching} />}>
          <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <Input className="max-w-72" placeholder={t("page.dataDev.evidence.scheduleId")} value={scheduleId} onChange={(event) => setScheduleId(event.target.value)} />
            <Input className="max-w-72" placeholder={t("page.dataDev.evidence.packetId")} value={packetFilter} onChange={(event) => setPacketFilter(event.target.value)} />
            <Select className="min-w-40" value={decision} options={[{ value: "", label: t("page.dataDev.evidence.allDecisions") }, ...DECISIONS.map((value) => ({ value, label: value }))]} onChange={setDecision} />
            <Button onClick={() => evidenceTasks.mutate(true)} loading={evidenceTasks.isPending}>{t("page.dataDev.evidence.previewTasks")}</Button>
            <Button type="primary" onClick={() => evidenceTasks.mutate(false)} loading={evidenceTasks.isPending}>{t("page.dataDev.evidence.createTasks")}</Button>
          </div>
          {evidenceTasks.data ? <Alert className="mb-4" type="info" showIcon message={t("page.dataDev.evidence.result", { count: (evidenceTasks.data as any).items?.length ?? (evidenceTasks.data as any).created ?? 0 })} /> : null}
          <Table rowKey={(row) => `${row.schedule_id}:${row.packet_id}`} size="middle" columns={evidenceColumns} dataSource={evidence} loading={evidenceQ.isFetching} pagination={{ pageSize: 8 }} locale={{ emptyText: t("page.dataDev.evidence.empty") }} />
        </WorkbenchPanel>
      ) : null}

      {tab === "runbook" ? (
        <WorkbenchPanel title={t("page.dataDev.panels.runbook")}>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <Button disabled={runbook.isPending} icon={<RefreshCw className="h-4 w-4" />} loading={runbook.isPending} onClick={() => runbook.mutate(true)}>{t("page.dataDev.runbook.preview")}</Button>
            <Button type="primary" disabled={runbook.isPending} icon={<GitBranch className="h-4 w-4" />} loading={runbook.isPending} onClick={() => runbook.mutate(false)}>{t("page.dataDev.runbook.create")}</Button>
            <span className="text-sm text-[var(--muted)]">{t("page.dataDev.runbook.description")}</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {(runbookResult?.steps ?? []).length === 0 ? <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">{t("page.dataDev.runbook.empty")}</div> : null}
            {(runbookResult?.steps ?? []).map((step: any) => (
              <div key={step.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start gap-3">
                  {step.type === "claim_ready_packet" ? <Bot className="mt-0.5 h-5 w-5 text-[var(--brand)]" /> : step.type === "quality_evidence_fix" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-yellow-600" /> : <Clock className="mt-0.5 h-5 w-5 text-[var(--muted)]" />}
                  <div>
                    <div className="font-medium">{step.title}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">{step.reason}</div>
                    <div className="mt-2 text-xs text-[var(--muted)]">{t("page.dataDev.runbook.agentTool", { agent: step.agent, tool: step.dev_tool })}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      ) : null}

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="data-dev"
        title={t("page.dataDev.aiTitle")}
        context={{ tab, selectedIds, scheduleId, packetFilter }}
        initialPrompt={t("page.dataDev.aiPrompt")}
      />
    </div>
  );
}
