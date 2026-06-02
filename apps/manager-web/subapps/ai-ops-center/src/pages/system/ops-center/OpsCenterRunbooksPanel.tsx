import { Button, Drawer, Form, Input, Space, Steps } from "antd";
import { RefreshButton } from "@/components/PageStates";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type OpsCenterRunbooksPanelProps = {
  rbQ: any;
  rbVersionsQ: any;
  rbEvidenceQ: any;
  selectedRunbookId: any;
  setSelectedRunbookId: any;
  rbForm: any;
  setRbForm: any;
  runbookEditorDrawerOpen: any;
  setRunbookEditorDrawerOpen: any;
  runbookDiffResult: any;
  setRunbookDiffResult: any;
  runbookEvidenceResult: any;
  saveRb: any;
  deleteRb: any;
  runbookVersionAction: any;
  compareRunbookVersions: any;
  backfillRunbookEvidence: any;
  updateRunbookEvidence: any;
};

export function OpsCenterRunbooksPanel({
  rbQ,
  rbVersionsQ,
  rbEvidenceQ,
  selectedRunbookId,
  setSelectedRunbookId,
  rbForm,
  setRbForm,
  runbookEditorDrawerOpen,
  setRunbookEditorDrawerOpen,
  runbookDiffResult,
  setRunbookDiffResult,
  runbookEvidenceResult,
  saveRb,
  deleteRb,
  runbookVersionAction,
  compareRunbookVersions,
  backfillRunbookEvidence,
  updateRunbookEvidence,
}: OpsCenterRunbooksPanelProps) {
  return (
          <WorkbenchPanel title="Runbook 版本治理" actions={
            <div className="flex flex-wrap gap-2">
              <RefreshButton onClick={() => { void rbQ.refetch(); void rbEvidenceQ.refetch(); if (selectedRunbookId) void rbVersionsQ.refetch(); }} pending={rbQ.isFetching || rbVersionsQ.isFetching || rbEvidenceQ.isFetching} />
              <button
                onClick={() => backfillRunbookEvidence.mutate(selectedRunbookId || undefined)}
                disabled={backfillRunbookEvidence.isPending}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)] disabled:opacity-50"
              >
                {backfillRunbookEvidence.isPending ? "回填中..." : "自动回填证据"}
              </button>
              <button
                onClick={() => { setRbForm({ id: "", name: "", steps: "", tags: "", owner: "Ops Lead", change_note: "" }); setRunbookEditorDrawerOpen(true); }}
                className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90"
              >
                + 新建
              </button>
            </div>
          }>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {[
                ["Runbook", rbQ.data?.summary?.runbooks ?? rbQ.data?.total ?? 0],
                ["版本数", rbQ.data?.summary?.versions ?? 0],
                ["激活版本", rbQ.data?.summary?.active_versions ?? 0],
                ["治理健康", rbQ.data?.summary?.health_score ?? 100],
                ["执行证据", rbEvidenceQ.data?.summary?.records ?? 0],
                ["证据覆盖", `${rbEvidenceQ.data?.summary?.coverage_score ?? 100}%`],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-[11px] uppercase text-[var(--muted)]">{label}</p>
                  <p className="mt-1 text-2xl font-semibold">{String(value)}</p>
                </div>
              ))}
            </div>
            <Drawer
              title={rbForm.id ? "编辑 Runbook 版本" : "新建 Runbook"}
              open={runbookEditorDrawerOpen}
              onClose={() => setRunbookEditorDrawerOpen(false)}
              width="min(700px, 100vw)"
            >
              <div className="runbookEditorFocusedDrawer space-y-5">
                <Steps
                  size="small"
                  current={rbForm.name && rbForm.steps ? 1 : 0}
                  items={[
                    { title: "身份" },
                    { title: "步骤" },
                    { title: "版本" },
                  ]}
                />
                <Form layout="vertical" requiredMark={false} onFinish={() => saveRb.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">Runbook 身份</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="Runbook 名称" required>
                        <Input value={rbForm.name} onChange={e => setRbForm((f: any) => ({ ...f, name: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="负责人">
                        <Input value={rbForm.owner} onChange={e => setRbForm((f: any) => ({ ...f, owner: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="标签">
                        <Input value={rbForm.tags} onChange={e => setRbForm((f: any) => ({ ...f, tags: e.target.value }))} placeholder="incident,api" />
                      </Form.Item>
                      <Form.Item label="变更说明">
                        <Input value={rbForm.change_note} onChange={e => setRbForm((f: any) => ({ ...f, change_note: e.target.value }))} />
                      </Form.Item>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">执行步骤</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">每行一个步骤，保存后生成不可变版本快照。</p>
                    <Form.Item className="mt-3" label="操作步骤" required>
                      <Input.TextArea
                        autoSize={{ minRows: 5, maxRows: 8 }}
                        value={rbForm.steps}
                        onChange={e => setRbForm((f: any) => ({ ...f, steps: e.target.value }))}
                      />
                    </Form.Item>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">版本证据</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">保存后会刷新 Runbook 列表与版本历史；编辑已有 Runbook 时会生成新版本，便于差异对比、恢复和归档。</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">模式</p>
                        <p className="text-sm font-semibold">{rbForm.id ? "新版本" : "首版本"}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">步骤数</p>
                        <p className="text-sm font-semibold">{rbForm.steps.split("\n").filter(Boolean).length}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">当前版本数</p>
                        <p className="text-sm font-semibold">{rbVersionsQ.data?.total ?? 0}</p>
                      </div>
                    </div>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={saveRb.isPending} disabled={!rbForm.name}>
                      {rbForm.id ? "保存并生成版本" : "创建首个版本"}
                    </Button>
                    <Button onClick={() => { setRunbookEditorDrawerOpen(false); setRbForm({ id: "", name: "", steps: "", tags: "", owner: "Ops Lead", change_note: "" }); }}>
                      取消
                    </Button>
                  </Space>
                  {saveRb.error && <p className="mt-3 text-xs text-red-600">{(saveRb.error as Error).message}</p>}
                </Form>
              </div>
            </Drawer>
            <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(460px,1.1fr)]">
              <div className="space-y-3">
                {(rbQ.data?.items ?? []).length === 0 && <p className="py-8 text-center text-sm text-[var(--muted)]">暂无 Runbook</p>}
                {(rbQ.data?.items ?? []).map((r: any) => (
                  <div key={r.id} className={`rounded-xl border p-4 ${selectedRunbookId === r.id ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-sm">{r.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">v{r.active_version_no ?? 1} / {r.steps?.length ?? 0} 步 / {r.owner || "Ops Lead"}</p>
                      </div>
                      <span className="rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--muted-strong)]">{r.status || "active"}</span>
                    </div>
                    {r.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.tags.map((t: string) => <span key={t} className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs text-[var(--brand)]">{t}</span>)}</div>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => { setSelectedRunbookId(r.id); setRunbookDiffResult(null); }} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs">版本治理</button>
                      <button onClick={() => backfillRunbookEvidence.mutate(r.id)} disabled={backfillRunbookEvidence.isPending} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs disabled:opacity-50">回填证据</button>
                      <button
                        onClick={() => {
                          setRbForm({ id: r.id, name: r.name || "", steps: (r.steps || []).join("\n"), tags: (r.tags || []).join(", "), owner: r.owner || "Ops Lead", change_note: "" });
                          setSelectedRunbookId(r.id);
                          setRunbookEditorDrawerOpen(true);
                        }}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs"
                      >
                        编辑生成新版本
                      </button>
                      <button onClick={() => deleteRb.mutate(r.id)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600">删除</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                {!selectedRunbookId ? (
                  <p className="py-8 text-center text-sm text-[var(--muted)]">选择左侧 Runbook 查看版本历史、差异和发布操作。</p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">版本历史</p>
                        <p className="text-xs text-[var(--muted)]">不可变快照、激活版本、归档和历史恢复。</p>
                      </div>
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-xs">{rbVersionsQ.data?.total ?? 0} 个版本</span>
                    </div>
                    {(rbVersionsQ.data?.items ?? []).slice(0, 8).map((version: any, index: number, arr: any[]) => (
                      <div key={version.id} className="rounded-lg border border-[var(--border)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">v{version.version_no} · {version.snapshot?.name}</p>
                            <p className="text-xs text-[var(--muted)]">{version.created_by || "-"} / {version.created_at || "-"} / {version.checksum?.slice(0, 10)}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[11px] ${version.status === "active" ? "bg-green-50 text-green-700" : version.status === "archived" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{version.status}</span>
                        </div>
                        <p className="mt-2 text-xs text-[var(--muted)]">步骤：{version.snapshot?.steps?.length ?? 0} / 标签：{(version.snapshot?.tags ?? []).join(", ") || "-"}</p>
                        {version.change_note ? <p className="mt-1 text-xs text-[var(--muted-strong)]">说明：{version.change_note}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            disabled={version.status === "active" || runbookVersionAction.isPending}
                            onClick={() => runbookVersionAction.mutate({ runbookId: selectedRunbookId, versionId: version.id, action: "promote" })}
                            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
                          >
                            恢复为当前
                          </button>
                          <button
                            disabled={version.status === "active" || version.status === "archived" || runbookVersionAction.isPending}
                            onClick={() => runbookVersionAction.mutate({ runbookId: selectedRunbookId, versionId: version.id, action: "archive" })}
                            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
                          >
                            归档
                          </button>
                          {arr[index + 1] ? (
                            <button
                              disabled={compareRunbookVersions.isPending}
                              onClick={() => compareRunbookVersions.mutate({ runbookId: selectedRunbookId, baseVersionId: arr[index + 1].id, targetVersionId: version.id })}
                              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
                            >
                              对比上一版
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {runbookDiffResult?.diff ? (
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                        <p className="font-semibold">版本差异</p>
                        <p className="mt-1 text-[var(--muted)]">名称变化：{runbookDiffResult.diff.name_changed ? "是" : "否"}；步骤变化：{runbookDiffResult.diff.summary?.changed_steps ?? 0}；新增标签：{runbookDiffResult.diff.added_tags?.join(", ") || "-"}</p>
                        <div className="mt-2 max-h-36 overflow-auto space-y-1">
                          {(runbookDiffResult.diff.changed_steps ?? []).slice(0, 10).map((step: any) => (
                            <p key={step.index} className="rounded bg-[var(--surface)] p-2">#{step.index}：{step.base || "-"} → {step.target || "-"}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">执行证据回填</p>
                          <p className="mt-1 text-[var(--muted)]">自动关联 RCA 验证、自愈执行和流水线恢复记录。</p>
                        </div>
                        <span className="rounded-full bg-[var(--surface)] px-2 py-1">{rbEvidenceQ.data?.summary?.missing_evidence ?? 0} 项缺口</span>
                      </div>
                      {runbookEvidenceResult?.summary ? (
                        <p className="mt-2 rounded bg-[var(--surface)] p-2 text-[var(--muted-strong)]">
                          最近回填：{runbookEvidenceResult.summary.records ?? 0} 条，覆盖率 {runbookEvidenceResult.summary.coverage_score ?? 100}%，已保存 {runbookEvidenceResult.persisted ?? 0} 条。
                        </p>
                      ) : null}
                      <div className="mt-3 max-h-64 overflow-auto space-y-2">
                        {(rbEvidenceQ.data?.items ?? []).length === 0 ? (
                          <p className="py-4 text-center text-[var(--muted)]">暂无执行证据，点击自动回填从 RCA 与自愈记录中归集。</p>
                        ) : (rbEvidenceQ.data?.items ?? []).slice(0, 8).map((record: any) => (
                          <div key={record.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="font-semibold">{record.runbook_name || record.runbook_id} · v{record.version_no ?? 1}</p>
                                <p className="mt-1 text-[var(--muted)]">覆盖率 {record.coverage_score ?? 0}% / 来源 {(record.sources ?? []).length} / {record.review_status || "open"}</p>
                              </div>
                              <span className={`rounded-full px-2 py-1 ${record.status === "complete" ? "bg-green-50 text-green-700" : record.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{record.status}</span>
                            </div>
                            {(record.missing_evidence ?? []).length > 0 ? (
                              <p className="mt-2 text-[var(--muted)]">缺口：{record.missing_evidence.map((item: any) => item.title || item.id).join("、")}</p>
                            ) : (
                              <p className="mt-2 text-green-700">证据链已完整，可作为执行审计归档。</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(record.collected_evidence ?? []).slice(0, 5).map((item: any) => (
                                <span key={`${record.id}-${item.id}`} className="rounded bg-[var(--surface-muted)] px-2 py-1">{item.title || item.id}</span>
                              ))}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={() => updateRunbookEvidence.mutate({ id: record.id, action: "acknowledge" })}
                                disabled={updateRunbookEvidence.isPending || record.review_status === "acknowledged"}
                                className="rounded-lg border border-[var(--border)] px-3 py-1 disabled:opacity-50"
                              >
                                确认
                              </button>
                              <button
                                onClick={() => updateRunbookEvidence.mutate({ id: record.id, action: record.review_status === "archived" ? "reopen" : "archive" })}
                                disabled={updateRunbookEvidence.isPending}
                                className="rounded-lg border border-[var(--border)] px-3 py-1 disabled:opacity-50"
                              >
                                {record.review_status === "archived" ? "重新打开" : "归档"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {(rbVersionsQ.data?.events ?? []).length ? (
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                        <p className="font-semibold">治理审计</p>
                        <div className="mt-2 max-h-32 overflow-auto space-y-1">
                          {rbVersionsQ.data.events.slice(0, 8).map((event: any) => (
                            <p key={event.id} className="text-[var(--muted)]">{event.created_at} / {event.event_type} / {event.actor || "-"}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </WorkbenchPanel>

  );
}
