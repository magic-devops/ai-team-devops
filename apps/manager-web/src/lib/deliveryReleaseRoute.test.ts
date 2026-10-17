import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDeliveryRoute } from "./deliveryProjectInbox";

describe("quality and release workspace entry points", () => {
  it("restores both canonical workbench views instead of silently opening overview", () => {
    for (const view of ["quality", "releases"])
      expect(
        parseDeliveryRoute(`#/dev-flow?view=${view}&release_id=REL-exact`).view,
      ).toBe(view);
  });
  it("retires manual release writes while keeping the recorded history visible", () => {
    const ui = readFileSync(
      new URL(
        "../../subapps/ai-rd-center/src/pages/delivery/DeliveryWorkbench.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const api = readFileSync(new URL("./delivery.ts", import.meta.url), "utf8");
    expect(ui).not.toContain("const releaseEditor");
    expect(ui).not.toContain('commit("release.save"');
    expect(api).not.toContain('| "release.save"');
    expect(ui).toContain("selected.flow.releases");
    expect(ui).toContain("deliveryRelease.historicalManual");
  });
});
