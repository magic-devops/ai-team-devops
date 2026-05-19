import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "connectors" | "jobs";

const CONNECTOR_TYPES = ["mysql", "postgresql", "kafka", "s3", "api", "dingtalk", "wechat", "oceanbase", "starrocks"];
const INGEST_MODES = ["batch", "cdc", "stream"];

export function DataIngestWorkbench({ focused: _focused, initialTab = "connectors" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [cForm, setCForm] = useState({ name: "", connector_type: "mysql", host: "", port: 3306, database: "" });
  const [jForm, setJForm] = useState({ connector_id: "", name: "", ingest_mode: "batch", schedule: "", target_table: "" });
  const [schema, setSchema] = useState<any>(null);

  const connQ = useQuery({ queryKey: ["diConnectors"], queryFn: () => api.dataIngestConnectors(), enabled: authed });
  const jobsQ = useQuery({ queryKey: ["diJobs"], queryFn: () => api.dataIngestJobs(), enabled: authed && tab === "jobs" });

  const createConn = useMutation({
    mutationFn: () => api.dataIngestConnectorCreate(cForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["diConnectors"] }); setShowForm(false); },
  });
  const testConn = useMutation({
    mutationFn: (id: string) => api.dataIngestConnectorTest(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["diConnectors"] }),
  });
  const deleteConn = useMutation({
    mutationFn: (id: string) => api.dataIngestConnectorDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["diConnectors"] }),
  });
  const loadSchema = useMutation({
    mutationFn: (id: string) => api.dataIngestConnectorSchema(id),
    onSuccess: (data) => setSchema(data),
  });
  const createJob = useMutation({
    mutationFn: () => api.dataIngestJobCreate(jForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["diJobs"] }); setShowForm(false); },
  });
  const runJob = useMutation({
    mutationFn: (id: string) => api.dataIngestJobRun(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["diJobs"] }),
  });
  const finishJob = useMutation({
    mutationFn: (id: string) => api.dataIngestJobStatus(id, { status: "success", rows_ingested: 1000 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["diJobs"] }),
  });
  const deleteJob = useMutation({
    mutationFn: (id: string) => api.dataIngestJobDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["diJobs"] }),
  });

  if (!authed) return <NeedLogin />;

  const connectors = connQ.data?.items ?? [];
  const jobs = jobsQ.data?.items ?? [];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title="数据接入中心" description="连接器管理与接入作业配置">
        <div className="flex gap-1 border-b border-[var(--border)] mb-4">
          {(["connectors", "jobs"] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
              {t === "connectors" ? `连接器 (${connectors.length})` : `接入作业 (${jobs.length})`}
            </button>
          ))}
        </div>

        {tab === "connectors" && (
          <WorkbenchPanel title="连接器管理" actions={
            <div className="flex gap-2">
              <AiAssistButton onClick={() => setAiOpen(true)} />
              <RefreshButton onClick={() => void connQ.refetch()} pending={connQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建连接器</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="连接器名称 *" value={cForm.name} onChange={e => setCForm(f => ({ ...f, name: e.target.value }))} />
                  <select className="input-base" value={cForm.connector_type} onChange={e => setCForm(f => ({ ...f, connector_type: e.target.value }))}>
                    {CONNECTOR_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <input className="input-base" placeholder="主机地址" value={cForm.host} onChange={e => setCForm(f => ({ ...f, host: e.target.value }))} />
                  <input className="input-base" type="number" placeholder="端口" value={cForm.port} onChange={e => setCForm(f => ({ ...f, port: Number(e.target.value) }))} />
                  <input className="input-base sm:col-span-2" placeholder="数据库名" value={cForm.database} onChange={e => setCForm(f => ({ ...f, database: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => createConn.mutate()} disabled={!cForm.name || createConn.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createConn.isPending ? "创建中..." : "创建"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {connectors.length === 0 && <p className="col-span-3 py-8 text-center text-sm text-[var(--muted)]">暂无连接器</p>}
              {connectors.map((c: any) => (
                <div key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{c.name}</p>
                      <p className="text-xs text-[var(--muted)] mt-0.5">{c.connector_type} · {c.host || "—"}:{c.port}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{c.status}</span>
                  </div>
	                  <div className="mt-3 flex gap-2">
	                    <button onClick={() => testConn.mutate(c.id)} className="text-xs text-[var(--brand)] hover:underline">测试连接</button>
	                    <button onClick={() => loadSchema.mutate(c.id)} className="text-xs text-[var(--brand)] hover:underline">发现 Schema</button>
	                    <button onClick={() => deleteConn.mutate(c.id)} className="text-xs text-red-500 hover:underline">删除</button>
	                  </div>
	                </div>
	              ))}
	            </div>
	            {schema && (
	              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
	                <p className="mb-2 text-sm font-semibold">Schema 发现结果</p>
	                <div className="grid gap-2 sm:grid-cols-2">
	                  {(schema.tables ?? []).map((t: any) => (
	                    <div key={t.name} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
	                      <p className="text-sm font-medium">{t.name}</p>
	                      <p className="mt-1 text-xs text-[var(--muted)]">{(t.columns ?? []).map((c: any) => `${c.name}:${c.type}`).join(", ")}</p>
	                    </div>
	                  ))}
	                </div>
	              </div>
	            )}
	          </WorkbenchPanel>
	        )}

        {tab === "jobs" && (
          <WorkbenchPanel title="接入作业" actions={
            <div className="flex gap-2">
              <RefreshButton onClick={() => void jobsQ.refetch()} pending={jobsQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建作业</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="作业名称 *" value={jForm.name} onChange={e => setJForm(f => ({ ...f, name: e.target.value }))} />
                  <select className="input-base" value={jForm.connector_id} onChange={e => setJForm(f => ({ ...f, connector_id: e.target.value }))}>
                    <option value="">选择连接器</option>
                    {connectors.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
	                  <select className="input-base" value={jForm.ingest_mode} onChange={e => setJForm(f => ({ ...f, ingest_mode: e.target.value }))}>
	                    {INGEST_MODES.map(m => <option key={m}>{m}</option>)}
	                  </select>
	                  <input className="input-base" placeholder="调度表达式 (如 0 2 * * *)" value={jForm.schedule} onChange={e => setJForm(f => ({ ...f, schedule: e.target.value }))} />
	                  <input className="input-base sm:col-span-2" placeholder="目标表名" value={jForm.target_table} onChange={e => setJForm(f => ({ ...f, target_table: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => createJob.mutate()} disabled={!jForm.name || createJob.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createJob.isPending ? "创建中..." : "创建"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
	                  <th className="pb-2 pr-4">作业名称</th><th className="pb-2 pr-4">模式</th><th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">接入行数</th><th className="pb-2 pr-4">最近运行</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
	                  {jobs.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[var(--muted)]">暂无作业</td></tr>}
                  {jobs.map((j: any) => (
                    <tr key={j.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 font-medium">{j.name}</td>
                      <td className="py-2 pr-4"><span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{j.ingest_mode}</span></td>
	                      <td className="py-2 pr-4 text-[var(--muted)]">{j.status}</td>
	                      <td className="py-2 pr-4">{j.rows_ingested ?? 0}</td>
	                      <td className="py-2 text-xs text-[var(--muted)]">{j.last_run_at?.slice(0, 19).replace("T", " ") ?? "—"}</td>
	                      <td className="py-2 flex gap-2">
	                        {j.status !== "running" && <button onClick={() => runJob.mutate(j.id)} className="text-xs text-[var(--brand)] hover:underline">运行</button>}
	                        {j.status === "running" && <button onClick={() => finishJob.mutate(j.id)} className="text-xs text-green-600 hover:underline">完成</button>}
	                        <button onClick={() => deleteJob.mutate(j.id)} className="text-xs text-red-500 hover:underline">删除</button>
	                      </td>
	                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WorkbenchPanel>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="data-ingest" title="AI 智能助手" initialPrompt="分析当前数据接入配置，建议优化连接器和作业策略" />
      </WorkbenchShell>
    </div>
  );
}
