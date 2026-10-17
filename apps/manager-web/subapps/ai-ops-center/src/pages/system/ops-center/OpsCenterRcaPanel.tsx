import { ProjectOwnerSelect } from "@/components/DeliveryMemberIdentity";
import { Button, Drawer, Form, Input, Select, Space, Steps } from "antd";
import { RefreshButton } from "@/components/PageStates";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type OpsCenterRcaPanelProps = {
  rcaQ: any;
  rcaForm: any;
  setRcaForm: any;
  rcaCreateDrawerOpen: any;
  setRcaCreateDrawerOpen: any;
  createRca: any;
  rcaInsightFilter: any;
  setRcaInsightFilter: any;
  rcaInsightDrawerOpen: any;
  setRcaInsightDrawerOpen: any;
  rcaInsightResult: any;
  analyzeRcaInsights: any;
  createRcaInsightTasks: any;
  rcaInsightTasksResult: any;
  createRcaFromInsight: any;
  rcaInsightCreateResult: any;
  rcaVerifyResult: any;
  loadRcaVerificationPlan: any;
  verifyRca: any;
  resolveRca: any;
};

function severityClass(level?: string) {
  if (level === "critical") return "bg-red-50 text-red-700";
  if (level === "high") return "bg-orange-50 text-orange-700";
  if (level === "medium") return "bg-yellow-50 text-yellow-700";
  return "bg-green-50 text-green-700";
}

