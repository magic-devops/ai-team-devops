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
});
