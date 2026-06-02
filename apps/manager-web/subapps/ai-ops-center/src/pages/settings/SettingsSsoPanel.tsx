import { KeyRound, ListChecks, MessageSquare, FileText, Rocket, Send, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Button, Drawer, Form, Input, Select, Space, Steps, Switch } from "antd";
import { Card } from "@/components/Card";

type MutationLike = any;
type QueryLike = any;
type SsoRiskEscalationAction = "create_tasks" | "send_im";
type SsoRiskEscalationBooleanKey = "enabled" | "include_low" | "force";
type SsoRiskEscalationDraft = {
  enabled: boolean;
  actions: SsoRiskEscalationAction[];
  channels: string[];
  min_severity: string;
  score_threshold: string;
  priority: string;
  assigned_to: string;
  dev_tool: string;
  include_low: boolean;
  limit: string;
  cooldown_minutes: string;
  title: string;
  owner: string;
  notes: string;
  force: boolean;
};

type SettingsSsoPanelProps = {
  ssoConfig: QueryLike;
  ssoDraft: any;
  setSsoDraft: Dispatch<SetStateAction<any>>;
  ssoTestResult: any;
  saveSso: MutationLike;
  testSso: MutationLike;
  deleteSso: MutationLike;
  ssoPreviewDraft: any;
  setSsoPreviewDraft: Dispatch<SetStateAction<any>>;
  ssoPreviewResult: any;
  previewSsoRole: MutationLike;
  scimTokenResult: any;
  rotateScimToken: MutationLike;
  scimTestDraft: any;
  setScimTestDraft: Dispatch<SetStateAction<any>>;
  scimTestResult: any;
  testScimUser: MutationLike;
  selectedSsoProviderExists: boolean;
  ssoScimAudit: QueryLike;
  ssoRiskReport: QueryLike;
  ssoRiskTaskDraft: any;
  setSsoRiskTaskDraft: Dispatch<SetStateAction<any>>;
  ssoRiskTaskResult: any;
  ssoRiskTaskDrawerOpen: boolean;
  setSsoRiskTaskDrawerOpen: Dispatch<SetStateAction<boolean>>;
  runSsoRiskTasks: MutationLike;
  ssoRiskImDraft: any;
  setSsoRiskImDraft: Dispatch<SetStateAction<any>>;
  ssoRiskImResult: any;
  ssoRiskImDrawerOpen: boolean;
  setSsoRiskImDrawerOpen: Dispatch<SetStateAction<boolean>>;
  runSsoRiskIm: MutationLike;
  notifyChannels: QueryLike;
  ssoRiskSubscription: QueryLike;
  ssoRiskSubscriptionDraft: any;
  setSsoRiskSubscriptionDraft: Dispatch<SetStateAction<any>>;
  ssoRiskSubscriptionResult: any;
  saveSsoRiskSubscription: MutationLike;
  runSsoRiskSubscription: MutationLike;
  ssoRiskEscalation: QueryLike;
  ssoRiskEscalationDraft: SsoRiskEscalationDraft;
  setSsoRiskEscalationDraft: Dispatch<SetStateAction<SsoRiskEscalationDraft>>;
  ssoRiskEscalationResult: any;
  ssoRiskEscalationDrawerOpen: boolean;
  setSsoRiskEscalationDrawerOpen: Dispatch<SetStateAction<boolean>>;
  saveSsoRiskEscalation: MutationLike;
  runSsoRiskEscalation: MutationLike;
  ssoRiskRunbookDraft: any;
  setSsoRiskRunbookDraft: Dispatch<SetStateAction<any>>;
  ssoRiskRunbookDetail: any;
  ssoRiskRunbookDrawerOpen: boolean;
  setSsoRiskRunbookDrawerOpen: Dispatch<SetStateAction<boolean>>;
  createSsoRiskRunbook: MutationLike;
  loadSsoRiskRunbook: MutationLike;
  applySsoRiskRunbookAction: MutationLike;
  ssoRiskRunbooks: QueryLike;
};

const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

const ssoRiskEscalationBooleanControls: Array<{ key: SsoRiskEscalationBooleanKey; label: string }> = [
  { key: "enabled", label: "ssoRiskEscalationEnabled" },
  { key: "include_low", label: "ssoRiskEscalationIncludeLow" },
  { key: "force", label: "ssoRiskEscalationForce" },
];

const ssoRiskEscalationActions: SsoRiskEscalationAction[] = ["create_tasks", "send_im"];

function currentRedirectTarget() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/?shell=1#/dashboard";
}

function mapToLines(value: any): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value).map(([k, v]) => `${k}=${v}`).join("\n");
}

