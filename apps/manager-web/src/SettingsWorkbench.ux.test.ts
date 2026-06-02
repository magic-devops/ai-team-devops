import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/Settings.tsx"), "utf8");
const appearanceSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsAppearancePanel.tsx"), "utf8");
const accountSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsAccountPanel.tsx"), "utf8");
const workspaceSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/settings/SettingsWorkspacePanel.tsx"), "utf8");

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
    expect(source).toContain("ssoRiskTaskQuickSummary");
    expect(source).toContain("ssoRiskTaskOpenDrawer");
    expect(source).toContain("setSsoRiskTaskDrawerOpen(true)");
    expect(source).toContain("Switch checked={ssoRiskTaskDraft.include_low}");
    expect(source).toContain("runSsoRiskTasks.mutate(true)");
    expect(source).toContain("runSsoRiskTasks.mutate(false)");
  });

  it("keeps SSO risk IM notification in a focused drawer flow", () => {
    expect(source).toContain("ssoRiskImDrawerOpen");
    expect(source).toContain("ssoRiskImQuickSummary");
    expect(source).toContain("ssoRiskImOpenDrawer");
    expect(source).toContain("setSsoRiskImDrawerOpen(true)");
    expect(source).toContain('mode="multiple"');
    expect(source).toContain("Switch checked={ssoRiskImDraft.include_low}");
    expect(source).toContain("runSsoRiskIm.mutate(true)");
    expect(source).toContain("runSsoRiskIm.mutate(false)");
  });

  it("keeps SSO risk auto escalation in a focused drawer flow", () => {
    expect(source).toContain("ssoRiskEscalationDrawerOpen");
    expect(source).toContain("ssoRiskEscalationQuickSummary");
    expect(source).toContain("ssoRiskEscalationOpenDrawer");
    expect(source).toContain("setSsoRiskEscalationDrawerOpen(true)");
    expect(source).toContain("Switch checked={ssoRiskEscalationDraft[item.key]}");
    expect(source).toContain("ssoRiskEscalationDraft.actions");
    expect(source).toContain("saveSsoRiskEscalation.mutate()");
    expect(source).toContain("runSsoRiskEscalation.mutate(true)");
    expect(source).toContain("runSsoRiskEscalation.mutate(false)");
  });

  it("keeps SSO risk Runbook in a focused drawer flow", () => {
    expect(source).toContain("ssoRiskRunbookDrawerOpen");
    expect(source).toContain("ssoRiskRunbookQuickSummary");
    expect(source).toContain("ssoRiskRunbookOpenDrawer");
    expect(source).toContain("setSsoRiskRunbookDrawerOpen(true)");
    expect(source).toContain("Switch checked={ssoRiskRunbookDraft.include_low}");
    expect(source).toContain("ssoRiskRunbookDraft.channels");
    expect(source).toContain("createSsoRiskRunbook.mutate()");
    expect(source).toContain('action: "preview_tasks"');
    expect(source).toContain('action: "create_tasks"');
    expect(source).toContain('action: "send_im"');
    expect(source).toContain('action: "verify"');
    expect(source).toContain('action: "archive"');
  });

  it("keeps billing subscription policy and payment in a focused drawer flow", () => {
    expect(source).toContain("billingDrawerOpen");
    expect(source).toContain("billingControlQuickSummary");
    expect(source).toContain("billingOpenDrawer");
    expect(source).toContain("setBillingDrawerOpen(true)");
    expect(source).toContain("billingSubscriptionStep");
    expect(source).toContain("billingOverageStep");
    expect(source).toContain("billingPaymentStep");
    expect(source).toContain("updateBilling.mutate()");
    expect(source).toContain("updateOveragePolicy.mutate()");
    expect(source).toContain("recordPayment.mutate()");
    expect(source).toContain("overageDraft.approval_threshold_percent");
    expect(source).toContain("paymentDraft.method");
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
});