export function OpsCenterRcaPanel({
  rcaQ,
  rcaForm,
  setRcaForm,
  rcaCreateDrawerOpen,
  setRcaCreateDrawerOpen,
  createRca,
  rcaInsightFilter,
  setRcaInsightFilter,
  rcaInsightDrawerOpen,
  setRcaInsightDrawerOpen,
  rcaInsightResult,
  analyzeRcaInsights,
  createRcaInsightTasks,
  rcaInsightTasksResult,
  createRcaFromInsight,
  rcaInsightCreateResult,
  rcaVerifyResult,
  loadRcaVerificationPlan,
  verifyRca,
  resolveRca,
}: OpsCenterRcaPanelProps) {
  return (
          <WorkbenchPanel title="根因分析" actions={
            <div className="flex gap-2">
              <RefreshButton onClick={() => void rcaQ.refetch()} pending={rcaQ.isFetching} />
              <Button type="primary" size="small" onClick={() => setRcaCreateDrawerOpen(true)}>新建 RCA</Button>
            </div>
          }>
            <Drawer
              title="新建 RCA"
              open={rcaCreateDrawerOpen}
              onClose={() => setRcaCreateDrawerOpen(false)}
              width="min(620px, 100vw)"
            >
              <div className="rcaCreateFocusedDrawer space-y-5">
                <Steps
                  size="small"
                  current={rcaForm.incident_id && rcaForm.root_cause ? 1 : 0}
                  items={[
                    { title: "事件" },
                    { title: "根因" },
                    { title: "闭环" },
                  ]}
                />
                <Form layout="vertical" requiredMark={false} onFinish={() => createRca.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">事件信息</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="事件 ID" required>
                        <Input value={rcaForm.incident_id} onChange={e => setRcaForm((f: any) => ({ ...f, incident_id: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="影响范围">
                        <Input value={rcaForm.impact} onChange={e => setRcaForm((f: any) => ({ ...f, impact: e.target.value }))} />
                      </Form.Item>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">根因与处置</p>
                    <Form.Item className="mt-3" label="根因描述" required>
                      <Input.TextArea
                        autoSize={{ minRows: 3, maxRows: 5 }}
                        value={rcaForm.root_cause}
                        onChange={e => setRcaForm((f: any) => ({ ...f, root_cause: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="解决方案">
                      <Input.TextArea
                        autoSize={{ minRows: 3, maxRows: 5 }}
                        value={rcaForm.resolution}
                        onChange={e => setRcaForm((f: any) => ({ ...f, resolution: e.target.value }))}
                      />
                    </Form.Item>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">创建后闭环</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">RCA 创建后会进入列表，可继续生成验证计划、执行验证关闭，并与 Runbook 和任务中心形成治理证据。</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">事件</p>
                        <p className="truncate text-sm font-semibold">{rcaForm.incident_id || "-"}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">影响</p>
                        <p className="truncate text-sm font-semibold">{rcaForm.impact || "待补充"}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">状态</p>
                        <p className="text-sm font-semibold">{rcaForm.root_cause ? "可创建" : "待补根因"}</p>
                      </div>
                    </div>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={createRca.isPending} disabled={!rcaForm.incident_id || !rcaForm.root_cause}>
                      创建 RCA
                    </Button>
                    <Button onClick={() => setRcaCreateDrawerOpen(false)}>取消</Button>
                  </Space>
                  {createRca.error && <p className="mt-3 text-xs text-red-600">{(createRca.error as Error).message}</p>}
                </Form>
              </div>
            </Drawer>
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">智能根因归因</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">聚合 Trace、数据质量告警、计费提醒、失败流水线和未关闭 RCA，生成可任务化的根因候选。</p>
                </div>
                <Space wrap>
                  <span className={`rounded-full px-2 py-1 text-xs ${severityClass((rcaInsightResult?.candidates ?? [])[0]?.severity)}`}>
                    {(rcaInsightResult?.summary?.candidates ?? 0) || "待分析"} 候选
                  </span>
                  <Button size="small" onClick={() => setRcaInsightDrawerOpen(true)}>配置归因</Button>
                </Space>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Agent Run", rcaInsightFilter.run_id || "全部运行"],
                  ["Trace", rcaInsightFilter.trace_id || "自动聚合"],
                  ["Correlation", rcaInsightFilter.correlation_id || "自动聚合"],
                  ["采样/任务", `${rcaInsightFilter.limit} / ${rcaInsightFilter.priority}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-[var(--surface-muted)] p-3">
                    <p className="text-[11px] uppercase text-[var(--muted)]">{label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[var(--text)]">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => analyzeRcaInsights.mutate()} disabled={analyzeRcaInsights.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                  {analyzeRcaInsights.isPending ? "分析中..." : "生成归因"}
                </button>
                <button onClick={() => createRcaInsightTasks.mutate(true)} disabled={createRcaInsightTasks.isPending || !rcaInsightResult} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm disabled:opacity-50">预览任务</button>
                <button onClick={() => createRcaInsightTasks.mutate(false)} disabled={createRcaInsightTasks.isPending || !rcaInsightResult} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm disabled:opacity-50">创建任务</button>
              </div>
              {analyzeRcaInsights.error && <p className="mt-2 text-xs text-red-600">{(analyzeRcaInsights.error as Error).message}</p>}
              {createRcaInsightTasks.error && <p className="mt-2 text-xs text-red-600">{(createRcaInsightTasks.error as Error).message}</p>}
              {rcaInsightResult && (
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
                  <div className="space-y-3">
                    {(rcaInsightResult.candidates ?? []).map((item: any) => (
                      <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{item.title}</p>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${severityClass(item.severity)}`}>{item.severity} / {Math.round(Number(item.confidence || 0) * 100)}%</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.root_cause}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(item.evidence ?? []).slice(0, 4).map((ev: any, idx: number) => (
                            <span key={`${item.id}-ev-${idx}`} className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[11px] text-[var(--muted-strong)]">{ev.type}: {ev.label || ev.status || "-"}</span>
                          ))}
                        </div>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--muted)]">
                          {(item.recommendations ?? []).slice(0, 3).map((rec: string) => <li key={rec}>{rec}</li>)}
                        </ul>
                        {(item.recommended_runbooks ?? []).length > 0 && (
                          <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-2">
                            <p className="text-[11px] font-semibold uppercase text-[var(--muted)]">推荐 Runbook</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(item.recommended_runbooks ?? []).slice(0, 3).map((runbook: any) => (
                                <span key={runbook.id || runbook.name} className="rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--muted-strong)]">
                                  {runbook.name || runbook.id} / {runbook.match_score}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {item.kind !== "healthy_baseline" && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => createRcaFromInsight.mutate(item)}
                              disabled={createRcaFromInsight.isPending}
                              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] disabled:opacity-50"
                            >
                              生成 RCA
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <p className="text-xs font-semibold uppercase text-[var(--muted)]">归因摘要</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      {Object.entries(rcaInsightResult.summary ?? {}).map(([key, value]) => (
                        <div key={key} className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                          <p className="text-[10px] uppercase text-[var(--muted)]">{key}</p>
                          <p className="mt-1 font-semibold text-[var(--text)]">{String(value)}</p>
                        </div>
                      ))}
                    </div>
                    {rcaInsightTasksResult && (
                      <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                        <p className="font-semibold text-[var(--text)]">{rcaInsightTasksResult.dry_run ? "任务预览" : "已创建任务"}：{rcaInsightTasksResult.summary?.created ?? rcaInsightTasksResult.summary?.planned ?? 0}</p>
                        <div className="mt-2 space-y-2">
                          {(rcaInsightTasksResult.tasks ?? rcaInsightTasksResult.items ?? []).slice(0, 4).map((task: any) => (
                            <p key={task.id || task.title} className="rounded bg-[var(--surface)] px-2 py-1 text-[var(--muted-strong)]">{task.title}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {rcaInsightCreateResult && (
                      <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                        <p className="font-semibold text-[var(--text)]">已生成 RCA：{rcaInsightCreateResult.item?.incident_id}</p>
                        <p className="mt-1 text-[var(--muted)]">{rcaInsightCreateResult.item?.root_cause}</p>
                      </div>
                    )}
                    {createRcaFromInsight.error && <p className="mt-2 text-xs text-red-600">{(createRcaFromInsight.error as Error).message}</p>}
                  </div>
                </div>
              )}
            </div>
            <Drawer
              title="配置智能根因归因"
              open={rcaInsightDrawerOpen}
              onClose={() => setRcaInsightDrawerOpen(false)}
              width="min(680px, 100vw)"
            >
              <div className="rcaInsightFocusedDrawer space-y-5">
                <Steps
                  size="small"
                  current={rcaInsightTasksResult ? 2 : rcaInsightResult ? 1 : 0}
                  items={[
                    { title: "归因范围" },
                    { title: "生成候选" },
                    { title: "任务闭环" },
                  ]}
                />
                <Form layout="vertical" requiredMark={false} onFinish={() => analyzeRcaInsights.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">归因范围</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">留空时聚合当前作用域的 Trace、流水线、告警、计费和未关闭 RCA。</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="Agent Run ID">
                        <Input value={rcaInsightFilter.run_id} onChange={e => setRcaInsightFilter((f: any) => ({ ...f, run_id: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="Trace ID">
                        <Input value={rcaInsightFilter.trace_id} onChange={e => setRcaInsightFilter((f: any) => ({ ...f, trace_id: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="Correlation ID">
                        <Input value={rcaInsightFilter.correlation_id} onChange={e => setRcaInsightFilter((f: any) => ({ ...f, correlation_id: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="采样数量">
                        <Input
                          type="number"
                          min={1}
                          value={rcaInsightFilter.limit}
                          onChange={e => setRcaInsightFilter((f: any) => ({ ...f, limit: e.target.value }))}
                        />
                      </Form.Item>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">任务化参数</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Form.Item label="优先级">
                        <Select
                          value={rcaInsightFilter.priority}
                          onChange={value => setRcaInsightFilter((f: any) => ({ ...f, priority: value }))}
                          options={["P0", "P1", "P2", "P3"].map(item => ({ label: item, value: item }))}
                        />
                      </Form.Item>
                      <Form.Item label="负责人">
                        <ProjectOwnerSelect value={rcaInsightFilter.owner_id} onChange={(owner_id) => setRcaInsightFilter((f: any) => ({ ...f, owner_id: owner_id }))} />
                      </Form.Item>
                      <Form.Item label="执行工具">
                        <Input value={rcaInsightFilter.dev_tool} onChange={e => setRcaInsightFilter((f: any) => ({ ...f, dev_tool: e.target.value }))} />
                      </Form.Item>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">归因证据</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">先生成候选，再按当前任务参数预览或创建治理任务。</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">候选</p>
                        <p className="text-sm font-semibold">{rcaInsightResult?.summary?.candidates ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">高风险</p>
                        <p className="text-sm font-semibold">{rcaInsightResult?.summary?.high_risk ?? rcaInsightResult?.summary?.critical ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">任务</p>
                        <p className="text-sm font-semibold">{rcaInsightTasksResult?.summary?.created ?? rcaInsightTasksResult?.summary?.planned ?? 0}</p>
                      </div>
                    </div>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={analyzeRcaInsights.isPending}>
                      生成归因
                    </Button>
                    <Button onClick={() => createRcaInsightTasks.mutate(true)} disabled={!rcaInsightResult} loading={createRcaInsightTasks.isPending}>
                      预览任务
                    </Button>
                    <Button danger onClick={() => createRcaInsightTasks.mutate(false)} disabled={!rcaInsightResult} loading={createRcaInsightTasks.isPending}>
                      创建任务
                    </Button>
                    <Button onClick={() => setRcaInsightDrawerOpen(false)}>取消</Button>
                  </Space>
                  {analyzeRcaInsights.error && <p className="mt-3 text-xs text-red-600">{(analyzeRcaInsights.error as Error).message}</p>}
                  {createRcaInsightTasks.error && <p className="mt-3 text-xs text-red-600">{(createRcaInsightTasks.error as Error).message}</p>}
                </Form>
              </div>
            </Drawer>
            {rcaVerifyResult && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">RCA 验证闭环：{rcaVerifyResult.incident_id || rcaVerifyResult.item?.incident_id}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">评分 {rcaVerifyResult.plan?.score ?? rcaVerifyResult.score ?? 0}，状态 {rcaVerifyResult.plan?.status ?? rcaVerifyResult.status ?? rcaVerifyResult.verification?.status}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${(rcaVerifyResult.plan?.status ?? rcaVerifyResult.status) === "passed" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {rcaVerifyResult.item?.status || rcaVerifyResult.plan?.status || rcaVerifyResult.status}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-3">
                  {(rcaVerifyResult.plan?.checks ?? rcaVerifyResult.checks ?? []).map((check: any) => (
                    <div key={check.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-[var(--text)]">{check.title}</p>
                        <span className={check.status === "passed" ? "text-green-700" : check.status === "failed" ? "text-red-700" : "text-amber-700"}>{check.status}</span>
                      </div>
                      <p className="mt-1 leading-5 text-[var(--muted)]">{check.recommendation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-3">
              {(rcaQ.data?.items ?? []).length === 0 && <p className="py-8 text-center text-sm text-[var(--muted)]">暂无根因分析记录</p>}
              {(rcaQ.data?.items ?? []).map((r: any) => (
                <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs text-[var(--muted)]">事件: {r.incident_id}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "open" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{r.status}</span>
                  </div>
	                  <p className="text-sm font-medium">{r.root_cause}</p>
	                  {r.resolution && <p className="mt-1 text-xs text-[var(--muted)]">解决方案: {r.resolution}</p>}
                    {r.source === "ops_center_rca_insight" && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--muted-strong)]">
                        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1">智能归因</span>
                        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1">{r.severity} / {Math.round(Number(r.confidence || 0) * 100)}%</span>
                        {(r.selected_runbook_ids ?? []).slice(0, 3).map((id: string) => <span key={id} className="rounded-full bg-[var(--surface-muted)] px-2 py-1">Runbook: {id}</span>)}
                      </div>
                    )}
                    {(r.verification_status || r.verified_at) && (
                      <p className="mt-2 text-[11px] text-[var(--muted)]">最近验证：{r.verification_status || "watch"} / {r.verification_score ?? 0} / {r.verified_by || "-"}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => loadRcaVerificationPlan.mutate(r.id)} disabled={loadRcaVerificationPlan.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50">验证计划</button>
                      {r.status === "open" && <button onClick={() => verifyRca.mutate(r)} disabled={verifyRca.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">验证并关闭</button>}
                      {r.status === "open" && <button onClick={() => resolveRca.mutate(r.id)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--brand)]">手动关闭</button>}
                    </div>
                    {(loadRcaVerificationPlan.error || verifyRca.error) && <p className="mt-2 text-xs text-red-600">{((loadRcaVerificationPlan.error || verifyRca.error) as Error).message}</p>}
	                </div>
              ))}
            </div>
          </WorkbenchPanel>

  );
}