export function SettingsSsoPanel({
  ssoConfig,
  ssoDraft,
  setSsoDraft,
  ssoTestResult,
  saveSso,
  testSso,
  deleteSso,
  ssoPreviewDraft,
  setSsoPreviewDraft,
  ssoPreviewResult,
  previewSsoRole,
  scimTokenResult,
  rotateScimToken,
  scimTestDraft,
  setScimTestDraft,
  scimTestResult,
  testScimUser,
  selectedSsoProviderExists,
  ssoScimAudit,
  ssoRiskReport,
  ssoRiskTaskDraft,
  setSsoRiskTaskDraft,
  ssoRiskTaskResult,
  ssoRiskTaskDrawerOpen,
  setSsoRiskTaskDrawerOpen,
  runSsoRiskTasks,
  ssoRiskImDraft,
  setSsoRiskImDraft,
  ssoRiskImResult,
  ssoRiskImDrawerOpen,
  setSsoRiskImDrawerOpen,
  runSsoRiskIm,
  notifyChannels,
  ssoRiskSubscription,
  ssoRiskSubscriptionDraft,
  setSsoRiskSubscriptionDraft,
  ssoRiskSubscriptionResult,
  saveSsoRiskSubscription,
  runSsoRiskSubscription,
  ssoRiskEscalation,
  ssoRiskEscalationDraft,
  setSsoRiskEscalationDraft,
  ssoRiskEscalationResult,
  ssoRiskEscalationDrawerOpen,
  setSsoRiskEscalationDrawerOpen,
  saveSsoRiskEscalation,
  runSsoRiskEscalation,
  ssoRiskRunbookDraft,
  setSsoRiskRunbookDraft,
  ssoRiskRunbookDetail,
  ssoRiskRunbookDrawerOpen,
  setSsoRiskRunbookDrawerOpen,
  createSsoRiskRunbook,
  loadSsoRiskRunbook,
  applySsoRiskRunbookAction,
  ssoRiskRunbooks,
}: SettingsSsoPanelProps) {
  const { t } = useTranslation();

  return (
        <Card
          title={t("page.settings.ssoCard")}
          actions={<StatusPill tone={ssoConfig.data?.enabled ? "ok" : ssoConfig.isError ? "danger" : "warn"} label={ssoConfig.data?.enabled ? "SSO" : "OFF"} />}
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(26rem,0.9fr)_minmax(0,1.1fr)]">
            <form
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!ssoDraft.provider.trim()) return;
                saveSso.mutate();
              }}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <KeyRound className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoProvider")}</p>
                  <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoDesc")}</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className={inputClass} value={ssoDraft.provider} onChange={(e) => setSsoDraft({ ...ssoDraft, provider: e.target.value })} placeholder="okta" />
                  <select className={inputClass} value={ssoDraft.type} onChange={(e) => setSsoDraft({ ...ssoDraft, type: e.target.value })}>
                    <option value="oidc">OIDC</option>
                    <option value="saml">SAML</option>
                  </select>
                </div>
                <input className={inputClass} value={ssoDraft.issuer} onChange={(e) => setSsoDraft({ ...ssoDraft, issuer: e.target.value })} placeholder={ssoDraft.type === "saml" ? "SAML issuer / entityID" : "https://idp.example.com/oauth2/default"} />
                <input className={inputClass} value={ssoDraft.client_id} onChange={(e) => setSsoDraft({ ...ssoDraft, client_id: e.target.value })} placeholder="client_id" />
                <input className={inputClass} type="password" value={ssoDraft.client_secret} onChange={(e) => setSsoDraft({ ...ssoDraft, client_secret: e.target.value })} placeholder={t("page.settings.ssoSecretPh")} />
                <input className={inputClass} value={ssoDraft.redirect_uri} onChange={(e) => setSsoDraft({ ...ssoDraft, redirect_uri: e.target.value })} placeholder="http://localhost:8000/api/v1/sso/okta/callback" />
                <input className={inputClass} value={ssoDraft.type === "saml" ? ssoDraft.metadata_url : ssoDraft.scope} onChange={(e) => setSsoDraft(ssoDraft.type === "saml" ? { ...ssoDraft, metadata_url: e.target.value } : { ...ssoDraft, scope: e.target.value })} placeholder={ssoDraft.type === "saml" ? "metadata_url" : "openid profile email groups"} />
                {ssoDraft.type === "saml" ? (
                  <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input className={inputClass} value={ssoDraft.sso_url} onChange={(e) => setSsoDraft({ ...ssoDraft, sso_url: e.target.value })} placeholder={t("page.settings.ssoSamlSsoUrlPh")} />
                      <input className={inputClass} value={ssoDraft.name_id_format} onChange={(e) => setSsoDraft({ ...ssoDraft, name_id_format: e.target.value })} placeholder={t("page.settings.ssoSamlNameIdPh")} />
                    </div>
                    <textarea className={`${inputClass} min-h-24 font-mono text-xs`} value={ssoDraft.x509_cert} onChange={(e) => setSsoDraft({ ...ssoDraft, x509_cert: e.target.value })} placeholder={t("page.settings.ssoSamlCertPh")} />
                    <div className="grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2">
                      <a className="break-all rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[var(--brand)]" href={`/api/v1/sso/${encodeURIComponent(ssoDraft.provider || "saml")}/saml/metadata`} target="_blank" rel="noreferrer">
                        {t("page.settings.ssoSamlMetadata")}
                      </a>
                      <a className="break-all rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[var(--brand)]" href={`/api/v1/sso/${encodeURIComponent(ssoDraft.provider || "saml")}/saml/login?redirect=${encodeURIComponent(currentRedirectTarget())}`} target="_blank" rel="noreferrer">
                        {t("page.settings.ssoSamlLogin")}
                      </a>
                    </div>
                  </div>
                ) : null}
                <label className="block text-xs font-medium text-[var(--muted)]">
                  {t("page.settings.ssoTenantMap")}
                  <textarea className={`${inputClass} mt-1 min-h-20 font-mono text-xs`} value={ssoDraft.tenant_domain_map} onChange={(e) => setSsoDraft({ ...ssoDraft, tenant_domain_map: e.target.value })} placeholder={t("page.settings.ssoTenantMapPh")} />
                </label>
                <label className="block text-xs font-medium text-[var(--muted)]">
                  {t("page.settings.ssoRoleMap")}
                  <textarea className={`${inputClass} mt-1 min-h-24 font-mono text-xs`} value={ssoDraft.role_map} onChange={(e) => setSsoDraft({ ...ssoDraft, role_map: e.target.value })} placeholder={t("page.settings.ssoRoleMapPh")} />
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                  <input type="checkbox" checked={ssoDraft.enabled} onChange={(e) => setSsoDraft({ ...ssoDraft, enabled: e.target.checked })} />
                  {t("page.settings.ssoEnabled")}
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                  <input type="checkbox" checked={ssoDraft.scim_enabled} onChange={(e) => setSsoDraft({ ...ssoDraft, scim_enabled: e.target.checked })} />
                  {t("page.settings.ssoScimEnabled")}
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="submit" className="rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={saveSso.isPending || !ssoDraft.provider.trim()}>
                    {t("page.settings.ssoSave")}
                  </button>
                  <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={testSso.isPending || !ssoDraft.provider.trim()} onClick={() => testSso.mutate(ssoDraft.provider)}>
                    {t("page.settings.ssoTest")}
                  </button>
                </div>
                {saveSso.error ? <ErrorLine message={(saveSso.error as Error).message} /> : null}
                {testSso.error ? <ErrorLine message={(testSso.error as Error).message} /> : null}
                {ssoTestResult ? <pre className="max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(ssoTestResult, null, 2)}</pre> : null}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoScimTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoScimDesc")}</p>
                    </div>
                    <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50" disabled={rotateScimToken.isPending || !ssoDraft.provider.trim()} onClick={() => rotateScimToken.mutate()}>
                      {t("page.settings.ssoScimRotate")}
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-[var(--muted)]">
                    <span className="break-all rounded-lg bg-[var(--surface-muted)] px-3 py-2">{`${window.location.origin}/api/v1/sso/scim/v2/${encodeURIComponent(ssoDraft.provider || "provider")}/Users`}</span>
                    <span className="break-all rounded-lg bg-[var(--surface-muted)] px-3 py-2">{`${window.location.origin}/api/v1/sso/scim/v2/${encodeURIComponent(ssoDraft.provider || "provider")}/Groups/{role}`}</span>
                    <span className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">{t("page.settings.ssoScimGroupHint")}</span>
                    {scimTokenResult?.token ? <pre className="max-h-28 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{scimTokenResult.token}</pre> : null}
                  </div>
                  {rotateScimToken.error ? <ErrorLine message={(rotateScimToken.error as Error).message} /> : null}
                </div>
              </div>
            </form>
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {(ssoConfig.data?.templates || []).map((tpl: any) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
                    onClick={() => setSsoDraft({
                      ...ssoDraft,
                      provider: tpl.id,
                      type: tpl.type,
                      issuer: tpl.issuer_hint || "",
                      redirect_uri: tpl.redirect_hint || "",
                      metadata_url: tpl.metadata_hint || "",
                      sso_url: tpl.sso_url_hint || "",
                      name_id_format: tpl.name_id_format || ssoDraft.name_id_format,
                      scope: tpl.scope || ssoDraft.scope,
                    })}
                  >
                    <span className="text-sm font-semibold text-[var(--text)]">{tpl.name}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--muted)]">{tpl.issuer_hint}</span>
                  </button>
                ))}
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoPreview")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoPreviewDesc")}</p>
                    </div>
                    <StatusPill tone={ssoPreviewResult?.ok ? "ok" : "warn"} label={ssoPreviewResult?.role || "JIT"} />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <input className={inputClass} value={ssoPreviewDraft.email} onChange={(e) => setSsoPreviewDraft({ ...ssoPreviewDraft, email: e.target.value })} placeholder={t("page.settings.ssoPreviewEmail")} />
                    <input className={inputClass} value={ssoPreviewDraft.groups} onChange={(e) => setSsoPreviewDraft({ ...ssoPreviewDraft, groups: e.target.value })} placeholder={t("page.settings.ssoPreviewGroups")} />
                  </div>
                  <button
                    type="button"
                    className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                    disabled={previewSsoRole.isPending || !ssoDraft.provider.trim()}
                    onClick={() => previewSsoRole.mutate()}
                  >
                    {t("page.settings.ssoPreviewRun")}
                  </button>
                  {previewSsoRole.error ? <ErrorLine message={(previewSsoRole.error as Error).message} /> : null}
                  {ssoPreviewResult ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Info label={t("auth.tenant")} value={String(ssoPreviewResult.tenant || "-")} />
                      <Info label={t("auth.role")} value={String(ssoPreviewResult.role || "-")} />
                      <Info label={t("page.settings.ssoGroups")} value={(ssoPreviewResult.groups || []).join(",") || "-"} />
                    </div>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRoles")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(ssoConfig.data?.roles || []).map((role: string) => (
                      <span key={role} className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 font-mono text-[11px] text-[var(--muted-strong)]">{role}</span>
                    ))}
                  </div>
                  <div className="mt-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--muted-strong)]">
                    <span className="font-semibold text-[var(--text)]">{t("page.settings.ssoSamlDependency")}: </span>
                    {ssoConfig.data?.saml_dependency?.installed ? `${ssoConfig.data.saml_dependency.package} ${ssoConfig.data.saml_dependency.version || ""}` : ssoConfig.data?.saml_dependency?.install_hint || "python3-saml"}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t("page.settings.ssoJitDesc")}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoScimTest")}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoScimTestDesc")}</p>
                  </div>
                  <StatusPill tone={scimTestResult?.ok ? "ok" : "warn"} label={scimTestDraft.apply ? "APPLY" : "DRY"} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input className={inputClass} value={scimTestDraft.userName} onChange={(e) => setScimTestDraft({ ...scimTestDraft, userName: e.target.value })} placeholder={t("page.settings.ssoScimUserName")} />
                  <input className={inputClass} value={scimTestDraft.displayName} onChange={(e) => setScimTestDraft({ ...scimTestDraft, displayName: e.target.value })} placeholder={t("page.settings.ssoScimDisplayName")} />
                  <input className={inputClass} value={scimTestDraft.groups} onChange={(e) => setScimTestDraft({ ...scimTestDraft, groups: e.target.value })} placeholder={t("page.settings.ssoPreviewGroups")} />
                  <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-strong)]">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={scimTestDraft.active} onChange={(e) => setScimTestDraft({ ...scimTestDraft, active: e.target.checked })} />{t("page.settings.ssoScimActive")}</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={scimTestDraft.apply} onChange={(e) => setScimTestDraft({ ...scimTestDraft, apply: e.target.checked })} />{t("page.settings.ssoScimApply")}</label>
                  </div>
                </div>
                <button type="button" className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={testScimUser.isPending || !ssoDraft.provider.trim()} onClick={() => testScimUser.mutate()}>
                  {t("page.settings.ssoScimRun")}
                </button>
                {testScimUser.error ? <ErrorLine message={(testScimUser.error as Error).message} /> : null}
                {scimTestResult ? <pre className="mt-3 max-h-52 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(scimTestResult, null, 2)}</pre> : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskTitle")}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoRiskDesc")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill
                      tone={ssoRiskReport.data?.status === "risk" ? "danger" : ssoRiskReport.data?.status === "watch" ? "warn" : "ok"}
                      label={String(ssoRiskReport.data?.score ?? "-")}
                    />
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50"
                      disabled={!selectedSsoProviderExists || ssoRiskReport.isFetching}
                      onClick={() => void ssoRiskReport.refetch()}
                    >
                      {t("page.settings.ssoRiskRefresh")}
                    </button>
                  </div>
                </div>
                {!selectedSsoProviderExists ? (
                  <HintLine message={t("page.settings.ssoRiskNoProvider")} />
                ) : ssoRiskReport.error ? (
                  <ErrorLine message={(ssoRiskReport.error as Error).message} />
                ) : (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Info label={t("page.settings.ssoRiskScore")} value={String(ssoRiskReport.data?.score ?? "-")} />
                      <Info label={t("page.settings.ssoRiskStatus")} value={String(ssoRiskReport.data?.status || "-")} />
                      <Info label={t("page.settings.ssoRiskFindings")} value={String(ssoRiskReport.data?.summary?.findings || 0)} />
                      <Info label={t("page.settings.ssoRiskHigh")} value={String(ssoRiskReport.data?.summary?.high || 0)} />
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                        <div className="grid min-w-[42rem] grid-cols-[7rem_1fr_1fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                          <span>{t("page.settings.ssoRiskSeverity")}</span>
                          <span>{t("page.settings.ssoRiskFinding")}</span>
                          <span>{t("page.settings.ssoRiskRecommendation")}</span>
                        </div>
                        {(ssoRiskReport.data?.findings || []).length ? (ssoRiskReport.data.findings || []).map((finding: any) => (
                          <div key={finding.id} className="grid min-w-[42rem] grid-cols-[7rem_1fr_1fr] gap-3 border-b border-[var(--border)] px-3 py-2 text-xs last:border-0">
                            <span className="font-mono text-[var(--muted-strong)]">{finding.severity}</span>
                            <span className="text-[var(--text)]">{String(t(`page.settings.ssoRiskKind.${finding.kind}`, { ...(finding.params || {}), defaultValue: finding.kind }))}</span>
                            <span className="text-[var(--muted-strong)]">{String(t(`page.settings.ssoRiskAction.${finding.recommendation_key || finding.kind}`, { ...(finding.params || {}), defaultValue: finding.recommendation_key || finding.kind }))}</span>
                          </div>
                        )) : (
                          <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">{t("page.settings.ssoRiskEmpty")}</div>
                        )}
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskActionPlan")}</p>
                        <div className="mt-3 space-y-2">
                          {(ssoRiskReport.data?.action_plan || []).length ? (ssoRiskReport.data.action_plan || []).map((action: any) => (
                            <div key={`${action.order}-${action.kind}`} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[var(--muted)]">#{action.order}</span>
                                <span className="font-mono text-[var(--muted-strong)]">{action.severity}</span>
                              </div>
                              <p className="mt-1 text-[var(--text)]">{String(t(`page.settings.ssoRiskAction.${action.action_key}`, { defaultValue: action.action_key }))}</p>
                            </div>
                          )) : (
                            <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoRiskNoActions")}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskTaskTitle")}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoRiskTaskDesc")}</p>
                        </div>
                        <StatusPill
                          tone={(ssoRiskTaskResult?.summary?.created || 0) > 0 ? "ok" : (ssoRiskTaskResult?.summary?.planned || 0) > 0 ? "warn" : "ok"}
                          label={ssoRiskTaskResult ? `${ssoRiskTaskResult.summary?.planned || 0}/${ssoRiskTaskResult.summary?.created || 0}` : "TASK"}
                        />
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-4">
                        <Info label={t("page.settings.ssoRiskTaskLimit")} value={ssoRiskTaskDraft.limit} />
                        <Info label={t("page.settings.ssoRiskTaskPriority", { defaultValue: "优先级" })} value={ssoRiskTaskDraft.priority} />
                        <Info label={t("page.settings.ssoRiskTaskAssignee")} value={ssoRiskTaskDraft.assigned_to || "-"} />
                        <Info label={t("page.settings.ssoRiskTaskDevTool")} value={ssoRiskTaskDraft.dev_tool || "-"} />
                      </div>
                      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                        <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskTaskQuickSummary", { defaultValue: "任务化草稿" })}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{ssoRiskTaskDraft.include_low ? t("page.settings.ssoRiskTaskIncludeLow") : t("page.settings.ssoRiskTaskSkipLow", { defaultValue: "默认只处理中高风险项" })}</p>
                      </div>
                      <Button className="mt-3" block type="primary" icon={<ListChecks className="h-4 w-4" />} disabled={!selectedSsoProviderExists} onClick={() => setSsoRiskTaskDrawerOpen(true)}>
                        {t("page.settings.ssoRiskTaskOpenDrawer", { defaultValue: "配置风险任务" })}
                      </Button>
                      {runSsoRiskTasks.error ? <ErrorLine message={(runSsoRiskTasks.error as Error).message} /> : null}
                      {ssoRiskTaskResult ? (
                        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Info label={t("page.settings.ssoRiskTaskPlanned")} value={String(ssoRiskTaskResult.summary?.planned || 0)} />
                            <Info label={t("page.settings.ssoRiskTaskCreated")} value={String(ssoRiskTaskResult.summary?.created || 0)} />
                            <Info label={t("page.settings.ssoRiskTaskSkipped")} value={String(ssoRiskTaskResult.summary?.skipped_low || 0)} />
                          </div>
                          <div className="mt-3 space-y-2">
                            {(ssoRiskTaskResult.items || []).length ? (ssoRiskTaskResult.items || []).map((item: any, index: number) => {
                              const created = (ssoRiskTaskResult.created || [])[index];
                              return (
                                <div key={`${item.source_report_id || index}-${created?.id || "preview"}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-semibold text-[var(--text)]">{item.title}</p>
                                    <span className="font-mono text-[var(--muted-strong)]">{created?.id || item.priority}</span>
                                  </div>
                                  <p className="mt-1 text-[var(--muted)]">{item.source_report_title} · {item.assigned_to} · {item.dev_tool}</p>
                                </div>
                              );
                            }) : (
                              <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoRiskTaskEmpty")}</p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <Drawer
                      title={t("page.settings.ssoRiskTaskTitle")}
                      open={ssoRiskTaskDrawerOpen}
                      onClose={() => setSsoRiskTaskDrawerOpen(false)}
                      width={620}
                      destroyOnHidden
                      extra={
                        <Space>
                          <Button onClick={() => setSsoRiskTaskDrawerOpen(false)}>{t("common.cancel")}</Button>
                          <Button loading={runSsoRiskTasks.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskTasks.mutate(true)}>
                            {t("page.settings.ssoRiskTaskPreview")}
                          </Button>
                          <Button type="primary" loading={runSsoRiskTasks.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskTasks.mutate(false)}>
                            {t("page.settings.ssoRiskTaskCreate")}
                          </Button>
                        </Space>
                      }
                    >
                      <div className="space-y-4">
                        <Steps
                          size="small"
                          current={ssoRiskTaskResult?.summary?.created ? 2 : ssoRiskTaskResult?.summary?.planned ? 1 : 0}
                          items={[
                            { title: t("page.settings.ssoRiskTaskPreview", { defaultValue: "预览" }) },
                            { title: t("page.settings.ssoRiskTaskCreate", { defaultValue: "生成" }) },
                            { title: t("page.settings.pipelineEvidence", { defaultValue: "证据" }) },
                          ]}
                        />
                        <Form layout="vertical">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item label={t("page.settings.ssoRiskTaskIncludeLow")}>
                              <Switch checked={ssoRiskTaskDraft.include_low} onChange={(checked) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, include_low: checked })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskTaskLimit")} required>
                              <Input type="number" min={1} max={20} value={ssoRiskTaskDraft.limit} onChange={(e) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, limit: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskTaskPriority", { defaultValue: "优先级" })} required>
                              <Select value={ssoRiskTaskDraft.priority} onChange={(value) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, priority: value })} options={["P0", "P1", "P2", "P3"].map((value) => ({ value, label: value }))} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskTaskAssignee")} required>
                              <Input value={ssoRiskTaskDraft.assigned_to} onChange={(e) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, assigned_to: e.target.value })} />
                            </Form.Item>
                          </div>
                          <Form.Item label={t("page.settings.ssoRiskTaskDevTool")}>
                            <Input value={ssoRiskTaskDraft.dev_tool} onChange={(e) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, dev_tool: e.target.value })} />
                          </Form.Item>
                          {runSsoRiskTasks.error ? <ErrorLine message={(runSsoRiskTasks.error as Error).message} /> : null}
                          {ssoRiskTaskResult ? (
                            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="grid gap-3 sm:grid-cols-3">
                                <Info label={t("page.settings.ssoRiskTaskPlanned")} value={String(ssoRiskTaskResult.summary?.planned || 0)} />
                                <Info label={t("page.settings.ssoRiskTaskCreated")} value={String(ssoRiskTaskResult.summary?.created || 0)} />
                                <Info label={t("page.settings.ssoRiskTaskSkipped")} value={String(ssoRiskTaskResult.summary?.skipped_low || 0)} />
                              </div>
                            </div>
                          ) : null}
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Button loading={runSsoRiskTasks.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskTasks.mutate(true)}>
                              {t("page.settings.ssoRiskTaskPreview")}
                            </Button>
                            <Button type="primary" loading={runSsoRiskTasks.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskTasks.mutate(false)}>
                              {t("page.settings.ssoRiskTaskCreate")}
                            </Button>
                          </div>
                        </Form>
                      </div>
                    </Drawer>
                    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                            <MessageSquare className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskImTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoRiskImDesc")}</p>
                          </div>
                        </div>
                        <StatusPill
                          tone={(ssoRiskImResult?.delivery_plan?.target_count || 0) > 0 ? "ok" : "warn"}
                          label={ssoRiskImResult ? String(ssoRiskImResult.delivery_plan?.target_count || 0) : "IM"}
                        />
                      </div>
                      <div className="ssoRiskImQuickSummary mt-3 grid gap-3 sm:grid-cols-4">
                        <Info label={t("page.settings.ssoRiskImTitle")} value={ssoRiskImDraft.title || t("page.settings.ssoRiskImTitlePh")} />
                        <Info label={t("page.settings.ssoRiskImTargets")} value={String(ssoRiskImDraft.channels.length || (notifyChannels.data || []).length || 0)} />
                        <Info label={t("page.settings.ssoRiskTaskLimit")} value={ssoRiskImDraft.limit} />
                        <Info label={t("page.settings.ssoRiskTaskIncludeLow")} value={ssoRiskImDraft.include_low ? "ON" : "OFF"} />
                      </div>
                      {notifyChannels.error ? <ErrorLine message={(notifyChannels.error as Error).message} /> : null}
                      {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.ssoRiskImNoChannels")} /> : null}
                      <Button className="mt-3" block type="primary" icon={<MessageSquare className="h-4 w-4" />} disabled={!selectedSsoProviderExists} onClick={() => setSsoRiskImDrawerOpen(true)}>
                        {t("page.settings.ssoRiskImOpenDrawer", { defaultValue: "配置 IM 风险通知" })}
                      </Button>
                      <Drawer
                        title={t("page.settings.ssoRiskImTitle")}
                        open={ssoRiskImDrawerOpen}
                        onClose={() => setSsoRiskImDrawerOpen(false)}
                        width={560}
                        destroyOnClose={false}
                        extra={
                          <Space>
                            <Button onClick={() => setSsoRiskImDrawerOpen(false)}>{t("common.cancel")}</Button>
                            <Button type="primary" loading={runSsoRiskIm.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskIm.mutate(false)}>{t("page.settings.ssoRiskImSend")}</Button>
                          </Space>
                        }
                      >
                        <div className="space-y-4">
                          <Steps
                            size="small"
                            current={ssoRiskImResult?.audit?.sent_count || ssoRiskImResult?.sent?.length ? 2 : ssoRiskImResult?.delivery_plan?.target_count ? 1 : 0}
                            items={[
                              { title: t("page.settings.ssoRiskImTitle", { defaultValue: "简报" }) },
                              { title: t("page.settings.ssoRiskImPreview", { defaultValue: "预览" }) },
                              { title: t("page.settings.ssoRiskImSend", { defaultValue: "发送" }) },
                            ]}
                          />
                          <Form layout="vertical">
                            <Form.Item label={t("page.settings.ssoRiskImTitle")} required>
                              <Input value={ssoRiskImDraft.title} onChange={(e) => setSsoRiskImDraft({ ...ssoRiskImDraft, title: e.target.value })} placeholder={t("page.settings.ssoRiskImTitlePh")} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskImTargets")}>
                              <Select
                                mode="multiple"
                                allowClear
                                value={ssoRiskImDraft.channels}
                                onChange={(channels) => setSsoRiskImDraft({ ...ssoRiskImDraft, channels })}
                                placeholder={t("page.settings.selectNotifyChannel")}
                                options={(notifyChannels.data || []).map((channel: any) => ({
                                  value: channel.name,
                                  label: `${channel.name} · ${channel.type}`,
                                }))}
                              />
                            </Form.Item>
                            {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.ssoRiskImNoChannels")} /> : null}
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Form.Item label={t("page.settings.ssoRiskTaskIncludeLow")}>
                                <Switch checked={ssoRiskImDraft.include_low} onChange={(checked) => setSsoRiskImDraft({ ...ssoRiskImDraft, include_low: checked })} />
                              </Form.Item>
                              <Form.Item label={t("page.settings.ssoRiskTaskLimit")} required>
                                <Input type="number" min={1} max={20} value={ssoRiskImDraft.limit} onChange={(e) => setSsoRiskImDraft({ ...ssoRiskImDraft, limit: e.target.value })} />
                              </Form.Item>
                            </div>
                            {runSsoRiskIm.error ? <ErrorLine message={(runSsoRiskIm.error as Error).message} /> : null}
                            {ssoRiskImResult ? (
                              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                                <div className="grid gap-3 sm:grid-cols-3">
                                  <Info label={t("page.settings.ssoRiskImTargets")} value={String(ssoRiskImResult.delivery_plan?.target_count || 0)} />
                                  <Info label={t("page.settings.ssoRiskImMode")} value={String(ssoRiskImResult.delivery_plan?.selection_mode || "-")} />
                                  <Info label={t("page.settings.ssoRiskImSent")} value={String(ssoRiskImResult.audit?.sent_count || ssoRiskImResult.sent?.length || 0)} />
                                </div>
                              </div>
                            ) : null}
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Button loading={runSsoRiskIm.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskIm.mutate(true)}>
                                {t("page.settings.ssoRiskImPreview")}
                              </Button>
                              <Button type="primary" loading={runSsoRiskIm.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskIm.mutate(false)}>
                                {t("page.settings.ssoRiskImSend")}
                              </Button>
                            </div>
                          </Form>
                        </div>
                      </Drawer>
                      {runSsoRiskIm.error ? <ErrorLine message={(runSsoRiskIm.error as Error).message} /> : null}
                      {ssoRiskImResult ? (
                        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                          <pre className="max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{ssoRiskImResult.briefing?.content || ""}</pre>
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                            <div className="grid gap-2">
                              <Info label={t("page.settings.ssoRiskImTargets")} value={String(ssoRiskImResult.delivery_plan?.target_count || 0)} />
                              <Info label={t("page.settings.ssoRiskImMode")} value={String(ssoRiskImResult.delivery_plan?.selection_mode || "-")} />
                              <Info label={t("page.settings.ssoRiskImSent")} value={String(ssoRiskImResult.audit?.sent_count || ssoRiskImResult.sent?.length || 0)} />
                            </div>
                            {(ssoRiskImResult.delivery_plan?.missing_channels || []).length ? (
                              <p className="mt-2 text-xs text-amber-600">{t("page.settings.ssoRiskImMissing")}: {(ssoRiskImResult.delivery_plan.missing_channels || []).join(", ")}</p>
                            ) : null}
                            {(ssoRiskImResult.delivery_plan?.blocked_channels || []).length ? (
                              <p className="mt-2 text-xs text-rose-600">{t("page.settings.ssoRiskImBlocked")}: {(ssoRiskImResult.delivery_plan.blocked_channels || []).map((item: any) => item.name).join(", ")}</p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                            <ShieldCheck className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskSubscriptionTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoRiskSubscriptionDesc")}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill
                            tone={ssoRiskSubscription.data?.subscription?.enabled ? "ok" : "warn"}
                            label={String(t(`page.settings.ssoRiskSubscriptionFrequencyValue.${ssoRiskSubscription.data?.subscription?.frequency || ssoRiskSubscriptionDraft.frequency}`, { defaultValue: ssoRiskSubscriptionDraft.frequency }))}
                          />
                          <StatusPill
                            tone={ssoRiskSubscriptionResult?.triggered ? "ok" : "warn"}
                            label={ssoRiskSubscriptionResult ? String(t(`page.settings.ssoRiskSubscriptionReasonValue.${ssoRiskSubscriptionResult.reason || "no_matching_risk"}`, { defaultValue: ssoRiskSubscriptionResult.reason || "-" })) : "SUB"}
                          />
                        </div>
                      </div>
                      {!selectedSsoProviderExists ? (
                        <HintLine message={t("page.settings.ssoScimAuditNoProvider")} />
                      ) : (
                        <>
                          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                            <div className="space-y-3">
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                                  <input
                                    type="checkbox"
                                    checked={ssoRiskSubscriptionDraft.enabled}
                                    onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, enabled: e.target.checked })}
                                  />
                                  {t("page.settings.ssoRiskSubscriptionEnabled")}
                                </label>
                                <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                                  <input
                                    type="checkbox"
                                    checked={ssoRiskSubscriptionDraft.include_low}
                                    onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, include_low: e.target.checked })}
                                  />
                                  {t("page.settings.ssoRiskSubscriptionIncludeLow")}
                                </label>
                                <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                                  <input
                                    type="checkbox"
                                    checked={ssoRiskSubscriptionDraft.force}
                                    onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, force: e.target.checked })}
                                  />
                                  {t("page.settings.ssoRiskSubscriptionForce")}
                                </label>
                              </div>
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <select
                                  className={inputClass}
                                  value={ssoRiskSubscriptionDraft.frequency}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, frequency: e.target.value })}
                                  aria-label={String(t("page.settings.ssoRiskSubscriptionFrequency"))}
                                >
                                  {["hourly", "daily", "weekly", "manual"].map((frequency) => (
                                    <option key={frequency} value={frequency}>
                                      {String(t(`page.settings.ssoRiskSubscriptionFrequencyValue.${frequency}`, { defaultValue: frequency }))}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  className={inputClass}
                                  value={ssoRiskSubscriptionDraft.min_severity}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, min_severity: e.target.value })}
                                  aria-label={String(t("page.settings.ssoRiskSubscriptionMinSeverity"))}
                                >
                                  {["high", "medium", "low"].map((severity) => (
                                    <option key={severity} value={severity}>
                                      {String(t(`page.settings.ssoRiskSubscriptionSeverity.${severity}`, { defaultValue: severity }))}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  className={inputClass}
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={ssoRiskSubscriptionDraft.score_threshold}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, score_threshold: e.target.value })}
                                  placeholder={t("page.settings.ssoRiskSubscriptionScoreThreshold")}
                                />
                                <input
                                  className={inputClass}
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={ssoRiskSubscriptionDraft.limit}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, limit: e.target.value })}
                                  placeholder={t("page.settings.ssoRiskSubscriptionLimit")}
                                />
                              </div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <input
                                  className={inputClass}
                                  value={ssoRiskSubscriptionDraft.owner}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, owner: e.target.value })}
                                  placeholder={t("page.settings.ssoRiskSubscriptionOwner")}
                                />
                                <input
                                  className={inputClass}
                                  value={ssoRiskSubscriptionDraft.title}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, title: e.target.value })}
                                  placeholder={t("page.settings.ssoRiskSubscriptionTitlePh")}
                                />
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskSubscriptionChannels")}</p>
                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                  {(notifyChannels.data || []).map((channel: any) => {
                                    const checked = ssoRiskSubscriptionDraft.channels.includes(channel.name);
                                    return (
                                      <label key={channel.name} className="flex min-h-16 items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted-strong)]">
                                        <input
                                          className="mt-1"
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => setSsoRiskSubscriptionDraft({
                                            ...ssoRiskSubscriptionDraft,
                                            channels: e.target.checked
                                              ? Array.from(new Set([...ssoRiskSubscriptionDraft.channels, channel.name]))
                                              : ssoRiskSubscriptionDraft.channels.filter((name: string) => name !== channel.name),
                                          })}
                                        />
                                        <span className="min-w-0">
                                          <span className="flex items-center gap-2">
                                            <span className="truncate font-semibold text-[var(--text)]">{channel.name}</span>
                                            <span className="font-mono text-[10px]">{channel.type}</span>
                                          </span>
                                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{(channel.events || []).join(", ") || "-"}</span>
                                        </span>
                                      </label>
                                    );
                                  })}
                                  {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.ssoRiskSubscriptionNoChannels")} /> : null}
                                </div>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <div className="grid gap-2">
                                <Info label={t("page.settings.ssoRiskSubscriptionLastSent")} value={String(ssoRiskSubscription.data?.subscription?.last_sent_at || "-")} />
                                <Info label={t("page.settings.ssoRiskSubscriptionTriggered")} value={ssoRiskSubscriptionResult ? String(Boolean(ssoRiskSubscriptionResult.triggered)) : "-"} />
                                <Info label={t("page.settings.ssoRiskSubscriptionReason")} value={ssoRiskSubscriptionResult ? String(t(`page.settings.ssoRiskSubscriptionReasonValue.${ssoRiskSubscriptionResult.reason || "no_matching_risk"}`, { defaultValue: ssoRiskSubscriptionResult.reason || "-" })) : "-"} />
                              </div>
                              <div className="grid gap-2">
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                                  disabled={!selectedSsoProviderExists || saveSsoRiskSubscription.isPending}
                                  onClick={() => saveSsoRiskSubscription.mutate()}
                                >
                                  <ShieldCheck className="h-4 w-4" />
                                  {t("page.settings.ssoRiskSubscriptionSave")}
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                                  disabled={!selectedSsoProviderExists || runSsoRiskSubscription.isPending}
                                  onClick={() => runSsoRiskSubscription.mutate(true)}
                                >
                                  <ListChecks className="h-4 w-4" />
                                  {t("page.settings.ssoRiskSubscriptionPreview")}
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                                  disabled={!selectedSsoProviderExists || runSsoRiskSubscription.isPending}
                                  onClick={() => runSsoRiskSubscription.mutate(false)}
                                >
                                  <Send className="h-4 w-4" />
                                  {t("page.settings.ssoRiskSubscriptionSend")}
                                </button>
                              </div>
                            </div>
                          </div>
                          {ssoRiskSubscription.error ? <ErrorLine message={(ssoRiskSubscription.error as Error).message} /> : null}
                          {saveSsoRiskSubscription.error ? <ErrorLine message={(saveSsoRiskSubscription.error as Error).message} /> : null}
                          {runSsoRiskSubscription.error ? <ErrorLine message={(runSsoRiskSubscription.error as Error).message} /> : null}
                          {ssoRiskSubscriptionResult ? (
                            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                              <pre className="max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{ssoRiskSubscriptionResult.briefing?.content || JSON.stringify(ssoRiskSubscriptionResult.subscription || {}, null, 2)}</pre>
                              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                <div className="grid gap-2">
                                  <Info label={t("page.settings.ssoRiskImTargets")} value={String(ssoRiskSubscriptionResult.delivery_plan?.target_count || 0)} />
                                  <Info label={t("page.settings.ssoRiskImMode")} value={String(ssoRiskSubscriptionResult.delivery_plan?.selection_mode || "-")} />
                                  <Info label={t("page.settings.ssoRiskImSent")} value={String(ssoRiskSubscriptionResult.audit?.sent_count || ssoRiskSubscriptionResult.sent?.length || 0)} />
                                </div>
                                {(ssoRiskSubscriptionResult.delivery_plan?.missing_channels || []).length ? (
                                  <p className="mt-2 text-xs text-amber-600">{t("page.settings.ssoRiskImMissing")}: {(ssoRiskSubscriptionResult.delivery_plan.missing_channels || []).join(", ")}</p>
                                ) : null}
                                {(ssoRiskSubscriptionResult.delivery_plan?.blocked_channels || []).length ? (
                                  <p className="mt-2 text-xs text-rose-600">{t("page.settings.ssoRiskImBlocked")}: {(ssoRiskSubscriptionResult.delivery_plan.blocked_channels || []).map((item: any) => item.name).join(", ")}</p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskSubscriptionHistory")}</p>
                            <div className="mt-2 space-y-2">
                              {(ssoRiskSubscription.data?.history?.items || []).length ? (ssoRiskSubscription.data.history.items || []).map((item: any) => (
                                <div key={item.id || item.created_at} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold text-[var(--text)]">{item.actor || item.owner || "-"}</span>
                                    <span className="font-mono text-[var(--muted-strong)]">{item.created_at || "-"}</span>
                                  </div>
                                  <p className="mt-1 text-[var(--muted)]">
                                    {String(t(`page.settings.ssoRiskSubscriptionReasonValue.${item.reason || "no_matching_risk"}`, { defaultValue: item.reason || "-" }))} · {item.sent_count || 0}/{item.target_count || 0}
                                  </p>
                                </div>
                              )) : (
                                <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoRiskSubscriptionHistoryEmpty")}</p>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Rocket className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskEscalationTitle")}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.ssoRiskEscalationDesc")}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={ssoRiskEscalation.data?.policy?.enabled ? "ok" : "warn"} label={ssoRiskEscalation.data?.policy?.enabled ? String(t("page.settings.ssoRiskEscalationEnabled")) : String(t("page.settings.ssoRiskEscalationDisabled"))} />
                    <StatusPill tone={ssoRiskEscalationResult?.triggered ? "ok" : "warn"} label={ssoRiskEscalationResult ? String(t(`page.settings.ssoRiskEscalationReasonValue.${ssoRiskEscalationResult.reason || "no_matching_risk"}`, { defaultValue: ssoRiskEscalationResult.reason || "-" })) : "AUTO"} />
                  </div>
                </div>
                {!selectedSsoProviderExists ? (
                  <HintLine message={t("page.settings.ssoRiskNoProvider")} />
                ) : (
                  <>
                    <div className="ssoRiskEscalationQuickSummary mt-4 grid gap-3 sm:grid-cols-4">
                      <Info label={t("page.settings.ssoRiskEscalationActions")} value={ssoRiskEscalationDraft.actions.map((action) => String(t(`page.settings.ssoRiskEscalationAction.${action}`, { defaultValue: action }))).join(", ")} />
                      <Info label={t("page.settings.ssoRiskEscalationScoreThreshold")} value={ssoRiskEscalationDraft.score_threshold} />
                      <Info label={t("page.settings.ssoRiskEscalationCooldown")} value={ssoRiskEscalationDraft.cooldown_minutes} />
                      <Info label={t("page.settings.ssoRiskEscalationChannels")} value={String(ssoRiskEscalationDraft.channels.length || (notifyChannels.data || []).length || 0)} />
                    </div>
                    <Button className="mt-3" block type="primary" icon={<Rocket className="h-4 w-4" />} disabled={!selectedSsoProviderExists} onClick={() => setSsoRiskEscalationDrawerOpen(true)}>
                      {t("page.settings.ssoRiskEscalationOpenDrawer", { defaultValue: "配置自动升级策略" })}
                    </Button>
                    <Drawer
                      title={t("page.settings.ssoRiskEscalationTitle")}
                      open={ssoRiskEscalationDrawerOpen}
                      onClose={() => setSsoRiskEscalationDrawerOpen(false)}
                      width={620}
                      destroyOnClose={false}
                      extra={
                        <Space>
                          <Button onClick={() => setSsoRiskEscalationDrawerOpen(false)}>{t("common.cancel")}</Button>
                          <Button loading={saveSsoRiskEscalation.isPending} disabled={!selectedSsoProviderExists} onClick={() => saveSsoRiskEscalation.mutate()}>{t("page.settings.ssoRiskEscalationSave")}</Button>
                          <Button type="primary" loading={runSsoRiskEscalation.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskEscalation.mutate(false)}>{t("page.settings.ssoRiskEscalationRun")}</Button>
                        </Space>
                      }
                    >
                      <div className="space-y-4">
                        <Steps
                          size="small"
                          current={ssoRiskEscalationResult?.triggered ? 2 : ssoRiskEscalationResult ? 1 : 0}
                          items={[
                            { title: t("page.settings.ssoRiskEscalationSave", { defaultValue: "保存" }) },
                            { title: t("page.settings.ssoRiskEscalationPreview", { defaultValue: "预览" }) },
                            { title: t("page.settings.ssoRiskEscalationRun", { defaultValue: "执行" }) },
                          ]}
                        />
                        <Form layout="vertical">
                          <div className="grid gap-3 sm:grid-cols-3">
                            {ssoRiskEscalationBooleanControls.map((item) => (
                              <Form.Item key={item.key} label={t(`page.settings.${item.label}`)}>
                                <Switch checked={ssoRiskEscalationDraft[item.key]} onChange={(checked) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, [item.key]: checked })} />
                              </Form.Item>
                            ))}
                          </div>
                          <Form.Item label={t("page.settings.ssoRiskEscalationActions")} required>
                            <Select
                              mode="multiple"
                              value={ssoRiskEscalationDraft.actions}
                              onChange={(actions) => setSsoRiskEscalationDraft({
                                ...ssoRiskEscalationDraft,
                                actions: (actions as string[]).filter((action): action is SsoRiskEscalationAction => ssoRiskEscalationActions.includes(action as SsoRiskEscalationAction)),
                              })}
                              options={ssoRiskEscalationActions.map((action) => ({
                                value: action,
                                label: String(t(`page.settings.ssoRiskEscalationAction.${action}`, { defaultValue: action })),
                              }))}
                            />
                          </Form.Item>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item label={t("page.settings.ssoRiskSubscriptionMinSeverity")}>
                              <Select
                                value={ssoRiskEscalationDraft.min_severity}
                                onChange={(min_severity) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, min_severity })}
                                options={["high", "medium", "low"].map((severity) => ({ value: severity, label: String(t(`page.settings.ssoRiskSubscriptionSeverity.${severity}`, { defaultValue: severity })) }))}
                              />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskEscalationPriority", { defaultValue: "优先级" })}>
                              <Select value={ssoRiskEscalationDraft.priority} onChange={(priority) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, priority })} options={["P0", "P1", "P2", "P3"].map((priority) => ({ value: priority, label: priority }))} />
                            </Form.Item>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Form.Item label={t("page.settings.ssoRiskEscalationScoreThreshold")} required>
                              <Input type="number" min={0} max={100} value={ssoRiskEscalationDraft.score_threshold} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, score_threshold: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskEscalationCooldown")} required>
                              <Input type="number" min={0} max={10080} value={ssoRiskEscalationDraft.cooldown_minutes} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, cooldown_minutes: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskEscalationLimit")} required>
                              <Input type="number" min={1} max={20} value={ssoRiskEscalationDraft.limit} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, limit: e.target.value })} />
                            </Form.Item>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item label={t("page.settings.ssoRiskEscalationAssignee")}>
                              <Input value={ssoRiskEscalationDraft.assigned_to} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, assigned_to: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskEscalationDevTool")}>
                              <Input value={ssoRiskEscalationDraft.dev_tool} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, dev_tool: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskEscalationOwner")}>
                              <Input value={ssoRiskEscalationDraft.owner} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, owner: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskEscalationTitlePh")}>
                              <Input value={ssoRiskEscalationDraft.title} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, title: e.target.value })} />
                            </Form.Item>
                          </div>
                          <Form.Item label={t("page.settings.ssoRiskEscalationChannels")}>
                            <Select
                              mode="multiple"
                              allowClear
                              value={ssoRiskEscalationDraft.channels}
                              onChange={(channels) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, channels })}
                              placeholder={t("page.settings.selectNotifyChannel")}
                              options={(notifyChannels.data || []).map((channel: any) => ({
                                value: channel.name,
                                label: `${channel.name} · ${channel.type}`,
                              }))}
                            />
                          </Form.Item>
                          {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.ssoRiskEscalationNoChannels")} /> : null}
                          <Form.Item label={t("page.settings.ssoRiskEscalationNotes")}>
                            <Input.TextArea rows={3} value={ssoRiskEscalationDraft.notes} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, notes: e.target.value })} />
                          </Form.Item>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <Button loading={saveSsoRiskEscalation.isPending} disabled={!selectedSsoProviderExists} onClick={() => saveSsoRiskEscalation.mutate()}>
                              {t("page.settings.ssoRiskEscalationSave")}
                            </Button>
                            <Button loading={runSsoRiskEscalation.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskEscalation.mutate(true)}>
                              {t("page.settings.ssoRiskEscalationPreview")}
                            </Button>
                            <Button type="primary" loading={runSsoRiskEscalation.isPending} disabled={!selectedSsoProviderExists} onClick={() => runSsoRiskEscalation.mutate(false)}>
                              {t("page.settings.ssoRiskEscalationRun")}
                            </Button>
                          </div>
                        </Form>
                      </div>
                    </Drawer>
                    <div className="mt-4 grid gap-3 sm:grid-cols-4">
                      <Info label={t("page.settings.ssoRiskEscalationLastRun")} value={String(ssoRiskEscalation.data?.policy?.last_run_at || "-")} />
                      <Info label={t("page.settings.ssoRiskEscalationLastTriggered")} value={String(ssoRiskEscalation.data?.policy?.last_triggered_at || "-")} />
                      <Info label={t("page.settings.ssoRiskEscalationTriggered")} value={ssoRiskEscalationResult ? String(Boolean(ssoRiskEscalationResult.triggered)) : "-"} />
                      <Info label={t("page.settings.ssoRiskEscalationReason")} value={ssoRiskEscalationResult ? String(t(`page.settings.ssoRiskEscalationReasonValue.${ssoRiskEscalationResult.reason || "no_matching_risk"}`, { defaultValue: ssoRiskEscalationResult.reason || "-" })) : "-"} />
                    </div>
                    {ssoRiskEscalation.error ? <ErrorLine message={(ssoRiskEscalation.error as Error).message} /> : null}
                    {saveSsoRiskEscalation.error ? <ErrorLine message={(saveSsoRiskEscalation.error as Error).message} /> : null}
                    {runSsoRiskEscalation.error ? <ErrorLine message={(runSsoRiskEscalation.error as Error).message} /> : null}
                    <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <div className="grid gap-3 md:grid-cols-4">
                          <Info label={t("page.settings.ssoRiskEscalationActions")} value={(ssoRiskEscalationResult?.actions || ssoRiskEscalation.data?.policy?.actions || []).join(", ") || "-"} />
                          <Info label={t("page.settings.ssoRiskTaskPlanned")} value={String(ssoRiskEscalationResult?.task_result?.summary?.planned || 0)} />
                          <Info label={t("page.settings.ssoRiskTaskCreated")} value={String(ssoRiskEscalationResult?.task_result?.summary?.created || 0)} />
                          <Info label={t("page.settings.ssoRiskImSent")} value={String(ssoRiskEscalationResult?.im_result?.audit?.sent_count || ssoRiskEscalationResult?.im_result?.sent?.length || 0)} />
                        </div>
                        {ssoRiskEscalationResult ? <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{ssoRiskEscalationResult.im_result?.briefing?.content || JSON.stringify(ssoRiskEscalationResult.audit || {}, null, 2)}</pre> : null}
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskEscalationHistory")}</p>
                        <div className="mt-2 space-y-2">
                          {(ssoRiskEscalation.data?.history?.items || ssoRiskEscalationResult?.history?.items || []).length ? (ssoRiskEscalation.data?.history?.items || ssoRiskEscalationResult?.history?.items || []).map((item: any) => (
                            <div key={item.id || item.created_at} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-[var(--text)]">{item.actor || "-"}</span><span className="font-mono text-[var(--muted-strong)]">{item.created_at || "-"}</span></div>
                              <p className="mt-1 text-[var(--muted)]">{String(t(`page.settings.ssoRiskEscalationReasonValue.${item.reason || "no_matching_risk"}`, { defaultValue: item.reason || "-" }))} · {item.created_count || 0}/{item.sent_count || 0}</p>
                            </div>
                          )) : <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoRiskEscalationHistoryEmpty")}</p>}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <FileText className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskRunbookTitle")}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.ssoRiskRunbookDesc")}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={ssoRiskRunbookDetail?.item?.status === "verified" ? "ok" : ssoRiskRunbookDetail?.item?.status === "risk" ? "danger" : "warn"} label={ssoRiskRunbookDetail?.item?.status ? String(t(`page.settings.ssoRiskRunbookStatus.${ssoRiskRunbookDetail.item.status}`, { defaultValue: ssoRiskRunbookDetail.item.status })) : "RUNBOOK"} />
                    <button type="button" className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50" disabled={ssoRiskRunbooks.isFetching} onClick={() => void ssoRiskRunbooks.refetch()}>
                      {t("common.refresh")}
                    </button>
                  </div>
                </div>
                {!selectedSsoProviderExists ? (
                  <HintLine message={t("page.settings.ssoRiskNoProvider")} />
                ) : (
                  <>
                    <div className="ssoRiskRunbookQuickSummary mt-4 grid gap-3 sm:grid-cols-4">
                      <Info label={t("page.settings.ssoRiskRunbookLimit")} value={ssoRiskRunbookDraft.limit} />
                      <Info label={t("tasks.priority")} value={ssoRiskRunbookDraft.priority} />
                      <Info label={t("page.settings.ssoRiskRunbookAssignee")} value={ssoRiskRunbookDraft.assigned_to || "-"} />
                      <Info label={t("page.settings.ssoRiskRunbookChannels")} value={String(ssoRiskRunbookDraft.channels.length || (notifyChannels.data || []).length || 0)} />
                    </div>
                    <Button className="mt-3" block type="primary" icon={<FileText className="h-4 w-4" />} disabled={!selectedSsoProviderExists} onClick={() => setSsoRiskRunbookDrawerOpen(true)}>
                      {t("page.settings.ssoRiskRunbookOpenDrawer", { defaultValue: "配置处置 Runbook" })}
                    </Button>
                    <Drawer
                      title={t("page.settings.ssoRiskRunbookTitle")}
                      open={ssoRiskRunbookDrawerOpen}
                      onClose={() => setSsoRiskRunbookDrawerOpen(false)}
                      width={620}
                      destroyOnClose={false}
                      extra={
                        <Space>
                          <Button onClick={() => setSsoRiskRunbookDrawerOpen(false)}>{t("common.cancel")}</Button>
                          <Button type="primary" loading={createSsoRiskRunbook.isPending} disabled={!selectedSsoProviderExists} onClick={() => createSsoRiskRunbook.mutate()}>{t("page.settings.ssoRiskRunbookCreate")}</Button>
                        </Space>
                      }
                    >
                      <div className="space-y-4">
                        <Steps
                          size="small"
                          current={ssoRiskRunbookDetail?.item?.task_count ? 2 : ssoRiskRunbookDetail?.item?.id ? 1 : 0}
                          items={[
                            { title: t("page.settings.ssoRiskRunbookCreate", { defaultValue: "生成 Runbook" }) },
                            { title: t("page.settings.ssoRiskRunbookPreviewTasks", { defaultValue: "预览任务" }) },
                            { title: t("page.settings.ssoRiskRunbookCreateTasks", { defaultValue: "生成任务" }) },
                          ]}
                        />
                        <Form layout="vertical">
                          <Form.Item label={t("page.settings.ssoRiskRunbookIncludeLow")}>
                            <Switch checked={ssoRiskRunbookDraft.include_low} onChange={(include_low) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, include_low })} />
                          </Form.Item>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item label={t("page.settings.ssoRiskRunbookLimit")} required>
                              <Input type="number" min={1} max={20} value={ssoRiskRunbookDraft.limit} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, limit: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("tasks.priority")}>
                              <Select value={ssoRiskRunbookDraft.priority} onChange={(priority) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, priority })} options={["P0", "P1", "P2", "P3"].map((priority) => ({ value: priority, label: priority }))} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskRunbookAssignee")}>
                              <Input value={ssoRiskRunbookDraft.assigned_to} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, assigned_to: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskEscalationDevTool")}>
                              <Input value={ssoRiskRunbookDraft.dev_tool} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, dev_tool: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskRunbookOwner")}>
                              <Input value={ssoRiskRunbookDraft.owner} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, owner: e.target.value })} />
                            </Form.Item>
                            <Form.Item label={t("page.settings.ssoRiskRunbookTitlePh")}>
                              <Input value={ssoRiskRunbookDraft.title} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, title: e.target.value })} />
                            </Form.Item>
                          </div>
                          <Form.Item label={t("page.settings.ssoRiskRunbookChannels")}>
                            <Select
                              mode="multiple"
                              allowClear
                              value={ssoRiskRunbookDraft.channels}
                              onChange={(channels) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, channels })}
                              placeholder={t("page.settings.selectNotifyChannel")}
                              options={(notifyChannels.data || []).map((channel: any) => ({
                                value: channel.name,
                                label: `${channel.name} · ${channel.type}`,
                              }))}
                            />
                          </Form.Item>
                          {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.ssoRiskRunbookNoChannels")} /> : null}
                          <Form.Item label={t("page.settings.ssoRiskRunbookNotes")}>
                            <Input.TextArea rows={3} value={ssoRiskRunbookDraft.notes} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, notes: e.target.value })} />
                          </Form.Item>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Button type="primary" icon={<FileText className="h-4 w-4" />} loading={createSsoRiskRunbook.isPending} disabled={!selectedSsoProviderExists} onClick={() => createSsoRiskRunbook.mutate()}>
                              {t("page.settings.ssoRiskRunbookCreate")}
                            </Button>
                            <Button icon={<ListChecks className="h-4 w-4" />} loading={applySsoRiskRunbookAction.isPending} disabled={!ssoRiskRunbookDetail?.item?.id} onClick={() => applySsoRiskRunbookAction.mutate({ action: "preview_tasks", dryRun: true })}>
                              {t("page.settings.ssoRiskRunbookPreviewTasks")}
                            </Button>
                            <Button icon={<ListChecks className="h-4 w-4" />} loading={applySsoRiskRunbookAction.isPending} disabled={!ssoRiskRunbookDetail?.item?.id} onClick={() => applySsoRiskRunbookAction.mutate({ action: "create_tasks", dryRun: false })}>
                              {t("page.settings.ssoRiskRunbookCreateTasks")}
                            </Button>
                            <Button icon={<MessageSquare className="h-4 w-4" />} loading={applySsoRiskRunbookAction.isPending} disabled={!ssoRiskRunbookDetail?.item?.id} onClick={() => applySsoRiskRunbookAction.mutate({ action: "send_im", dryRun: true })}>
                              {t("page.settings.ssoRiskRunbookPreviewIm")}
                            </Button>
                            <Button type="primary" icon={<ShieldCheck className="h-4 w-4" />} loading={applySsoRiskRunbookAction.isPending} disabled={!ssoRiskRunbookDetail?.item?.id} onClick={() => applySsoRiskRunbookAction.mutate({ action: "verify", dryRun: true })}>
                              {t("page.settings.ssoRiskRunbookVerify")}
                            </Button>
                            <Button danger loading={applySsoRiskRunbookAction.isPending} disabled={!ssoRiskRunbookDetail?.item?.id} onClick={() => applySsoRiskRunbookAction.mutate({ action: "archive", dryRun: false })}>
                              {t("page.settings.ssoRiskRunbookArchive")}
                            </Button>
                          </div>
                        </Form>
                        {createSsoRiskRunbook.error ? <ErrorLine message={(createSsoRiskRunbook.error as Error).message} /> : null}
                        {loadSsoRiskRunbook.error ? <ErrorLine message={(loadSsoRiskRunbook.error as Error).message} /> : null}
                        {applySsoRiskRunbookAction.error ? <ErrorLine message={(applySsoRiskRunbookAction.error as Error).message} /> : null}
                      </div>
                    </Drawer>
                    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskRunbookRecent")}</p>
                        <div className="mt-3 space-y-2">
                          {(ssoRiskRunbooks.data?.items || []).map((runbook: any) => (
                            <button key={runbook.id} type="button" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50" disabled={loadSsoRiskRunbook.isPending} onClick={() => loadSsoRiskRunbook.mutate(runbook.id)}>
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-semibold text-[var(--text)]">{runbook.title || runbook.id}</span>
                                <span className="shrink-0 text-[11px] text-[var(--muted)]">{`${runbook.step_done || 0}/${runbook.step_total || 0}`}</span>
                              </span>
                              <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${String(t(`page.settings.ssoRiskRunbookStatus.${runbook.status}`, { defaultValue: runbook.status || "-" }))} / ${runbook.risk_score || 0}`}</span>
                            </button>
                          ))}
                          {!ssoRiskRunbooks.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.ssoRiskRunbookEmpty")}</p> : null}
                        </div>
                        {ssoRiskRunbooks.error ? <ErrorLine message={(ssoRiskRunbooks.error as Error).message} /> : null}
                      </div>
                    {ssoRiskRunbookDetail ? (
                      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[var(--text)]">{ssoRiskRunbookDetail.item?.id}</p>
                              <p className="mt-1 truncate text-xs text-[var(--muted)]">{`${ssoRiskRunbookDetail.item?.provider || "-"} / ${ssoRiskRunbookDetail.item?.risk_status || "-"}`}</p>
                            </div>
                            <StatusPill tone={ssoRiskRunbookDetail.item?.status === "verified" ? "ok" : ssoRiskRunbookDetail.item?.status === "risk" ? "danger" : "warn"} label={String(t(`page.settings.ssoRiskRunbookStatus.${ssoRiskRunbookDetail.item?.status}`, { defaultValue: ssoRiskRunbookDetail.item?.status || "-" }))} />
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-4">
                            <Info label={t("page.settings.ssoRiskRunbookRiskScore")} value={String(ssoRiskRunbookDetail.item?.risk_score || 0)} />
                            <Info label={t("page.settings.ssoRiskRunbookFindings")} value={String(ssoRiskRunbookDetail.item?.finding_count || 0)} />
                            <Info label={t("page.settings.ssoRiskRunbookSteps")} value={`${ssoRiskRunbookDetail.item?.step_done || 0}/${ssoRiskRunbookDetail.item?.step_total || 0}`} />
                            <Info label={t("page.settings.ssoRiskRunbookTasks")} value={String(ssoRiskRunbookDetail.item?.task_count || 0)} />
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {(ssoRiskRunbookDetail.runbook?.steps || []).map((step: any) => (
                              <div key={step.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="truncate font-medium text-[var(--text)]">{step.title || step.id}</span>
                                  <StatusPill tone={step.status === "completed" ? "ok" : step.status === "failed" ? "danger" : "warn"} label={String(t(`page.settings.ssoRiskRunbookStepStatus.${step.status}`, { defaultValue: step.status || "-" }))} />
                                </div>
                                <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${step.kind || "-"} / ${step.owner || "-"}`}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button type="button" className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--text)] disabled:opacity-50" disabled={applySsoRiskRunbookAction.isPending} onClick={() => applySsoRiskRunbookAction.mutate({ action: "mark_step_done", dryRun: false, stepId: step.id })}>{t("page.settings.ssoRiskRunbookStepDone")}</button>
                                  <button type="button" className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--text)] disabled:opacity-50" disabled={applySsoRiskRunbookAction.isPending} onClick={() => applySsoRiskRunbookAction.mutate({ action: "mark_step_failed", dryRun: false, stepId: step.id })}>{t("page.settings.ssoRiskRunbookStepFailed")}</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                          <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskRunbookEvidence")}</p>
                          <div className="mt-3 space-y-2">
                            {(ssoRiskRunbookDetail.runbook?.events || []).slice(-5).reverse().map((event: any) => (
                              <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                                <p className="font-semibold text-[var(--text)]">{String(t(`page.settings.ssoRiskRunbookEvent.${event.kind}`, { defaultValue: event.kind || "-" }))}</p>
                                <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                              </div>
                            ))}
                          </div>
                          {ssoRiskRunbookDetail.result ? <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ planned: ssoRiskRunbookDetail.result.planned?.length, created: ssoRiskRunbookDetail.result.created?.length, im: ssoRiskRunbookDetail.result.im?.audit, risk: ssoRiskRunbookDetail.result.risk }, null, 2)}</pre> : null}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoScimAuditTitle")}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoScimAuditDesc")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={(ssoScimAudit.data?.summary?.failed || 0) > 0 ? "danger" : "ok"} label={String(ssoScimAudit.data?.summary?.total || 0)} />
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50"
                      disabled={!selectedSsoProviderExists || ssoScimAudit.isFetching}
                      onClick={() => void ssoScimAudit.refetch()}
                    >
                      {t("page.settings.ssoScimAuditRefresh")}
                    </button>
                  </div>
                </div>
                {!selectedSsoProviderExists ? (
                  <HintLine message={t("page.settings.ssoScimAuditNoProvider")} />
                ) : ssoScimAudit.error ? (
                  <ErrorLine message={(ssoScimAudit.error as Error).message} />
                ) : (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Info label={t("page.settings.ssoScimAuditTotal")} value={String(ssoScimAudit.data?.summary?.total || 0)} />
                      <Info label={t("page.settings.ssoScimAuditFailures")} value={String(ssoScimAudit.data?.summary?.failed || 0)} />
                      <Info label={t("page.settings.ssoScimAuditSkipped")} value={String(ssoScimAudit.data?.summary?.skipped || 0)} />
                      <Info label={t("page.settings.ssoScimAuditLast")} value={String(ssoScimAudit.data?.summary?.last_event_at || "-")} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {Object.entries(ssoScimAudit.data?.summary?.by_event || {}).map(([event, count]) => (
                        <span key={event} className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 font-mono text-[11px] text-[var(--muted-strong)]">{event}: {String(count)}</span>
                      ))}
                    </div>
                    <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)]">
                      <div className="grid min-w-[44rem] grid-cols-[9rem_8rem_8rem_1fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                        <span>{t("page.settings.ssoScimAuditEvent")}</span>
                        <span>{t("page.settings.status")}</span>
                        <span>{t("page.settings.ssoScimAuditActor")}</span>
                        <span>{t("page.settings.ssoScimAuditDetails")}</span>
                      </div>
                      {(ssoScimAudit.data?.items || []).length ? (ssoScimAudit.data.items || []).map((event: any) => (
                        <div key={event.event_id} className="grid min-w-[44rem] grid-cols-[9rem_8rem_8rem_1fr] gap-3 border-b border-[var(--border)] px-3 py-2 text-xs last:border-0">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[var(--text)]">{event.event_type}</p>
                            <p className="truncate text-[var(--muted)]">{event.ts}</p>
                          </div>
                          <span className="font-mono text-[var(--muted-strong)]">{event.status}</span>
                          <span className="truncate font-mono text-[var(--muted-strong)]">{event.actor || "-"}</span>
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[var(--muted-strong)]">{event.subject || "-"}</p>
                            <p className="truncate font-mono text-[11px] text-[var(--muted)]">{JSON.stringify(event.details || {})}</p>
                          </div>
                        </div>
                      )) : (
                        <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">{t("page.settings.ssoScimAuditEmpty")}</div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="grid grid-cols-[1fr_5rem_7rem_7rem_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                  <span>{t("page.settings.ssoProvider")}</span>
                  <span>{t("page.settings.ssoType")}</span>
                  <span>{t("page.settings.ssoSource")}</span>
                  <span>{t("page.settings.ssoReadiness")}</span>
                  <span>{t("page.settings.status")}</span>
                </div>
                {(ssoConfig.data?.items || []).map((row: any) => (
                  <div key={row.name} className="grid grid-cols-[1fr_5rem_7rem_7rem_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => setSsoDraft({
                        provider: row.name,
                        type: row.type || "oidc",
                        issuer: row.issuer || "",
                        client_id: row.client_id || "",
                        client_secret: "",
                        redirect_uri: row.redirect_uri || "",
                        scope: row.scope || "openid profile email",
                        metadata_url: row.metadata_url || "",
                        sso_url: row.sso_url || "",
                        x509_cert: "",
                        name_id_format: row.name_id_format || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
                        scim_enabled: row.scim?.enabled || false,
                        tenant_domain_map: mapToLines(row.tenant_domain_map || {}),
                        role_map: mapToLines(row.role_map || {}),
                        enabled: row.enabled !== false,
                      })}
                    >
                      <span className="block truncate text-sm font-semibold text-[var(--text)]">{row.name}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">{row.issuer || row.metadata_url}</span>
                    </button>
                    <span className="text-xs uppercase text-[var(--muted-strong)]">{row.type}</span>
                    <span className="text-xs text-[var(--muted-strong)]">{row.source}</span>
                    <span className={row.type === "saml" && !row.saml?.ready ? "text-xs text-amber-600" : "text-xs text-emerald-600"}>
                      {row.type === "saml" ? (row.saml?.ready ? t("page.settings.ssoReady") : t("page.settings.ssoNotReady")) : "OIDC"}
                    </span>
                    <button type="button" className="text-left text-xs text-[var(--brand)] disabled:opacity-50" disabled={deleteSso.isPending || row.source === "env"} onClick={() => deleteSso.mutate(row.name)}>
                      {row.source === "env" ? "env" : t("common.delete")}
                    </button>
                  </div>
                ))}
                {!ssoConfig.data?.items?.length ? <div className="px-4 py-8 text-sm text-[var(--muted)]">{t("page.settings.ssoEmpty")}</div> : null}
              </div>
              {ssoConfig.isError ? <ErrorLine message={(ssoConfig.error as Error).message} /> : null}
              {ssoConfig.data?.config_path ? <p className="break-all text-xs text-[var(--muted)]">{ssoConfig.data.config_path}</p> : null}
            </div>
          </div>
        </Card>
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
