import { Button, Drawer, Form, Input, Space, Steps, Switch } from "antd";
import { RefreshButton } from "@/components/PageStates";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type OpsCenterSelfHealPanelProps = {
  shQ: any;
  evalQ: any;
  actionsQ: any;
  shForm: any;
  setShForm: any;
  selfHealPolicyDrawerOpen: any;
  setSelfHealPolicyDrawerOpen: any;
  signalText: any;
  setSignalText: any;
  selfHealSignalDrawerOpen: any;
  setSelfHealSignalDrawerOpen: any;
  healResult: any;
  healTasksResult: any;
  healActionResult: any;
  selfHealActionDrawerOpen: any;
  setSelfHealActionDrawerOpen: any;
  setSelectedHealActionId: any;
  createSh: any;
  evaluateSh: any;
  createHealTasks: any;
  applySh: any;
  toggleSh: any;
  deleteSh: any;
  approveAction: any;
  applyAction: any;
  verifyAction: any;
  rollbackAction: any;
  selfHealActions: any;
  selectedHealAction: any;
};

function parseSignals(value: string) {
  const out: Record<string, unknown> = {};
  for (const line of value.split(/\n|,/)) {
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey?.trim();
    const rawValue = rest.join("=").trim();
    if (!key || rawValue === "") continue;
    const n = Number(rawValue);
    out[key] = Number.isFinite(n) && rawValue !== "" ? n : rawValue;
  }
  return out;
}

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

function actionStepIndex(state?: string) {
  if (state === "verified" || state === "rolled_back") return 3;
  if (state === "applied") return 2;
  if (state === "approved") return 1;
  return 0;
}

