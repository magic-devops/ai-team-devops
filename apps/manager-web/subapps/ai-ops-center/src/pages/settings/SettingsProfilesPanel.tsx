import { CloudCog, PackageCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Drawer, Form, Input, Select, Space, Steps } from "antd";
import { Card } from "@/components/Card";

type SettingsProfilesPanelProps = {
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
  controlledReleasesHref: string;
};

const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

export function SettingsProfilesPanel({
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
  controlledReleasesHref,
}: SettingsProfilesPanelProps) {
  const { t } = useTranslation();

  return (
        <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <p className="min-w-0 flex-1 text-sm text-[var(--muted-strong)]">{t("page.settings.configurationOnlyNotice")}</p>
          <a href={controlledReleasesHref} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--brand)]">{t("page.settings.controlledReleases")}</a>
        </div>
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
