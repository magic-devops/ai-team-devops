import { Button, Drawer, Form, Input, Select, Space, Steps, Switch } from "antd";
import { RefreshButton } from "@/components/PageStates";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type OpsCenterAlertSourcesPanelProps = {
  alertSourcesQ: any;
  externalAlertsQ: any;
  alertNoiseQ: any;
  alertNoiseHistoryQ: any;
  alertStrategyQ: any;
  alertStrategyCompareRunsQ: any;
  alertSloPredictionRunsQ: any;
  alertSloEscalationPolicyQ: any;
  alertSloEscalationRunsQ: any;
  alertStrategyCanaryAuditsQ: any;
  opsStrategyLinkageRunsQ: any;
  alertSourceForm: any;
  setAlertSourceForm: any;
  alertSourceDrawerOpen: any;
  setAlertSourceDrawerOpen: any;
  alertSourceResult: any;
  createAlertSource: any;
  syncAlertSources: any;
  testAlertSource: any;
  toggleAlertSource: any;
  deleteAlertSource: any;
  alertNoisePolicyForm: any;
  setAlertNoisePolicyForm: any;
  alertSilenceForm: any;
  setAlertSilenceForm: any;
  alertNoiseConfigDrawer: any;
  setAlertNoiseConfigDrawer: any;
  alertNoiseResult: any;
  createAlertNoisePolicy: any;
  toggleAlertNoisePolicy: any;
  deleteAlertNoisePolicy: any;
  evaluateAlertNoise: any;
  createAlertSilence: any;
  toggleAlertSilence: any;
  deleteAlertSilence: any;
  alertStrategyResult: any;
  generateAlertStrategy: any;
  updateAlertStrategyRecommendation: any;
  compareAlertStrategy: any;
  latestStrategyCompare: any;
  predictAlertSlo: any;
  latestSloPrediction: any;
  alertSloEscalationForm: any;
  setAlertSloEscalationForm: any;
  alertSloEscalationDrawerOpen: any;
  setAlertSloEscalationDrawerOpen: any;
  saveAlertSloEscalationPolicy: any;
  runAlertSloEscalation: any;
  latestSloEscalation: any;
  alertStrategyCanaryForm: any;
  setAlertStrategyCanaryForm: any;
  alertStrategyCanaryDrawerOpen: any;
  setAlertStrategyCanaryDrawerOpen: any;
  runAlertStrategyCanaryAudit: any;
  updateAlertStrategyCanary: any;
  latestStrategyCanary: any;
  opsStrategyLinkageForm: any;
  setOpsStrategyLinkageForm: any;
  opsStrategyLinkageDrawerOpen: any;
  setOpsStrategyLinkageDrawerOpen: any;
  runOpsStrategyLinkage: any;
  latestOpsStrategyLinkage: any;
  imChannels: string[];
};

function severityClass(level?: string) {
  if (level === "critical") return "bg-red-50 text-red-700";
  if (level === "high") return "bg-orange-50 text-orange-700";
  if (level === "medium") return "bg-yellow-50 text-yellow-700";
  return "bg-green-50 text-green-700";
}

function actionStateClass(state?: string) {
  if (state === "approval_required" || state === "rolled_back") return "bg-red-50 text-red-700";
  if (state === "approved" || state === "applied") return "bg-amber-50 text-amber-700";
  if (state === "verified") return "bg-green-50 text-green-700";
  return "bg-slate-50 text-slate-700";
}

