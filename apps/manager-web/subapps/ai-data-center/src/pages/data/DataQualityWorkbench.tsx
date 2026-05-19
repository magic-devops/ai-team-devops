import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton, SearchInput } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "rules" | "runs" | "alerts";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-600 bg-red-50",
  high: "text-orange-600 bg-orange-50",
  medium: "text-yellow-600 bg-yellow-50",
  low: "text-green-600 bg-green-50",
};

export function DataQualityWorkbench({ focused: _focused, initialTab = "rules" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", domain: "general", rule_type: "completeness", severity: "medium", expression: "" });
  const [showForm, setShowForm] = useState(false);

  const rulesQ = useQuery({ queryKey: ["dqRules"], queryFn: () => api.dataQualityRules(), enabled: authed });
  const runsQ = useQuery({ queryKey: ["dqRuns"], queryFn: () => api.dataQualityRuns(), enabled: authed && tab === "runs" });
  const alertsQ = useQuery({ queryKey: ["dqAlerts"], queryFn: () => api.dataQualityAlerts(), enabled: authed && tab === "alerts" });

  const createRule = useMutation({
    mutationFn: () => api.dataQualityRuleCreate(form),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["dqRules"] }); setShowForm(false); setForm({ name: "", domain: "general", rule_type: "completeness", severity: "medium", expression: "" }); },
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
    mutationFn: (ruleId: string) => api.dataQualityRunCreate({ rule_id: ruleId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["dqRuns"] }); setTab("runs"); },
  });
  const finishRun = useMutation({
    mutationFn: (id: string) => api.dataQualityRunFinish(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["dqRuns"] }); void qc.invalidateQueries({ queryKey: ["dqAlerts"] }); },
  });

  if (!authed) return <NeedLogin />;

  const rules = (rulesQ.data?.items ?? []).filter((r: any) => !q || r.name?.toLowerCase().includes(q.toLowerCase()));
  const runs = runsQ.data?.items ?? [];
  const alerts = alertsQ.data?.items ?? [];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title="数据质量中心" description="质量规则管理、运行记录与告警处置">
        <div className="flex gap-1 border-b border-[var(--border)] mb-4">
          {(["rules", "runs", "alerts"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
              {t === "rules" ? "质量规则" : t === "runs" ? "运行记录" : "告警处置"}
              {t === "alerts" && alerts.filter((a: any) => a.status === "open").length > 0 &&
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white">{alerts.filter((a: any) => a.status === "open").length}</span>}
            </button>
          ))}
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
                    {["completeness", "freshness", "uniqueness", "validity", "consistency"].map(t => <option key={t}>{t}</option>)}
                  </select>
                  <select className="input-base" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                    {["critical", "high", "medium", "low"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <input className="input-base w-full" placeholder="检查表达式 (可选)" value={form.expression} onChange={e => setForm(f => ({ ...f, expression: e.target.value }))} />
                <div className="flex gap-2">
                  <button onClick={() => createRule.mutate()} disabled={!form.name || createRule.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createRule.isPending ? "创建中..." : "创建"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">规则名称</th><th className="pb-2 pr-4">域</th><th className="pb-2 pr-4">类型</th><th className="pb-2 pr-4">严重度</th><th className="pb-2 pr-4">状态</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
                  {rules.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[var(--muted)]">暂无规则，点击「新建规则」创建</td></tr>}
                  {rules.map((r: any) => (
                    <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 font-medium">{r.name}</td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{r.domain}</td>
                      <td className="py-2 pr-4"><span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{r.rule_type}</span></td>
                      <td className="py-2 pr-4"><span className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[r.severity] ?? ""}`}>{r.severity}</span></td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{r.status}</td>
                      <td className="py-2 flex gap-2">
                        <button onClick={() => triggerRun.mutate(r.id)} className="text-xs text-[var(--brand)] hover:underline">运行</button>
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
	                  <th className="pb-2 pr-4">规则 ID</th><th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">质量分</th><th className="pb-2 pr-4">检查行数</th><th className="pb-2 pr-4">开始时间</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
	                  {runs.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[var(--muted)]">暂无运行记录</td></tr>}
                  {runs.map((r: any) => (
                    <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 font-mono text-xs">{r.rule_id?.slice(0, 8)}...</td>
                      <td className="py-2 pr-4"><span className={`rounded px-2 py-0.5 text-xs ${r.status === "passed" ? "bg-green-50 text-green-700" : r.status === "failed" ? "bg-red-50 text-red-700" : "bg-yellow-50 text-yellow-700"}`}>{r.status}</span></td>
	                      <td className="py-2 pr-4">{r.score != null ? (r.score * 100).toFixed(1) + "%" : "—"}</td>
	                      <td className="py-2 pr-4">{r.rows_checked ?? 0}</td>
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
          <WorkbenchPanel title="告警处置" actions={<RefreshButton onClick={() => void alertsQ.refetch()} pending={alertsQ.isFetching} />}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">告警信息</th><th className="pb-2 pr-4">严重度</th><th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">时间</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
                  {alerts.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[var(--muted)]">暂无告警</td></tr>}
                  {alerts.map((a: any) => (
                    <tr key={a.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 max-w-xs truncate">{a.message}</td>
                      <td className="py-2 pr-4"><span className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[a.severity] ?? ""}`}>{a.severity}</span></td>
                      <td className="py-2 pr-4"><span className={`rounded px-2 py-0.5 text-xs ${a.status === "open" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{a.status}</span></td>
                      <td className="py-2 pr-4 text-xs text-[var(--muted)]">{a.created_at?.slice(0, 19).replace("T", " ")}</td>
                      <td className="py-2">{a.status === "open" && <button onClick={() => resolveAlert.mutate(a.id)} className="text-xs text-[var(--brand)] hover:underline">处置</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WorkbenchPanel>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="data-quality" title="AI 智能助手" initialPrompt="分析当前质量规则，建议补充哪些检查项" />
      </WorkbenchShell>
    </div>
  );
}
