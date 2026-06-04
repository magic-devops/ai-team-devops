import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton, SearchInput } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "rules" | "runs" | "alerts" | "reports";

const TAB_KEYS: Tab[] = ["rules", "runs", "alerts", "reports"];
const TAB_META: Record<Tab, { titleKey: string; descriptionKey: string; focusKey: string }> = {
  rules: {
    titleKey: "page.dataQuality.modules.rules.title",
    descriptionKey: "page.dataQuality.modules.rules.description",
    focusKey: "page.dataQuality.modules.rules.focus",
  },
  runs: {
    titleKey: "page.dataQuality.modules.runs.title",
    descriptionKey: "page.dataQuality.modules.runs.description",
    focusKey: "page.dataQuality.modules.runs.focus",
  },
  alerts: {
    titleKey: "page.dataQuality.modules.alerts.title",
    descriptionKey: "page.dataQuality.modules.alerts.description",
    focusKey: "page.dataQuality.modules.alerts.focus",
  },
  reports: {
    titleKey: "page.dataQuality.modules.reports.title",
    descriptionKey: "page.dataQuality.modules.reports.description",
    focusKey: "page.dataQuality.modules.reports.focus",
  },
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-600 bg-red-50",
  high: "text-orange-600 bg-orange-50",
  medium: "text-yellow-600 bg-yellow-50",
  low: "text-green-600 bg-green-50",
};

const RULE_TYPES = ["not_null", "range", "regex", "uniqueness", "freshness"];
const DEFAULT_SAMPLE = `[
  {"id":"asset-1","owner":"DataOps","score":95,"email":"owner@example.com","updated_at":"2026-05-21T06:00:00+00:00"},
  {"id":"asset-1","owner":"","score":130,"email":"bad-email","updated_at":"2026-05-19T06:00:00+00:00"}
]`;

