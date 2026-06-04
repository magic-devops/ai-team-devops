import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "catalog" | "semantic" | "published" | "monitor";
const TAB_KEYS: Tab[] = ["catalog", "semantic", "published", "monitor"];
const TAB_META: Record<Tab, { titleKey: string; descriptionKey: string; focusKey: string }> = {
  catalog: {
    titleKey: "page.metricsCenter.modules.catalog.title",
    descriptionKey: "page.metricsCenter.modules.catalog.description",
    focusKey: "page.metricsCenter.modules.catalog.focus",
  },
  semantic: {
    titleKey: "page.metricsCenter.modules.semantic.title",
    descriptionKey: "page.metricsCenter.modules.semantic.description",
    focusKey: "page.metricsCenter.modules.semantic.focus",
  },
  published: {
    titleKey: "page.metricsCenter.modules.published.title",
    descriptionKey: "page.metricsCenter.modules.published.description",
    focusKey: "page.metricsCenter.modules.published.focus",
  },
  monitor: {
    titleKey: "page.metricsCenter.modules.monitor.title",
    descriptionKey: "page.metricsCenter.modules.monitor.description",
    focusKey: "page.metricsCenter.modules.monitor.focus",
  },
};
const METRIC_TYPES = ["atomic", "derived", "composite"];

function splitList(value: string) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

