import { Activity, CloudCog, FileText, ListChecks, MessageSquare, Network, PackageCheck, PlayCircle, Rocket, Search, Send, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Drawer, Form, Input, Select, Space, Steps, Switch } from "antd";
import { Card } from "@/components/Card";

type SettingsProfilesPanelProps = {
  me: any;
  api: any;
  opsProfiles: any;
  profileDraft: any;
  setProfileDraft: any;
  profileDrawerOpen: any;
  setProfileDrawerOpen: any;
  profileEnv: any;
  profileBundle: any;
  saveProfile: any;
  activateProfile: any;
  deleteProfile: any;
  exportProfile: any;
  exportBundle: any;
  deploymentPackageDraft: any;
  setDeploymentPackageDraft: any;
  deploymentPackageDetail: any;
  deploymentPackages: any;
  createDeploymentPackage: any;
  loadDeploymentPackage: any;
  deploymentApprovalDraft: any;
  setDeploymentApprovalDraft: any;
  deploymentApprovalDetail: any;
  deploymentApprovals: any;
  createDeploymentApproval: any;
  loadDeploymentApproval: any;
  applyDeploymentApprovalAction: any;
  selectedApprovalPackageId: any;
  deploymentCanaryDraft: any;
  setDeploymentCanaryDraft: any;
  deploymentCanaryDetail: any;
  deploymentCanaryPolicies: any;
  createDeploymentCanaryPolicy: any;
  loadDeploymentCanaryPolicy: any;
  applyDeploymentCanaryAction: any;
  selectedCanaryPackageId: any;
  deploymentCanaryMetricSourceDraft: any;
  setDeploymentCanaryMetricSourceDraft: any;
  deploymentCanaryMetricSourceDetail: any;
  deploymentCanaryMetricResult: any;
  deploymentCanaryMetricSources: any;
  createDeploymentCanaryMetricSource: any;
  loadDeploymentCanaryMetricSource: any;
  collectDeploymentCanaryMetrics: any;
  selectedCanaryPolicyId: any;
  selectedCanaryMetricSourceId: any;
  deploymentCanaryImDraft: any;
  setDeploymentCanaryImDraft: any;
  deploymentCanaryImResult: any;
  runDeploymentCanaryIm: any;
  deploymentPipelineDraft: any;
  setDeploymentPipelineDraft: any;
  deploymentPipelineDetail: any;
  deploymentPipelineDrawerOpen: any;
  setDeploymentPipelineDrawerOpen: any;
  deploymentPipelines: any;
  createDeploymentPipeline: any;
  loadDeploymentPipeline: any;
  applyDeploymentPipelineAction: any;
  selectedDeploymentPackageId: any;
  deploymentPipelineExecutors: any;
  deploymentPipelineExecuteDraft: any;
  setDeploymentPipelineExecuteDraft: any;
  executeDeploymentPipeline: any;
  deploymentExecutorTargets: any;
  deploymentExecutorTargetDraft: any;
  setDeploymentExecutorTargetDraft: any;
  saveDeploymentExecutorTarget: any;
  applyDeploymentExecutorTargetAction: any;
  deploymentPipelineCallbackDraft: any;
  setDeploymentPipelineCallbackDraft: any;
  callbackDeploymentPipelineExecution: any;
  deploymentPipelineRemediationDraft: any;
  setDeploymentPipelineRemediationDraft: any;
  remediateDeploymentPipeline: any;
  deploymentRollbackDrillDraft: any;
  setDeploymentRollbackDrillDraft: any;
  deploymentRollbackDrillDetail: any;
  deploymentRollbackDrills: any;
  createDeploymentRollbackDrill: any;
  loadDeploymentRollbackDrill: any;
  applyDeploymentRollbackDrillAction: any;
  selectedRollbackDrillPackageId: any;
  deploymentRollbackRunbookDraft: any;
  setDeploymentRollbackRunbookDraft: any;
  deploymentRollbackRunbookDetail: any;
  deploymentRollbackRunbooks: any;
  createDeploymentRollbackRunbook: any;
  loadDeploymentRollbackRunbook: any;
  applyDeploymentRollbackRunbookAction: any;
  selectedRollbackRunbookPackageId: any;
  deploymentExecutionAuditDraft: any;
  setDeploymentExecutionAuditDraft: any;
  deploymentExecutionAuditDetail: any;
  deploymentExecutionAudits: any;
  createDeploymentExecutionAudit: any;
  loadDeploymentExecutionAudit: any;
  createDeploymentExecutionAuditTasks: any;
  selectedExecutionAuditPackageId: any;
  selectedExecutionAuditPipelineId: any;
  selectedExecutionAuditCanaryId: any;
  selectedExecutionAuditDrillId: any;
  selectedExecutionAuditRunbookId: any;
  notifyChannels: any;
};

const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

