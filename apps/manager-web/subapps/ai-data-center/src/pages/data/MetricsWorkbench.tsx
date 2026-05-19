import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "catalog" | "published";
const METRIC_TYPES = ["atomic", "derived", "composite"];

export function MetricsWorkbench({ focused: _focused, initialTab = "catalog" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "general", metric_type: "atomic", formula: "", unit: "", owner: "" });

  const catalogQ = useQuery({ queryKey: ["metricsCatalog"], queryFn: () => api.metricsCatalog(), enabled: authed });
  const publishedQ = useQuery({ queryKey: ["metricsPublished"], queryFn: () => api.metricsPublished(), enabled: authed && tab === "published" });

  const create = useMutation({
    mutationFn: () => api.metricCreate(form),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["metricsCatalog"] }); setShowForm(false); setForm({ name: "", domain: "general", metric_type: "atomic", formula: "", unit: "", owner: "" }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.metricDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["metricsCatalog"] }),
  });
  const publish = useMutation({
    mutationFn: (id: string) => api.metricPublishApi(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["metricsCatalog"] }); void qc.invalidateQueries({ queryKey: ["metricsPublished"] }); },
  });
  const previewValues = useMutation({
    mutationFn: (id: string) => api.metricValues(id),
  });

  if (!authed) return <NeedLogin />;
  const catalog = catalogQ.data?.items ?? [];
  const published = publishedQ.data?.items ?? [];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title="指标中心" description="指标目录管理与 API 发布">
        <div className="flex gap-1 border-b border-[var(--border)] mb-4">
          {(["catalog", "published"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
              {t === "catalog" ? `指标目录 (${catalog.length})` : `已发布 API (${published.length})`}
            </button>
          ))}
        </div>

        {tab === "catalog" && (
          <WorkbenchPanel title="指标目录" actions={
            <div className="flex gap-2">
              <AiAssistButton onClick={() => setAiOpen(true)} />
              <RefreshButton onClick={() => void catalogQ.refetch()} pending={catalogQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 注册指标</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="指标名称 *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  <input className="input-base" placeholder="业务域" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} />
                  <select className="input-base" value={form.metric_type} onChange={e => setForm(f => ({ ...f, metric_type: e.target.value }))}>
                    {METRIC_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <input className="input-base" placeholder="单位 (如 count, ¥)" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
                  <input className="input-base sm:col-span-2" placeholder="计算公式 (如 sum(order_amount))" value={form.formula} onChange={e => setForm(f => ({ ...f, formula: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => create.mutate()} disabled={!form.name || create.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {create.isPending ? "注册中..." : "注册"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">指标名称</th><th className="pb-2 pr-4">域</th><th className="pb-2 pr-4">类型</th><th className="pb-2 pr-4">单位</th><th className="pb-2 pr-4">API</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
                  {catalog.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[var(--muted)]">暂无指标</td></tr>}
                  {catalog.map((m: any) => (
                    <tr key={m.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 font-medium">{m.name}</td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{m.domain}</td>
                      <td className="py-2 pr-4"><span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{m.metric_type}</span></td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{m.unit || "—"}</td>
                      <td className="py-2 pr-4 text-xs font-mono text-[var(--muted)]">{m.api_endpoint ? "✓ 已发布" : "—"}</td>
	                      <td className="py-2 flex gap-2">
	                        {!m.api_endpoint && <button onClick={() => publish.mutate(m.id)} className="text-xs text-[var(--brand)] hover:underline">发布 API</button>}
	                        <button onClick={() => previewValues.mutate(m.id)} className="text-xs text-[var(--brand)] hover:underline">预览</button>
	                        <button onClick={() => del.mutate(m.id)} className="text-xs text-red-500 hover:underline">删除</button>
	                      </td>
                    </tr>
                  ))}
                </tbody>
	              </table>
	            </div>
	            {previewValues.data && (
	              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
	                <p className="mb-2 text-sm font-semibold">指标样例值</p>
	                <div className="grid gap-2 sm:grid-cols-4">
	                  {(previewValues.data.values ?? []).map((v: any) => (
	                    <div key={v.bucket} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
	                      <p className="text-xs text-[var(--muted)]">{v.bucket}</p>
	                      <p className="text-lg font-semibold">{v.value}</p>
	                    </div>
	                  ))}
	                </div>
	              </div>
	            )}
	          </WorkbenchPanel>
	        )}

        {tab === "published" && (
          <WorkbenchPanel title="已发布 API" actions={<RefreshButton onClick={() => void publishedQ.refetch()} pending={publishedQ.isFetching} />}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">指标 ID</th><th className="pb-2 pr-4">Endpoint</th><th className="pb-2">发布时间</th>
                </tr></thead>
                <tbody>
                  {published.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-[var(--muted)]">暂无已发布 API</td></tr>}
                  {published.map((p: any) => (
                    <tr key={p.id} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-4 font-mono text-xs">{p.metric_id?.slice(0, 8)}...</td>
                      <td className="py-2 pr-4 font-mono text-xs text-[var(--brand)]">{p.endpoint}</td>
                      <td className="py-2 text-xs text-[var(--muted)]">{p.published_at?.slice(0, 19).replace("T", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WorkbenchPanel>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="metrics" title="AI 智能助手" initialPrompt="分析指标目录，建议补充哪些关键业务指标" />
      </WorkbenchShell>
    </div>
  );
}
