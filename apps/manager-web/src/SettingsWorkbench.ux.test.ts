import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/Settings.tsx"), "utf8");

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
});