export function SettingsProfilesPanel({
  me,
  api,
  opsProfiles,
  profileDraft,
  setProfileDraft,
  profileDrawerOpen,
  setProfileDrawerOpen,
  profileEnv,
  profileBundle,
  saveProfile,
  activateProfile,
  deleteProfile,
  exportProfile,
  exportBundle,
  deploymentPackageDraft,
  setDeploymentPackageDraft,
  deploymentPackageDetail,
  deploymentPackages,
  createDeploymentPackage,
  loadDeploymentPackage,
  deploymentApprovalDraft,
  setDeploymentApprovalDraft,
  deploymentApprovalDetail,
  deploymentApprovals,
  createDeploymentApproval,
  loadDeploymentApproval,
  applyDeploymentApprovalAction,
  selectedApprovalPackageId,
  deploymentCanaryDraft,
  setDeploymentCanaryDraft,
  deploymentCanaryDetail,
  deploymentCanaryPolicies,
  createDeploymentCanaryPolicy,
  loadDeploymentCanaryPolicy,
  applyDeploymentCanaryAction,
  selectedCanaryPackageId,
  deploymentCanaryMetricSourceDraft,
  setDeploymentCanaryMetricSourceDraft,
  deploymentCanaryMetricSourceDetail,
  deploymentCanaryMetricResult,
  deploymentCanaryMetricSources,
  createDeploymentCanaryMetricSource,
  loadDeploymentCanaryMetricSource,
  collectDeploymentCanaryMetrics,
  selectedCanaryPolicyId,
  selectedCanaryMetricSourceId,
  deploymentCanaryImDraft,
  setDeploymentCanaryImDraft,
  deploymentCanaryImResult,
  runDeploymentCanaryIm,
  deploymentPipelineDraft,
  setDeploymentPipelineDraft,
  deploymentPipelineDetail,
  deploymentPipelineDrawerOpen,
  setDeploymentPipelineDrawerOpen,
  deploymentPipelines,
  createDeploymentPipeline,
  loadDeploymentPipeline,
  applyDeploymentPipelineAction,
  selectedDeploymentPackageId,
  deploymentPipelineExecutors,
  deploymentPipelineExecuteDraft,
  setDeploymentPipelineExecuteDraft,
  executeDeploymentPipeline,
  deploymentExecutorTargets,
  deploymentExecutorTargetDraft,
  setDeploymentExecutorTargetDraft,
  saveDeploymentExecutorTarget,
  applyDeploymentExecutorTargetAction,
  deploymentPipelineCallbackDraft,
  setDeploymentPipelineCallbackDraft,
  callbackDeploymentPipelineExecution,
  deploymentPipelineRemediationDraft,
  setDeploymentPipelineRemediationDraft,
  remediateDeploymentPipeline,
  deploymentRollbackDrillDraft,
  setDeploymentRollbackDrillDraft,
  deploymentRollbackDrillDetail,
  deploymentRollbackDrills,
  createDeploymentRollbackDrill,
  loadDeploymentRollbackDrill,
  applyDeploymentRollbackDrillAction,
  selectedRollbackDrillPackageId,
  deploymentRollbackRunbookDraft,
  setDeploymentRollbackRunbookDraft,
  deploymentRollbackRunbookDetail,
  deploymentRollbackRunbooks,
  createDeploymentRollbackRunbook,
  loadDeploymentRollbackRunbook,
  applyDeploymentRollbackRunbookAction,
  selectedRollbackRunbookPackageId,
  deploymentExecutionAuditDraft,
  setDeploymentExecutionAuditDraft,
  deploymentExecutionAuditDetail,
  deploymentExecutionAudits,
  createDeploymentExecutionAudit,
  loadDeploymentExecutionAudit,
  createDeploymentExecutionAuditTasks,
  selectedExecutionAuditPackageId,
  selectedExecutionAuditPipelineId,
  selectedExecutionAuditCanaryId,
  selectedExecutionAuditDrillId,
  selectedExecutionAuditRunbookId,
  notifyChannels,
}: SettingsProfilesPanelProps) {
  const { t } = useTranslation();

  return (
        <>
        <Card
          title={t("page.settings.profilesCard")}
          actions={<StatusPill tone={opsProfiles.data?.doctor?.ok ? "ok" : opsProfiles.isError ? "danger" : "warn"} label={opsProfiles.data?.active || "..."} />}
        >
          <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <CloudCog className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.profileEdit")}</p>
                  <p className="text-xs text-[var(--muted)]">{t("page.settings.profileDesc")}</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="grid gap-3">
                  <Info label={t("page.settings.profile")} value={profileDraft.name || "-"} />
                  <Info label={t("page.settings.mode")} value={profileDraft.mode || "-"} />
                  <Info label={t("page.settings.database")} value={profileDraft.database || "-"} />
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.profileQuickSummary", { defaultValue: "当前草稿" })}</p>
                  <p className="mt-1 break-all text-xs text-[var(--muted)]">{profileDraft.manager_url || profileDraft.public_url || profileDraft.notes || t("page.settings.profileDesc")}</p>
                </div>
                <Button block type="primary" icon={<CloudCog className="h-4 w-4" />} onClick={() => setProfileDrawerOpen(true)}>
                  {t("page.settings.profileEdit")}
                </Button>
                {saveProfile.error ? <ErrorLine message={(saveProfile.error as Error).message} /> : null}
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                {(opsProfiles.data?.doctor?.checks || []).map((check: any) => (
                  <div key={check.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <StatusPill tone={check.ok ? "ok" : "warn"} label={check.ok ? "OK" : "WARN"} />
                    <p className="mt-3 text-sm font-semibold text-[var(--text)]">{check.id}</p>
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">{check.message}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {(opsProfiles.data?.templates || []).map((tpl: any) => (
                  <button
                    key={tpl.name}
                    type="button"
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
                    onClick={() => {
                      setProfileDraft(profileToDraft(tpl));
                      setProfileDrawerOpen(true);
                    }}
                  >
                    <span className="text-sm font-semibold text-[var(--text)]">{tpl.name}</span>
                    <span className="mt-1 block text-xs text-[var(--muted)]">{tpl.notes}</span>
                  </button>
                ))}
              </div>
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="grid grid-cols-[1fr_6rem_7rem_11rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                  <span>{t("page.settings.profile")}</span>
                  <span>{t("page.settings.mode")}</span>
                  <span>{t("page.settings.database")}</span>
                  <span>{t("page.settings.actions")}</span>
                </div>
                {(opsProfiles.data?.items || []).map((row: any) => (
                  <div key={row.name} className="grid grid-cols-[1fr_6rem_7rem_11rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => {
                        setProfileDraft(profileToDraft(row));
                        setProfileDrawerOpen(true);
                      }}
                    >
                      <span className="block truncate text-sm font-semibold text-[var(--text)]">{row.name}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">{row.manager_url || row.public_url || row.notes}</span>
                    </button>
                    <span className="text-xs text-[var(--muted-strong)]">{row.mode}</span>
                    <span className="text-xs text-[var(--muted-strong)]">{row.database}</span>
                    <span className="flex flex-wrap gap-2 text-xs">
                      <button className="text-[var(--brand)] disabled:opacity-50" disabled={activateProfile.isPending || row.active} onClick={() => activateProfile.mutate(row.name)}>{row.active ? t("page.settings.active") : t("page.settings.activate")}</button>
                      <button className="text-[var(--brand)] disabled:opacity-50" disabled={exportProfile.isPending} onClick={() => exportProfile.mutate(row.name)}>{t("page.settings.exportEnv")}</button>
                      <button className="text-[var(--brand)] disabled:opacity-50" disabled={exportBundle.isPending} onClick={() => exportBundle.mutate(row.name)}>{t("page.settings.exportBundle")}</button>
                      <button className="text-rose-600 disabled:opacity-50" disabled={deleteProfile.isPending || ["local-dev", "saas-pg", "private-oceanbase"].includes(row.name)} onClick={() => deleteProfile.mutate(row.name)}>{t("common.delete")}</button>
                    </span>
                  </div>
                ))}
              </div>
              {profileEnv ? <pre className="max-h-56 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">{profileEnv.shell}</pre> : null}
              {profileBundle ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployBundle")}</p>
                      <p className="mt-1 break-all text-xs text-[var(--muted)]">{profileBundle.dir}</p>
                    </div>
                    <a className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]" href={api.opsProfileComposeUrl(profileBundle.profile)} target="_blank" rel="noreferrer">
                      {t("page.settings.downloadCompose")}
                    </a>
                  </div>
                  <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{profileBundle.compose}</pre>
                </div>
              ) : null}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <PackageCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployPackageVersions")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.deployPackageVersionsDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentPackages.isFetching}
                    onClick={() => void deploymentPackages.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[9rem_9rem_minmax(0,1fr)_8rem]">
                  <input
                    className={inputClass}
                    value={deploymentPackageDraft.version}
                    onChange={(e) => setDeploymentPackageDraft({ ...deploymentPackageDraft, version: e.target.value })}
                    placeholder={t("page.settings.deployPackageVersion")}
                  />
                  <select className={inputClass} value={deploymentPackageDraft.channel} onChange={(e) => setDeploymentPackageDraft({ ...deploymentPackageDraft, channel: e.target.value })}>
                    {["manual", "staging", "production", "rollback"].map((channel) => <option key={channel} value={channel}>{channel}</option>)}
                  </select>
                  <input
                    className={inputClass}
                    value={deploymentPackageDraft.release_notes}
                    onChange={(e) => setDeploymentPackageDraft({ ...deploymentPackageDraft, release_notes: e.target.value })}
                    placeholder={t("page.settings.deployPackageNotes")}
                  />
                  <button
                    type="button"
                    className="rounded-xl bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    disabled={createDeploymentPackage.isPending || !profileDraft.name.trim()}
                    onClick={() => createDeploymentPackage.mutate()}
                  >
                    {t("page.settings.deployPackageCreate")}
                  </button>
                </div>
                {createDeploymentPackage.error ? <ErrorLine message={(createDeploymentPackage.error as Error).message} /> : null}
                {deploymentPackages.error ? <ErrorLine message={(deploymentPackages.error as Error).message} /> : null}
                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
                  <div className="grid grid-cols-[1fr_6rem_7rem_8rem] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                    <span>{t("page.settings.deployPackage")}</span>
                    <span>{t("page.settings.deployPackageChannel")}</span>
                    <span>{t("page.settings.deployPackageFiles")}</span>
                    <span>{t("page.settings.actions")}</span>
                  </div>
                  {(deploymentPackages.data?.items || []).map((item: any) => (
                    <div key={item.id} className="grid grid-cols-[1fr_6rem_7rem_8rem] gap-3 border-b border-[var(--border)] px-3 py-2 text-xs last:border-0">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--text)]">{item.version}</p>
                        <p className="truncate font-mono text-[11px] text-[var(--muted)]">{item.id}</p>
                      </div>
                      <span className="font-mono text-[var(--muted-strong)]">{item.channel}</span>
                      <span className="font-mono text-[var(--muted-strong)]">{item.file_count}</span>
                      <button
                        type="button"
                        className="text-left text-[var(--brand)] disabled:opacity-50"
                        disabled={loadDeploymentPackage.isPending}
                        onClick={() => loadDeploymentPackage.mutate(item.id)}
                      >
                        {t("page.settings.deployPackageInspect")}
                      </button>
                    </div>
                  ))}
                  {!deploymentPackages.data?.items?.length ? <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">{t("page.settings.deployPackageEmpty")}</div> : null}
                </div>
                {deploymentPackageDetail ? (
                  <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentPackageDetail.item?.id}</p>
                        <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentPackageDetail.item?.dir}</p>
                      </div>
                      {deploymentPackageDetail.item?.id ? (
                        <a className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]" href={api.opsDeploymentPackageComposeUrl(deploymentPackageDetail.item.id)} target="_blank" rel="noreferrer">
                          {t("page.settings.downloadCompose")}
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <Info label={t("page.settings.deployPackageChecksum")} value={String(deploymentPackageDetail.item?.checksum || "-")} />
                      <Info label={t("page.settings.deployPackageCreatedAt")} value={String(deploymentPackageDetail.item?.created_at || "-")} />
                      <Info label={t("page.settings.deployPackageDatabase")} value={String(deploymentPackageDetail.item?.database || "-")} />
                    </div>
                    <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{deploymentPackageDetail.preview?.compose || ""}</pre>
                  </div>
                ) : null}
                {loadDeploymentPackage.error ? <ErrorLine message={(loadDeploymentPackage.error as Error).message} /> : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployApprovalTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.deployApprovalDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentApprovals.isFetching}
                    onClick={() => void deploymentApprovals.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        className={inputClass}
                        value={selectedApprovalPackageId}
                        onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, package_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <select className={inputClass} value={deploymentApprovalDraft.environment} onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, environment: e.target.value })}>
                        {["dev", "staging", "production", "rollback"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
                      <select className={inputClass} value={deploymentApprovalDraft.policy} onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, policy: e.target.value })}>
                        {["single", "two_person", "change_board"].map((policy) => <option key={policy} value={policy}>{t(`page.settings.deployApprovalPolicy.${policy}`, { defaultValue: policy })}</option>)}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentApprovalDraft.reviewers}
                        onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, reviewers: e.target.value })}
                        placeholder={t("page.settings.deployApprovalReviewers")}
                      />
                    </div>
                    <input
                      className={inputClass}
                      value={deploymentApprovalDraft.requested_by}
                      onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, requested_by: e.target.value })}
                      placeholder={t("page.settings.deployApprovalRequester")}
                    />
                    <textarea
                      className={`${inputClass} min-h-20`}
                      value={deploymentApprovalDraft.notes}
                      onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, notes: e.target.value })}
                      placeholder={t("page.settings.deployApprovalNotes")}
                    />
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={createDeploymentApproval.isPending || !selectedApprovalPackageId}
                      onClick={() => createDeploymentApproval.mutate()}
                    >
                      <ListChecks className="h-4 w-4" />
                      {t("page.settings.deployApprovalRequest")}
                    </button>
                    {createDeploymentApproval.error ? <ErrorLine message={(createDeploymentApproval.error as Error).message} /> : null}
                    {deploymentApprovals.error ? <ErrorLine message={(deploymentApprovals.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployApprovalRecent")}</p>
                      <StatusPill tone={deploymentApprovalDetail?.item?.status === "published" ? "ok" : deploymentApprovalDetail?.item?.status === "rejected" ? "danger" : "warn"} label={deploymentApprovalDetail?.item?.status ? t(`page.settings.deployApprovalStatus.${deploymentApprovalDetail.item.status}`, { defaultValue: deploymentApprovalDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentApprovals.data?.items || []).map((approval: any) => (
                        <button
                          key={approval.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentApproval.isPending}
                          onClick={() => loadDeploymentApproval.mutate(approval.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs text-[var(--text)]">{approval.version || approval.package_id}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{t(`page.settings.deployApprovalStatus.${approval.status}`, { defaultValue: approval.status })}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${approval.environment} / ${approval.policy} / ${approval.requested_by}`}</span>
                        </button>
                      ))}
                      {!deploymentApprovals.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.deployApprovalEmpty")}</p> : null}
                    </div>
                    {loadDeploymentApproval.error ? <ErrorLine message={(loadDeploymentApproval.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentApprovalDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentApprovalDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentApprovalDetail.item?.package_id}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {["approve", "reject", "publish", "cancel"].map((action) => (
                            <button
                              key={action}
                              type="button"
                              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                              disabled={applyDeploymentApprovalAction.isPending || !deploymentApprovalDetail.item?.id}
                              onClick={() => applyDeploymentApprovalAction.mutate({ approvalId: deploymentApprovalDetail.item.id, action })}
                            >
                              {t(`page.settings.deployApprovalControl.${action}`, { defaultValue: action })}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        <Info label={t("page.settings.deployApprovalStatusLabel")} value={t(`page.settings.deployApprovalStatus.${deploymentApprovalDetail.item?.status}`, { defaultValue: deploymentApprovalDetail.item?.status || "-" })} />
                        <Info label={t("page.settings.deployApprovalApprovedBy")} value={String(deploymentApprovalDetail.item?.approved_by || "-")} />
                        <Info label={t("page.settings.deployApprovalPipeline")} value={String(deploymentApprovalDetail.item?.pipeline_run_id || "-")} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {(deploymentApprovalDetail.approval?.checks || []).map((check: any) => (
                          <div key={check.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.deployApprovalCheck.${check.id}`, { defaultValue: check.id })}</p>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{check.status}</p>
                          </div>
                        ))}
                      </div>
                      {applyDeploymentApprovalAction.error ? <ErrorLine message={(applyDeploymentApprovalAction.error as Error).message} /> : null}
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployApprovalEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentApprovalDetail.approval?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.deployApprovalEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <FileText className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackRunbookTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.rollbackRunbookDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentRollbackRunbooks.isFetching}
                    onClick={() => void deploymentRollbackRunbooks.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        className={inputClass}
                        value={selectedRollbackRunbookPackageId}
                        onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, package_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <select
                        className={inputClass}
                        value={deploymentRollbackRunbookDraft.drill_id || deploymentRollbackDrillDetail?.item?.id || ""}
                        onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, drill_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.rollbackRunbookDrillPh")}</option>
                        {(deploymentRollbackDrills.data?.items || []).map((drill: any) => (
                          <option key={drill.id} value={drill.id}>{`${drill.name || drill.version} / ${drill.status}`}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <input
                        className={inputClass}
                        value={deploymentRollbackRunbookDraft.name}
                        onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, name: e.target.value })}
                        placeholder={t("page.settings.rollbackRunbookName")}
                      />
                      <select className={inputClass} value={deploymentRollbackRunbookDraft.environment} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, environment: e.target.value })}>
                        {["dev", "staging", "production", "rollback"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentRollbackRunbookDraft.trigger} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, trigger: e.target.value })}>
                        {["manual", "canary_gate_failure", "post_deploy_regression", "dependency_outage", "slo_breach"].map((trigger) => <option key={trigger} value={trigger}>{t(`page.settings.rollbackRunbookTrigger.${trigger}`, { defaultValue: trigger })}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <input className={inputClass} value={deploymentRollbackRunbookDraft.operator} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, operator: e.target.value })} placeholder={t("page.settings.rollbackRunbookOperator")} />
                      <select className={inputClass} value={deploymentRollbackRunbookDraft.task_priority} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, task_priority: e.target.value })}>
                        {["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                      </select>
                      <input className={inputClass} value={deploymentRollbackRunbookDraft.assigned_to} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, assigned_to: e.target.value })} placeholder={t("page.settings.rollbackRunbookAssignee")} />
                      <input className={inputClass} value={deploymentRollbackRunbookDraft.dev_tool} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, dev_tool: e.target.value })} placeholder={t("page.settings.rollbackRunbookDevTool")} />
                    </div>
                    <textarea
                      className={`${inputClass} min-h-20`}
                      value={deploymentRollbackRunbookDraft.notes}
                      onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, notes: e.target.value })}
                      placeholder={t("page.settings.rollbackRunbookNotes")}
                    />
                    <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-strong)]">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={deploymentRollbackRunbookDraft.approval_required} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, approval_required: e.target.checked })} />
                        {t("page.settings.pipelineApprovalRequired")}
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={deploymentRollbackRunbookDraft.create_preview_pipeline} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, create_preview_pipeline: e.target.checked })} />
                        {t("page.settings.rollbackRunbookCreatePreview")}
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={createDeploymentRollbackRunbook.isPending || !selectedRollbackRunbookPackageId}
                        onClick={() => createDeploymentRollbackRunbook.mutate()}
                      >
                        <FileText className="h-4 w-4" />
                        {t("page.settings.rollbackRunbookCreate")}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                        disabled={applyDeploymentRollbackRunbookAction.isPending || !deploymentRollbackRunbookDetail?.item?.id}
                        onClick={() => applyDeploymentRollbackRunbookAction.mutate({ runbookId: deploymentRollbackRunbookDetail.item.id, action: "create_tasks", dryRun: true })}
                      >
                        {t("page.settings.rollbackRunbookPreviewTasks")}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                        disabled={applyDeploymentRollbackRunbookAction.isPending || !deploymentRollbackRunbookDetail?.item?.id}
                        onClick={() => applyDeploymentRollbackRunbookAction.mutate({ runbookId: deploymentRollbackRunbookDetail.item.id, action: "create_tasks", dryRun: false })}
                      >
                        {t("page.settings.rollbackRunbookCreateTasks")}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                        disabled={applyDeploymentRollbackRunbookAction.isPending || !deploymentRollbackRunbookDetail?.item?.id}
                        onClick={() => applyDeploymentRollbackRunbookAction.mutate({ runbookId: deploymentRollbackRunbookDetail.item.id, action: "create_pipeline", dryRun: false })}
                      >
                        {t("page.settings.rollbackRunbookCreatePipeline")}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                        disabled={applyDeploymentRollbackRunbookAction.isPending || !deploymentRollbackRunbookDetail?.item?.id}
                        onClick={() => applyDeploymentRollbackRunbookAction.mutate({ runbookId: deploymentRollbackRunbookDetail.item.id, action: "mark_ready", dryRun: true })}
                      >
                        {t("page.settings.rollbackRunbookMarkReady")}
                      </button>
                    </div>
                    {createDeploymentRollbackRunbook.error ? <ErrorLine message={(createDeploymentRollbackRunbook.error as Error).message} /> : null}
                    {applyDeploymentRollbackRunbookAction.error ? <ErrorLine message={(applyDeploymentRollbackRunbookAction.error as Error).message} /> : null}
                    {deploymentRollbackRunbooks.error ? <ErrorLine message={(deploymentRollbackRunbooks.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackRunbookRecent")}</p>
                      <StatusPill tone={deploymentRollbackRunbookDetail?.item?.status === "ready" ? "ok" : deploymentRollbackRunbookDetail?.item?.status === "risk" ? "danger" : "warn"} label={deploymentRollbackRunbookDetail?.item?.status ? t(`page.settings.rollbackRunbookStatus.${deploymentRollbackRunbookDetail.item.status}`, { defaultValue: deploymentRollbackRunbookDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentRollbackRunbooks.data?.items || []).map((runbook: any) => (
                        <button
                          key={runbook.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentRollbackRunbook.isPending}
                          onClick={() => loadDeploymentRollbackRunbook.mutate(runbook.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-[var(--text)]">{runbook.name || runbook.version}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{`${runbook.step_done}/${runbook.step_total}`}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${runbook.environment} / ${t(`page.settings.rollbackRunbookStatus.${runbook.status}`, { defaultValue: runbook.status })}`}</span>
                        </button>
                      ))}
                      {!deploymentRollbackRunbooks.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.rollbackRunbookEmpty")}</p> : null}
                    </div>
                    {loadDeploymentRollbackRunbook.error ? <ErrorLine message={(loadDeploymentRollbackRunbook.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentRollbackRunbookDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentRollbackRunbookDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentRollbackRunbookDetail.item?.package_id}</p>
                        </div>
                        <StatusPill tone={deploymentRollbackRunbookDetail.item?.status === "ready" ? "ok" : deploymentRollbackRunbookDetail.item?.status === "risk" ? "danger" : "warn"} label={t(`page.settings.rollbackRunbookStatus.${deploymentRollbackRunbookDetail.item?.status}`, { defaultValue: deploymentRollbackRunbookDetail.item?.status || "-" })} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <Info label={t("page.settings.rollbackRunbookTriggerLabel")} value={t(`page.settings.rollbackRunbookTrigger.${deploymentRollbackRunbookDetail.item?.trigger}`, { defaultValue: deploymentRollbackRunbookDetail.item?.trigger || "-" })} />
                        <Info label={t("page.settings.rollbackRunbookSteps")} value={`${deploymentRollbackRunbookDetail.item?.step_done ?? 0}/${deploymentRollbackRunbookDetail.item?.step_total ?? 0}`} />
                        <Info label={t("page.settings.rollbackRunbookTasks")} value={String(deploymentRollbackRunbookDetail.item?.task_count || 0)} />
                        <Info label={t("page.settings.rollbackRunbookPipeline")} value={String(deploymentRollbackRunbookDetail.item?.rollback_pipeline_run_id || deploymentRollbackRunbookDetail.item?.preview_pipeline_run_id || "-")} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentRollbackRunbookDetail.runbook?.steps || []).map((step: any) => (
                          <div key={step.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate font-medium text-[var(--text)]">{step.title || step.id}</span>
                              <StatusPill tone={step.status === "failed" ? "danger" : step.status === "completed" ? "ok" : "warn"} label={t(`page.settings.rollbackRunbookStepStatus.${step.status}`, { defaultValue: step.status })} />
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{step.command || step.api || step.evidence || "-"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackRunbookEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentRollbackRunbookDetail.runbook?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.rollbackRunbookEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                      {deploymentRollbackRunbookDetail.result?.planned ? (
                        <div className="mt-3 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                          <p className="font-semibold text-[var(--text)]">{t("page.settings.rollbackRunbookPlannedTasks")}</p>
                          <p className="mt-1 text-[var(--muted)]">{String(deploymentRollbackRunbookDetail.result.planned.length || 0)}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <ListChecks className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.executionAuditTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.executionAuditDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentExecutionAudits.isFetching}
                    onClick={() => void deploymentExecutionAudits.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <select className={inputClass} value={selectedExecutionAuditPackageId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, package_id: e.target.value })}>
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <select className={inputClass} value={deploymentExecutionAuditDraft.environment} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, environment: e.target.value })}>
                        {["dev", "staging", "production", "rollback"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentExecutionAuditDraft.action} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, action: e.target.value })}>
                        {["deploy", "rollback", "canary", "runbook", "manual"].map((action) => <option key={action} value={action}>{t(`page.settings.executionAuditAction.${action}`, { defaultValue: action })}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <select className={inputClass} value={selectedExecutionAuditPipelineId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, pipeline_run_id: e.target.value })}>
                        <option value="">{t("page.settings.executionAuditPipelinePh")}</option>
                        {(deploymentPipelines.data?.items || []).map((run: any) => <option key={run.id} value={run.id}>{`${run.environment} / ${run.action} / ${run.status}`}</option>)}
                      </select>
                      <select className={inputClass} value={selectedExecutionAuditCanaryId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, canary_policy_id: e.target.value })}>
                        <option value="">{t("page.settings.executionAuditCanaryPh")}</option>
                        {(deploymentCanaryPolicies.data?.items || []).map((policy: any) => <option key={policy.id} value={policy.id}>{`${policy.name || policy.version} / ${policy.status}`}</option>)}
                      </select>
                      <select className={inputClass} value={selectedExecutionAuditDrillId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, rollback_drill_id: e.target.value })}>
                        <option value="">{t("page.settings.executionAuditDrillPh")}</option>
                        {(deploymentRollbackDrills.data?.items || []).map((drill: any) => <option key={drill.id} value={drill.id}>{`${drill.name || drill.version} / ${drill.status}`}</option>)}
                      </select>
                      <select className={inputClass} value={selectedExecutionAuditRunbookId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, rollback_runbook_id: e.target.value })}>
                        <option value="">{t("page.settings.executionAuditRunbookPh")}</option>
                        {(deploymentRollbackRunbooks.data?.items || []).map((runbook: any) => <option key={runbook.id} value={runbook.id}>{`${runbook.name || runbook.version} / ${runbook.status}`}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <select className={inputClass} value={deploymentExecutionAuditDraft.status} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, status: e.target.value })}>
                        {["pending", "running", "succeeded", "failed", "blocked"].map((status) => <option key={status} value={status}>{t(`page.settings.executionAuditStatus.${status}`, { defaultValue: status })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentExecutionAuditDraft.risk_level} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, risk_level: e.target.value })}>
                        {["low", "medium", "high", "critical"].map((risk) => <option key={risk} value={risk}>{t(`page.settings.executionAuditRisk.${risk}`, { defaultValue: risk })}</option>)}
                      </select>
                      <input className={inputClass} value={deploymentExecutionAuditDraft.actor} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, actor: e.target.value })} placeholder={t("page.settings.executionAuditActor")} />
                      <input className={inputClass} value={deploymentExecutionAuditDraft.change_ticket} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, change_ticket: e.target.value })} placeholder={t("page.settings.executionAuditTicket")} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_1fr_12rem_12rem]">
                      <input className={inputClass} value={deploymentExecutionAuditDraft.evidence_url} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, evidence_url: e.target.value })} placeholder={t("page.settings.executionAuditEvidenceUrl")} />
                      <input className={inputClass} value={deploymentExecutionAuditDraft.assigned_to} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, assigned_to: e.target.value })} placeholder={t("page.settings.executionAuditAssignee")} />
                      <select className={inputClass} value={deploymentExecutionAuditDraft.priority} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, priority: e.target.value })}>
                        {["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                      </select>
                      <input className={inputClass} value={deploymentExecutionAuditDraft.dev_tool} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, dev_tool: e.target.value })} placeholder={t("page.settings.rollbackRunbookDevTool")} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <textarea className={`${inputClass} min-h-20`} value={deploymentExecutionAuditDraft.notes} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, notes: e.target.value })} placeholder={t("page.settings.executionAuditNotes")} />
                      <textarea className={`${inputClass} min-h-20`} value={deploymentExecutionAuditDraft.metadata} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, metadata: e.target.value })} placeholder={t("page.settings.executionAuditMetadata")} />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                      <input type="checkbox" checked={deploymentExecutionAuditDraft.include_low} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, include_low: e.target.checked })} />
                      {t("page.settings.executionAuditIncludeLow")}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={createDeploymentExecutionAudit.isPending || !selectedExecutionAuditPackageId} onClick={() => createDeploymentExecutionAudit.mutate()}>
                        <ListChecks className="h-4 w-4" />
                        {t("page.settings.executionAuditCreate")}
                      </button>
                      <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50" disabled={createDeploymentExecutionAuditTasks.isPending || !deploymentExecutionAuditDetail?.item?.id} onClick={() => createDeploymentExecutionAuditTasks.mutate(true)}>
                        {t("page.settings.executionAuditPreviewTasks")}
                      </button>
                      <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50" disabled={createDeploymentExecutionAuditTasks.isPending || !deploymentExecutionAuditDetail?.item?.id} onClick={() => createDeploymentExecutionAuditTasks.mutate(false)}>
                        {t("page.settings.executionAuditCreateTasks")}
                      </button>
                    </div>
                    {createDeploymentExecutionAudit.error ? <ErrorLine message={(createDeploymentExecutionAudit.error as Error).message} /> : null}
                    {createDeploymentExecutionAuditTasks.error ? <ErrorLine message={(createDeploymentExecutionAuditTasks.error as Error).message} /> : null}
                    {deploymentExecutionAudits.error ? <ErrorLine message={(deploymentExecutionAudits.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.executionAuditRecent")}</p>
                      <StatusPill tone={deploymentExecutionAuditDetail?.item?.risk_level === "critical" || deploymentExecutionAuditDetail?.item?.risk_level === "high" ? "danger" : deploymentExecutionAuditDetail?.item?.risk_level === "low" ? "ok" : "warn"} label={deploymentExecutionAuditDetail?.item?.risk_level ? t(`page.settings.executionAuditRisk.${deploymentExecutionAuditDetail.item.risk_level}`, { defaultValue: deploymentExecutionAuditDetail.item.risk_level }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentExecutionAudits.data?.items || []).map((audit: any) => (
                        <button key={audit.id} type="button" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50" disabled={loadDeploymentExecutionAudit.isPending} onClick={() => loadDeploymentExecutionAudit.mutate(audit.id)}>
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-[var(--text)]">{`${audit.environment} / ${t(`page.settings.executionAuditAction.${audit.action}`, { defaultValue: audit.action })}`}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{audit.risk_score}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${t(`page.settings.executionAuditStatus.${audit.status}`, { defaultValue: audit.status })} / ${audit.evidence_passed || 0}/${audit.evidence_total || 0}`}</span>
                        </button>
                      ))}
                      {!deploymentExecutionAudits.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.executionAuditEmpty")}</p> : null}
                    </div>
                    {loadDeploymentExecutionAudit.error ? <ErrorLine message={(loadDeploymentExecutionAudit.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentExecutionAuditDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentExecutionAuditDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentExecutionAuditDetail.item?.package_id}</p>
                        </div>
                        <StatusPill tone={deploymentExecutionAuditDetail.item?.risk_level === "critical" || deploymentExecutionAuditDetail.item?.risk_level === "high" ? "danger" : deploymentExecutionAuditDetail.item?.risk_level === "low" ? "ok" : "warn"} label={`${t(`page.settings.executionAuditRisk.${deploymentExecutionAuditDetail.item?.risk_level}`, { defaultValue: deploymentExecutionAuditDetail.item?.risk_level || "-" })} ${deploymentExecutionAuditDetail.item?.risk_score || 0}`} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <Info label={t("page.settings.executionAuditStatusLabel")} value={t(`page.settings.executionAuditStatus.${deploymentExecutionAuditDetail.item?.status}`, { defaultValue: deploymentExecutionAuditDetail.item?.status || "-" })} />
                        <Info label={t("page.settings.executionAuditCoverage")} value={`${deploymentExecutionAuditDetail.item?.evidence_passed || 0}/${deploymentExecutionAuditDetail.item?.evidence_total || 0}`} />
                        <Info label={t("page.settings.executionAuditMissing")} value={String(deploymentExecutionAuditDetail.item?.missing_required || 0)} />
                        <Info label={t("page.settings.executionAuditTasks")} value={String(deploymentExecutionAuditDetail.item?.task_count || 0)} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentExecutionAuditDetail.audit?.evidence || []).map((row: any) => (
                          <div key={row.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate font-medium text-[var(--text)]">{row.label || row.id}</span>
                              <StatusPill tone={row.status === "passed" ? "ok" : row.status === "failed" || row.status === "missing" ? "danger" : "warn"} label={t(`page.settings.executionAuditEvidenceStatus.${row.status}`, { defaultValue: row.status })} />
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{row.ref_id || row.summary || "-"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.executionAuditEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentExecutionAuditDetail.audit?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.executionAuditEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                      {deploymentExecutionAuditDetail.result?.planned ? (
                        <div className="mt-3 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                          <p className="font-semibold text-[var(--text)]">{t("page.settings.executionAuditPlannedTasks")}</p>
                          <p className="mt-1 text-[var(--muted)]">{String(deploymentExecutionAuditDetail.result.planned.length || 0)}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <SlidersHorizontal className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.canaryDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentCanaryPolicies.isFetching}
                    onClick={() => void deploymentCanaryPolicies.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        className={inputClass}
                        value={selectedCanaryPackageId}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, package_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.name}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, name: e.target.value })}
                        placeholder={t("page.settings.canaryName")}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <select className={inputClass} value={deploymentCanaryDraft.environment} onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, environment: e.target.value })}>
                        {["dev", "staging", "production"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentCanaryDraft.strategy} onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, strategy: e.target.value })}>
                        {["linear", "exponential", "manual"].map((strategy) => <option key={strategy} value={strategy}>{t(`page.settings.canaryStrategy.${strategy}`, { defaultValue: strategy })}</option>)}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.traffic_steps}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, traffic_steps: e.target.value })}
                        placeholder={t("page.settings.canarySteps")}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.max_error_rate}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, max_error_rate: e.target.value })}
                        placeholder={t("page.settings.canaryMaxError")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.latency_p95_ms}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, latency_p95_ms: e.target.value })}
                        placeholder={t("page.settings.canaryLatency")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.min_observation_minutes}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, min_observation_minutes: e.target.value })}
                        placeholder={t("page.settings.canaryObserve")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.created_by}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, created_by: e.target.value })}
                        placeholder={t("page.settings.canaryOperator")}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_10rem_10rem]">
                      <textarea
                        className={`${inputClass} min-h-20`}
                        value={deploymentCanaryDraft.notes}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, notes: e.target.value })}
                        placeholder={t("page.settings.canaryNotes")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.error_rate}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, error_rate: e.target.value })}
                        placeholder={t("page.settings.canaryObservedError")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.observed_latency_p95_ms}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, observed_latency_p95_ms: e.target.value })}
                        placeholder={t("page.settings.canaryObservedLatency")}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                      <input type="checkbox" checked={deploymentCanaryDraft.auto_promote} onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, auto_promote: e.target.checked })} />
                      {t("page.settings.canaryAutoPromote")}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={createDeploymentCanaryPolicy.isPending || !selectedCanaryPackageId}
                        onClick={() => createDeploymentCanaryPolicy.mutate()}
                      >
                        <Activity className="h-4 w-4" />
                        {t("page.settings.canaryCreate")}
                      </button>
                      {["start", "advance", "pause", "resume", "rollback", "complete"].map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                          disabled={applyDeploymentCanaryAction.isPending || !deploymentCanaryDetail?.item?.id}
                          onClick={() => applyDeploymentCanaryAction.mutate({ policyId: deploymentCanaryDetail.item.id, action })}
                        >
                          {t(`page.settings.canaryControl.${action}`, { defaultValue: action })}
                        </button>
                      ))}
                    </div>
                    {createDeploymentCanaryPolicy.error ? <ErrorLine message={(createDeploymentCanaryPolicy.error as Error).message} /> : null}
                    {applyDeploymentCanaryAction.error ? <ErrorLine message={(applyDeploymentCanaryAction.error as Error).message} /> : null}
                    {deploymentCanaryPolicies.error ? <ErrorLine message={(deploymentCanaryPolicies.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryRecent")}</p>
                      <StatusPill tone={deploymentCanaryDetail?.item?.status === "completed" ? "ok" : deploymentCanaryDetail?.item?.status === "rolled_back" || deploymentCanaryDetail?.item?.status === "blocked" ? "danger" : "warn"} label={deploymentCanaryDetail?.item?.status ? t(`page.settings.canaryStatus.${deploymentCanaryDetail.item.status}`, { defaultValue: deploymentCanaryDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentCanaryPolicies.data?.items || []).map((policy: any) => (
                        <button
                          key={policy.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentCanaryPolicy.isPending}
                          onClick={() => loadDeploymentCanaryPolicy.mutate(policy.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-[var(--text)]">{policy.name || policy.version}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{policy.current_traffic}%</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${policy.environment} / ${policy.strategy} / ${t(`page.settings.canaryStatus.${policy.status}`, { defaultValue: policy.status })}`}</span>
                        </button>
                      ))}
                      {!deploymentCanaryPolicies.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.canaryEmpty")}</p> : null}
                    </div>
                    {loadDeploymentCanaryPolicy.error ? <ErrorLine message={(loadDeploymentCanaryPolicy.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentCanaryDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentCanaryDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentCanaryDetail.item?.package_id}</p>
                        </div>
                        <StatusPill tone={deploymentCanaryDetail.item?.status === "completed" ? "ok" : deploymentCanaryDetail.item?.status === "blocked" || deploymentCanaryDetail.item?.status === "rolled_back" ? "danger" : "warn"} label={t(`page.settings.canaryStatus.${deploymentCanaryDetail.item?.status}`, { defaultValue: deploymentCanaryDetail.item?.status || "-" })} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <Info label={t("page.settings.canaryTraffic")} value={`${deploymentCanaryDetail.item?.current_traffic ?? 0}%`} />
                        <Info label={t("page.settings.canaryStep")} value={`${Number(deploymentCanaryDetail.item?.current_step_index ?? -1) + 1}/${deploymentCanaryDetail.item?.traffic_steps?.length || 0}`} />
                        <Info label={t("page.settings.canaryPipeline")} value={String(deploymentCanaryDetail.item?.pipeline_run_id || "-")} />
                        <Info label={t("page.settings.canaryUpdatedAt")} value={String(deploymentCanaryDetail.item?.updated_at || "-")} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(deploymentCanaryDetail.item?.traffic_steps || []).map((step: number) => (
                          <span key={step} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${step <= Number(deploymentCanaryDetail.item?.current_traffic || 0) ? "bg-[var(--brand)] text-white" : "bg-[var(--surface)] text-[var(--muted-strong)]"}`}>
                            {step}%
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentCanaryDetail.policy?.gates || []).slice(-4).reverse().map((gate: any) => (
                          <div key={gate.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold text-[var(--text)]">{t("page.settings.canaryGate")}</p>
                              <StatusPill tone={gate.status === "passed" ? "ok" : gate.status === "failed" ? "danger" : "warn"} label={t(`page.settings.canaryGateStatus.${gate.status}`, { defaultValue: gate.status })} />
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{JSON.stringify(gate.metrics || {})}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentCanaryDetail.policy?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.canaryEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 xl:col-span-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                            <Activity className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryMetricTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.canaryMetricDesc")}</p>
                          </div>
                        </div>
                        <StatusPill tone={deploymentCanaryMetricResult?.gate?.status === "passed" ? "ok" : deploymentCanaryMetricResult?.gate?.status === "failed" ? "danger" : "warn"} label={deploymentCanaryMetricResult?.gate?.status ? t(`page.settings.canaryGateStatus.${deploymentCanaryMetricResult.gate.status}`, { defaultValue: deploymentCanaryMetricResult.gate.status }) : t("page.settings.canaryMetricNoResult")} />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <select className={inputClass} value={deploymentCanaryMetricSourceDraft.source_type} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, source_type: e.target.value })}>
                          {["manual", "synthetic", "prometheus", "grafana", "datadog"].map((type) => <option key={type} value={type}>{t(`page.settings.canaryMetricSourceType.${type}`, { defaultValue: type })}</option>)}
                        </select>
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.name} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, name: e.target.value })} placeholder={t("page.settings.canaryMetricName")} />
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.window_minutes} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, window_minutes: e.target.value })} placeholder={t("page.settings.canaryMetricWindow")} />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_9rem_9rem]">
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.endpoint} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, endpoint: e.target.value })} placeholder={t("page.settings.canaryMetricEndpoint")} />
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.sample_error_rate} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, sample_error_rate: e.target.value })} placeholder={t("page.settings.canaryObservedError")} />
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.sample_latency_p95_ms} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, sample_latency_p95_ms: e.target.value })} placeholder={t("page.settings.canaryObservedLatency")} />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <textarea className={`${inputClass} min-h-20`} value={deploymentCanaryMetricSourceDraft.error_rate_query} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, error_rate_query: e.target.value })} placeholder={t("page.settings.canaryMetricErrorQuery")} />
                        <textarea className={`${inputClass} min-h-20`} value={deploymentCanaryMetricSourceDraft.latency_p95_query} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, latency_p95_query: e.target.value })} placeholder={t("page.settings.canaryMetricLatencyQuery")} />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                        <textarea className={`${inputClass} min-h-16`} value={deploymentCanaryMetricSourceDraft.labels} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, labels: e.target.value })} placeholder={t("page.settings.canaryMetricLabels")} />
                        <textarea className={`${inputClass} min-h-16`} value={deploymentCanaryMetricSourceDraft.notes} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, notes: e.target.value })} placeholder={t("page.settings.canaryMetricNotes")} />
                        <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--muted-strong)]">
                          <input type="checkbox" checked={deploymentCanaryMetricSourceDraft.enabled} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, enabled: e.target.checked })} />
                          {t("page.settings.canaryMetricEnabled")}
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={createDeploymentCanaryMetricSource.isPending || !selectedCanaryPolicyId} onClick={() => createDeploymentCanaryMetricSource.mutate()}>
                          <SlidersHorizontal className="h-4 w-4" />
                          {t("page.settings.canaryMetricCreate")}
                        </button>
                        <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={collectDeploymentCanaryMetrics.isPending || !selectedCanaryMetricSourceId} onClick={() => collectDeploymentCanaryMetrics.mutate({ dryRun: true, applyToGate: false, advanceOnPass: false })}>
                          <Search className="h-4 w-4" />
                          {t("page.settings.canaryMetricPreview")}
                        </button>
                        <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={collectDeploymentCanaryMetrics.isPending || !selectedCanaryMetricSourceId} onClick={() => collectDeploymentCanaryMetrics.mutate({ dryRun: false, applyToGate: true, advanceOnPass: false })}>
                          <ListChecks className="h-4 w-4" />
                          {t("page.settings.canaryMetricApplyGate")}
                        </button>
                        <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={collectDeploymentCanaryMetrics.isPending || !selectedCanaryMetricSourceId} onClick={() => collectDeploymentCanaryMetrics.mutate({ dryRun: false, applyToGate: true, advanceOnPass: true })}>
                          <Rocket className="h-4 w-4" />
                          {t("page.settings.canaryMetricAutoAdvance")}
                        </button>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
                        <div className="space-y-2">
                          {(deploymentCanaryMetricSources.data?.items || []).map((source: any) => (
                            <button key={source.id} type="button" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50" disabled={loadDeploymentCanaryMetricSource.isPending} onClick={() => loadDeploymentCanaryMetricSource.mutate(source.id)}>
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-semibold text-[var(--text)]">{source.name || source.id}</span>
                                <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">{source.source_type}</span>
                              </span>
                              <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${source.last_status || "-"} / ${source.last_error_rate || "-"} / ${source.last_latency_p95_ms || "-"}`}</span>
                            </button>
                          ))}
                          {!deploymentCanaryMetricSources.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.canaryMetricEmpty")}</p> : null}
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                          <div className="grid gap-2 md:grid-cols-4">
                            <Info label={t("page.settings.canaryMetricErrorRate")} value={String(deploymentCanaryMetricResult?.metrics?.error_rate ?? deploymentCanaryMetricSourceDetail?.item?.last_error_rate ?? "-")} />
                            <Info label={t("page.settings.canaryMetricLatency")} value={String(deploymentCanaryMetricResult?.metrics?.latency_p95_ms ?? deploymentCanaryMetricSourceDetail?.item?.last_latency_p95_ms ?? "-")} />
                            <Info label={t("page.settings.canaryMetricMode")} value={String(deploymentCanaryMetricResult?.metrics?.collection_mode || "-")} />
                            <Info label={t("page.settings.canaryMetricSamples")} value={String(deploymentCanaryMetricSourceDetail?.item?.sample_count ?? "-")} />
                          </div>
                          {deploymentCanaryMetricResult ? <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ metrics: deploymentCanaryMetricResult.metrics, gate: deploymentCanaryMetricResult.gate, applied: deploymentCanaryMetricResult.applied, advanced: deploymentCanaryMetricResult.advanced }, null, 2)}</pre> : null}
                        </div>
                      </div>
                      {createDeploymentCanaryMetricSource.error ? <ErrorLine message={(createDeploymentCanaryMetricSource.error as Error).message} /> : null}
                      {loadDeploymentCanaryMetricSource.error ? <ErrorLine message={(loadDeploymentCanaryMetricSource.error as Error).message} /> : null}
                      {collectDeploymentCanaryMetrics.error ? <ErrorLine message={(collectDeploymentCanaryMetrics.error as Error).message} /> : null}
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 xl:col-span-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                            <MessageSquare className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryImTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.canaryImDesc")}</p>
                          </div>
                        </div>
                        {deploymentCanaryImResult?.delivery_plan ? (
                          <StatusPill
                            tone={deploymentCanaryImResult.delivery_plan.ready ? "ok" : "warn"}
                            label={`${deploymentCanaryImResult.delivery_plan.target_count || 0} ${t("page.settings.canaryImTargets")}`}
                          />
                        ) : null}
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem]">
                        <input
                          className={inputClass}
                          value={deploymentCanaryImDraft.title}
                          onChange={(e) => setDeploymentCanaryImDraft({ ...deploymentCanaryImDraft, title: e.target.value })}
                          placeholder={t("page.settings.canaryImTitlePh")}
                        />
                        <input
                          className={inputClass}
                          value={deploymentCanaryImDraft.limit}
                          onChange={(e) => setDeploymentCanaryImDraft({ ...deploymentCanaryImDraft, limit: e.target.value })}
                          placeholder={t("page.settings.canaryImLimit")}
                        />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        {(notifyChannels.data || []).map((channel: any) => {
                          const selected = deploymentCanaryImDraft.channels.includes(channel.name);
                          return (
                            <label key={channel.name} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${selected ? "border-[var(--brand)] bg-[var(--brand-softer)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-[var(--text)]">{channel.name}</span>
                                <span className="block truncate text-[11px] text-[var(--muted)]">{`${channel.type || "webhook"} / ${channel.enabled === false ? t("page.settings.canaryImDisabled") : t("page.settings.canaryImEnabled")}`}</span>
                              </span>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  const channels = e.target.checked
                                    ? [...deploymentCanaryImDraft.channels, channel.name]
                                    : deploymentCanaryImDraft.channels.filter((item: string) => item !== channel.name);
                                  setDeploymentCanaryImDraft({ ...deploymentCanaryImDraft, channels });
                                }}
                              />
                            </label>
                          );
                        })}
                      </div>
                      {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.canaryImNoChannels")} /> : null}
                      {notifyChannels.error ? <ErrorLine message={(notifyChannels.error as Error).message} /> : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                          disabled={runDeploymentCanaryIm.isPending || !deploymentCanaryDetail.item?.id}
                          onClick={() => runDeploymentCanaryIm.mutate(true)}
                        >
                          <Search className="h-4 w-4" />
                          {t("page.settings.canaryImPreview")}
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          disabled={runDeploymentCanaryIm.isPending || !deploymentCanaryDetail.item?.id}
                          onClick={() => runDeploymentCanaryIm.mutate(false)}
                        >
                          <Send className="h-4 w-4" />
                          {t("page.settings.canaryImSend")}
                        </button>
                      </div>
                      {deploymentCanaryImResult ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          <Info label={t("page.settings.canaryImRisk")} value={String(deploymentCanaryImResult.briefing?.risk_level || "-")} />
                          <Info label={t("page.settings.canaryImMode")} value={String(deploymentCanaryImResult.delivery_plan?.selection_mode || "-")} />
                          <Info label={t("page.settings.canaryImSent")} value={String(deploymentCanaryImResult.sent?.length || 0)} />
                        </div>
                      ) : null}
                      {deploymentCanaryImResult?.delivery_plan?.recommendation ? <HintLine message={deploymentCanaryImResult.delivery_plan.recommendation} /> : null}
                      {runDeploymentCanaryIm.error ? <ErrorLine message={(runDeploymentCanaryIm.error as Error).message} /> : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackDrillTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.rollbackDrillDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentRollbackDrills.isFetching}
                    onClick={() => void deploymentRollbackDrills.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        className={inputClass}
                        value={selectedRollbackDrillPackageId}
                        onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, package_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentRollbackDrillDraft.name}
                        onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, name: e.target.value })}
                        placeholder={t("page.settings.rollbackDrillName")}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <select className={inputClass} value={deploymentRollbackDrillDraft.environment} onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, environment: e.target.value })}>
                        {["dev", "staging", "production", "rollback"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentRollbackDrillDraft.scenario} onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, scenario: e.target.value })}>
                        {["post_deploy_regression", "canary_gate_failure", "dependency_outage", "manual_rehearsal"].map((scenario) => <option key={scenario} value={scenario}>{t(`page.settings.rollbackDrillScenario.${scenario}`, { defaultValue: scenario })}</option>)}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentRollbackDrillDraft.operator}
                        onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, operator: e.target.value })}
                        placeholder={t("page.settings.rollbackDrillOperator")}
                      />
                    </div>
                    <textarea
                      className={`${inputClass} min-h-20`}
                      value={deploymentRollbackDrillDraft.notes}
                      onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, notes: e.target.value })}
                      placeholder={t("page.settings.rollbackDrillNotes")}
                    />
                    <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-strong)]">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={deploymentRollbackDrillDraft.approval_required} onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, approval_required: e.target.checked })} />
                        {t("page.settings.pipelineApprovalRequired")}
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={deploymentRollbackDrillDraft.create_pipeline} onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, create_pipeline: e.target.checked })} />
                        {t("page.settings.rollbackDrillCreatePreview")}
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={createDeploymentRollbackDrill.isPending || !selectedRollbackDrillPackageId}
                        onClick={() => createDeploymentRollbackDrill.mutate()}
                      >
                        <ListChecks className="h-4 w-4" />
                        {t("page.settings.rollbackDrillCreate")}
                      </button>
                      {["start", "create_rollback_pipeline", "complete", "cancel"].map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                          disabled={applyDeploymentRollbackDrillAction.isPending || !deploymentRollbackDrillDetail?.item?.id}
                          onClick={() => applyDeploymentRollbackDrillAction.mutate({ drillId: deploymentRollbackDrillDetail.item.id, action })}
                        >
                          {t(`page.settings.rollbackDrillControl.${action}`, { defaultValue: action })}
                        </button>
                      ))}
                    </div>
                    {createDeploymentRollbackDrill.error ? <ErrorLine message={(createDeploymentRollbackDrill.error as Error).message} /> : null}
                    {applyDeploymentRollbackDrillAction.error ? <ErrorLine message={(applyDeploymentRollbackDrillAction.error as Error).message} /> : null}
                    {deploymentRollbackDrills.error ? <ErrorLine message={(deploymentRollbackDrills.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackDrillRecent")}</p>
                      <StatusPill tone={deploymentRollbackDrillDetail?.item?.status === "completed" ? "ok" : deploymentRollbackDrillDetail?.item?.status === "risk" ? "danger" : "warn"} label={deploymentRollbackDrillDetail?.item?.status ? t(`page.settings.rollbackDrillStatus.${deploymentRollbackDrillDetail.item.status}`, { defaultValue: deploymentRollbackDrillDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentRollbackDrills.data?.items || []).map((drill: any) => (
                        <button
                          key={drill.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentRollbackDrill.isPending}
                          onClick={() => loadDeploymentRollbackDrill.mutate(drill.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-[var(--text)]">{drill.name || drill.version}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{`${drill.check_passed}/${drill.check_total}`}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${drill.environment} / ${t(`page.settings.rollbackDrillStatus.${drill.status}`, { defaultValue: drill.status })}`}</span>
                        </button>
                      ))}
                      {!deploymentRollbackDrills.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.rollbackDrillEmpty")}</p> : null}
                    </div>
                    {loadDeploymentRollbackDrill.error ? <ErrorLine message={(loadDeploymentRollbackDrill.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentRollbackDrillDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentRollbackDrillDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentRollbackDrillDetail.item?.package_id}</p>
                        </div>
                        <StatusPill tone={deploymentRollbackDrillDetail.item?.status === "completed" ? "ok" : deploymentRollbackDrillDetail.item?.status === "risk" ? "danger" : "warn"} label={t(`page.settings.rollbackDrillStatus.${deploymentRollbackDrillDetail.item?.status}`, { defaultValue: deploymentRollbackDrillDetail.item?.status || "-" })} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <Info label={t("page.settings.rollbackDrillScenarioLabel")} value={t(`page.settings.rollbackDrillScenario.${deploymentRollbackDrillDetail.item?.scenario}`, { defaultValue: deploymentRollbackDrillDetail.item?.scenario || "-" })} />
                        <Info label={t("page.settings.rollbackDrillChecks")} value={`${deploymentRollbackDrillDetail.item?.check_passed ?? 0}/${deploymentRollbackDrillDetail.item?.check_total ?? 0}`} />
                        <Info label={t("page.settings.rollbackDrillPreviewPipeline")} value={String(deploymentRollbackDrillDetail.item?.preview_pipeline_run_id || "-")} />
                        <Info label={t("page.settings.rollbackDrillPipeline")} value={String(deploymentRollbackDrillDetail.item?.rollback_pipeline_run_id || "-")} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentRollbackDrillDetail.drill?.checks || []).map((check: any) => (
                          <div key={check.id} className="rounded-lg bg-[var(--surface)] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-xs font-medium text-[var(--text)]">{t(`page.settings.rollbackDrillCheck.${check.id}`, { defaultValue: check.id })}</span>
                              <StatusPill tone={check.status === "failed" ? "danger" : check.status === "passed" ? "ok" : "warn"} label={t(`page.settings.rollbackDrillCheckStatus.${check.status}`, { defaultValue: check.status })} />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                                disabled={applyDeploymentRollbackDrillAction.isPending || !deploymentRollbackDrillDetail.item?.id}
                                onClick={() => applyDeploymentRollbackDrillAction.mutate({ drillId: deploymentRollbackDrillDetail.item.id, action: "pass_check", checkId: check.id })}
                              >
                                {t("page.settings.rollbackDrillPassCheck")}
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--danger)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                                disabled={applyDeploymentRollbackDrillAction.isPending || !deploymentRollbackDrillDetail.item?.id}
                                onClick={() => applyDeploymentRollbackDrillAction.mutate({ drillId: deploymentRollbackDrillDetail.item.id, action: "fail_check", checkId: check.id })}
                              >
                                {t("page.settings.rollbackDrillFailCheck")}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackDrillEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentRollbackDrillDetail.drill?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.rollbackDrillEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Rocket className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.pipelineDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentPipelines.isFetching}
                    onClick={() => void deploymentPipelines.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Info label={t("page.settings.deployPackage")} value={selectedDeploymentPackageId || "-"} />
                      <Info label={t("page.settings.pipelineEnvironmentLabel", { defaultValue: "环境" })} value={t(`page.settings.pipelineEnvironment.${deploymentPipelineDraft.environment}`, { defaultValue: deploymentPipelineDraft.environment })} />
                      <Info label={t("page.settings.pipelineActionLabel", { defaultValue: "动作" })} value={t(`page.settings.pipelineAction.${deploymentPipelineDraft.action}`, { defaultValue: deploymentPipelineDraft.action })} />
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineQuickSummary", { defaultValue: "发布草稿" })}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{deploymentPipelineDraft.notes || t("page.settings.pipelineNotes")}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusPill tone={deploymentPipelineDraft.dry_run ? "warn" : "ok"} label={deploymentPipelineDraft.dry_run ? t("page.settings.pipelineDryRun") : t("page.settings.pipelineCreate")} />
                        <StatusPill tone={deploymentPipelineDraft.approval_required ? "warn" : "ok"} label={deploymentPipelineDraft.approval_required ? t("page.settings.pipelineApprovalRequired") : t("page.settings.pipelineNoApproval", { defaultValue: "无需审批" })} />
                      </div>
                    </div>
                    <Button block type="primary" icon={<Rocket className="h-4 w-4" />} onClick={() => setDeploymentPipelineDrawerOpen(true)}>
                      {t("page.settings.pipelineOpenDrawer", { defaultValue: "配置发布流水线" })}
                    </Button>
                    {createDeploymentPipeline.error ? <ErrorLine message={(createDeploymentPipeline.error as Error).message} /> : null}
                    {deploymentPipelines.error ? <ErrorLine message={(deploymentPipelines.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineRecent")}</p>
                      <StatusPill tone={deploymentPipelineDetail?.item?.status === "failed" ? "danger" : deploymentPipelineDetail?.item?.status === "succeeded" ? "ok" : "warn"} label={deploymentPipelineDetail?.item?.status ? t(`page.settings.pipelineStatus.${deploymentPipelineDetail.item.status}`, { defaultValue: deploymentPipelineDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentPipelines.data?.items || []).map((run: any) => (
                        <button
                          key={run.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentPipeline.isPending}
                          onClick={() => loadDeploymentPipeline.mutate(run.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs text-[var(--text)]">{run.version || run.package_id}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{t(`page.settings.pipelineStatus.${run.status}`, { defaultValue: run.status })}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${run.environment} / ${run.action} / ${run.stage_done}/${run.stage_total}`}</span>
                        </button>
                      ))}
                      {!deploymentPipelines.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.pipelineEmpty")}</p> : null}
                    </div>
                    {loadDeploymentPipeline.error ? <ErrorLine message={(loadDeploymentPipeline.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentPipelineDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentPipelineDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentPipelineDetail.item?.package_id}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {["approve", "start", "mark_success", "mark_failed", "cancel"].map((action) => (
                            <button
                              key={action}
                              type="button"
                              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                              disabled={applyDeploymentPipelineAction.isPending || !deploymentPipelineDetail.item?.id}
                              onClick={() => applyDeploymentPipelineAction.mutate({ runId: deploymentPipelineDetail.item.id, action })}
                            >
                              {t(`page.settings.pipelineControl.${action}`, { defaultValue: action })}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentPipelineDetail.run?.stages || []).map((stage: any) => (
                          <div key={stage.id} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface)] px-3 py-2">
                            <span className="truncate text-xs font-medium text-[var(--text)]">{t(`page.settings.pipelineStage.${stage.id}`, { defaultValue: stage.id })}</span>
                            <StatusPill tone={stage.status === "failed" ? "danger" : stage.status === "completed" ? "ok" : "warn"} label={t(`page.settings.pipelineStatus.${stage.status}`, { defaultValue: stage.status })} />
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineExecutorTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.pipelineExecutorDesc")}</p>
                          </div>
                          <StatusPill tone={deploymentPipelineDetail.item?.last_execution_status === "failed" ? "danger" : deploymentPipelineDetail.item?.last_execution_status === "succeeded" ? "ok" : "warn"} label={deploymentPipelineDetail.item?.last_execution_status || "EXEC"} />
                        </div>
                        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineExecutorTargetTitle")}</p>
                              <p className="mt-1 text-[11px] text-[var(--muted)]">{t("page.settings.pipelineExecutorTargetDesc")}</p>
                            </div>
                            <StatusPill tone={(deploymentExecutorTargets.data?.items || []).some((target: any) => target.enabled) ? "ok" : "warn"} label={`${deploymentExecutorTargets.data?.total || 0} ${t("page.settings.pipelineExecutorTargetCount")}`} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <input className={inputClass} value={deploymentExecutorTargetDraft.name} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, name: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetName")} />
                            <select className={inputClass} value={deploymentExecutorTargetDraft.target_type} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, target_type: e.target.value })}>
                              {["webhook", "github_actions", "gitlab_ci", "jenkins", "kubernetes_job", "temporal_workflow", "remote_agent"].map((type) => <option key={type} value={type}>{t(`page.settings.pipelineExecutorTargetType.${type}`, { defaultValue: type })}</option>)}
                            </select>
                            <input className={inputClass} value={deploymentExecutorTargetDraft.auth_ref} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, auth_ref: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetAuthRef")} />
                            <input className={inputClass} value={deploymentExecutorTargetDraft.callback_secret_ref} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, callback_secret_ref: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetCallbackSecretRef")} />
                            <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                              <input type="checkbox" checked={deploymentExecutorTargetDraft.enabled} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, enabled: e.target.checked })} />
                              {t("page.settings.pipelineExecutorTargetEnabled")}
                            </label>
                            <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                              <input type="checkbox" checked={deploymentExecutorTargetDraft.require_callback_signature} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, require_callback_signature: e.target.checked })} />
                              {t("page.settings.pipelineExecutorTargetRequireSignature")}
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem_12rem]">
                            <input className={inputClass} value={deploymentExecutorTargetDraft.endpoint} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, endpoint: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetEndpoint")} />
                            <input className={inputClass} type="number" min={1} max={50} value={deploymentExecutorTargetDraft.concurrency_limit} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, concurrency_limit: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetConcurrency")} />
                            <input className={inputClass} type="number" min={5} max={3600} value={deploymentExecutorTargetDraft.timeout_seconds} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, timeout_seconds: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetTimeout")} />
                            <input className={inputClass} type="number" min={30} max={3600} value={deploymentExecutorTargetDraft.callback_skew_seconds} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, callback_skew_seconds: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetCallbackSkew")} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <input className={inputClass} value={deploymentExecutorTargetDraft.supports} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, supports: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetSupports")} />
                            <input className={inputClass} value={deploymentExecutorTargetDraft.labels} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, labels: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetLabels")} />
                          </div>
                          <textarea className={`${inputClass} mt-3 min-h-16`} value={deploymentExecutorTargetDraft.notes} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, notes: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetNotes")} />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={saveDeploymentExecutorTarget.isPending || !deploymentExecutorTargetDraft.name.trim()} onClick={() => saveDeploymentExecutorTarget.mutate()}><Network className="h-4 w-4" />{deploymentExecutorTargetDraft.id ? t("page.settings.pipelineExecutorTargetUpdate") : t("page.settings.pipelineExecutorTargetCreate")}</button>
                            {deploymentExecutorTargetDraft.id ? (
                              <>
                                <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={applyDeploymentExecutorTargetAction.isPending} onClick={() => applyDeploymentExecutorTargetAction.mutate({ targetId: deploymentExecutorTargetDraft.id, action: "test" })}>{t("page.settings.pipelineExecutorTargetTest")}</button>
                                <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={applyDeploymentExecutorTargetAction.isPending} onClick={() => applyDeploymentExecutorTargetAction.mutate({ targetId: deploymentExecutorTargetDraft.id, action: deploymentExecutorTargetDraft.enabled ? "disable" : "enable" })}>{deploymentExecutorTargetDraft.enabled ? t("page.settings.pipelineExecutorTargetDisable") : t("page.settings.pipelineExecutorTargetEnable")}</button>
                                <button type="button" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={applyDeploymentExecutorTargetAction.isPending} onClick={() => applyDeploymentExecutorTargetAction.mutate({ targetId: deploymentExecutorTargetDraft.id, action: "delete" })}>{t("page.settings.pipelineExecutorTargetDelete")}</button>
                              </>
                            ) : null}
                          </div>
                          {saveDeploymentExecutorTarget.error ? <ErrorLine message={(saveDeploymentExecutorTarget.error as Error).message} /> : null}
                          {applyDeploymentExecutorTargetAction.error ? <ErrorLine message={(applyDeploymentExecutorTargetAction.error as Error).message} /> : null}
                          <div className="mt-3 grid gap-2 lg:grid-cols-2">
                            {(deploymentExecutorTargets.data?.items || []).slice(0, 6).map((target: any) => (
                              <button
                                key={target.id}
                                type="button"
                                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)]"
                                onClick={() => {
                                  setDeploymentExecutorTargetDraft({ id: target.id || "", name: target.name || "", target_type: target.target_type || "webhook", endpoint: target.endpoint || "", enabled: Boolean(target.enabled), supports: (target.supports || []).join(","), auth_ref: target.auth_ref || "", callback_secret_ref: target.callback_secret_ref || "", require_callback_signature: Boolean(target.require_callback_signature), callback_skew_seconds: String(target.callback_skew_seconds || 300), concurrency_limit: String(target.concurrency_limit || 1), timeout_seconds: String(target.timeout_seconds || 120), labels: mapToLines(target.labels), notes: target.notes || "" });
                                  setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, executor_id: target.id });
                                }}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-[var(--text)]">{target.name || target.id}</p>
                                    <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${target.target_type || "-"} / ${target.endpoint || "-"}`}</p>
                                    <p className="mt-1 truncate text-[10px] text-[var(--muted)]">{target.require_callback_signature ? `${t("page.settings.pipelineExecutorTargetSigned")} / ${target.callback_secret_ref || "env://SOP_DEPLOY_CALLBACK_SECRET"}` : t("page.settings.pipelineExecutorTargetUnsigned")}</p>
                                  </div>
                                  <StatusPill tone={target.enabled ? "ok" : "warn"} label={target.last_check?.status || (target.enabled ? "enabled" : "disabled")} />
                                </div>
                              </button>
                            ))}
                            {!(deploymentExecutorTargets.data?.items || []).length ? <p className="text-xs text-[var(--muted)]">{t("page.settings.pipelineExecutorTargetEmpty")}</p> : null}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <select className={inputClass} value={deploymentPipelineExecuteDraft.executor_id} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, executor_id: e.target.value })}>
                            {(deploymentPipelineExecutors.data?.items || deploymentPipelineDetail.executors || deploymentPipelines.data?.executors || []).map((executor: any) => <option key={executor.id} value={executor.id}>{`${executor.name || executor.id} / ${executor.mode || "-"}`}</option>)}
                          </select>
                          <select className={inputClass} value={deploymentPipelineExecuteDraft.command_id} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, command_id: e.target.value })}>
                            <option value="">{t("page.settings.pipelineExecutorCommandPh")}</option>
                            {(deploymentPipelineDetail.run?.commands || []).map((command: any) => <option key={command.id} value={command.id}>{`${command.id} / ${command.intent}`}</option>)}
                          </select>
                          <select className={inputClass} value={deploymentPipelineExecuteDraft.stage_id} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, stage_id: e.target.value })}>
                            <option value="">{t("page.settings.pipelineExecutorStagePh")}</option>
                            {(deploymentPipelineDetail.run?.stages || []).map((stage: any) => <option key={stage.id} value={stage.id}>{t(`page.settings.pipelineStage.${stage.id}`, { defaultValue: stage.id })}</option>)}
                          </select>
                          <input className={inputClass} type="number" min={1} max={300} value={deploymentPipelineExecuteDraft.timeout_seconds} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, timeout_seconds: e.target.value })} placeholder={t("page.settings.pipelineExecutorTimeout")} />
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
                          <input className={inputClass} value={deploymentPipelineExecuteDraft.evidence_url} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, evidence_url: e.target.value })} placeholder={t("page.settings.pipelineExecutorEvidenceUrl")} />
                          <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--muted-strong)]">
                            <input type="checkbox" checked={deploymentPipelineExecuteDraft.allow_apply} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, allow_apply: e.target.checked })} />
                            {t("page.settings.pipelineExecutorAllowApply")}
                          </label>
                        </div>
                        <textarea className={`${inputClass} mt-3 min-h-16`} value={deploymentPipelineExecuteDraft.note} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, note: e.target.value })} placeholder={t("page.settings.pipelineExecutorNote")} />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={executeDeploymentPipeline.isPending || !deploymentPipelineDetail.item?.id} onClick={() => executeDeploymentPipeline.mutate(true)}><Search className="h-4 w-4" />{t("page.settings.pipelineExecutorPlan")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={executeDeploymentPipeline.isPending || !deploymentPipelineDetail.item?.id} onClick={() => executeDeploymentPipeline.mutate(false)}><PlayCircle className="h-4 w-4" />{t("page.settings.pipelineExecutorRun")}</button>
                        </div>
                        {executeDeploymentPipeline.error ? <ErrorLine message={(executeDeploymentPipeline.error as Error).message} /> : null}
                        {deploymentPipelineDetail.result ? <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(deploymentPipelineDetail.result, null, 2)}</pre> : null}
                        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineExternalCallbackTitle")}</p>
                              <p className="mt-1 text-[11px] text-[var(--muted)]">{t("page.settings.pipelineExternalCallbackDesc")}</p>
                            </div>
                            <StatusPill tone={(deploymentPipelineDetail.run?.executions || []).some((execution: any) => execution.status === "queued" || execution.status === "running") ? "warn" : "ok"} label={`${(deploymentPipelineDetail.run?.executions || []).length} ${t("page.settings.pipelineExternalCallbackExecutions")}`} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <select className={inputClass} value={deploymentPipelineCallbackDraft.execution_id} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, execution_id: e.target.value })}>
                              <option value="">{t("page.settings.pipelineExternalCallbackExecutionPh")}</option>
                              {(deploymentPipelineDetail.run?.executions || []).slice().reverse().map((execution: any) => <option key={execution.id} value={execution.id}>{`${execution.id} / ${execution.command_id || "-"} / ${execution.status || "-"}`}</option>)}
                            </select>
                            <select className={inputClass} value={deploymentPipelineCallbackDraft.status} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, status: e.target.value })}>
                              {["running", "succeeded", "failed", "blocked", "cancelled"].map((status) => <option key={status} value={status}>{t(`page.settings.pipelineStatus.${status}`, { defaultValue: status })}</option>)}
                            </select>
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.external_run_id} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, external_run_id: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackRunId")} />
                            <input className={inputClass} type="number" value={deploymentPipelineCallbackDraft.exit_code} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, exit_code: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackExitCode")} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.evidence_url} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, evidence_url: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackEvidence")} />
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.metadata} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, metadata: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackMetadata")} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-[10rem_12rem_minmax(0,1fr)]">
                            <input className={inputClass} type="number" value={deploymentPipelineCallbackDraft.timestamp} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, timestamp: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackTimestamp")} />
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.nonce} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, nonce: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackNonce")} />
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.signature} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, signature: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackSignature")} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <textarea className={`${inputClass} min-h-16`} value={deploymentPipelineCallbackDraft.stdout} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, stdout: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackStdout")} />
                            <textarea className={`${inputClass} min-h-16`} value={deploymentPipelineCallbackDraft.stderr} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, stderr: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackStderr")} />
                          </div>
                          <textarea className={`${inputClass} mt-3 min-h-14`} value={deploymentPipelineCallbackDraft.note} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, note: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackNote")} />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={callbackDeploymentPipelineExecution.isPending || !deploymentPipelineDetail.item?.id || !deploymentPipelineCallbackDraft.execution_id} onClick={() => callbackDeploymentPipelineExecution.mutate()}><Send className="h-4 w-4" />{t("page.settings.pipelineExternalCallbackSubmit")}</button>
                          </div>
                          {callbackDeploymentPipelineExecution.error ? <ErrorLine message={(callbackDeploymentPipelineExecution.error as Error).message} /> : null}
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineRemediationTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.pipelineRemediationDesc")}</p>
                          </div>
                          <StatusPill tone={(deploymentPipelineDetail.result?.summary?.high || deploymentPipelineDetail.run?.self_heal?.summary?.high || 0) > 0 ? "danger" : (deploymentPipelineDetail.result?.summary?.findings || deploymentPipelineDetail.run?.self_heal?.summary?.findings || 0) > 0 ? "warn" : "ok"} label={`${deploymentPipelineDetail.result?.summary?.findings ?? deploymentPipelineDetail.run?.self_heal?.summary?.findings ?? 0} ${t("page.settings.pipelineRemediationFindings")}`} />
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <select className={inputClass} value={deploymentPipelineRemediationDraft.priority} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, priority: e.target.value })}>
                            {["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{`${t("page.settings.pipelineRemediationPriority")} ${priority}`}</option>)}
                          </select>
                          <input className={inputClass} value={deploymentPipelineRemediationDraft.assigned_to} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, assigned_to: e.target.value })} placeholder={t("page.settings.pipelineRemediationAssignee")} />
                          <input className={inputClass} value={deploymentPipelineRemediationDraft.dev_tool} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, dev_tool: e.target.value })} placeholder={t("page.settings.pipelineRemediationDevTool")} />
                          <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--muted-strong)]">
                            <input type="checkbox" checked={deploymentPipelineRemediationDraft.include_low} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, include_low: e.target.checked })} />
                            {t("page.settings.pipelineRemediationIncludeLow")}
                          </label>
                        </div>
                        <textarea className={`${inputClass} mt-3 min-h-16`} value={deploymentPipelineRemediationDraft.note} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, note: e.target.value })} placeholder={t("page.settings.pipelineRemediationNote")} />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={remediateDeploymentPipeline.isPending || !deploymentPipelineDetail.item?.id} onClick={() => remediateDeploymentPipeline.mutate(true)}><ShieldCheck className="h-4 w-4" />{t("page.settings.pipelineRemediationPreview")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={remediateDeploymentPipeline.isPending || !deploymentPipelineDetail.item?.id} onClick={() => remediateDeploymentPipeline.mutate(false)}><ListChecks className="h-4 w-4" />{t("page.settings.pipelineRemediationCreateTasks")}</button>
                        </div>
                        {remediateDeploymentPipeline.error ? <ErrorLine message={(remediateDeploymentPipeline.error as Error).message} /> : null}
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          {[
                            ["high", deploymentPipelineDetail.result?.summary?.high ?? deploymentPipelineDetail.run?.self_heal?.summary?.high ?? 0],
                            ["medium", deploymentPipelineDetail.result?.summary?.medium ?? deploymentPipelineDetail.run?.self_heal?.summary?.medium ?? 0],
                            ["created", deploymentPipelineDetail.result?.created?.length ?? deploymentPipelineDetail.item?.self_heal_task_count ?? 0],
                          ].map(([key, value]) => (
                            <div key={key} className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t(`page.settings.pipelineRemediationMetric.${key}`)}</p>
                              <p className="mt-1 text-lg font-bold text-[var(--text)]">{value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid gap-3 xl:grid-cols-2">
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineRemediationFindings")}</p>
                            <div className="mt-2 space-y-2">
                              {(deploymentPipelineDetail.result?.findings || deploymentPipelineDetail.run?.self_heal?.findings || []).slice(0, 6).map((finding: any) => (
                                <div key={finding.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="font-semibold text-[var(--text)]">{finding.title || finding.id}</p>
                                    <StatusPill tone={finding.severity === "high" ? "danger" : finding.severity === "medium" ? "warn" : "ok"} label={t(`page.settings.pipelineRemediationSeverity.${finding.severity}`, { defaultValue: finding.severity })} />
                                  </div>
                                  <p className="mt-1 text-[var(--muted)]">{finding.recommendation}</p>
                                </div>
                              ))}
                              {!(deploymentPipelineDetail.result?.findings || deploymentPipelineDetail.run?.self_heal?.findings || []).length ? <p className="text-xs text-[var(--muted)]">{t("page.settings.pipelineRemediationEmpty")}</p> : null}
                            </div>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineRemediationRunbook")}</p>
                            <div className="mt-2 space-y-2">
                              {(deploymentPipelineDetail.result?.runbook?.steps || deploymentPipelineDetail.run?.self_heal?.runbook?.steps || []).slice(0, 6).map((step: any) => (
                                <div key={step.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="truncate font-semibold text-[var(--text)]">{step.title || step.id}</p>
                                    <StatusPill tone={step.status === "completed" ? "ok" : "warn"} label={step.status || "pending"} />
                                  </div>
                                  <p className="mt-1 truncate text-[var(--muted)]">{step.api || step.owner || "-"}</p>
                                </div>
                              ))}
                              {!(deploymentPipelineDetail.result?.runbook?.steps || deploymentPipelineDetail.run?.self_heal?.runbook?.steps || []).length ? <p className="text-xs text-[var(--muted)]">{t("page.settings.pipelineRemediationEmpty")}</p> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                      {applyDeploymentPipelineAction.error ? <ErrorLine message={(applyDeploymentPipelineAction.error as Error).message} /> : null}
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentPipelineDetail.run?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.pipelineEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              {exportBundle.error ? <ErrorLine message={(exportBundle.error as Error).message} /> : null}
              {opsProfiles.data?.config_path ? <p className="break-all text-xs text-[var(--muted)]">{opsProfiles.data.config_path}</p> : null}
              {opsProfiles.isError ? <ErrorLine message={(opsProfiles.error as Error).message} /> : null}
            </div>
          </div>
        </Card>
        <Drawer
          title={t("page.settings.profileEdit")}
          open={profileDrawerOpen}
          onClose={() => setProfileDrawerOpen(false)}
          width={620}
          destroyOnHidden
          extra={
            <Space>
              <Button onClick={() => setProfileDrawerOpen(false)}>{t("common.cancel")}</Button>
              <Button type="primary" loading={saveProfile.isPending} disabled={!profileDraft.name.trim()} onClick={() => saveProfile.mutate()}>
                {t("page.settings.profileSave")}
              </Button>
            </Space>
          }
        >
          <div className="space-y-4">
            <Steps
              size="small"
              current={1}
              items={[
                { title: t("page.settings.profileStepScope", { defaultValue: "范围" }) },
                { title: t("page.settings.profileStepRuntime", { defaultValue: "运行" }) },
                { title: t("page.settings.profileStepEvidence", { defaultValue: "证据" }) },
              ]}
            />
            <Form
              layout="vertical"
              onFinish={() => {
                if (profileDraft.name.trim()) saveProfile.mutate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Form.Item label={t("page.settings.profile")} required>
                  <Input value={profileDraft.name} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} placeholder="local-dev" />
                </Form.Item>
                <Form.Item label={t("page.settings.mode")} required>
                  <Select
                    value={profileDraft.mode}
                    onChange={(value) => setProfileDraft({ ...profileDraft, mode: value })}
                    options={["local", "single", "saas", "private"].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
                <Form.Item label={t("page.settings.database")} required>
                  <Select
                    value={profileDraft.database}
                    onChange={(value) => setProfileDraft({ ...profileDraft, database: value })}
                    options={["sqlite", "postgresql", "mysql", "oceanbase"].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
              </div>
              <Form.Item label="MANAGER_URL">
                <Input value={profileDraft.manager_url} onChange={(e) => setProfileDraft({ ...profileDraft, manager_url: e.target.value })} placeholder="http://localhost:8765" />
              </Form.Item>
              <Form.Item label="MANAGER_PUBLIC_URL">
                <Input value={profileDraft.public_url} onChange={(e) => setProfileDraft({ ...profileDraft, public_url: e.target.value })} placeholder="https://manager.example.com" />
              </Form.Item>
              <Form.Item label={t("page.settings.profileFeatures", { defaultValue: "能力开关" })}>
                <Input value={profileDraft.features} onChange={(e) => setProfileDraft({ ...profileDraft, features: e.target.value })} placeholder="billing=true,sso=true,worker=true" />
              </Form.Item>
              <Form.Item label={t("page.settings.profileEnv", { defaultValue: "环境变量" })}>
                <Input.TextArea
                  rows={7}
                  className="font-mono text-xs"
                  value={profileDraft.env}
                  onChange={(e) => setProfileDraft({ ...profileDraft, env: e.target.value })}
                  placeholder={"ADMIN_MODE=saas\nDB_TYPE=postgresql"}
                />
              </Form.Item>
              <Form.Item label={t("page.settings.profileNotes")}>
                <Input.TextArea rows={3} value={profileDraft.notes} onChange={(e) => setProfileDraft({ ...profileDraft, notes: e.target.value })} placeholder={t("page.settings.profileNotes")} />
              </Form.Item>
              {saveProfile.error ? <ErrorLine message={(saveProfile.error as Error).message} /> : null}
              <Button className="w-full" htmlType="submit" type="primary" loading={saveProfile.isPending} disabled={!profileDraft.name.trim()}>
                {t("page.settings.profileSave")}
              </Button>
            </Form>
          </div>
        </Drawer>
        <Drawer
          title={t("page.settings.pipelineTitle")}
          open={deploymentPipelineDrawerOpen}
          onClose={() => setDeploymentPipelineDrawerOpen(false)}
          width={640}
          destroyOnHidden
          extra={
            <Space>
              <Button onClick={() => setDeploymentPipelineDrawerOpen(false)}>{t("common.cancel")}</Button>
              <Button loading={createDeploymentPipeline.isPending} disabled={!selectedDeploymentPackageId} onClick={() => createDeploymentPipeline.mutate(true)}>
                {t("page.settings.pipelinePreview")}
              </Button>
              <Button type="primary" loading={createDeploymentPipeline.isPending} disabled={!selectedDeploymentPackageId || deploymentPipelineDraft.action === "preview"} onClick={() => createDeploymentPipeline.mutate(false)}>
                {t("page.settings.pipelineCreate")}
              </Button>
            </Space>
          }
        >
          <div className="space-y-4">
            <Steps
              size="small"
              current={deploymentPipelineDraft.action === "preview" || deploymentPipelineDraft.dry_run ? 0 : 1}
              items={[
                { title: t("page.settings.pipelinePreview", { defaultValue: "预览" }) },
                { title: t("page.settings.pipelineCreate", { defaultValue: "创建" }) },
                { title: t("page.settings.pipelineEvidence", { defaultValue: "证据" }) },
              ]}
            />
            <Form layout="vertical">
              <Form.Item label={t("page.settings.deployPackage")} required>
                <Select
                  value={selectedDeploymentPackageId || undefined}
                  placeholder={t("page.settings.pipelinePackagePh")}
                  onChange={(value) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, package_id: value })}
                  options={(deploymentPackages.data?.items || []).map((item: any) => ({ value: item.id, label: `${item.version} / ${item.channel}` }))}
                />
              </Form.Item>
              <div className="grid gap-3 sm:grid-cols-2">
                <Form.Item label={t("page.settings.pipelineEnvironmentLabel", { defaultValue: "环境" })} required>
                  <Select
                    value={deploymentPipelineDraft.environment}
                    onChange={(value) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, environment: value })}
                    options={["dev", "staging", "production", "rollback"].map((value) => ({ value, label: t(`page.settings.pipelineEnvironment.${value}`, { defaultValue: value }) }))}
                  />
                </Form.Item>
                <Form.Item label={t("page.settings.pipelineActionLabel", { defaultValue: "动作" })} required>
                  <Select
                    value={deploymentPipelineDraft.action}
                    onChange={(value) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, action: value, dry_run: value === "preview" ? true : deploymentPipelineDraft.dry_run })}
                    options={["preview", "deploy", "rollback"].map((value) => ({ value, label: t(`page.settings.pipelineAction.${value}`, { defaultValue: value }) }))}
                  />
                </Form.Item>
              </div>
              <Form.Item label={t("page.settings.pipelineOperator")}>
                <Input value={deploymentPipelineDraft.operator} onChange={(e) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, operator: e.target.value })} placeholder={me.data?.username || me.data?.email || "ops-admin"} />
              </Form.Item>
              <div className="grid gap-3 sm:grid-cols-2">
                <Form.Item label={t("page.settings.pipelineDryRun")}>
                  <Switch checked={deploymentPipelineDraft.dry_run} onChange={(checked) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, dry_run: checked, action: checked ? "preview" : deploymentPipelineDraft.action })} />
                </Form.Item>
                <Form.Item label={t("page.settings.pipelineApprovalRequired")}>
                  <Switch checked={deploymentPipelineDraft.approval_required} onChange={(checked) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, approval_required: checked })} />
                </Form.Item>
              </div>
              <Form.Item label={t("page.settings.pipelineNotes")}>
                <Input.TextArea rows={4} value={deploymentPipelineDraft.notes} onChange={(e) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, notes: e.target.value })} placeholder={t("page.settings.pipelineNotes")} />
              </Form.Item>
              {createDeploymentPipeline.error ? <ErrorLine message={(createDeploymentPipeline.error as Error).message} /> : null}
              {deploymentPipelineDetail?.result ? <pre className="max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(deploymentPipelineDetail.result, null, 2)}</pre> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <Button loading={createDeploymentPipeline.isPending} disabled={!selectedDeploymentPackageId} onClick={() => createDeploymentPipeline.mutate(true)}>
                  {t("page.settings.pipelinePreview")}
                </Button>
                <Button type="primary" loading={createDeploymentPipeline.isPending} disabled={!selectedDeploymentPackageId || deploymentPipelineDraft.action === "preview"} onClick={() => createDeploymentPipeline.mutate(false)}>
                  {t("page.settings.pipelineCreate")}
                </Button>
              </div>
            </Form>
          </div>
        </Drawer>
        </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs text-[var(--muted-strong)]">{value}</dd>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "warn" | "danger"; label: string }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
      : tone === "danger"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function ErrorLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">{message}</div>;
}

function HintLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">{message}</div>;
}

function mapToLines(value: any): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value).map(([k, v]) => `${k}=${v}`).join("\n");
}

function profileToDraft(row: any) {
  const env = row.env && typeof row.env === "object"
    ? Object.entries(row.env).map(([k, v]) => `${k}=${v}`).join("\n")
    : "";
  const features = row.features && typeof row.features === "object"
    ? Object.entries(row.features).map(([k, v]) => `${k}=${Boolean(v)}`).join(",")
    : "";
  return {
    name: String(row.name || "local-dev"),
    mode: String(row.mode || "local"),
    database: String(row.database || "sqlite"),
    manager_url: String(row.manager_url || ""),
    public_url: String(row.public_url || ""),
    features,
    env,
    notes: String(row.notes || ""),
  };
}
