import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/Settings.tsx"), "utf8");
const appearanceSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsAppearancePanel.tsx"), "utf8");
const accountSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsAccountPanel.tsx"), "utf8");
const workspaceSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsWorkspacePanel.tsx"), "utf8");
const runtimeSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsRuntimePanel.tsx"), "utf8");
const storageSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsStoragePanel.tsx"), "utf8");
const billingSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsBillingPanel.tsx"), "utf8");
const ssoSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsSsoPanel.tsx"), "utf8");

describe("Settings workbench UX contract", () => {
  it("keeps environment Profile editing in a focused drawer flow", () => {
    expect(source).toContain("profileDrawerOpen");
    expect(source).toContain("<Drawer");
    expect(source).toContain("<Form");
    expect(source).toContain("<Steps");
    expect(source).toContain("setProfileDrawerOpen(true)");
  });

  it("keeps the Profiles main surface focused on status, templates, and lists", () => {
    expect(source).toContain("profileQuickSummary");
    expect(source).not.toContain("onSubmit={(e) => {\n                e.preventDefault();\n                if (!profileDraft.name.trim()) return;\n                saveProfile.mutate();\n              }}");
  });

  it("keeps release pipeline creation in a preview-first drawer flow", () => {
    expect(source).toContain("deploymentPipelineDrawerOpen");
    expect(source).toContain("pipelineQuickSummary");
    expect(source).toContain("pipelineOpenDrawer");
    expect(source).toContain("setDeploymentPipelineDrawerOpen(true)");
    expect(source).toContain("Switch checked={deploymentPipelineDraft.dry_run}");
    expect(source).toContain("createDeploymentPipeline.mutate(true)");
    expect(source).toContain("createDeploymentPipeline.mutate(false)");
  });

  it("keeps SSO risk governance tasking in a focused drawer flow", () => {
    expect(source).toContain("ssoRiskTaskDrawerOpen");
    expect(source).toContain('lazy(() => import("./settings/SettingsSsoPanel")');
    expect(source).toContain("SettingsSsoPanel");
    expect(source).not.toContain("ssoRiskTaskQuickSummary");
    expect(ssoSource).toContain("export function SettingsSsoPanel");
    expect(ssoSource).toContain("ssoRiskTaskQuickSummary");
    expect(ssoSource).toContain("ssoRiskTaskOpenDrawer");
    expect(ssoSource).toContain("setSsoRiskTaskDrawerOpen(true)");
    expect(ssoSource).toContain("Switch checked={ssoRiskTaskDraft.include_low}");
    expect(ssoSource).toContain("runSsoRiskTasks.mutate(true)");
    expect(ssoSource).toContain("runSsoRiskTasks.mutate(false)");
  });

  it("keeps SSO risk IM notification in a focused drawer flow", () => {
    expect(source).toContain("ssoRiskImDrawerOpen");
    expect(source).not.toContain("ssoRiskImQuickSummary");
    expect(ssoSource).toContain("ssoRiskImQuickSummary");
    expect(ssoSource).toContain("ssoRiskImOpenDrawer");
    expect(ssoSource).toContain("setSsoRiskImDrawerOpen(true)");
    expect(ssoSource).toContain('mode="multiple"');
    expect(ssoSource).toContain("Switch checked={ssoRiskImDraft.include_low}");
    expect(ssoSource).toContain("runSsoRiskIm.mutate(true)");
    expect(ssoSource).toContain("runSsoRiskIm.mutate(false)");
  });

  it("keeps SSO risk auto escalation in a focused drawer flow", () => {
    expect(source).toContain("ssoRiskEscalationDrawerOpen");
    expect(source).not.toContain("ssoRiskEscalationQuickSummary");
    expect(ssoSource).toContain("ssoRiskEscalationQuickSummary");
    expect(ssoSource).toContain("ssoRiskEscalationOpenDrawer");
    expect(ssoSource).toContain("setSsoRiskEscalationDrawerOpen(true)");
    expect(ssoSource).toContain("Switch checked={ssoRiskEscalationDraft[item.key]}");
    expect(ssoSource).toContain("ssoRiskEscalationDraft.actions");
    expect(ssoSource).toContain("saveSsoRiskEscalation.mutate()");
    expect(ssoSource).toContain("runSsoRiskEscalation.mutate(true)");
    expect(ssoSource).toContain("runSsoRiskEscalation.mutate(false)");
  });

  it("keeps SSO risk Runbook in a focused drawer flow", () => {
    expect(source).toContain("ssoRiskRunbookDrawerOpen");
    expect(source).not.toContain("ssoRiskRunbookQuickSummary");
    expect(ssoSource).toContain("ssoRiskRunbookQuickSummary");
    expect(ssoSource).toContain("ssoRiskRunbookOpenDrawer");
    expect(ssoSource).toContain("setSsoRiskRunbookDrawerOpen(true)");
    expect(ssoSource).toContain("Switch checked={ssoRiskRunbookDraft.include_low}");
    expect(ssoSource).toContain("ssoRiskRunbookDraft.channels");
    expect(ssoSource).toContain("createSsoRiskRunbook.mutate()");
    expect(ssoSource).toContain('action: "preview_tasks"');
    expect(ssoSource).toContain('action: "create_tasks"');
    expect(ssoSource).toContain('action: "send_im"');
    expect(ssoSource).toContain('action: "verify"');
    expect(ssoSource).toContain('action: "archive"');
  });

  it("keeps billing subscription policy and payment in a focused drawer flow", () => {
    expect(source).toContain("billingDrawerOpen");
    expect(source).toContain('lazy(() => import("./settings/SettingsBillingPanel")');
    expect(source).toContain("SettingsBillingPanel");
    expect(source).not.toContain("billingControlQuickSummary rounded-2xl");
    expect(billingSource).toContain("export function SettingsBillingPanel");
    expect(billingSource).toContain("billingControlQuickSummary");
    expect(billingSource).toContain("billingOpenDrawer");
    expect(billingSource).toContain("setBillingDrawerOpen(true)");
    expect(billingSource).toContain("billingSubscriptionStep");
    expect(billingSource).toContain("billingOverageStep");
    expect(billingSource).toContain("billingPaymentStep");
    expect(billingSource).toContain("updateBilling.mutate()");
    expect(billingSource).toContain("updateOveragePolicy.mutate()");
    expect(billingSource).toContain("recordPayment.mutate()");
    expect(billingSource).toContain("overageDraft.approval_threshold_percent");
    expect(billingSource).toContain("paymentDraft.method");
    expect(billingSource).toContain("api.billingInvoiceCsvUrl");
    expect(billingSource).toContain("invoiceAudit.data?.items");
    expect(billingSource).toContain("checkEntitlement.mutate()");
  });

  it("keeps appearance settings as an independent lightweight module", () => {
    expect(source).toContain("SettingsAppearancePanel");
    expect(source).toContain('lazy(() => import("./settings/SettingsAppearancePanel")');
    expect(source).toContain("<Suspense");
    expect(source).not.toContain("const [themePref, setThemePref]");
    expect(appearanceSource).toContain("export function SettingsAppearancePanel");
    expect(appearanceSource).toContain("THEME_OPTIONS.map");
    expect(appearanceSource).toContain("setThemePreference(theme)");
    expect(appearanceSource).toContain('window.addEventListener("sop-theme"');
    expect(appearanceSource).toContain("sm:grid-cols-2 xl:grid-cols-4");
  });

  it("keeps account session controls as an independent lazy module", () => {
    expect(source).toContain('lazy(() => import("./settings/SettingsAccountPanel")');
    expect(source).toContain("SettingsAccountPanel");
    expect(source).toContain("onLogout={() => logout.mutate()}");
    expect(source).not.toContain("const [themePref, setThemePref]");
    expect(accountSource).toContain("export function SettingsAccountPanel");
    expect(accountSource).toContain("LogOut");
    expect(accountSource).toContain("logoutPending");
    expect(accountSource).toContain("tenantLabel");
    expect(accountSource).toContain("projectId");
    expect(accountSource).toContain("sm:grid-cols-2 xl:grid-cols-4");
  });

  it("keeps workspace management entries as an independent lazy module", () => {
    expect(source).toContain('lazy(() => import("./settings/SettingsWorkspacePanel")');
    expect(source).toContain("SettingsWorkspacePanel");
    expect(source).not.toContain('SettingLink href="#/organization"');
    expect(workspaceSource).toContain("export function SettingsWorkspacePanel");
    expect(workspaceSource).toContain('href="#/organization"');
    expect(workspaceSource).toContain('href="#/intelligence"');
    expect(workspaceSource).toContain('href="#/vibe"');
    expect(workspaceSource).toContain('href="#/orchestration"');
    expect(workspaceSource).toContain('href="#/search"');
    expect(workspaceSource).toContain('href="/login.html"');
    expect(workspaceSource).toContain("md:grid-cols-2 xl:grid-cols-4");
  });

  it("keeps runtime and observability as an independent lazy module", () => {
    expect(source).toContain('lazy(() => import("./settings/SettingsRuntimePanel")');
    expect(source).toContain("SettingsRuntimePanel");
    expect(source).not.toContain('SettingLink href="/api/v1/health"');
    expect(runtimeSource).toContain("export function SettingsRuntimePanel");
    expect(runtimeSource).toContain('href="/api/v1/health"');
    expect(runtimeSource).toContain('href="/metrics"');
    expect(runtimeSource).toContain('href="/api/v1/events"');
    expect(runtimeSource).toContain('href="/api/v1/system/ops/observability"');
    expect(runtimeSource).toContain("opsTraceSummary.refetch()");
    expect(runtimeSource).toContain("opsLogs.data?.items");
    expect(runtimeSource).toContain("setLogFilter");
    expect(runtimeSource).toContain("setTraceFilter");
    expect(runtimeSource).toContain("xl:grid-cols-[minmax(0,1fr)_24rem]");
  });

  it("keeps production storage as an independent lazy module", () => {
    expect(source).toContain('lazy(() => import("./settings/SettingsStoragePanel")');
    expect(source).toContain("SettingsStoragePanel");
    expect(source).not.toContain("storageBackupRestore\")}</p>");
    expect(storageSource).toContain("export function SettingsStoragePanel");
    expect(storageSource).toContain("opsStorageMigrationPlan.refetch()");
    expect(storageSource).toContain("runStorageSmoke.mutate()");
    expect(storageSource).toContain("storageSmokeResult?.checks");
    expect(storageSource).toContain("backup_restore_checklist");
    expect(storageSource).toContain("storageCoreTables");
    expect(storageSource).toContain("storageScopeColumns");
    expect(storageSource).toContain("storageScopeIndexes");
    expect(storageSource).toContain("xl:grid-cols-[24rem_minmax(0,1fr)]");
  });
});
