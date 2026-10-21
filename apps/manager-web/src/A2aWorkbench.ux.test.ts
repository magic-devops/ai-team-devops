import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { externalWorkOrderCopy, externalWorkOrderNavigation } from "./i18n/external-work-orders";
import { parseExternalWorkOrderRoute } from "./lib/externalWorkOrderRoute";
const root = resolve(__dirname, "..");
const source = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ecosystem/A2aWorkbench.tsx"), "utf8");
const apiSource = readFileSync(resolve(root, "src/lib/api.ts"), "utf8");
describe("canonical external work-order entry", () => {
  it("routes former protocol entries into the same project-bound work-order experience", () => {
    for (const path of ["registry", "negotiate", "dispatch", "evidence", "sla", "windows"]) {
      const route = parseExternalWorkOrderRoute(`#/ecosystem/a2a/${path}?project_id=P&task_id=T`);
      expect(route.invalid).toBe(false); expect(route.projectId).toBe("P"); expect(route.taskId).toBe("T");
    }
  });
  it("has no legacy API write consumer, fabricated Task, preset progress or confidence result", () => {
    expect(source).not.toContain("manual-${Date.now()}");
    expect(source).not.toContain("api.a2a");
    expect(apiSource).not.toContain("/api/v1/a2a/");
    expect(source).not.toContain("confidence: 0.95");
    expect(source).toContain("ExternalWorkOrderPanel");
    expect(source).toContain("ProjectContextGate requireSelection");
  });
  it("uses one independent three-language dictionary including queued, stop attestation and human review", () => {
    for (const language of ["zh-CN", "en-US", "ja-JP"] as const) {
      const copy = externalWorkOrderCopy(language);
      expect(externalWorkOrderNavigation[language].a2aGateway).toBe(copy.title);
      expect(copy.queuedHint).toBeTruthy(); expect(copy.reportStopConfirm).toBeTruthy(); expect(copy.deliveryStates.accepted).toBeTruthy();
    }
  });
});
