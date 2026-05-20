import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bot, CheckCircle2, Clock, GitBranch, Play, RefreshCw, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton, SearchInput } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";
import { buildSchedulePayload, derivePacketStats, toggleTemplateSelection } from "./dataDevModel";

type Tab = "templates" | "schedules" | "agent_feed" | "evidence" | "runbook";

type LegacyTab = "sql_editor" | "spark_jobs" | "flink_jobs" | "schedules";

const TAB_ITEMS: Array<{ id: Tab; label: string }> = [
  { id: "templates", label: "开发模板" },
  { id: "schedules", label: "调度运行" },
  { id: "agent_feed", label: "Agent 执行包" },
  { id: "evidence", label: "质量证据" },
  { id: "runbook", label: "Runbook" },
];

const ENGINES = ["SQL", "Spark", "Flink", "Python", "dbt"];
const POLICIES = ["quality_first", "balanced", "throughput", "cost_saver"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];

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

function statusBadgeClass(status?: string) {
  if (status === "applied" || status === "completed" || status === "pass" || status === "success") return "bg-green-50 text-green-700";
  if (status === "archived" || status === "blocked" || status === "block" || status === "failed") return "bg-red-50 text-red-700";
  if (status === "running" || status === "warn" || status === "claimed") return "bg-yellow-50 text-yellow-700";
  return "bg-[var(--surface-muted)] text-[var(--muted)]";
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center text-sm text-[var(--muted)]">{text}</td>
    </tr>
  );
}