export function OpsCenterAlertSourcesPanel({
  alertSourcesQ,
  externalAlertsQ,
  alertNoiseQ,
  alertNoiseHistoryQ,
  alertStrategyQ,
  alertStrategyCompareRunsQ,
  alertSloPredictionRunsQ,
  alertSloEscalationPolicyQ,
  alertSloEscalationRunsQ,
  alertStrategyCanaryAuditsQ,
  opsStrategyLinkageRunsQ,
  alertSourceForm,
  setAlertSourceForm,
  alertSourceDrawerOpen,
  setAlertSourceDrawerOpen,
  alertSourceResult,
  createAlertSource,
  syncAlertSources,
  testAlertSource,
  toggleAlertSource,
  deleteAlertSource,
  alertNoisePolicyForm,
  setAlertNoisePolicyForm,
  alertSilenceForm,
  setAlertSilenceForm,
  alertNoiseConfigDrawer,
  setAlertNoiseConfigDrawer,
  alertNoiseResult,
  createAlertNoisePolicy,
  toggleAlertNoisePolicy,
  deleteAlertNoisePolicy,
  evaluateAlertNoise,
  createAlertSilence,
  toggleAlertSilence,
  deleteAlertSilence,
  alertStrategyResult,
  generateAlertStrategy,
  updateAlertStrategyRecommendation,
  compareAlertStrategy,
  latestStrategyCompare,
  predictAlertSlo,
  latestSloPrediction,
  alertSloEscalationForm,
  setAlertSloEscalationForm,
  alertSloEscalationDrawerOpen,
  setAlertSloEscalationDrawerOpen,
  saveAlertSloEscalationPolicy,
  runAlertSloEscalation,
  latestSloEscalation,
  alertStrategyCanaryForm,
  setAlertStrategyCanaryForm,
  alertStrategyCanaryDrawerOpen,
  setAlertStrategyCanaryDrawerOpen,
  runAlertStrategyCanaryAudit,
  updateAlertStrategyCanary,
  latestStrategyCanary,
  opsStrategyLinkageForm,
  setOpsStrategyLinkageForm,
  opsStrategyLinkageDrawerOpen,
  setOpsStrategyLinkageDrawerOpen,
  runOpsStrategyLinkage,
  latestOpsStrategyLinkage,
  imChannels,
}: OpsCenterAlertSourcesPanelProps) {
  return (
          <>
          <div className="grid gap-4 xl:grid-cols-[minmax(420px,0.9fr)_minmax(520px,1.1fr)]">
            <WorkbenchPanel title="生产告警源" actions={
              <div className="flex flex-wrap gap-2">
                <RefreshButton onClick={() => { void alertSourcesQ.refetch(); void externalAlertsQ.refetch(); void alertNoiseQ.refetch(); void alertNoiseHistoryQ.refetch(); void alertStrategyQ.refetch(); void alertStrategyCompareRunsQ.refetch(); void alertSloPredictionRunsQ.refetch(); void alertSloEscalationPolicyQ.refetch(); void alertSloEscalationRunsQ.refetch(); void alertStrategyCanaryAuditsQ.refetch(); void opsStrategyLinkageRunsQ.refetch(); }} pending={alertSourcesQ.isFetching || externalAlertsQ.isFetching || alertNoiseQ.isFetching || alertNoiseHistoryQ.isFetching || alertStrategyQ.isFetching || alertStrategyCompareRunsQ.isFetching || alertSloPredictionRunsQ.isFetching || alertSloEscalationPolicyQ.isFetching || alertSloEscalationRunsQ.isFetching || alertStrategyCanaryAuditsQ.isFetching || opsStrategyLinkageRunsQ.isFetching} />
                <button onClick={() => syncAlertSources.mutate()} disabled={syncAlertSources.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">同步告警</button>
                <button onClick={() => setAlertSourceDrawerOpen(true)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white">+ 告警源</button>
              </div>
            }>
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">源数量</p><p className="text-lg font-semibold">{alertSourcesQ.data?.summary?.sources ?? 0}</p></div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">启用</p><p className="text-lg font-semibold">{alertSourcesQ.data?.summary?.enabled_sources ?? 0}</p></div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">开放告警</p><p className="text-lg font-semibold">{alertSourcesQ.data?.summary?.open_alerts ?? 0}</p></div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">健康分</p><p className="text-lg font-semibold">{alertSourcesQ.data?.summary?.health_score ?? 100}</p></div>
              </div>

              <div className="mt-4 space-y-3">
                {(alertSourcesQ.data?.items ?? []).length === 0 && <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">暂无告警源，先配置 Prometheus/Grafana/Datadog/Webhook 或通用 JSON 源。</p>}
                {(alertSourcesQ.data?.items ?? []).map((item: any) => (
                  <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{item.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{item.source_type} · {item.endpoint || "sample/manual payload"}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${item.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{item.enabled ? "启用" : "停用"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--muted-strong)]">
                      {Object.entries(item.labels ?? {}).map(([key, value]) => <span key={key} className="rounded-full bg-[var(--surface-muted)] px-2 py-1">{key}: {String(value)}</span>)}
                      {item.auth_ref && <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1">密钥已托管</span>}
                      {item.sample_payload_status && <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1">样例已配置</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => testAlertSource.mutate(item)} disabled={testAlertSource.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">测试</button>
                      <button onClick={() => toggleAlertSource.mutate(item)} disabled={toggleAlertSource.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">{item.enabled ? "停用" : "启用"}</button>
                      <button onClick={() => deleteAlertSource.mutate(item.id)} disabled={deleteAlertSource.isPending} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 disabled:opacity-50">删除</button>
                    </div>
                  </div>
                ))}
                {(syncAlertSources.error || testAlertSource.error || toggleAlertSource.error || deleteAlertSource.error) && (
                  <p className="text-xs text-red-600">{((syncAlertSources.error || testAlertSource.error || toggleAlertSource.error || deleteAlertSource.error) as Error).message}</p>
                )}
              </div>
            </WorkbenchPanel>

            <WorkbenchPanel title="告警同步与 RCA 输入">
              <div className="space-y-4">
                {alertSourceResult ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">最近动作：{alertSourceResult.type}</p>
                      <span className={`rounded px-2 py-0.5 text-xs ${alertSourceResult.ok === false ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{alertSourceResult.ok === false ? "failed" : "ok"}</span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">来源</p><p className="text-sm font-semibold">{alertSourceResult.summary?.sources ?? alertSourceResult.source_name ?? "-"}</p></div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">告警</p><p className="text-sm font-semibold">{alertSourceResult.summary?.alerts ?? alertSourceResult.alerts?.length ?? 0}</p></div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">失败</p><p className="text-sm font-semibold">{alertSourceResult.summary?.failed ?? 0}</p></div>
                    </div>
                    {alertSourceResult.error && <p className="mt-2 text-xs text-red-600">{alertSourceResult.error}</p>}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">测试或同步后会展示标准化结果；持久化告警会自动进入 RCA 智能归因。</div>
                )}

                <div>
                  <p className="mb-2 text-sm font-semibold">最近同步告警</p>
                  <div className="space-y-2">
                    {(externalAlertsQ.data?.items ?? []).length === 0 && <p className="rounded-lg bg-[var(--surface-muted)] p-4 text-center text-sm text-[var(--muted)]">暂无已同步外部告警</p>}
                    {(externalAlertsQ.data?.items ?? []).slice(0, 12).map((alert: any) => (
                      <div key={`${alert.source_id}-${alert.id}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">{alert.title}</p>
                          <span className={`rounded px-2 py-0.5 text-xs ${severityClass(alert.severity)}`}>{alert.severity} · {alert.status}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">{alert.source} / {alert.detail || alert.dataset || "-"}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">告警降噪策略</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">按标签分组、折叠重复、抑制低优先级，并把可行动组送入 RCA。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setAlertNoiseConfigDrawer("policy")} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">新增策略</button>
                        <button onClick={() => setAlertNoiseConfigDrawer("silence")} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">新增静默</button>
                        <button onClick={() => generateAlertStrategy.mutate()} disabled={generateAlertStrategy.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">
                          {generateAlertStrategy.isPending ? "生成中..." : "智能推荐"}
                        </button>
                      <button onClick={() => evaluateAlertNoise.mutate(false)} disabled={evaluateAlertNoise.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览降噪</button>
                      <button onClick={() => evaluateAlertNoise.mutate(true)} disabled={evaluateAlertNoise.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">应用评估</button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">策略</p><p className="text-lg font-semibold">{alertNoiseQ.data?.summary?.enabled_policies ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">静默</p><p className="text-lg font-semibold">{alertNoiseQ.data?.summary?.enabled_silences ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">可行动组</p><p className="text-lg font-semibold">{alertNoiseResult?.summary?.actionable_incidents ?? alertNoiseQ.data?.summary?.latest_actionable_incidents ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">降噪率</p><p className="text-lg font-semibold">{Math.round(((alertNoiseResult?.summary?.noise_reduction_ratio ?? alertNoiseQ.data?.summary?.latest_noise_reduction_ratio ?? 0) as number) * 100)}%</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">推荐</p><p className="text-lg font-semibold">{alertStrategyQ.data?.summary?.recommendations ?? alertStrategyResult?.summary?.recommendations ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">可应用</p><p className="text-lg font-semibold">{alertStrategyQ.data?.summary?.applyable ?? alertStrategyResult?.summary?.applyable ?? 0}</p></div>
                  </div>
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">策略智能推荐</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">基于开放告警、重复分组、降噪率和历史健康分，推荐可应用的策略或静默。</p>
                      </div>
                      {alertStrategyResult?.persisted !== undefined ? <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-xs">最近保存 {alertStrategyResult.persisted} 条</span> : null}
                    </div>
                    <div className="mt-3 grid gap-2 xl:grid-cols-2">
                      {(alertStrategyQ.data?.items ?? []).length === 0 ? (
                        <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无策略推荐，先同步告警并点击智能推荐。</p>
                      ) : (alertStrategyQ.data?.items ?? []).slice(0, 6).map((item: any) => (
                        <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">{item.title}</p>
                              <p className="mt-1 text-xs text-[var(--muted)]">{item.reason}</p>
                            </div>
                            <span className={`rounded px-2 py-0.5 text-[11px] ${severityClass(item.priority)}`}>{item.priority}</span>
                          </div>
                          <p className="mt-2 text-xs text-[var(--muted-strong)]">{item.impact}</p>
                          <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                            <span className="rounded bg-[var(--surface-muted)] px-2 py-1">{item.operation}</span>
                            <span className="rounded bg-[var(--surface-muted)] px-2 py-1">置信度 {Math.round((item.confidence ?? 0) * 100)}%</span>
                            <span className="rounded bg-[var(--surface-muted)] px-2 py-1">{item.review_status || item.status || "open"}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.operation !== "review" && item.review_status !== "applied" ? (
                              <button onClick={() => updateAlertStrategyRecommendation.mutate({ id: item.id, action: "apply" })} disabled={updateAlertStrategyRecommendation.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1 text-xs text-white disabled:opacity-50">应用</button>
                            ) : null}
                            {item.review_status === "dismissed" ? (
                              <button onClick={() => updateAlertStrategyRecommendation.mutate({ id: item.id, action: "reopen" })} disabled={updateAlertStrategyRecommendation.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50">重新打开</button>
                            ) : (
                              <button onClick={() => updateAlertStrategyRecommendation.mutate({ id: item.id, action: "dismiss" })} disabled={updateAlertStrategyRecommendation.isPending || item.review_status === "applied"} className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50">忽略</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-[var(--muted-strong)]">策略效果 A/B 对比</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">把当前表单策略、严格高危策略和后端基线放到同一批告警上比较。</p>
                        </div>
                        <button onClick={() => compareAlertStrategy.mutate()} disabled={compareAlertStrategy.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">
                          {compareAlertStrategy.isPending ? "对比中..." : "对比策略效果"}
                        </button>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">候选策略</p>
                          <p className="text-lg font-semibold">{latestStrategyCompare?.summary?.variants ?? alertStrategyCompareRunsQ.data?.summary?.latest_variants ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">赢家提升</p>
                          <p className="text-lg font-semibold">{latestStrategyCompare?.summary?.winner_score_delta ?? alertStrategyCompareRunsQ.data?.summary?.latest_winner_score_delta ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">最佳降噪</p>
                          <p className="text-lg font-semibold">{Math.round(((latestStrategyCompare?.summary?.best_noise_reduction_ratio ?? alertStrategyCompareRunsQ.data?.summary?.latest_best_noise_reduction_ratio ?? 0) as number) * 100)}%</p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {(latestStrategyCompare?.items ?? []).length === 0 ? (
                          <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无对比记录，保存或调整策略表单后点击对比。</p>
                        ) : (latestStrategyCompare?.items ?? []).slice(0, 4).map((item: any) => (
                          <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium">{item.name}</p>
                              <div className="flex flex-wrap gap-1 text-[11px]">
                                {item.winner ? <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">推荐赢家</span> : null}
                                <span className="rounded bg-[var(--surface-muted)] px-2 py-0.5">健康 {item.health_score}</span>
                                <span className="rounded bg-[var(--surface-muted)] px-2 py-0.5">Δ {item.score_delta}</span>
                              </div>
                            </div>
                            <p className="mt-1 text-xs text-[var(--muted)]">RCA 组 {item.actionable_incidents} / 折叠 {item.deduped_alerts} / 抑制 {item.suppressed_alerts} / 降噪 {Math.round((item.noise_reduction_ratio ?? 0) * 100)}%</p>
                            <p className="mt-1 text-xs text-[var(--muted-strong)]">{item.recommendation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-[var(--muted-strong)]">跨源 SLO 预测</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">按告警源与服务预测 24 小时 SLO 风险，联动 RCA、Runbook 和策略治理。</p>
                        </div>
                        <button onClick={() => predictAlertSlo.mutate()} disabled={predictAlertSlo.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">
                          {predictAlertSlo.isPending ? "预测中..." : "预测 SLO"}
                        </button>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">风险对象</p>
                          <p className="text-lg font-semibold">{latestSloPrediction?.summary?.risk_targets ?? alertSloPredictionRunsQ.data?.summary?.latest_risk_targets ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">平均分</p>
                          <p className="text-lg font-semibold">{latestSloPrediction?.summary?.avg_slo_score ?? alertSloPredictionRunsQ.data?.summary?.latest_avg_slo_score ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">最大概率</p>
                          <p className="text-lg font-semibold">{Math.round(((latestSloPrediction?.summary?.breach_probability ?? alertSloPredictionRunsQ.data?.summary?.latest_breach_probability ?? 0) as number) * 100)}%</p>
                        </div>
                      </div>
                      <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                        {(latestSloPrediction?.items ?? []).length === 0 ? (
                          <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无 SLO 预测记录，先同步告警源并点击预测。</p>
                        ) : (latestSloPrediction?.items ?? []).slice(0, 8).map((item: any) => (
                          <div key={`${item.source_id}-${item.service}`} className="rounded-lg border border-[var(--border)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium">{item.source_name} / {item.service}</p>
                              <span className={`rounded px-2 py-0.5 text-[11px] ${severityClass(item.risk_level === "watch" ? "medium" : item.risk_level)}`}>{item.risk_level}</span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--muted)]">SLO {item.predicted_slo_score} / breach {Math.round((item.breach_probability ?? 0) * 100)}% / open {item.open_alerts} / high {item.high_alerts} / critical {item.critical_alerts}</p>
                            <p className="mt-1 text-xs text-[var(--muted-strong)]">{(item.recommendations ?? [])[0]}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">告警 SLO 自动升级</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">把跨源 SLO 预测中的高风险对象自动升级为治理任务和 IM 风险简报，保留运行记录。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setAlertSloEscalationDrawerOpen(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">配置策略</button>
                        <button onClick={() => runAlertSloEscalation.mutate(true)} disabled={runAlertSloEscalation.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览升级</button>
                        <button onClick={() => runAlertSloEscalation.mutate(false)} disabled={runAlertSloEscalation.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">执行升级</button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">最近候选</p>
                        <p className="text-lg font-semibold">{latestSloEscalation?.summary?.candidates ?? alertSloEscalationRunsQ.data?.summary?.latest_candidates ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">已建任务</p>
                        <p className="text-lg font-semibold">{latestSloEscalation?.summary?.created ?? alertSloEscalationRunsQ.data?.summary?.latest_created ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">Critical</p>
                        <p className="text-lg font-semibold">{latestSloEscalation?.summary?.critical ?? alertSloEscalationRunsQ.data?.summary?.latest_critical ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">最大概率</p>
                        <p className="text-lg font-semibold">{Math.round(((latestSloEscalation?.summary?.max_breach_probability ?? alertSloEscalationRunsQ.data?.summary?.latest_max_breach_probability ?? 0) as number) * 100)}%</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[var(--muted-strong)]">当前升级策略</p>
                          <span className={`rounded px-2 py-0.5 text-[11px] ${alertSloEscalationPolicyQ.data?.item?.enabled === false ? "bg-gray-100 text-gray-500" : "bg-green-50 text-green-700"}`}>
                            {alertSloEscalationPolicyQ.data?.item?.enabled === false ? "停用" : "启用"}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">最低风险</p>
                            <p className="text-sm font-semibold">{alertSloEscalationPolicyQ.data?.item?.min_risk_level ?? alertSloEscalationForm.min_risk_level}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">违约阈值</p>
                            <p className="text-sm font-semibold">{Math.round(((alertSloEscalationPolicyQ.data?.item?.min_breach_probability ?? Number(alertSloEscalationForm.min_breach_probability || 0)) as number) * 100)}%</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">最大对象</p>
                            <p className="text-sm font-semibold">{alertSloEscalationPolicyQ.data?.item?.max_targets ?? alertSloEscalationForm.max_targets}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">冷却窗口</p>
                            <p className="text-sm font-semibold">{alertSloEscalationPolicyQ.data?.item?.cooldown_minutes ?? alertSloEscalationForm.cooldown_minutes} 分钟</p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">动作：{(alertSloEscalationPolicyQ.data?.item?.actions ?? alertSloEscalationForm.actions.split(",")).join(", ")} / Owner：{alertSloEscalationPolicyQ.data?.item?.owner ?? alertSloEscalationForm.owner}</p>
                      </div>
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">升级结果</p>
                        {(latestSloEscalation?.items ?? []).length === 0 ? (
                          <p className="mt-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无升级运行记录，先预测 SLO 后预览或执行升级。</p>
                        ) : (
                          <div className="mt-2 max-h-72 space-y-2 overflow-auto">
                            {(latestSloEscalation?.items ?? []).slice(0, 8).map((item: any) => (
                              <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium">{item.source_name} / {item.service}</p>
                                  <span className={`rounded px-2 py-0.5 text-[11px] ${severityClass(item.risk_level)}`}>{item.risk_level}</span>
                                </div>
                                <p className="mt-1 text-xs text-[var(--muted)]">SLO {item.predicted_slo_score} / breach {Math.round((item.breach_probability ?? 0) * 100)}% / open {item.open_alerts}</p>
                                <p className="mt-1 text-xs text-[var(--muted-strong)]">{(item.recommendations ?? [])[0] || "按策略升级处置。"}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {latestSloEscalation?.delivery_plan ? (
                          <p className="mt-2 text-[11px] text-[var(--muted)]">IM 目标：{latestSloEscalation.delivery_plan.target_count ?? 0} / 已发送：{latestSloEscalation.summary?.sent ?? 0}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">策略灰度应用审计</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">汇总策略 A/B 对比、SLO 风险、自动升级记录和灰度护栏，形成可审批的准入结论。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setAlertStrategyCanaryDrawerOpen(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">配置审计</button>
                        <button onClick={() => runAlertStrategyCanaryAudit.mutate()} disabled={runAlertStrategyCanaryAudit.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">
                          {runAlertStrategyCanaryAudit.isPending ? "审计中..." : "生成灰度审计"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">准入分</p>
                        <p className="text-lg font-semibold">{latestStrategyCanary?.summary?.readiness_score ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_readiness_score ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">结论</p>
                        <p className="text-lg font-semibold">{latestStrategyCanary?.summary?.decision ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_decision ?? "-"}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">建议流量</p>
                        <p className="text-lg font-semibold">{latestStrategyCanary?.summary?.recommended_percent ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_recommended_percent ?? 0}%</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">运行中</p>
                        <p className="text-lg font-semibold">{alertStrategyCanaryAuditsQ.data?.summary?.running ?? 0}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">审计配置摘要</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">策略来源</p>
                            <p className="text-sm font-semibold">{alertStrategyCanaryForm.policy_id || "自动选择"}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">候选策略</p>
                            <p className="text-sm font-semibold">{alertStrategyCanaryForm.candidate_id || "A/B 胜出"}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">灰度流量</p>
                            <p className="text-sm font-semibold">{alertStrategyCanaryForm.traffic_percent}%</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">审批人</p>
                            <p className="text-sm font-semibold">{alertStrategyCanaryForm.created_by}</p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">{alertStrategyCanaryForm.refresh_inputs ? "审计会刷新策略对比和 SLO 风险。" : "审计复用当前已生成证据。"}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(["approve", "start", "rollback", "archive", "reject", "reopen"] as const).map(action => (
                            <button
                              key={action}
                              onClick={() => latestStrategyCanary?.id && updateAlertStrategyCanary.mutate({ id: latestStrategyCanary.id, action })}
                              disabled={!latestStrategyCanary?.id || updateAlertStrategyCanary.isPending}
                              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50"
                            >
                              {action}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[var(--muted-strong)]">审计证据</p>
                          {latestStrategyCanary?.audit_status ? <span className={`rounded px-2 py-0.5 text-[11px] ${actionStateClass(latestStrategyCanary.audit_status)}`}>{latestStrategyCanary.audit_status}</span> : null}
                        </div>
                        {!latestStrategyCanary ? (
                          <p className="mt-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无灰度审计记录，先执行策略对比和 SLO 预测后生成审计。</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                              <p className="text-sm font-medium">{latestStrategyCanary.candidate?.name ?? "候选策略"}</p>
                              <p className="mt-1 text-xs text-[var(--muted)]">health {latestStrategyCanary.candidate?.health_score ?? 0} / delta {latestStrategyCanary.candidate?.score_delta ?? 0} / RCA {latestStrategyCanary.candidate?.actionable_delta ?? 0}</p>
                            </div>
                            {(latestStrategyCanary.items ?? []).map((item: any) => (
                              <div key={item.kind} className="rounded-lg border border-[var(--border)] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium">{item.title}</p>
                                  <span className={`rounded px-2 py-0.5 text-[11px] ${item.status === "fail" ? "bg-red-50 text-red-700" : item.status === "review" ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>{item.status}</span>
                                </div>
                                <p className="mt-1 text-xs text-[var(--muted)]">{item.detail}</p>
                              </div>
                            ))}
                            {(latestStrategyCanary.blocked_reasons ?? latestStrategyCanary.review_reasons ?? []).length > 0 ? (
                              <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                                <p className="text-xs font-semibold text-[var(--muted-strong)]">准入说明</p>
                                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-[var(--muted)]">
                                  {[...(latestStrategyCanary.blocked_reasons ?? []), ...(latestStrategyCanary.review_reasons ?? [])].slice(0, 4).map((item: string) => <li key={item}>{item}</li>)}
                                </ul>
                              </div>
                            ) : null}
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                                <p className="text-xs font-semibold text-[var(--muted-strong)]">护栏</p>
                                <p className="mt-1 text-xs text-[var(--muted)]">{(latestStrategyCanary.guardrails ?? [])[0] ?? "按策略护栏灰度。"}</p>
                              </div>
                              <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                                <p className="text-xs font-semibold text-[var(--muted-strong)]">回滚触发</p>
                                <p className="mt-1 text-xs text-[var(--muted)]">{(latestStrategyCanary.rollback_triggers ?? [])[0] ?? "异常时回滚。"}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">跨模块运维策略联动</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">把灰度审计、SLO 升级、Runbook、自愈、任务和 IM 通知串成可执行联动包。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setOpsStrategyLinkageDrawerOpen(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">配置联动</button>
                        <button onClick={() => runOpsStrategyLinkage.mutate(true)} disabled={runOpsStrategyLinkage.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览联动</button>
                        <button onClick={() => runOpsStrategyLinkage.mutate(false)} disabled={runOpsStrategyLinkage.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">执行联动</button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">联动项</p>
                        <p className="text-lg font-semibold">{latestOpsStrategyLinkage?.summary?.linkage_items ?? opsStrategyLinkageRunsQ.data?.summary?.latest_items ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">模块数</p>
                        <p className="text-lg font-semibold">{latestOpsStrategyLinkage?.summary?.modules ?? opsStrategyLinkageRunsQ.data?.summary?.latest_modules ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">高风险</p>
                        <p className="text-lg font-semibold">{latestOpsStrategyLinkage?.summary?.high_risk ?? opsStrategyLinkageRunsQ.data?.summary?.latest_high_risk ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">已建任务</p>
                        <p className="text-lg font-semibold">{latestOpsStrategyLinkage?.summary?.created ?? opsStrategyLinkageRunsQ.data?.summary?.latest_created ?? 0}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">联动配置摘要</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">动作</p>
                            <p className="text-sm font-semibold">{opsStrategyLinkageForm.actions}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">最大联动项</p>
                            <p className="text-sm font-semibold">{opsStrategyLinkageForm.max_items}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">优先级</p>
                            <p className="text-sm font-semibold">{opsStrategyLinkageForm.priority}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">负责人</p>
                            <p className="text-sm font-semibold">{opsStrategyLinkageForm.assigned_to}</p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">工具：{opsStrategyLinkageForm.dev_tool}。IM 通道沿用本页已选择通道，执行联动会创建任务并发送风险简报。</p>
                      </div>
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">联动结果</p>
                        {(latestOpsStrategyLinkage?.items ?? []).length === 0 ? (
                          <p className="mt-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无联动运行记录，先完成策略灰度审计或 SLO 升级后预览联动。</p>
                        ) : (
                          <div className="mt-2 max-h-72 space-y-2 overflow-auto">
                            {(latestOpsStrategyLinkage?.items ?? []).slice(0, 8).map((item: any) => (
                              <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium">{item.title}</p>
                                  <span className={`rounded px-2 py-0.5 text-[11px] ${severityClass(item.risk_level === "watch" ? "medium" : item.risk_level)}`}>{item.module} / {item.risk_level}</span>
                                </div>
                                <p className="mt-1 text-xs text-[var(--muted)]">{(item.recommendations ?? [])[0] ?? "按联动策略推进。"}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {latestOpsStrategyLinkage?.delivery_plan ? (
                          <p className="mt-2 text-[11px] text-[var(--muted)]">IM 目标：{latestOpsStrategyLinkage.delivery_plan.target_count ?? 0} / 已发送：{latestOpsStrategyLinkage.summary?.sent ?? 0}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[var(--muted-strong)]">策略目录</p>
                      {(alertNoiseQ.data?.items ?? []).length === 0 && <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无策略，保存后评估结果会记录为降噪历史。</p>}
                      {(alertNoiseQ.data?.items ?? []).slice(0, 4).map((item: any) => (
                        <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{item.name}</p>
                            <span className={`rounded px-2 py-0.5 text-[11px] ${item.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{item.enabled ? "启用" : "停用"}</span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted)]">分组：{(item.group_by ?? []).join(", ")} / RCA 阈值：{item.min_rca_severity}</p>
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => toggleAlertNoisePolicy.mutate(item)} className="text-xs text-[var(--brand)]">{item.enabled ? "停用" : "启用"}</button>
                            <button onClick={() => deleteAlertNoisePolicy.mutate(item.id)} className="text-xs text-red-600">删除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[var(--muted-strong)]">静默规则</p>
                      {(alertNoiseQ.data?.silences ?? []).length === 0 && <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无静默规则。</p>}
                      {(alertNoiseQ.data?.silences ?? []).slice(0, 4).map((item: any) => (
                        <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{item.name}</p>
                            <span className={`rounded px-2 py-0.5 text-[11px] ${item.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{item.enabled ? "启用" : "停用"}</span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted)]">匹配：{Object.entries(item.matchers ?? {}).map(([key, value]) => `${key}=${String(value)}`).join(", ") || "-"}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{item.reason || "-"}</p>
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => toggleAlertSilence.mutate(item)} className="text-xs text-[var(--brand)]">{item.enabled ? "停用" : "启用"}</button>
                            <button onClick={() => deleteAlertSilence.mutate(item.id)} className="text-xs text-red-600">删除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {alertNoiseResult?.groups?.length ? (
                    <div className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs font-semibold text-[var(--muted-strong)]">最近降噪结果</p>
                      <div className="mt-2 max-h-56 overflow-auto space-y-2">
                        {alertNoiseResult.groups.slice(0, 8).map((group: any) => (
                          <div key={group.id} className="rounded bg-[var(--surface)] p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{group.title}</span>
                              <span className={severityClass(group.max_severity)}>{group.max_severity} / {group.recommended_action}</span>
                            </div>
                            <p className="mt-1 text-[var(--muted)]">{group.group_key} / {group.count} 条，抑制 {group.suppressed_count}，折叠 {group.deduped_count}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {(createAlertNoisePolicy.error || createAlertSilence.error || evaluateAlertNoise.error || generateAlertStrategy.error || updateAlertStrategyRecommendation.error || compareAlertStrategy.error || predictAlertSlo.error || saveAlertSloEscalationPolicy.error || runAlertSloEscalation.error) && (
                    <p className="mt-3 text-xs text-red-600">{((createAlertNoisePolicy.error || createAlertSilence.error || evaluateAlertNoise.error || generateAlertStrategy.error || updateAlertStrategyRecommendation.error || compareAlertStrategy.error || predictAlertSlo.error || saveAlertSloEscalationPolicy.error || runAlertSloEscalation.error) as Error).message}</p>
                  )}
                </div>
              </div>
            </WorkbenchPanel>
          </div>
          <Drawer
            title="配置生产告警源"
            open={alertSourceDrawerOpen}
            onClose={() => setAlertSourceDrawerOpen(false)}
            width="min(640px, 100vw)"
          >
            <div className="alertSourceFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={alertSourceForm.sample_payload.trim() ? 2 : (alertSourceForm.endpoint.trim() || alertSourceForm.auth_ref.trim()) ? 1 : 0}
                items={[
                  { title: "来源" },
                  { title: "连接" },
                  { title: "样例" },
                ]}
              />
              <Form layout="vertical" requiredMark={false} onFinish={() => createAlertSource.mutate()}>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">来源身份</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="告警源名称" required>
                      <Input
                        value={alertSourceForm.name}
                        onChange={e => setAlertSourceForm((f: any) => ({ ...f, name: e.target.value }))}
                        placeholder="production-prometheus"
                      />
                    </Form.Item>
                    <Form.Item label="来源类型">
                      <Select
                        value={alertSourceForm.source_type}
                        onChange={value => setAlertSourceForm((f: any) => ({ ...f, source_type: value }))}
                        options={["prometheus", "grafana", "datadog", "webhook", "generic_json", "manual"].map(type => ({ label: type, value: type }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label="启用同步">
                    <Switch
                      checked={alertSourceForm.enabled}
                      onChange={checked => setAlertSourceForm((f: any) => ({ ...f, enabled: checked }))}
                    />
                    <span className="ml-2 text-xs text-[var(--muted)]">启用后参与同步和 RCA 智能归因。</span>
                  </Form.Item>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">连接与密钥</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px]">
                    <Form.Item label="Endpoint">
                      <Input
                        value={alertSourceForm.endpoint}
                        onChange={e => setAlertSourceForm((f: any) => ({ ...f, endpoint: e.target.value }))}
                        placeholder="https://alerts.example.com/api"
                      />
                    </Form.Item>
                    <Form.Item label="超时秒">
                      <Input
                        type="number"
                        min={1}
                        value={alertSourceForm.timeout_s}
                        onChange={e => setAlertSourceForm((f: any) => ({ ...f, timeout_s: e.target.value }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label="密钥引用">
                    <Input
                      value={alertSourceForm.auth_ref}
                      onChange={e => setAlertSourceForm((f: any) => ({ ...f, auth_ref: e.target.value }))}
                      placeholder="env://PROM_TOKEN"
                    />
                  </Form.Item>
                  <p className="text-xs text-[var(--muted)]">只保存 SecretRef，不保存明文密钥。</p>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">标签与样例</p>
                  <Form.Item label="标签">
                    <Input.TextArea
                      autoSize={{ minRows: 3, maxRows: 5 }}
                      value={alertSourceForm.labels}
                      onChange={e => setAlertSourceForm((f: any) => ({ ...f, labels: e.target.value }))}
                      placeholder="environment=production"
                    />
                  </Form.Item>
                  <Form.Item label="样例 payload JSON">
                    <Input.TextArea
                      autoSize={{ minRows: 6, maxRows: 10 }}
                      value={alertSourceForm.sample_payload}
                      onChange={e => setAlertSourceForm((f: any) => ({ ...f, sample_payload: e.target.value }))}
                      placeholder="用于无外网或 Webhook dry-run 测试"
                    />
                  </Form.Item>
                </div>

                <Space className="mt-4" wrap>
                  <Button type="primary" htmlType="submit" loading={createAlertSource.isPending} disabled={!alertSourceForm.name.trim()}>
                    保存告警源
                  </Button>
                  <Button onClick={() => setAlertSourceDrawerOpen(false)}>取消</Button>
                </Space>
                {createAlertSource.error && <p className="mt-3 text-xs text-red-600">{(createAlertSource.error as Error).message}</p>}
              </Form>
            </div>
          </Drawer>
          <Drawer
            title={alertNoiseConfigDrawer === "silence" ? "配置告警静默" : "配置降噪策略"}
            open={Boolean(alertNoiseConfigDrawer)}
            onClose={() => setAlertNoiseConfigDrawer(null)}
            width="min(640px, 100vw)"
          >
            <div className="alertNoiseFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={alertNoiseConfigDrawer === "silence" ? 1 : 2}
                items={[
                  { title: "规则" },
                  { title: "范围" },
                  { title: "生效" },
                ]}
              />
              {alertNoiseConfigDrawer === "silence" ? (
                <Form layout="vertical" requiredMark={false} onFinish={() => createAlertSilence.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">静默范围</p>
                    <Form.Item className="mt-3" label="静默名称" required>
                      <Input
                        value={alertSilenceForm.name}
                        onChange={e => setAlertSilenceForm((f: any) => ({ ...f, name: e.target.value }))}
                        placeholder="维护窗口静默"
                      />
                    </Form.Item>
                    <Form.Item label="匹配器">
                      <Input.TextArea
                        autoSize={{ minRows: 4, maxRows: 7 }}
                        value={alertSilenceForm.matchers}
                        onChange={e => setAlertSilenceForm((f: any) => ({ ...f, matchers: e.target.value }))}
                        placeholder="environment=staging"
                      />
                    </Form.Item>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">窗口与责任人</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="开始时间">
                        <Input
                          value={alertSilenceForm.starts_at}
                          onChange={e => setAlertSilenceForm((f: any) => ({ ...f, starts_at: e.target.value }))}
                          placeholder="ISO 时间，可空"
                        />
                      </Form.Item>
                      <Form.Item label="结束时间">
                        <Input
                          value={alertSilenceForm.ends_at}
                          onChange={e => setAlertSilenceForm((f: any) => ({ ...f, ends_at: e.target.value }))}
                          placeholder="ISO 时间，可空"
                        />
                      </Form.Item>
                    </div>
                    <Form.Item label="原因">
                      <Input
                        value={alertSilenceForm.reason}
                        onChange={e => setAlertSilenceForm((f: any) => ({ ...f, reason: e.target.value }))}
                        placeholder="维护窗口或非生产环境降噪"
                      />
                    </Form.Item>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Form.Item label="Owner">
                        <Input
                          value={alertSilenceForm.owner}
                          onChange={e => setAlertSilenceForm((f: any) => ({ ...f, owner: e.target.value }))}
                        />
                      </Form.Item>
                      <Form.Item label="启用静默">
                        <Switch
                          checked={alertSilenceForm.enabled}
                          onChange={checked => setAlertSilenceForm((f: any) => ({ ...f, enabled: checked }))}
                        />
                      </Form.Item>
                    </div>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={createAlertSilence.isPending} disabled={!alertSilenceForm.name.trim()}>
                      保存静默
                    </Button>
                    <Button onClick={() => setAlertNoiseConfigDrawer(null)}>取消</Button>
                  </Space>
                  {createAlertSilence.error && <p className="mt-3 text-xs text-red-600">{(createAlertSilence.error as Error).message}</p>}
                </Form>
              ) : (
                <Form layout="vertical" requiredMark={false} onFinish={() => createAlertNoisePolicy.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">策略规则</p>
                    <Form.Item className="mt-3" label="策略名称" required>
                      <Input
                        value={alertNoisePolicyForm.name}
                        onChange={e => setAlertNoisePolicyForm((f: any) => ({ ...f, name: e.target.value }))}
                        placeholder="生产告警降噪策略"
                      />
                    </Form.Item>
                    <Form.Item label="分组字段">
                      <Input
                        value={alertNoisePolicyForm.group_by}
                        onChange={e => setAlertNoisePolicyForm((f: any) => ({ ...f, group_by: e.target.value }))}
                        placeholder="service,alertname,source_id"
                      />
                    </Form.Item>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">降噪动作</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="RCA 阈值">
                        <Select
                          value={alertNoisePolicyForm.min_rca_severity}
                          onChange={value => setAlertNoisePolicyForm((f: any) => ({ ...f, min_rca_severity: value }))}
                          options={["critical", "high", "medium", "low", "info"].map(item => ({ label: item, value: item }))}
                        />
                      </Form.Item>
                      <Form.Item label="抑制级别">
                        <Input
                          value={alertNoisePolicyForm.suppress_severities}
                          onChange={e => setAlertNoisePolicyForm((f: any) => ({ ...f, suppress_severities: e.target.value }))}
                          placeholder="info,low"
                        />
                      </Form.Item>
                    </div>
                    <Form.Item label="策略说明">
                      <Input.TextArea
                        autoSize={{ minRows: 3, maxRows: 5 }}
                        value={alertNoisePolicyForm.note}
                        onChange={e => setAlertNoisePolicyForm((f: any) => ({ ...f, note: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="启用策略">
                      <Switch
                        checked={alertNoisePolicyForm.enabled}
                        onChange={checked => setAlertNoisePolicyForm((f: any) => ({ ...f, enabled: checked }))}
                      />
                    </Form.Item>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={createAlertNoisePolicy.isPending} disabled={!alertNoisePolicyForm.name.trim()}>
                      保存策略
                    </Button>
                    <Button onClick={() => setAlertNoiseConfigDrawer(null)}>取消</Button>
                  </Space>
                  {createAlertNoisePolicy.error && <p className="mt-3 text-xs text-red-600">{(createAlertNoisePolicy.error as Error).message}</p>}
                </Form>
              )}
            </div>
          </Drawer>
          <Drawer
            title="配置 SLO 自动升级"
            open={alertSloEscalationDrawerOpen}
            onClose={() => setAlertSloEscalationDrawerOpen(false)}
            width="min(680px, 100vw)"
          >
            <div className="alertSloEscalationFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={1}
                items={[
                  { title: "阈值" },
                  { title: "动作" },
                  { title: "证据" },
                ]}
              />
              <Form layout="vertical" requiredMark={false} onFinish={() => saveAlertSloEscalationPolicy.mutate()}>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">升级阈值</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="最低风险">
                      <Select
                        value={alertSloEscalationForm.min_risk_level}
                        onChange={value => setAlertSloEscalationForm((f: any) => ({ ...f, min_risk_level: value }))}
                        options={["critical", "high", "watch", "healthy"].map(item => ({ label: item, value: item }))}
                      />
                    </Form.Item>
                    <Form.Item label="违约概率阈值">
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step="0.05"
                        value={alertSloEscalationForm.min_breach_probability}
                        onChange={e => setAlertSloEscalationForm((f: any) => ({ ...f, min_breach_probability: e.target.value }))}
                        placeholder="0.35"
                      />
                    </Form.Item>
                    <Form.Item label="最大升级对象">
                      <Input
                        type="number"
                        min={1}
                        value={alertSloEscalationForm.max_targets}
                        onChange={e => setAlertSloEscalationForm((f: any) => ({ ...f, max_targets: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="冷却分钟">
                      <Input
                        type="number"
                        min={0}
                        value={alertSloEscalationForm.cooldown_minutes}
                        onChange={e => setAlertSloEscalationForm((f: any) => ({ ...f, cooldown_minutes: e.target.value }))}
                      />
                    </Form.Item>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">动作与责任人</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="动作">
                      <Input
                        value={alertSloEscalationForm.actions}
                        onChange={e => setAlertSloEscalationForm((f: any) => ({ ...f, actions: e.target.value }))}
                        placeholder="create_task,im_notify"
                      />
                    </Form.Item>
                    <Form.Item label="优先级">
                      <Select
                        value={alertSloEscalationForm.priority}
                        onChange={value => setAlertSloEscalationForm((f: any) => ({ ...f, priority: value }))}
                        options={["P0", "P1", "P2", "P3"].map(item => ({ label: item, value: item }))}
                      />
                    </Form.Item>
                    <Form.Item label="负责人">
                      <Input
                        value={alertSloEscalationForm.assigned_to}
                        onChange={e => setAlertSloEscalationForm((f: any) => ({ ...f, assigned_to: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="执行工具">
                      <Input
                        value={alertSloEscalationForm.dev_tool}
                        onChange={e => setAlertSloEscalationForm((f: any) => ({ ...f, dev_tool: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="Owner">
                      <Input
                        value={alertSloEscalationForm.owner}
                        onChange={e => setAlertSloEscalationForm((f: any) => ({ ...f, owner: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="启用策略">
                      <Switch
                        checked={alertSloEscalationForm.enabled}
                        onChange={checked => setAlertSloEscalationForm((f: any) => ({ ...f, enabled: checked }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label="说明">
                    <Input.TextArea
                      autoSize={{ minRows: 3, maxRows: 5 }}
                      value={alertSloEscalationForm.note}
                      onChange={e => setAlertSloEscalationForm((f: any) => ({ ...f, note: e.target.value }))}
                    />
                  </Form.Item>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-sm font-semibold">执行证据</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">保存只更新策略；预览和执行会复用当前表单参数、IM 通道和 24 小时预测窗口。</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">最近候选</p>
                      <p className="text-sm font-semibold">{latestSloEscalation?.summary?.candidates ?? alertSloEscalationRunsQ.data?.summary?.latest_candidates ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">已建任务</p>
                      <p className="text-sm font-semibold">{latestSloEscalation?.summary?.created ?? alertSloEscalationRunsQ.data?.summary?.latest_created ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">IM 通道</p>
                      <p className="text-sm font-semibold">{imChannels.length}</p>
                    </div>
                  </div>
                </div>

                <Space className="mt-4" wrap>
                  <Button type="primary" htmlType="submit" loading={saveAlertSloEscalationPolicy.isPending}>
                    保存策略
                  </Button>
                  <Button onClick={() => runAlertSloEscalation.mutate(true)} loading={runAlertSloEscalation.isPending}>
                    预览升级
                  </Button>
                  <Button danger onClick={() => runAlertSloEscalation.mutate(false)} loading={runAlertSloEscalation.isPending}>
                    执行升级
                  </Button>
                  <Button onClick={() => setAlertSloEscalationDrawerOpen(false)}>取消</Button>
                </Space>
                {(saveAlertSloEscalationPolicy.error || runAlertSloEscalation.error) && (
                  <p className="mt-3 text-xs text-red-600">{((saveAlertSloEscalationPolicy.error || runAlertSloEscalation.error) as Error).message}</p>
                )}
              </Form>
            </div>
          </Drawer>
          <Drawer
            title="配置策略灰度审计"
            open={alertStrategyCanaryDrawerOpen}
            onClose={() => setAlertStrategyCanaryDrawerOpen(false)}
            width="min(680px, 100vw)"
          >
            <div className="alertStrategyCanaryFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={1}
                items={[
                  { title: "候选" },
                  { title: "灰度" },
                  { title: "审批" },
                ]}
              />
              <Form layout="vertical" requiredMark={false} onFinish={() => runAlertStrategyCanaryAudit.mutate()}>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">候选策略</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="基准策略">
                      <Select
                        value={alertStrategyCanaryForm.policy_id}
                        onChange={value => setAlertStrategyCanaryForm((f: any) => ({ ...f, policy_id: value }))}
                        options={[
                          { label: "自动选择候选策略", value: "" },
                          ...(alertNoiseQ.data?.items ?? []).map((item: any) => ({ label: item.name, value: item.id })),
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="候选策略">
                      <Select
                        value={alertStrategyCanaryForm.candidate_id}
                        onChange={value => setAlertStrategyCanaryForm((f: any) => ({ ...f, candidate_id: value }))}
                        options={[
                          { label: "使用 A/B 胜出策略", value: "" },
                          ...(latestStrategyCompare?.items ?? []).slice(0, 8).map((item: any) => ({ label: item.name, value: item.id })),
                        ]}
                      />
                    </Form.Item>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">灰度参数</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="灰度流量">
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={alertStrategyCanaryForm.traffic_percent}
                        onChange={e => setAlertStrategyCanaryForm((f: any) => ({ ...f, traffic_percent: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="审批人">
                      <Input
                        value={alertStrategyCanaryForm.created_by}
                        onChange={e => setAlertStrategyCanaryForm((f: any) => ({ ...f, created_by: e.target.value }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label="审计备注">
                    <Input.TextArea
                      autoSize={{ minRows: 3, maxRows: 5 }}
                      value={alertStrategyCanaryForm.note}
                      onChange={e => setAlertStrategyCanaryForm((f: any) => ({ ...f, note: e.target.value }))}
                    />
                  </Form.Item>
                  <Form.Item label="刷新输入证据">
                    <Switch
                      checked={alertStrategyCanaryForm.refresh_inputs}
                      onChange={checked => setAlertStrategyCanaryForm((f: any) => ({ ...f, refresh_inputs: checked }))}
                    />
                    <span className="ml-2 text-xs text-[var(--muted)]">重新计算策略对比和 SLO 风险。</span>
                  </Form.Item>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-sm font-semibold">审批证据</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">准入分</p>
                      <p className="text-sm font-semibold">{latestStrategyCanary?.summary?.readiness_score ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_readiness_score ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">建议流量</p>
                      <p className="text-sm font-semibold">{latestStrategyCanary?.summary?.recommended_percent ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_recommended_percent ?? 0}%</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">结论</p>
                      <p className="text-sm font-semibold">{latestStrategyCanary?.summary?.decision ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_decision ?? "-"}</p>
                    </div>
                  </div>
                </div>

                <Space className="mt-4" wrap>
                  <Button type="primary" htmlType="submit" loading={runAlertStrategyCanaryAudit.isPending}>
                    生成灰度审计
                  </Button>
                  <Button onClick={() => setAlertStrategyCanaryDrawerOpen(false)}>取消</Button>
                </Space>
                {runAlertStrategyCanaryAudit.error && <p className="mt-3 text-xs text-red-600">{(runAlertStrategyCanaryAudit.error as Error).message}</p>}
              </Form>
            </div>
          </Drawer>
          <Drawer
            title="配置跨模块联动"
            open={opsStrategyLinkageDrawerOpen}
            onClose={() => setOpsStrategyLinkageDrawerOpen(false)}
            width="min(680px, 100vw)"
          >
            <div className="opsStrategyLinkageFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={1}
                items={[
                  { title: "范围" },
                  { title: "动作" },
                  { title: "证据" },
                ]}
              />
              <Form layout="vertical" requiredMark={false} onFinish={() => runOpsStrategyLinkage.mutate(true)}>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">联动范围</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="动作">
                      <Input
                        value={opsStrategyLinkageForm.actions}
                        onChange={e => setOpsStrategyLinkageForm((f: any) => ({ ...f, actions: e.target.value }))}
                        placeholder="create_task,im_notify"
                      />
                    </Form.Item>
                    <Form.Item label="最大联动项">
                      <Input
                        type="number"
                        min={1}
                        value={opsStrategyLinkageForm.max_items}
                        onChange={e => setOpsStrategyLinkageForm((f: any) => ({ ...f, max_items: e.target.value }))}
                      />
                    </Form.Item>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">任务与投递</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="优先级">
                      <Select
                        value={opsStrategyLinkageForm.priority}
                        onChange={value => setOpsStrategyLinkageForm((f: any) => ({ ...f, priority: value }))}
                        options={["P0", "P1", "P2", "P3"].map(item => ({ label: item, value: item }))}
                      />
                    </Form.Item>
                    <Form.Item label="负责人">
                      <Input
                        value={opsStrategyLinkageForm.assigned_to}
                        onChange={e => setOpsStrategyLinkageForm((f: any) => ({ ...f, assigned_to: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="执行工具">
                      <Input
                        value={opsStrategyLinkageForm.dev_tool}
                        onChange={e => setOpsStrategyLinkageForm((f: any) => ({ ...f, dev_tool: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="IM 通道">
                      <Input value={`${imChannels.length} 个已选通道`} disabled />
                    </Form.Item>
                  </div>
                  <Form.Item label="联动说明">
                    <Input.TextArea
                      autoSize={{ minRows: 3, maxRows: 5 }}
                      value={opsStrategyLinkageForm.note}
                      onChange={e => setOpsStrategyLinkageForm((f: any) => ({ ...f, note: e.target.value }))}
                    />
                  </Form.Item>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-sm font-semibold">联动证据</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">预览不会落库；执行会创建治理任务并按 Notify 计划发送风险简报。</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">联动项</p>
                      <p className="text-sm font-semibold">{latestOpsStrategyLinkage?.summary?.linkage_items ?? opsStrategyLinkageRunsQ.data?.summary?.latest_items ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">高风险</p>
                      <p className="text-sm font-semibold">{latestOpsStrategyLinkage?.summary?.high_risk ?? opsStrategyLinkageRunsQ.data?.summary?.latest_high_risk ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">已建任务</p>
                      <p className="text-sm font-semibold">{latestOpsStrategyLinkage?.summary?.created ?? opsStrategyLinkageRunsQ.data?.summary?.latest_created ?? 0}</p>
                    </div>
                  </div>
                </div>

                <Space className="mt-4" wrap>
                  <Button type="primary" htmlType="submit" loading={runOpsStrategyLinkage.isPending}>
                    预览联动
                  </Button>
                  <Button danger onClick={() => runOpsStrategyLinkage.mutate(false)} loading={runOpsStrategyLinkage.isPending}>
                    执行联动
                  </Button>
                  <Button onClick={() => setOpsStrategyLinkageDrawerOpen(false)}>取消</Button>
                </Space>
                {runOpsStrategyLinkage.error && <p className="mt-3 text-xs text-red-600">{(runOpsStrategyLinkage.error as Error).message}</p>}
              </Form>
            </div>
          </Drawer>
          </>
  );
}