export function DataQualityWorkbench({ focused = false, initialTab = "rules" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({
    name: "",
    domain: "general",
    rule_type: "not_null",
    severity: "medium",
    expression: "",
    field: "owner",
    min: "",
    max: "",
    pattern: "^[^@]+@[^@]+\\.[^@]+$",
    max_age_hours: "24",
  });
  const [dataset, setDataset] = useState("asset_sample");
  const [sampleRows, setSampleRows] = useState(DEFAULT_SAMPLE);
  const [sampleError, setSampleError] = useState("");
  const [taskResult, setTaskResult] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);

  const rulesQ = useQuery({ queryKey: ["dqRules"], queryFn: () => api.dataQualityRules(), enabled: authed });
  const runsQ = useQuery({ queryKey: ["dqRuns"], queryFn: () => api.dataQualityRuns(), enabled: authed && (tab === "runs" || tab === "reports") });
  const alertsQ = useQuery({ queryKey: ["dqAlerts"], queryFn: () => api.dataQualityAlerts(), enabled: authed && (tab === "alerts" || tab === "reports") });

  function buildConfig() {
    const config: Record<string, unknown> = { field: form.field.trim() };
    if (form.rule_type === "range") {
      if (form.min !== "") config.min = Number(form.min);
      if (form.max !== "") config.max = Number(form.max);
    }
    if (form.rule_type === "regex") config.pattern = form.pattern;
    if (form.rule_type === "freshness") config.max_age_hours = Number(form.max_age_hours || 24);
    if (form.expression.trim()) {
      try {
        return { ...config, ...JSON.parse(form.expression) };
      } catch {
        return config;
      }
    }
    return config;
  }

  function parseSampleRows() {
    try {
      const parsed = JSON.parse(sampleRows);
      if (!Array.isArray(parsed)) throw new Error("样本必须是数组");
      setSampleError("");
      return parsed as Array<Record<string, unknown>>;
    } catch (err: any) {
      const message = err?.message || "样本 JSON 格式不正确";
      setSampleError(message);
      throw new Error(message);
    }
  }

  const createRule = useMutation({
    mutationFn: () => api.dataQualityRuleCreate({ ...form, config: buildConfig() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dqRules"] });
      setShowForm(false);
      setForm({ name: "", domain: "general", rule_type: "not_null", severity: "medium", expression: "", field: "owner", min: "", max: "", pattern: "^[^@]+@[^@]+\\.[^@]+$", max_age_hours: "24" });
    },
  });
  const deleteRule = useMutation({
    mutationFn: (id: string) => api.dataQualityRuleDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dqRules"] }),
  });
  const resolveAlert = useMutation({
    mutationFn: (id: string) => api.dataQualityAlertResolve(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dqAlerts"] }),
  });
  const triggerRun = useMutation({
    mutationFn: (ruleId: string) => {
      const rows = parseSampleRows();
      return api.dataQualityRunCreate({ rule_id: ruleId, dataset, sample_rows: rows, execute_now: true });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dqRuns"] });
      void qc.invalidateQueries({ queryKey: ["dqAlerts"] });
      setTab("runs");
    },
  });
  const finishRun = useMutation({
    mutationFn: (id: string) => api.dataQualityRunFinish(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["dqRuns"] }); void qc.invalidateQueries({ queryKey: ["dqAlerts"] }); },
  });
  const buildAlertTasks = useMutation({
    mutationFn: (id?: string) => api.dataQualityAlertTasks({ ids: id ? [id] : [], dry_run: true, priority: "P1", assigned_to: "Data Governance Agent", dev_tool: "codex" }),
    onSuccess: (data) => setTaskResult(data),
  });

  if (!authed) return <NeedLogin />;

  const rules = (rulesQ.data?.items ?? []).filter((r: any) => !q || r.name?.toLowerCase().includes(q.toLowerCase()));
  const runs = runsQ.data?.items ?? [];
  const alerts = alertsQ.data?.items ?? [];
  const openAlerts = alerts.filter((a: any) => a.status === "open");
  const scoredRuns = runs.filter((r: any) => r.score != null);
  const averageQualityScore = scoredRuns.length
    ? `${((scoredRuns.reduce((sum: number, r: any) => sum + Number(r.score || 0), 0) / scoredRuns.length) * 100).toFixed(1)}%`
    : "—";
  const tabLabel = (value: Tab) => t(`page.dataQuality.tabs.${value}`);
  const activeMetaDef = TAB_META[tab];
  const activeMeta = {
    title: t(activeMetaDef.titleKey),
    description: t(activeMetaDef.descriptionKey),
    focus: t(activeMetaDef.focusKey),
  };

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title={focused ? activeMeta.title : t("page.dataQuality.workbenchTitle")} description={focused ? activeMeta.description : t("page.dataQuality.workbenchDesc")}>
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
          {focused ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.dataQuality.focusedTag")}</span>
                <span className="text-xs font-medium text-[var(--text)]">{activeMeta.focus}</span>
                <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.dataQuality.focusedHint")}</span>
              </div>
              <a href="#/data/quality" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.dataQuality.backToHub")}</a>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {TAB_KEYS.map(tabId => (
                <button key={tabId} onClick={() => setTab(tabId)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === tabId ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"}`}>
                  {tabLabel(tabId)}
                  {tabId === "alerts" && openAlerts.length > 0 &&
                    <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white">{openAlerts.length}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === "rules" && (
          <WorkbenchPanel title="质量规则" actions={
            <div className="flex gap-2">
              <SearchInput value={q} onChange={setQ} placeholder="搜索规则..." />
              <AiAssistButton onClick={() => setAiOpen(true)} />
              <RefreshButton onClick={() => void rulesQ.refetch()} pending={rulesQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建规则</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="规则名称 *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  <input className="input-base" placeholder="业务域 (如 product)" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} />
                  <select className="input-base" value={form.rule_type} onChange={e => setForm(f => ({ ...f, rule_type: e.target.value }))}>
                    {RULE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <select className="input-base" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                    {["critical", "high", "medium", "low"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <input className="input-base" placeholder="字段名" value={form.field} onChange={e => setForm(f => ({ ...f, field: e.target.value }))} />
                  <input className="input-base" placeholder="最小值" value={form.min} onChange={e => setForm(f => ({ ...f, min: e.target.value }))} disabled={form.rule_type !== "range"} />
                  <input className="input-base" placeholder="最大值" value={form.max} onChange={e => setForm(f => ({ ...f, max: e.target.value }))} disabled={form.rule_type !== "range"} />
                  <input className="input-base" placeholder="最大时效小时" value={form.max_age_hours} onChange={e => setForm(f => ({ ...f, max_age_hours: e.target.value }))} disabled={form.rule_type !== "freshness"} />
                </div>
                <input className="input-base w-full" placeholder="正则表达式或 JSON 配置覆盖 (可选)" value={form.rule_type === "regex" ? form.pattern : form.expression} onChange={e => form.rule_type === "regex" ? setForm(f => ({ ...f, pattern: e.target.value })) : setForm(f => ({ ...f, expression: e.target.value }))} />
                <div className="flex gap-2">
                  <button onClick={() => createRule.mutate()} disabled={!form.name || !form.field || createRule.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createRule.isPending ? "创建中..." : "创建"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="mb-4 grid gap-3 lg:grid-cols-[260px_1fr]">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">运行数据集</label>
                <input className="input-base w-full" value={dataset} onChange={e => setDataset(e.target.value)} placeholder="dataset_name" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">样本行 JSON</label>
                <textarea className="input-base min-h-[96px] w-full font-mono text-xs" value={sampleRows} onChange={e => setSampleRows(e.target.value)} />
                {sampleError && <div className="mt-1 text-xs text-red-600">{sampleError}</div>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">规则名称</th><th className="pb-2 pr-4">域</th><th className="pb-2 pr-4">类型</th><th className="pb-2 pr-4">配置</th><th className="pb-2 pr-4">严重度</th><th className="pb-2 pr-4">状态</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
                  {rules.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[var(--muted)]">暂无规则，点击「新建规则」创建</td></tr>}
                  {rules.map((r: any) => (
                    <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 font-medium">{r.name}</td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{r.domain}</td>
                      <td className="py-2 pr-4"><span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{r.rule_type}</span></td>
                      <td className="py-2 pr-4 max-w-[260px] truncate font-mono text-xs text-[var(--muted)]">{JSON.stringify(r.config || {})}</td>
                      <td className="py-2 pr-4"><span className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[r.severity] ?? ""}`}>{r.severity}</span></td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{r.status}</td>
                      <td className="py-2 flex gap-2">
                        <button onClick={() => triggerRun.mutate(r.id)} disabled={triggerRun.isPending} className="text-xs text-[var(--brand)] hover:underline disabled:opacity-50">运行</button>
                        <button onClick={() => deleteRule.mutate(r.id)} className="text-xs text-red-500 hover:underline">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WorkbenchPanel>
        )}

        {tab === "runs" && (
          <WorkbenchPanel title="运行记录" actions={<RefreshButton onClick={() => void runsQ.refetch()} pending={runsQ.isFetching} />}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
	                  <th className="pb-2 pr-4">规则 ID</th><th className="pb-2 pr-4">数据集</th><th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">质量分</th><th className="pb-2 pr-4">检查/失败</th><th className="pb-2 pr-4">根因</th><th className="pb-2 pr-4">开始时间</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
	                  {runs.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-[var(--muted)]">暂无运行记录</td></tr>}
                  {runs.map((r: any) => (
                    <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 font-mono text-xs">{r.rule_id?.slice(0, 8)}...</td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{r.dataset || "未命名"}</td>
                      <td className="py-2 pr-4"><span className={`rounded px-2 py-0.5 text-xs ${r.status === "passed" ? "bg-green-50 text-green-700" : r.status === "failed" ? "bg-red-50 text-red-700" : "bg-yellow-50 text-yellow-700"}`}>{r.status}</span></td>
	                      <td className="py-2 pr-4">{r.score != null ? (r.score * 100).toFixed(1) + "%" : "—"}</td>
	                      <td className="py-2 pr-4">{r.rows_checked ?? 0} / <span className={r.rows_failed ? "text-red-600" : "text-green-600"}>{r.rows_failed ?? 0}</span></td>
	                      <td className="py-2 pr-4 max-w-[260px] truncate text-xs text-[var(--muted)]">{r.alert_attribution?.root_causes?.join(", ") || "—"}</td>
	                      <td className="py-2 text-[var(--muted)] text-xs">{r.started_at?.slice(0, 19).replace("T", " ")}</td>
	                      <td className="py-2">{r.status === "running" && <button onClick={() => finishRun.mutate(r.id)} className="text-xs text-[var(--brand)] hover:underline">完成评估</button>}</td>
	                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WorkbenchPanel>
        )}

        {tab === "alerts" && (
          <WorkbenchPanel title="告警处置" actions={
            <div className="flex gap-2">
              <button onClick={() => buildAlertTasks.mutate(undefined)} disabled={buildAlertTasks.isPending || alerts.length === 0} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50">预览任务</button>
              <RefreshButton onClick={() => void alertsQ.refetch()} pending={alertsQ.isFetching} />
            </div>
          }>
            {taskResult?.items?.length > 0 && (
              <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <div className="mb-2 text-sm font-semibold">任务预览</div>
                <div className="space-y-2">
                  {taskResult.items.slice(0, 3).map((item: any, idx: number) => (
                    <div key={`${item.source_report_id}-${idx}`} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
                      <div className="font-medium text-[var(--text)]">{item.priority} · {item.title}</div>
                      <div className="mt-1 text-[var(--muted)]">{item.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">告警信息</th><th className="pb-2 pr-4">数据集</th><th className="pb-2 pr-4">根因</th><th className="pb-2 pr-4">严重度</th><th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">时间</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
                  {alerts.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[var(--muted)]">暂无告警</td></tr>}
                  {alerts.map((a: any) => (
                    <tr key={a.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 max-w-xs truncate">{a.message}</td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{a.dataset || a.alert_attribution?.dataset || "—"}</td>
                      <td className="py-2 pr-4 max-w-[220px] truncate text-xs text-[var(--muted)]">{a.alert_attribution?.root_causes?.join(", ") || "—"}</td>
                      <td className="py-2 pr-4"><span className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[a.severity] ?? ""}`}>{a.severity}</span></td>
                      <td className="py-2 pr-4"><span className={`rounded px-2 py-0.5 text-xs ${a.status === "open" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{a.status}</span></td>
                      <td className="py-2 pr-4 text-xs text-[var(--muted)]">{a.created_at?.slice(0, 19).replace("T", " ")}</td>
                      <td className="py-2">
                        <div className="flex gap-2">
                          {a.status === "open" && <button onClick={() => resolveAlert.mutate(a.id)} className="text-xs text-[var(--brand)] hover:underline">处置</button>}
                          <button onClick={() => buildAlertTasks.mutate(a.id)} className="text-xs text-[var(--brand)] hover:underline">任务</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WorkbenchPanel>
        )}

        {tab === "reports" && (
          <WorkbenchPanel title={t("page.dataQuality.reportsTitle")} actions={<RefreshButton onClick={() => { void runsQ.refetch(); void alertsQ.refetch(); }} pending={runsQ.isFetching || alertsQ.isFetching} />}>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="text-xs text-[var(--muted)]">{t("page.dataQuality.reportRunTotal")}</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text)]">{runs.length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="text-xs text-[var(--muted)]">{t("page.dataQuality.reportFailedRuns")}</p>
                <p className="mt-1 text-2xl font-semibold text-red-600">{runs.filter((r: any) => r.status === "failed").length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="text-xs text-[var(--muted)]">{t("page.dataQuality.reportOpenAlerts")}</p>
                <p className="mt-1 text-2xl font-semibold text-orange-600">{openAlerts.length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="text-xs text-[var(--muted)]">{t("page.dataQuality.reportAverageScore")}</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text)]">{averageQualityScore}</p>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.recentRunQuality")}</p>
                <div className="space-y-2">
                  {runs.slice(0, 8).map((run: any) => (
                    <div key={run.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                      <span className="min-w-0 truncate">{run.dataset || run.rule_id}</span>
                      <span className={run.status === "failed" ? "text-red-600" : "text-green-600"}>{run.status} · {run.score != null ? `${(Number(run.score) * 100).toFixed(1)}%` : "—"}</span>
                    </div>
                  ))}
                  {!runs.length && <div className="py-6 text-center text-sm text-[var(--muted)]">{t("page.dataQuality.emptyRuns")}</div>}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.alertRootCauseSummary")}</p>
                <div className="space-y-2">
                  {alerts.slice(0, 8).map((alert: any) => (
                    <div key={alert.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-medium text-[var(--text)]">{alert.message}</span>
                        <span className={SEVERITY_COLOR[alert.severity] ?? ""}>{alert.severity}</span>
                      </div>
                      <p className="mt-1 truncate text-[var(--muted)]">{alert.alert_attribution?.root_causes?.join(", ") || t("page.dataQuality.unattributed")}</p>
                    </div>
                  ))}
                  {!alerts.length && <div className="py-6 text-center text-sm text-[var(--muted)]">{t("page.dataQuality.emptyAlerts")}</div>}
                </div>
              </div>
            </div>
          </WorkbenchPanel>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="data-quality" title="AI 智能助手" initialPrompt="分析当前质量规则，建议补充哪些检查项" />
      </WorkbenchShell>
    </div>
  );
}