export function DataDevWorkbench({ focused: _focused, initialTab }: { focused?: boolean; initialTab?: Tab | LegacyTab }) {
  const authed = Boolean(getToken());
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(normalizeTab(initialTab));
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
    summary: "已完成数据开发执行包并回写证据",
    artifactUrl: "",
  });

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
  const packetStats = useMemo(() => derivePacketStats(packets), [packets]);

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

  if (!authed) return <NeedLogin />;

  const summary = opsQ.data?.summary ?? templatesQ.data?.summary ?? {};
  const canSchedule = selectedIds.length > 0 && !scheduleMut.isPending;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="数据开发工作台"
        description="模板建模、调度编排、Agent 执行包、质量证据和自动化 Runbook"
        actions={<AiAssistButton onClick={() => setAiOpen(true)} />}
        metrics={
          <WorkbenchStats items={[
            { label: "开发模板", value: summary.dev_templates ?? templates.length ?? 0 },
            { label: "调度运行", value: summary.schedules ?? schedules.length ?? 0 },
            { label: "待领取包", value: summary.ready_unclaimed ?? packetStats.ready ?? 0 },
            { label: "质量阻断", value: summary.quality_blocked ?? 0, trend: (summary.quality_blocked ?? 0) > 0 ? "down" : "neutral" },
          ]} />
        }
      />

      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[var(--border)]">
        {TAB_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition ${tab === item.id ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "templates" ? (
        <WorkbenchPanel
          title="开发模板目录"
          actions={
            <div className="flex flex-wrap gap-2">
              <SearchInput value={q} onChange={setQ} placeholder="搜索模板、资产、负责人..." />
              <RefreshButton onClick={() => void templatesQ.refetch()} pending={templatesQ.isFetching} />
              <button type="button" onClick={() => setShowTemplateForm((value) => !value)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white">
                + 新建模板
              </button>
            </div>
          }
        >
          {showTemplateForm ? (
            <div className="mb-4 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <input className="input-base" placeholder="模板 ID *" value={templateForm.id} onChange={(e) => setTemplateForm((v) => ({ ...v, id: e.target.value }))} />
                <input className="input-base" placeholder="模板名称 *" value={templateForm.name} onChange={(e) => setTemplateForm((v) => ({ ...v, name: e.target.value }))} />
                <select className="input-base" value={templateForm.engine} onChange={(e) => setTemplateForm((v) => ({ ...v, engine: e.target.value }))}>
                  {ENGINES.map((engine) => <option key={engine}>{engine}</option>)}
                </select>
                <select className="input-base" value={templateForm.priority} onChange={(e) => setTemplateForm((v) => ({ ...v, priority: e.target.value }))}>
                  {PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
                </select>
                <input className="input-base" placeholder="负责 Agent" value={templateForm.owner} onChange={(e) => setTemplateForm((v) => ({ ...v, owner: e.target.value }))} />
                <input className="input-base" placeholder="开发工具" value={templateForm.dev_tool} onChange={(e) => setTemplateForm((v) => ({ ...v, dev_tool: e.target.value }))} />
                <input className="input-base md:col-span-3" placeholder="关联资产，逗号分隔" value={templateForm.assets} onChange={(e) => setTemplateForm((v) => ({ ...v, assets: e.target.value }))} />
                <input className="input-base md:col-span-3" placeholder="质量卡点，逗号分隔" value={templateForm.quality_gates} onChange={(e) => setTemplateForm((v) => ({ ...v, quality_gates: e.target.value }))} />
                <textarea className="input-base min-h-24 md:col-span-3" placeholder="模板描述、产出物和验收说明" value={templateForm.description} onChange={(e) => setTemplateForm((v) => ({ ...v, description: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={!templateForm.id.trim() || !templateForm.name.trim() || upsertTemplate.isPending} onClick={() => upsertTemplate.mutate()} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                  {upsertTemplate.isPending ? "保存中..." : "保存模板"}
                </button>
                <button type="button" onClick={() => setShowTemplateForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">选择</th>
                  <th className="pb-2 pr-4">模板</th>
                  <th className="pb-2 pr-4">引擎</th>
                  <th className="pb-2 pr-4">优先级</th>
                  <th className="pb-2 pr-4">Agent / 工具</th>
                  <th className="pb-2 pr-4">质量卡点</th>
                </tr>
              </thead>
              <tbody>
                {templates.length === 0 ? <EmptyRow colSpan={6} text="暂无数据开发模板，点击「新建模板」创建第一条。" /> : null}
                {templates.map((tpl: any) => (
                  <tr key={tpl.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                    <td className="py-3 pr-4">
                      <input type="checkbox" checked={selectedIds.includes(tpl.id)} onChange={() => setSelectedIds((ids) => toggleTemplateSelection(ids, tpl.id))} />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium">{tpl.name}</div>
                      <div className="mt-1 max-w-xl text-xs text-[var(--muted)]">{tpl.description || tpl.id}</div>
                    </td>
                    <td className="py-3 pr-4"><span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{tpl.engine}</span></td>
                    <td className="py-3 pr-4">{tpl.priority}</td>
                    <td className="py-3 pr-4 text-xs text-[var(--muted)]">{tpl.owner || "-"} / {tpl.dev_tool || "-"}</td>
                    <td className="py-3 pr-4 text-xs text-[var(--muted)]">{(tpl.quality_gates ?? []).join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <span className="text-sm text-[var(--muted)]">已选择 {selectedIds.length} 个模板</span>
            <button type="button" disabled={!selectedIds.length || createTasks.isPending} onClick={() => createTasks.mutate(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50">
              预览任务
            </button>
            <button type="button" disabled={!selectedIds.length || createTasks.isPending} onClick={() => createTasks.mutate(false)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white disabled:opacity-50">
              生成任务
            </button>
            {createTasks.data ? <span className="text-xs text-[var(--muted)]">候选/创建任务：{createTasks.data.items?.length ?? createTasks.data.created ?? 0}</span> : null}
          </div>
        </WorkbenchPanel>
      ) : null}

      {tab === "schedules" ? (
        <WorkbenchPanel title="调度运行" actions={<RefreshButton onClick={() => void schedulesQ.refetch()} pending={schedulesQ.isFetching} />}>
          <div className="mb-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 md:grid-cols-6">
            <select className="input-base" value={scheduleForm.policy} onChange={(e) => setScheduleForm((v) => ({ ...v, policy: e.target.value }))}>
              {POLICIES.map((policy) => <option key={policy}>{policy}</option>)}
            </select>
            <input className="input-base" type="number" min={1} max={20} value={scheduleForm.maxParallel} onChange={(e) => setScheduleForm((v) => ({ ...v, maxParallel: Number(e.target.value) }))} />
            <select className="input-base" value={scheduleForm.priority} onChange={(e) => setScheduleForm((v) => ({ ...v, priority: e.target.value }))}>
              {PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
            </select>
            <input className="input-base" value={scheduleForm.assignedTo} onChange={(e) => setScheduleForm((v) => ({ ...v, assignedTo: e.target.value }))} />
            <input className="input-base" value={scheduleForm.devTool} onChange={(e) => setScheduleForm((v) => ({ ...v, devTool: e.target.value }))} />
            <div className="flex gap-2">
              <button type="button" disabled={!canSchedule} onClick={() => scheduleMut.mutate(true)} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50">
                <Sparkles className="h-4 w-4" />预览
              </button>
              <button type="button" disabled={!canSchedule} onClick={() => scheduleMut.mutate(false)} className="flex items-center gap-1 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white disabled:opacity-50">
                <Play className="h-4 w-4" />应用
              </button>
            </div>
          </div>

          {scheduleResult ? (
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
              <div className="font-medium">最近调度结果：{scheduleResult.schedule_id || scheduleResult.item?.id || "-"}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">dry_run={String(scheduleResult.dry_run ?? false)}，Agent 包 {scheduleResult.agent_packets?.length ?? scheduleResult.summary?.packets ?? 0}，任务 {scheduleResult.created ?? scheduleResult.summary?.created_tasks ?? 0}</div>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">调度 ID</th>
                  <th className="pb-2 pr-4">状态</th>
                  <th className="pb-2 pr-4">策略</th>
                  <th className="pb-2 pr-4">模板/包/任务</th>
                  <th className="pb-2 pr-4">创建时间</th>
                  <th className="pb-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {schedules.length === 0 ? <EmptyRow colSpan={6} text="暂无调度运行记录，先选择模板并应用调度。" /> : null}
                {schedules.map((item: any) => (
                  <tr key={item.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                    <td className="py-3 pr-4 font-mono text-xs">{item.id}</td>
                    <td className="py-3 pr-4"><span className={`rounded px-2 py-0.5 text-xs ${statusBadgeClass(item.status)}`}>{item.status}</span></td>
                    <td className="py-3 pr-4">{item.policy}</td>
                    <td className="py-3 pr-4 text-xs text-[var(--muted)]">{item.templates ?? 0} / {item.packets ?? 0} / {item.created_tasks ?? 0}</td>
                    <td className="py-3 pr-4 text-xs text-[var(--muted)]">{shortDate(item.created_at)}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => { setScheduleId(item.id); setTab("agent_feed"); }} className="text-xs text-[var(--brand)] hover:underline">执行包</button>
                        <button type="button" onClick={() => scheduleAction.mutate({ id: item.id, action: "rerun", dryRun: true })} className="text-xs text-[var(--brand)] hover:underline">预览重放</button>
                        <button type="button" onClick={() => scheduleAction.mutate({ id: item.id, action: item.status === "archived" ? "restore" : "archive", dryRun: false })} className="text-xs text-[var(--brand)] hover:underline">{item.status === "archived" ? "恢复" : "归档"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WorkbenchPanel>
      ) : null}

      {tab === "agent_feed" ? (
        <WorkbenchPanel
          title="Agent 执行包"
          actions={<RefreshButton onClick={() => void agentFeedQ.refetch()} pending={agentFeedQ.isFetching} />}
        >
          <div className="mb-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 lg:grid-cols-5">
            <input className="input-base" placeholder="schedule_id" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} />
            <input className="input-base" placeholder="Agent 或 packet_id" value={packetFilter} onChange={(e) => setPacketFilter(e.target.value)} />
            <input className="input-base" placeholder="回写 Agent" value={reportForm.agent} onChange={(e) => setReportForm((v) => ({ ...v, agent: e.target.value }))} />
            <input className="input-base" placeholder="产物 URL" value={reportForm.artifactUrl} onChange={(e) => setReportForm((v) => ({ ...v, artifactUrl: e.target.value }))} />
            <input className="input-base" placeholder="报告摘要" value={reportForm.summary} onChange={(e) => setReportForm((v) => ({ ...v, summary: e.target.value }))} />
          </div>
          <WorkbenchStats items={[
            { label: "Ready", value: packetStats.ready },
            { label: "Blocked", value: packetStats.blocked, trend: packetStats.blocked > 0 ? "down" : "neutral" },
            { label: "Claimed", value: packetStats.claimed },
            { label: "Reported", value: packetStats.reported },
          ]} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">执行包</th>
                  <th className="pb-2 pr-4">状态</th>
                  <th className="pb-2 pr-4">Agent / 车道</th>
                  <th className="pb-2 pr-4">质量门</th>
                  <th className="pb-2 pr-4">报告</th>
                  <th className="pb-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {packets.length === 0 ? <EmptyRow colSpan={6} text="暂无执行包；应用调度后会生成 Agent 可消费任务包。" /> : null}
                {packets.map((packet: any) => (
                  <tr key={`${packet.schedule_id}:${packet.packet_id}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                    <td className="py-3 pr-4">
                      <div className="font-mono text-xs">{packet.packet_id}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{packet.title || packet.template_id}</div>
                    </td>
                    <td className="py-3 pr-4"><span className={`rounded px-2 py-0.5 text-xs ${packet.ready ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{packet.ready ? "ready" : "blocked"}</span></td>
                    <td className="py-3 pr-4 text-xs text-[var(--muted)]">{packet.assigned_to || "-"} / {packet.lane || "-"}</td>
                    <td className="py-3 pr-4 text-xs text-[var(--muted)]">{(packet.quality_gates ?? []).join(", ") || "-"}</td>
                    <td className="py-3 pr-4 text-xs text-[var(--muted)]">{packet.report?.status || packet.claim?.status || "-"}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!packet.ready || packetAction.isPending} onClick={() => packetAction.mutate({ packet, action: "claim" })} className="text-xs text-[var(--brand)] hover:underline disabled:text-[var(--muted)]">领取</button>
                        <button type="button" disabled={packetAction.isPending} onClick={() => packetAction.mutate({ packet, action: "heartbeat" })} className="text-xs text-[var(--brand)] hover:underline">心跳</button>
                        <button type="button" disabled={packetAction.isPending} onClick={() => packetAction.mutate({ packet, action: "report" })} className="text-xs text-[var(--brand)] hover:underline">回写证据</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WorkbenchPanel>
      ) : null}

      {tab === "evidence" ? (
        <WorkbenchPanel
          title="质量证据"
          actions={<RefreshButton onClick={() => void evidenceQ.refetch()} pending={evidenceQ.isFetching} />}
        >
          <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <input className="input-base max-w-72" placeholder="schedule_id" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} />
            <input className="input-base max-w-72" placeholder="packet_id" value={packetFilter} onChange={(e) => setPacketFilter(e.target.value)} />
            <select className="input-base max-w-40" value={decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="">全部决策</option>
              <option value="pass">pass</option>
              <option value="warn">warn</option>
              <option value="block">block</option>
            </select>
            <button type="button" onClick={() => evidenceTasks.mutate(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm">预览治理任务</button>
            <button type="button" onClick={() => evidenceTasks.mutate(false)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white">生成治理任务</button>
          </div>
          {evidenceTasks.data ? <div className="mb-4 text-sm text-[var(--muted)]">证据治理任务：{evidenceTasks.data.items?.length ?? evidenceTasks.data.created ?? 0}</div> : null}
          <div className="grid gap-3 lg:grid-cols-2">
            {evidence.length === 0 ? <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">暂无质量证据；Agent 回写报告后会在这里沉淀。</div> : null}
            {evidence.map((item: any) => (
              <div key={`${item.schedule_id}:${item.packet_id}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{item.title || item.packet_id}</div>
                    <div className="mt-1 font-mono text-xs text-[var(--muted)]">{item.schedule_id} / {item.packet_id}</div>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-xs ${statusBadgeClass(item.quality?.decision)}`}>{item.quality?.decision || "-"}</span>
                </div>
                <div className="mt-3 text-sm">Score: {item.quality?.score ?? "-"}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">缺失门禁：{(item.quality?.missing_required_gates ?? []).join(", ") || "-"}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">产物：{item.artifact_url || "-"}</div>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      ) : null}

      {tab === "runbook" ? (
        <WorkbenchPanel title="自动化 Runbook">
          <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <button type="button" disabled={runbook.isPending} onClick={() => runbook.mutate(true)} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50">
              <RefreshCw className="h-4 w-4" />预览 Runbook
            </button>
            <button type="button" disabled={runbook.isPending} onClick={() => runbook.mutate(false)} className="flex items-center gap-1 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white disabled:opacity-50">
              <GitBranch className="h-4 w-4" />生成任务
            </button>
            <span className="text-sm text-[var(--muted)]">按未领取包、质量阻断和缺证据自动生成处置步骤。</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {(runbookResult?.steps ?? []).length === 0 ? <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">点击预览 Runbook 查看自动化处置步骤。</div> : null}
            {(runbookResult?.steps ?? []).map((step: any) => (
              <div key={step.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start gap-3">
                  {step.type === "claim_ready_packet" ? <Bot className="mt-0.5 h-5 w-5 text-[var(--brand)]" /> : step.type === "quality_evidence_fix" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-yellow-600" /> : <Clock className="mt-0.5 h-5 w-5 text-[var(--muted)]" />}
                  <div>
                    <div className="font-medium">{step.title}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">{step.reason}</div>
                    <div className="mt-2 text-xs text-[var(--muted)]">Agent: {step.agent} / Tool: {step.dev_tool}</div>
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
        title="AI 数据开发助手"
        context={{ tab, selectedIds, scheduleId, packetFilter }}
        initialPrompt="分析当前数据开发模板、调度运行、Agent 执行包和质量证据，给出下一步治理建议。"
      />
    </div>
  );
}