export function MetricsWorkbench({ focused = false, initialTab = "catalog" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [activeMetricId, setActiveMetricId] = useState("");
  const [form, setForm] = useState({ name: "", domain: "general", metric_type: "atomic", formula: "", dimensions: "day", source_assets: "", depends_on: "", unit: "", owner: "", description: "" });
  const [publishForm, setPublishForm] = useState({ version_note: "发布指标语义契约", sla: "99.5%" });
  const [queryForm, setQueryForm] = useState({ grain: "day", dimensions: "" });
  const [queryResult, setQueryResult] = useState<any>(null);
  const [impactResult, setImpactResult] = useState<any>(null);

  const catalogQ = useQuery({ queryKey: ["metricsCatalog"], queryFn: () => api.metricsCatalog(), enabled: authed });
  const publishedQ = useQuery({ queryKey: ["metricsPublished"], queryFn: () => api.metricsPublished(), enabled: authed && (tab === "published" || tab === "monitor") });
  const versionsQ = useQuery({ queryKey: ["metricVersions", activeMetricId], queryFn: () => api.metricVersions(activeMetricId), enabled: authed && tab === "semantic" && Boolean(activeMetricId) });

  const create = useMutation({
    mutationFn: () => api.metricCreate({
      name: form.name,
      domain: form.domain,
      metric_type: form.metric_type,
      formula: form.formula,
      dimensions: splitList(form.dimensions),
      source_assets: splitList(form.source_assets),
      depends_on: splitList(form.depends_on),
      unit: form.unit,
      owner: form.owner,
      description: form.description,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["metricsCatalog"] });
      setShowForm(false);
      setForm({ name: "", domain: "general", metric_type: "atomic", formula: "", dimensions: "day", source_assets: "", depends_on: "", unit: "", owner: "", description: "" });
    },
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
  const publishVersion = useMutation({
    mutationFn: (id: string) => api.metricPublishVersion(id, publishForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["metricsCatalog"] });
      void qc.invalidateQueries({ queryKey: ["metricsPublished"] });
      void qc.invalidateQueries({ queryKey: ["metricVersions", activeMetricId] });
    },
  });
  const queryMetric = useMutation({
    mutationFn: (id: string) => api.metricQuery(id, queryForm),
    onSuccess: (data) => setQueryResult(data),
  });
  const impactMetric = useMutation({
    mutationFn: (id: string) => api.metricImpact(id),
    onSuccess: (data) => setImpactResult(data),
  });

  if (!authed) return <NeedLogin />;
  const catalog = catalogQ.data?.items ?? [];
  const published = publishedQ.data?.items ?? [];
  const metricsWithSemanticVersion = catalog.filter((m: any) => m.semantic_version);
  const metricsWithFormulaIssues = catalog.filter((m: any) => m.formula_validation && !m.formula_validation.valid);
  const governanceTodos = catalog.filter((m: any) => !m.api_endpoint || (m.formula_validation && !m.formula_validation.valid));
  const activeMetric = catalog.find((m: any) => m.id === activeMetricId) ?? catalog[0];
  const versions = versionsQ.data?.items ?? [];
  const selectMetric = (id: string) => {
    setActiveMetricId(id);
    setQueryResult(null);
    setImpactResult(null);
    setTab("semantic");
  };
  const activeMetaDef = TAB_META[tab];
  const activeMeta = {
    title: t(activeMetaDef.titleKey),
    description: t(activeMetaDef.descriptionKey),
    focus: t(activeMetaDef.focusKey),
  };
  const tabLabel = (tabId: Tab) => {
    if (tabId === "catalog") return `${t("page.metricsCenter.tabs.catalog")} (${catalog.length})`;
    if (tabId === "published") return `${t("page.metricsCenter.tabs.published")} (${published.length})`;
    return t(`page.metricsCenter.tabs.${tabId}`);
  };

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title={focused ? activeMeta.title : t("page.metricsCenter.workbenchTitle")} description={focused ? activeMeta.description : t("page.metricsCenter.workbenchDesc")}>
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
          {focused ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.metricsCenter.focusedTag")}</span>
                <span className="text-xs font-medium text-[var(--text)]">{activeMeta.focus}</span>
                <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.metricsCenter.focusedHint")}</span>
              </div>
              <a href="#/data/metrics" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.metricsCenter.backToHub")}</a>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {TAB_KEYS.map(tabId => (
                <button key={tabId} onClick={() => setTab(tabId)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === tabId ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"}`}>
                  {tabLabel(tabId)}
                </button>
              ))}
            </div>
          )}
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
                  <input className="input-base" placeholder="维度，逗号分隔" value={form.dimensions} onChange={e => setForm(f => ({ ...f, dimensions: e.target.value }))} />
                  <input className="input-base" placeholder="源资产，逗号分隔" value={form.source_assets} onChange={e => setForm(f => ({ ...f, source_assets: e.target.value }))} />
                  <input className="input-base" placeholder="依赖指标 ID/字段，逗号分隔" value={form.depends_on} onChange={e => setForm(f => ({ ...f, depends_on: e.target.value }))} />
                  <input className="input-base" placeholder="负责人" value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} />
                  <input className="input-base sm:col-span-2" placeholder="指标描述" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
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
                  <th className="pb-2 pr-4">指标名称</th><th className="pb-2 pr-4">域</th><th className="pb-2 pr-4">类型</th><th className="pb-2 pr-4">公式</th><th className="pb-2 pr-4">版本</th><th className="pb-2 pr-4">API</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
                  {catalog.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[var(--muted)]">暂无指标</td></tr>}
                  {catalog.map((m: any) => (
                    <tr key={m.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 font-medium">{m.name}</td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{m.domain}</td>
                      <td className="py-2 pr-4"><span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{m.metric_type}</span></td>
                      <td className="py-2 pr-4 max-w-[220px] truncate font-mono text-xs text-[var(--muted)]">{m.formula || "—"}</td>
                      <td className="py-2 pr-4 text-xs text-[var(--muted)]">{m.semantic_version || "v0"}</td>
                      <td className="py-2 pr-4 text-xs font-mono text-[var(--muted)]">{m.api_endpoint ? "✓ 已发布" : "—"}</td>
	                      <td className="py-2 flex gap-2">
	                        {!m.api_endpoint && <button onClick={() => publish.mutate(m.id)} className="text-xs text-[var(--brand)] hover:underline">发布 API</button>}
	                        <button onClick={() => selectMetric(m.id)} className="text-xs text-[var(--brand)] hover:underline">语义</button>
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

        {tab === "semantic" && (
          <WorkbenchPanel title="指标语义层" actions={<RefreshButton onClick={() => void catalogQ.refetch()} pending={catalogQ.isFetching} />}>
            {!activeMetric ? (
              <div className="py-8 text-center text-sm text-[var(--muted)]">请先注册指标</div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <div className="mb-2 text-xs text-[var(--muted)]">当前指标</div>
                    <select className="input-base w-full" value={activeMetric.id} onChange={e => selectMetric(e.target.value)}>
                      {catalog.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <div className="mt-3 text-xs text-[var(--muted)]">{activeMetric.formula || "未配置公式"}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(activeMetric.dimensions ?? []).map((d: string) => <span key={d} className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{d}</span>)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <div className="mb-2 text-xs text-[var(--muted)]">公式校验</div>
                    <div className={activeMetric.formula_validation?.valid ? "text-sm font-semibold text-green-700" : "text-sm font-semibold text-red-700"}>
                      {activeMetric.formula_validation?.valid ? "已通过" : "待修正"}
                    </div>
                    <div className="mt-2 text-xs text-[var(--muted)]">函数：{activeMetric.formula_validation?.functions?.join(", ") || "—"}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">字段：{activeMetric.formula_validation?.fields?.join(", ") || "—"}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <div className="mb-2 text-xs text-[var(--muted)]">查询契约</div>
                    <div className="font-mono text-xs text-[var(--brand)]">{activeMetric.query_contract?.endpoint || activeMetric.api_endpoint || "未发布"}</div>
                    <div className="mt-2 text-xs text-[var(--muted)]">SLA：{activeMetric.query_contract?.sla || "—"} · 版本：{activeMetric.semantic_version || "v0"}</div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                    <div className="mb-3 text-sm font-semibold">版本发布</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input className="input-base" value={publishForm.version_note} onChange={e => setPublishForm(f => ({ ...f, version_note: e.target.value }))} placeholder="版本说明" />
                      <input className="input-base" value={publishForm.sla} onChange={e => setPublishForm(f => ({ ...f, sla: e.target.value }))} placeholder="SLA" />
                    </div>
                    <button onClick={() => publishVersion.mutate(activeMetric.id)} disabled={publishVersion.isPending} className="mt-3 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white disabled:opacity-50">发布新版本</button>
                    <div className="mt-3 space-y-2">
                      {versions.slice(0, 3).map((v: any) => (
                        <div key={v.id} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
                          <span className="font-semibold">{v.semantic_version}</span>
                          <span className="ml-2 text-[var(--muted)]">{v.version_note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                    <div className="mb-3 text-sm font-semibold">样本查询</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select className="input-base" value={queryForm.grain} onChange={e => setQueryForm(f => ({ ...f, grain: e.target.value }))}>
                        {["day", "week", "month"].map(g => <option key={g}>{g}</option>)}
                      </select>
                      <input className="input-base" value={queryForm.dimensions} onChange={e => setQueryForm(f => ({ ...f, dimensions: e.target.value }))} placeholder="channel=web,region=cn" />
                    </div>
                    <button onClick={() => queryMetric.mutate(activeMetric.id)} disabled={queryMetric.isPending} className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50">执行查询</button>
                    {queryResult && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        {(queryResult.values ?? []).slice(0, 4).map((v: any) => (
                          <div key={v.bucket} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-center text-xs">
                            <div className="text-[var(--muted)]">{v.bucket}</div>
                            <div className="text-base font-semibold">{v.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold">血缘影响分析</div>
                    <button onClick={() => impactMetric.mutate(activeMetric.id)} disabled={impactMetric.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50">分析影响</button>
                  </div>
                  {impactResult ? (
                    <div className="grid gap-3 lg:grid-cols-3">
                      <div>
                        <div className="text-xs text-[var(--muted)]">上游资产</div>
                        <div className="mt-1 text-sm">{impactResult.upstream_assets?.join(", ") || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--muted)]">下游指标</div>
                        <div className="mt-1 text-sm">{impactResult.downstream_metrics?.map((m: any) => m.name).join(", ") || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--muted)]">风险级别</div>
                        <div className="mt-1 text-sm font-semibold">{impactResult.risk_level}</div>
                      </div>
                    </div>
                  ) : <div className="text-sm text-[var(--muted)]">点击分析影响，查看源资产、下游指标和已发布服务影响。</div>}
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

        {tab === "monitor" && (
          <WorkbenchPanel title={t("page.metricsCenter.monitorTitle")} actions={<RefreshButton onClick={() => { void catalogQ.refetch(); void publishedQ.refetch(); }} pending={catalogQ.isFetching || publishedQ.isFetching} />}>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="text-xs text-[var(--muted)]">{t("page.metricsCenter.metricTotal")}</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text)]">{catalog.length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="text-xs text-[var(--muted)]">{t("page.metricsCenter.publishedApi")}</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text)]">{published.length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="text-xs text-[var(--muted)]">{t("page.metricsCenter.semanticCoverage")}</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text)]">{metricsWithSemanticVersion.length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="text-xs text-[var(--muted)]">{t("page.metricsCenter.formulaIssues")}</p>
                <p className="mt-1 text-2xl font-semibold text-orange-600">{metricsWithFormulaIssues.length}</p>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.metricsCenter.serviceHealth")}</p>
                <div className="space-y-2">
                  {published.slice(0, 8).map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                      <span className="min-w-0 truncate font-mono text-[var(--brand)]">{item.endpoint}</span>
                      <span className="rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700">healthy</span>
                    </div>
                  ))}
                  {!published.length && <div className="py-6 text-center text-sm text-[var(--muted)]">{t("page.metricsCenter.emptyPublishedServices")}</div>}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.metricsCenter.governanceTodos")}</p>
                <div className="space-y-2">
                  {governanceTodos.slice(0, 8).map((metric: any) => (
                    <div key={metric.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                      <p className="font-medium text-[var(--text)]">{metric.name}</p>
                      <p className="mt-1 text-[var(--muted)]">{!metric.api_endpoint ? t("page.metricsCenter.unpublishedApi") : t("page.metricsCenter.formulaNeedsFix")}</p>
                    </div>
                  ))}
                  {!governanceTodos.length && (
                    <div className="py-6 text-center text-sm text-[var(--muted)]">{t("page.metricsCenter.emptyGovernanceTodos")}</div>
                  )}
                </div>
              </div>
            </div>
          </WorkbenchPanel>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="metrics" title="AI 智能助手" initialPrompt="分析指标目录，建议补充哪些关键业务指标" />
      </WorkbenchShell>
    </div>
  );
}
