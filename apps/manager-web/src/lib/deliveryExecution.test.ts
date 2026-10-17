import { describe, expect, it } from "vitest";
import * as delivery from "./delivery";
import { readFileSync } from "node:fs";

describe("external delivery implementation gates", () => {
  it("exposes the pure dispatch preview instead of saving an unreviewed plan", () => {
    expect(delivery).toHaveProperty("previewDeliveryExecution");
    expect(delivery).toHaveProperty("fetchExecutionObservations");
  });
  it("removes name-only claim, heartbeat and result writes from the public client and UI", () => {
    const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
    const ui = readFileSync(
      new URL(
        "../../subapps/ai-rd-center/src/pages/Tasks.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    for (const removed of [
      "taskAgentClaim:",
      "taskAgentHeartbeat:",
      "taskAgentReport:",
    ])
      expect(api).not.toContain(removed);
    for (const removed of [
      "api.taskAgentClaim(",
      "api.taskAgentHeartbeat(",
      "claimMut.mutate(",
      "heartbeatMut.mutate(",
    ])
      expect(ui).not.toContain(removed);
  });
  it("uses the server policy permission instead of treating execution permission as configuration permission", () => {
    const source = readFileSync(
      new URL(
        "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionPanel.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source.includes("targets.data.can_configure_policy")).toBe(true);
    expect(
      source.includes(
        "canConfigure={data.permissions.configure && targets.data.can_execute}",
      ),
    ).toBe(false);
  });
});