export function OpsCenterSelfHealPanel({
  shQ,
  evalQ,
  actionsQ,
  shForm,
  setShForm,
  selfHealPolicyDrawerOpen,
  setSelfHealPolicyDrawerOpen,
  signalText,
  setSignalText,
  selfHealSignalDrawerOpen,
  setSelfHealSignalDrawerOpen,
  healResult,
  healTasksResult,
  healActionResult,
  selfHealActionDrawerOpen,
  setSelfHealActionDrawerOpen,
  setSelectedHealActionId,
  createSh,
  evaluateSh,
  createHealTasks,
  applySh,
  toggleSh,
  deleteSh,
  approveAction,
  applyAction,
  verifyAction,
  rollbackAction,
  selfHealActions,
  selectedHealAction,
}: OpsCenterSelfHealPanelProps) {
  return (
          <div className="grid gap-4 xl:grid-cols-[minmax(420px,1fr)_minmax(420px,1fr)]">
            <WorkbenchPanel title="策略目录与信号评估" actions={
              <div className="flex gap-2">
                <RefreshButton onClick={() => { void shQ.refetch(); void evalQ.refetch(); void actionsQ.refetch(); }} pending={shQ.isFetching || evalQ.isFetching || actionsQ.isFetching} />
                <Button size="small" onClick={() => setSelfHealSignalDrawerOpen(true)}>配置信号</Button>
                <Button type="primary" size="small" onClick={() => setSelfHealPolicyDrawerOpen(true)}>新建策略</Button>
              </div>
            }>
              <Drawer
                title="新建自愈策略"
                open={selfHealPolicyDrawerOpen}
                onClose={() => setSelfHealPolicyDrawerOpen(false)}
                width="min(620px, 100vw)"
              >
                <div className="selfHealPolicyFocusedDrawer space-y-5">
                  <Steps
                    size="small"
                    current={shForm.trigger_condition && shForm.action ? 1 : 0}
                    items={[
                      { title: "触发" },
                      { title: "动作" },
                      { title: "护栏" },
                    ]}
                  />
                  <Form layout="vertical" requiredMark={false} onFinish={() => createSh.mutate()}>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                      <p className="text-sm font-semibold">触发条件</p>
                      <Form.Item className="mt-3" label="条件表达式" required>
                        <Input
                          value={shForm.trigger_condition}
                          onChange={e => setShForm((f: any) => ({ ...f, trigger_condition: e.target.value }))}
                          placeholder="cpu > 90"
                        />
                      </Form.Item>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                      <p className="text-sm font-semibold">自愈动作</p>
                      <Form.Item className="mt-3" label="动作命令/API" required>
                        <Input
                          value={shForm.action}
                          onChange={e => setShForm((f: any) => ({ ...f, action: e.target.value }))}
                          placeholder="restart_service api"
                        />
                      </Form.Item>
                      <Form.Item label="启用策略">
                        <Switch checked={shForm.enabled} onChange={checked => setShForm((f: any) => ({ ...f, enabled: checked }))} />
                      </Form.Item>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <p className="text-sm font-semibold">护栏说明</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">策略创建后会参与信号评估；高风险动作仍会进入审批、应用、验证和回滚队列。</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">状态</p>
                          <p className="text-sm font-semibold">{shForm.enabled ? "启用" : "禁用"}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">策略数</p>
                          <p className="text-sm font-semibold">{shQ.data?.items?.length ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">动作队列</p>
                          <p className="text-sm font-semibold">{actionsQ.data?.items?.length ?? 0}</p>
                        </div>
                      </div>
                    </div>

                    <Space className="mt-4" wrap>
                      <Button type="primary" htmlType="submit" loading={createSh.isPending} disabled={!shForm.trigger_condition || !shForm.action}>
                        创建策略
                      </Button>
                      <Button onClick={() => setSelfHealPolicyDrawerOpen(false)}>取消</Button>
                    </Space>
                    {createSh.error && <p className="mt-3 text-xs text-red-600">{(createSh.error as Error).message}</p>}
                  </Form>
                </div>
              </Drawer>

              <Drawer
                title="配置自愈评估信号"
                open={selfHealSignalDrawerOpen}
                onClose={() => setSelfHealSignalDrawerOpen(false)}
                width="min(680px, 100vw)"
              >
                <div className="selfHealSignalFocusedDrawer space-y-5">
                  <Steps
                    size="small"
                    current={healTasksResult ? 2 : healResult ? 1 : 0}
                    items={[
                      { title: "信号" },
                      { title: "评估" },
                      { title: "任务" },
                    ]}
                  />
                  <Form layout="vertical" requiredMark={false} onFinish={() => evaluateSh.mutate()}>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                      <p className="text-sm font-semibold">运行信号</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">每行一个 key=value，支持 cpu、error_rate、latency_ms、environment、service 等字段。</p>
                      <Form.Item className="mt-3" label="信号输入" required>
                        <Input.TextArea
                          className="font-mono text-xs"
                          autoSize={{ minRows: 6, maxRows: 10 }}
                          value={signalText}
                          onChange={e => setSignalText(e.target.value)}
                          placeholder={"cpu=95\nerror_rate=3\nlatency_ms=1200\nenvironment=staging"}
                        />
                      </Form.Item>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <p className="text-sm font-semibold">评估证据</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">信号数</p>
                          <p className="text-sm font-semibold">{Object.keys(parseSignals(signalText)).length}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">命中</p>
                          <p className="text-sm font-semibold">{healResult?.summary?.matched ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">待审批</p>
                          <p className="text-sm font-semibold">{healResult?.summary?.needs_approval ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">任务</p>
                          <p className="text-sm font-semibold">{healTasksResult?.items?.length ?? 0}</p>
                        </div>
                      </div>
                    </div>

                    <Space className="mt-4" wrap>
                      <Button type="primary" htmlType="submit" loading={evaluateSh.isPending}>
                        评估自愈决策
                      </Button>
                      <Button onClick={() => createHealTasks.mutate(true)} loading={createHealTasks.isPending}>
                        预览治理任务
                      </Button>
                      <Button danger onClick={() => createHealTasks.mutate(false)} loading={createHealTasks.isPending}>
                        生成治理任务
                      </Button>
                      <Button onClick={() => setSelfHealSignalDrawerOpen(false)}>取消</Button>
                    </Space>
                    {evaluateSh.isError ? <p className="mt-3 text-xs text-red-600">{(evaluateSh.error as Error).message}</p> : null}
                  </Form>
                </div>
              </Drawer>

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["信号数", Object.keys(parseSignals(signalText)).length],
                    ["策略数", shQ.data?.items?.length ?? 0],
                    ["最近命中", healResult?.summary?.matched ?? 0],
                    ["待审批", healResult?.summary?.needs_approval ?? 0],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-[11px] uppercase text-[var(--muted)]">{label}</p>
                      <p className="mt-1 text-lg font-semibold">{String(value)}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="primary" onClick={() => evaluateSh.mutate()} loading={evaluateSh.isPending}>
                    评估自愈决策
                  </Button>
                  <Button onClick={() => createHealTasks.mutate(true)} loading={createHealTasks.isPending}>
                    预览治理任务
                  </Button>
                  <Button onClick={() => createHealTasks.mutate(false)} loading={createHealTasks.isPending}>
                    生成治理任务
                  </Button>
                </div>
                {evaluateSh.isError ? <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{(evaluateSh.error as Error).message}</p> : null}
              </div>

              <div className="mt-4 space-y-3">
                {(shQ.data?.items ?? []).length === 0 && <p className="py-8 text-center text-sm text-[var(--muted)]">暂无自愈策略</p>}
                {(shQ.data?.items ?? []).map((s: any) => (
                  <div key={s.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{s.trigger_condition}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">→ {s.action}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${s.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{s.enabled ? "启用" : "禁用"}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => applySh.mutate(s.id)} className="text-xs text-[var(--brand)] hover:underline">手动应用</button>
                      <button onClick={() => toggleSh.mutate(s)} className="text-xs text-[var(--brand)] hover:underline">{s.enabled ? "停用" : "启用"}</button>
                      <button onClick={() => deleteSh.mutate(s.id)} className="text-xs text-red-500 hover:underline">删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </WorkbenchPanel>

            <WorkbenchPanel title="自愈决策与任务化">
              <div className="space-y-4">
                {healResult ? (
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">命中</p><p className="text-lg font-semibold">{healResult.summary?.matched ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">待审批</p><p className="text-lg font-semibold">{healResult.summary?.needs_approval ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">高风险</p><p className="text-lg font-semibold">{(healResult.summary?.critical ?? 0) + (healResult.summary?.high ?? 0)}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">策略数</p><p className="text-lg font-semibold">{healResult.summary?.policies ?? 0}</p></div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">输入信号并评估后，会展示命中的自愈决策。</div>
                )}

                <div className="space-y-3">
                  {(healResult?.decisions ?? []).map((d: any) => (
                    <div key={`${d.policy_id}-${d.trigger_condition}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{d.trigger_condition}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{d.action}</p>
                        </div>
                        <span className={`rounded px-2 py-0.5 text-xs ${severityClass(d.risk_level)}`}>{d.risk_level} · {d.decision}</span>
                      </div>
                      <ol className="mt-3 space-y-1 text-xs text-[var(--muted-strong)]">
                        {(d.steps ?? []).map((step: any) => <li key={step.id}>- {step.title}</li>)}
                      </ol>
                    </div>
                  ))}
                </div>

                {healTasksResult ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">{healTasksResult.dry_run ? "治理任务预览" : "治理任务已生成"} · {healTasksResult.items?.length ?? 0}</p>
                    <div className="mt-3 space-y-2">
                      {(healTasksResult.items ?? []).slice(0, 5).map((item: any) => (
                        <div key={item.id ?? item.title} className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{item.priority} · {item.assigned_to}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <p className="mb-2 text-sm font-semibold">最近评估</p>
                  <div className="space-y-2">
                    {(evalQ.data?.items ?? []).slice(0, 5).map((item: any) => (
                      <div key={item.id} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                        <span className="font-medium">{item.created_at?.slice(0, 19).replace("T", " ")}</span>
                        <span className="ml-2 text-[var(--muted)]">命中 {item.summary?.matched ?? 0}，待审批 {item.summary?.needs_approval ?? 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </WorkbenchPanel>

            <WorkbenchPanel title="生产护栏动作队列">
              <div className="space-y-3">
                <Drawer
                  title="处置自愈护栏动作"
                  open={selfHealActionDrawerOpen}
                  onClose={() => setSelfHealActionDrawerOpen(false)}
                  width="min(720px, 100vw)"
                >
                  {selectedHealAction ? (
                    <div className="selfHealActionFocusedDrawer space-y-5">
                      <Steps
                        size="small"
                        current={actionStepIndex(selectedHealAction.state)}
                        items={[
                          { title: "审批" },
                          { title: "应用" },
                          { title: "验证" },
                          { title: "证据" },
                        ]}
                      />
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{selectedHealAction.trigger_condition}</p>
                            <p className="mt-1 break-all text-xs text-[var(--muted)]">{selectedHealAction.action}</p>
                          </div>
                          <span className={`rounded px-2 py-0.5 text-xs ${actionStateClass(selectedHealAction.state)}`}>
                            {selectedHealAction.state} · {selectedHealAction.risk_level}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                          <div className="rounded-lg bg-[var(--surface)] px-3 py-2">审批：{selectedHealAction.requires_approval ? selectedHealAction.approved_by || "待审批" : "无需审批"}</div>
                          <div className="rounded-lg bg-[var(--surface)] px-3 py-2">回滚：{selectedHealAction.rollback_required ? selectedHealAction.rollback_command || "需人工回滚" : "无需回滚"}</div>
                          <div className="rounded-lg bg-[var(--surface)] px-3 py-2">验证：{selectedHealAction.verified_by || "待验证"}</div>
                          <div className="rounded-lg bg-[var(--surface)] px-3 py-2">审计：{selectedHealAction.audit_payload?.state || selectedHealAction.state}</div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                        <p className="text-sm font-semibold">下一步动作</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedHealAction.state === "approval_required" ? (
                            <Button type="primary" loading={approveAction.isPending} onClick={() => approveAction.mutate(selectedHealAction.id)}>
                              审批通过
                            </Button>
                          ) : null}
                          {selectedHealAction.state === "preview" || selectedHealAction.state === "approved" ? (
                            <Button loading={applyAction.isPending} onClick={() => applyAction.mutate(selectedHealAction.id)}>
                              应用动作
                            </Button>
                          ) : null}
                          {selectedHealAction.state === "applied" ? (
                            <Button loading={verifyAction.isPending} onClick={() => verifyAction.mutate(selectedHealAction.id)}>
                              验证通过
                            </Button>
                          ) : null}
                          {(selectedHealAction.state === "applied" || selectedHealAction.state === "verified") && selectedHealAction.rollback_required ? (
                            <Button danger loading={rollbackAction.isPending} onClick={() => rollbackAction.mutate(selectedHealAction.id)}>
                              回滚并留证
                            </Button>
                          ) : null}
                          <Button onClick={() => setSelfHealActionDrawerOpen(false)}>关闭</Button>
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                        <p className="text-sm font-semibold">审计载荷</p>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5">
                          {JSON.stringify(healActionResult?.action?.audit_payload ?? selectedHealAction.audit_payload ?? selectedHealAction, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">
                      请选择一个护栏动作。
                    </div>
                  )}
                </Drawer>

                {selfHealActions.length ? (
                  <div className="grid gap-3 sm:grid-cols-4">
                    {[
                      ["动作数", selfHealActions.length],
                      ["待审批", selfHealActions.filter((item: any) => item.state === "approval_required").length],
                      ["已应用", selfHealActions.filter((item: any) => item.state === "applied").length],
                      ["已验证", selfHealActions.filter((item: any) => item.state === "verified").length],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-[11px] uppercase text-[var(--muted)]">{label}</p>
                        <p className="mt-1 text-lg font-semibold">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {selfHealActions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">
                    暂无自愈动作。执行评估后会生成 preview 或 approval_required 状态的动作。
                  </div>
                ) : null}
                {selfHealActions.map((item: any) => (
                  <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{item.trigger_condition}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{item.action}</p>
                      </div>
                      <span className={`rounded px-2 py-0.5 text-xs ${actionStateClass(item.state)}`}>{item.state} · {item.risk_level}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">审批：{item.requires_approval ? item.approved_by || "待审批" : "无需审批"}</div>
                      <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">回滚：{item.rollback_required ? item.rollback_command || "需人工回滚" : "无需回滚"}</div>
                      <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">验证：{item.verified_by || "待验证"}</div>
                      <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">审计：{item.audit_payload?.state || item.state}</div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="small"
                        onClick={() => {
                          setSelectedHealActionId(String(item.id));
                          setSelfHealActionDrawerOpen(true);
                        }}
                      >
                        处理动作
                      </Button>
                    </div>
                  </div>
                ))}
                {healActionResult?.action ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">最新审计载荷</p>
                    <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5">{JSON.stringify(healActionResult.action.audit_payload ?? healActionResult.action, null, 2)}</pre>
                  </div>
                ) : null}
              </div>
            </WorkbenchPanel>
          </div>

  );
}
